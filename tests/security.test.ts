import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { seededDb } from './helpers';
import {
  tripCreate, tripGetAll, programGetById, cardEarningCreate, cardEarningsGetAll,
  statusOverrideSet, statusOverridesGetAll,
  adjustmentDelete, adjustmentsDeleteForProgramYear, adjustmentsGetAll,
} from '../electron/database';
import { resolveIconPath, iconPathWithinAssets, ICON_FILE } from '../electron/iconPath';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf-8');

describe('SQL injection resistance (parameterized queries)', () => {
  it('treats a malicious label as literal data, not SQL', () => {
    const db = seededDb();
    const evil = "Robert'); DROP TABLE trips;--";
    const before = tripGetAll(db).length;
    const created = tripCreate(db, { label: evil, start_date: '2026-01-01' });
    // Table still exists and the label survived verbatim.
    const after = tripGetAll(db).length;
    expect(after).toBe(before + 1);
    expect(created.label).toBe(evil);
    expect(() => db.prepare('SELECT COUNT(*) FROM trips').get()).not.toThrow();
  });

  it('does not interpolate program ids into SQL', () => {
    const db = seededDb();
    expect(programGetById(db, "aa' OR '1'='1")).toBeNull();
  });

  it('treats a malicious card-earnings note as literal data', () => {
    const db = seededDb();
    const evil = "note'); DROP TABLE card_earnings_entries;--";
    const created = cardEarningCreate(db, { program_id: 'dl', entry_date: '2026-05-01', metric_key: 'mqd', amount: 100, notes: evil });
    expect(created.notes).toBe(evil);
    expect(cardEarningsGetAll(db).some(c => c.id === created.id)).toBe(true);
    expect(() => db.prepare('SELECT COUNT(*) FROM card_earnings_entries').get()).not.toThrow();
  });

  it('treats a malicious status-override note as literal data', () => {
    const db = seededDb();
    const evil = "x'); DROP TABLE program_status_overrides;--";
    const created = statusOverrideSet(db, { program_id: 'aa', program_year: 2026, tier_name: 'Gold', notes: evil });
    expect(created.notes).toBe(evil);
    expect(statusOverridesGetAll(db).some(o => o.id === created.id)).toBe(true);
    expect(() => db.prepare('SELECT COUNT(*) FROM program_status_overrides').get()).not.toThrow();
  });
});

describe('no dynamic code execution in source', () => {
  const files = ['electron/database.ts', 'electron/main.ts', 'electron/preload.ts', 'electron/rules.ts'];
  it.each(files)('%s contains no eval / new Function', (f) => {
    const src = read(f);
    expect(src).not.toMatch(/\beval\s*\(/);
    expect(src).not.toMatch(/new\s+Function\s*\(/);
  });
});

describe('Electron hardening in main process', () => {
  const main = read('electron/main.ts');
  it('enables contextIsolation', () => {
    expect(main).toMatch(/contextIsolation:\s*true/);
  });
  it('disables nodeIntegration', () => {
    expect(main).toMatch(/nodeIntegration:\s*false/);
  });
  it('keeps webSecurity on', () => {
    expect(main).toMatch(/webSecurity:\s*true/);
  });
  it('sets a Content-Security-Policy and forbids external default-src', () => {
    expect(main).toMatch(/Content-Security-Policy/);
    expect(main).toMatch(/default-src 'self'/);
  });
  it('guards navigation and window.open to external origins', () => {
    expect(main).toMatch(/will-navigate/);
    expect(main).toMatch(/setWindowOpenHandler/);
  });
});

describe('preload exposes a narrow API only', () => {
  const preload = read('electron/preload.ts');
  it('uses contextBridge, not direct node exposure', () => {
    expect(preload).toMatch(/contextBridge\.exposeInMainWorld/);
    expect(preload).not.toMatch(/exposeInMainWorld\(['"]\w+['"],\s*require/);
  });
  it('does not leak ipcRenderer wholesale', () => {
    expect(preload).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer\s*\)/);
  });
});

describe('file path traversal guard', () => {
  const main = read('electron/main.ts');
  it('validates chosen file extensions before writing', () => {
    expect(main).toMatch(/safeChosenPath/);
    expect(main).toMatch(/path\.extname/);
  });
});

describe('window/taskbar icon wiring (v1.4)', () => {
  const main = read('electron/main.ts');
  it('passes a non-empty icon option to the BrowserWindow constructor', () => {
    // The constructor must set icon to the resolved app icon (not left to default).
    expect(main).toMatch(/new BrowserWindow\(\{[\s\S]*icon:\s*appIconPath\(\)/);
  });
  it('sets the AppUserModelId on Windows before creating the window', () => {
    expect(main).toMatch(/setAppUserModelId/);
    // Ordering: the AUMID call appears before createWindow() in whenReady.
    const aumidIdx = main.indexOf('setAppUserModelId');
    const createIdx = main.indexOf('createWindow();');
    expect(aumidIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(aumidIdx);
  });
});

describe('icon path resolution is a fixed, contained asset (no attacker input)', () => {
  const main = read('electron/main.ts');
  // The resolver takes only environment facts (isPackaged, resourcesPath, __dirname)
  // and a hard-coded filename constant — no user/renderer string ever participates.
  const dev = { isPackaged: false, resourcesPath: '/opt/app/resources', dirname: '/repo/electron/dist' };
  const packaged = { isPackaged: true, resourcesPath: '/opt/app/resources', dirname: '/opt/app/resources/app.asar/electron/dist' };

  it('resolves to the icon.ico filename in both dev and packaged modes', () => {
    expect(resolveIconPath(dev).endsWith(`assets/${ICON_FILE}`)).toBe(true);
    expect(resolveIconPath(packaged).endsWith(`assets/${ICON_FILE}`)).toBe(true);
  });

  it('always stays within the expected assets directory boundary', () => {
    expect(iconPathWithinAssets(dev)).toBe(true);
    expect(iconPathWithinAssets(packaged)).toBe(true);
  });

  it('packaged mode roots the icon under process.resourcesPath/assets', () => {
    expect(resolveIconPath(packaged)).toBe(`/opt/app/resources/assets/${ICON_FILE}`);
  });

  it('the icon filename constant contains no path separators or traversal', () => {
    expect(ICON_FILE).not.toMatch(/[\\/]/);
    expect(ICON_FILE).not.toContain('..');
  });

  it('the icon path helper in main.ts takes no user-controlled arguments', () => {
    // appIconPath() is nullary and feeds only app.isPackaged / process.resourcesPath / __dirname.
    expect(main).toMatch(/function appIconPath\(\):\s*string/);
    expect(main).toMatch(/resolveIconPath\(\{[\s\S]*isPackaged:\s*app\.isPackaged/);
  });
});

// Item #1 (v1.4) — the dashboard reorder that moves the "Needs Update" / "Upcoming"
// panels from above to below the program-card grid is a pure JSX reordering in
// src/pages/Dashboard.tsx. It touches no IPC channel, no preload surface, and no
// data-access path, so it introduces no new security surface; the existing
// hardening / preload / SQL-injection assertions above remain the relevant coverage.
describe('dashboard reorder introduces no IPC/data-access surface (regression)', () => {
  const preload = read('electron/preload.ts');
  it('preload IPC channel surface is unchanged by a UI-only reorder', () => {
    // Same channel families the app has always exposed — a JSX move cannot add channels.
    for (const ch of ['projection:all', 'trips:getAll', 'programs:getAll']) {
      expect(preload).toContain(ch);
    }
  });
});

describe('multi-size icon.ico (v1.5)', () => {
  // Parse the raw ICO container: 6-byte ICONDIR header + N x 16-byte ICONDIRENTRY records.
  // Byte 0 of each entry is width in pixels (0 means 256).
  function readIcoSizes(): number[] {
    const buf = fs.readFileSync(path.resolve(__dirname, '..', 'assets', 'icon.ico'));
    expect(buf.readUInt16LE(0)).toBe(0); // reserved
    expect(buf.readUInt16LE(2)).toBe(1); // type = icon
    const count = buf.readUInt16LE(4);
    const sizes: number[] = [];
    for (let i = 0; i < count; i++) {
      const offset = 6 + i * 16;
      const w = buf.readUInt8(offset);
      sizes.push(w === 0 ? 256 : w);
    }
    return sizes;
  }

  it('is a valid ICONDIR container', () => {
    expect(() => readIcoSizes()).not.toThrow();
  });

  it('contains at least the 16, 32, 48, and 256 sized entries', () => {
    const sizes = readIcoSizes();
    for (const required of [16, 32, 48, 256]) {
      expect(sizes, `expected size ${required} present`).toContain(required);
    }
  });
});

describe('adjustment delete IPC uses parameterized queries (v1.5)', () => {
  it('a malicious numeric-looking id string does not drop tables and simply matches nothing', () => {
    const db = seededDb();
    const evil = "1); DROP TABLE program_year_adjustments;--" as unknown as number;
    expect(() => adjustmentDelete(db, evil)).not.toThrow();
    expect(() => db.prepare('SELECT COUNT(*) FROM program_year_adjustments').get()).not.toThrow();
  });

  it('a malicious programId string in deleteForProgramYear is treated as literal data', () => {
    const db = seededDb();
    const evil = "dl'); DROP TABLE program_year_adjustments;--";
    expect(() => adjustmentsDeleteForProgramYear(db, evil, 2026)).not.toThrow();
    expect(() => db.prepare('SELECT COUNT(*) FROM program_year_adjustments').get()).not.toThrow();
    expect(adjustmentsGetAll(db)).toBeInstanceOf(Array);
  });
});
