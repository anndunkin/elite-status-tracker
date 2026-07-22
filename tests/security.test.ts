import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { seededDb } from './helpers';
import { tripCreate, tripGetAll, programGetById } from '../electron/database';

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
