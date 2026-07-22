import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import {
  getDatabase, openDatabaseAt,
  programsGetAll, programGetById, programGetTiers, programCreateRuleVersion, lastActivityGetAll,
  tripGetAll, tripGetById, tripCreate, tripUpdate, tripDelete,
  computeProjections, adjustmentsGetAll,
  refreshStatus, refreshLogCheck,
  buildFilePayload, importFilePayload,
  lifetimeStatusGetAll, lifetimeStatusSet, lifetimeStatusClear, lifetimeMileageGetAll,
  cardEarningsGetAll, cardEarningCreate, cardEarningUpdate, cardEarningDelete,
  statusOverridesGetAll, statusOverrideSet, statusOverrideClear,
} from './database';
import type {
  TripCreate, TripUpdate, TierRequirement, AppFilePayload, FileResult,
  ProgramLifetimeStatus, CardEarningInput, CardEarningUpdate, ProgramStatusOverrideInput,
} from './types';
import { haversineMiles, lookupAirport } from './airports';
import { viewYearToDate } from './rules';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let currentDbPath = '';

function defaultDbPath(): string {
  return path.join(app.getPath('userData'), 'elite-status-tracker.db');
}

function logError(msg: string): void {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'elite-status-error.log'),
      `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* ignore */ }
}

function createWindow(): void {
  const win = new BrowserWindow({
    title: 'Elite Status Tracker',
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
    backgroundColor: '#0f172a',
    show: false,
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
    logError(`Loading: ${indexPath} (exists: ${fs.existsSync(indexPath)})`);
    win.loadFile(indexPath).catch(err => logError(`loadFile error: ${err}`));
  }

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' file:; " +
          "script-src 'self' 'unsafe-inline' file:; " +
          "style-src 'self' 'unsafe-inline' file:; " +
          "font-src 'self' file: data:; " +
          "img-src 'self' file: data:; " +
          "connect-src 'self' file:;",
        ],
      },
    });
  });

  win.webContents.on('will-navigate', (event, url) => {
    try {
      const parsedUrl = new URL(url);
      if (isDev && parsedUrl.origin === 'http://localhost:5173') return;
      if (parsedUrl.protocol === 'file:') return;
    } catch { /* ignore */ }
    event.preventDefault();
    shell.openExternal(url);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    logError(`render-process-gone: ${JSON.stringify(details)}`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logError(`did-fail-load: ${code} ${desc} url=${url}`);
  });
}

app.whenReady().then(() => {
  currentDbPath = defaultDbPath();
  openDatabaseAt(currentDbPath);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(err => logError(`app.whenReady error: ${err}`));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Programs ─────────────────────────────────────────────────────────────────

ipcMain.handle('programs:getAll', () => programsGetAll(getDatabase()));
ipcMain.handle('programs:getById', (_e, id: string) => programGetById(getDatabase(), id));
ipcMain.handle('programs:getTiers', (_e, programId: string) => programGetTiers(getDatabase(), programId));
ipcMain.handle('programs:createRuleVersion', (_e, programId: string, effective_date: string, source_notes: string,
  tiers: Array<{ tier_name: string; tier_order: number; requirements: TierRequirement[] }>) =>
  programCreateRuleVersion(getDatabase(), programId, effective_date, source_notes, tiers));
ipcMain.handle('programs:lastActivity', () => lastActivityGetAll(getDatabase()));

// ─── Trips ────────────────────────────────────────────────────────────────────

ipcMain.handle('trips:getAll', () => tripGetAll(getDatabase()));
ipcMain.handle('trips:getById', (_e, id: number) => tripGetById(getDatabase(), id));
ipcMain.handle('trips:create', (_e, data: TripCreate) => tripCreate(getDatabase(), data));
ipcMain.handle('trips:update', (_e, id: number, data: TripUpdate) => tripUpdate(getDatabase(), id, data));
ipcMain.handle('trips:delete', (_e, id: number) => tripDelete(getDatabase(), id));

// ─── Projection & adjustments ───────────────────────────────────────────────────

ipcMain.handle('projection:all', (_e, viewYear?: number) =>
  computeProjections(getDatabase(), viewYearToDate(viewYear)));
ipcMain.handle('adjustments:all', () => adjustmentsGetAll(getDatabase()));

// ─── Lifetime status / mileage ───────────────────────────────────────────────────

ipcMain.handle('lifetime:status', () => lifetimeStatusGetAll(getDatabase()));
ipcMain.handle('lifetime:setStatus', (_e, data: ProgramLifetimeStatus) => lifetimeStatusSet(getDatabase(), data));
ipcMain.handle('lifetime:clearStatus', (_e, programId: string) => lifetimeStatusClear(getDatabase(), programId));
ipcMain.handle('lifetime:mileage', () => lifetimeMileageGetAll(getDatabase()));

// ─── Card earnings ──────────────────────────────────────────────────────────────

ipcMain.handle('cardEarnings:getAll', () => cardEarningsGetAll(getDatabase()));
ipcMain.handle('cardEarnings:create', (_e, data: CardEarningInput) => cardEarningCreate(getDatabase(), data));
ipcMain.handle('cardEarnings:update', (_e, id: number, data: CardEarningUpdate) => cardEarningUpdate(getDatabase(), id, data));
ipcMain.handle('cardEarnings:delete', (_e, id: number) => cardEarningDelete(getDatabase(), id));

// ─── Manual status overrides ──────────────────────────────────────────────────

ipcMain.handle('statusOverrides:getAll', () => statusOverridesGetAll(getDatabase()));
ipcMain.handle('statusOverrides:set', (_e, data: ProgramStatusOverrideInput) => statusOverrideSet(getDatabase(), data));
ipcMain.handle('statusOverrides:clear', (_e, programId: string, programYear: number) =>
  statusOverrideClear(getDatabase(), programId, programYear));

// ─── Airports ─────────────────────────────────────────────────────────────────

ipcMain.handle('airports:distance', (_e, a: string, b: string) => haversineMiles(a, b));
ipcMain.handle('airports:lookup', (_e, code: string) => lookupAirport(code));

// ─── Quarterly refresh ────────────────────────────────────────────────────────

ipcMain.handle('refresh:status', () => refreshStatus(getDatabase()));
ipcMain.handle('refresh:log', (_e, reviewed: string[], updated: string[]) =>
  refreshLogCheck(getDatabase(), reviewed, updated));

// ─── File management ──────────────────────────────────────────────────────────

function activeWindow(): BrowserWindow {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

/** Reject paths that escape onto system locations or use unexpected extensions. */
function safeChosenPath(chosen: string, exts: string[]): boolean {
  const resolved = path.resolve(chosen);
  if (resolved !== chosen && path.normalize(chosen) !== resolved) { /* allow normalized */ }
  const ext = path.extname(resolved).toLowerCase();
  return exts.includes(ext);
}

ipcMain.handle('file:currentPath', () => currentDbPath);

ipcMain.handle('file:newDb', async (): Promise<FileResult> => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(activeWindow(), {
      title: 'New Tracker File',
      defaultPath: 'elite-status-tracker.db',
      filters: [{ name: 'Tracker Database', extensions: ['db'] }],
    });
    if (canceled || !filePath) return { success: false };
    if (!safeChosenPath(filePath, ['.db'])) return { success: false, error: 'Invalid file path.' };
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
    currentDbPath = filePath;
    openDatabaseAt(filePath); // fresh file → schema + seed applied
    return { success: true, filePath };
  } catch (err) { logError(`file:newDb ${err}`); return { success: false, error: String(err) }; }
});

ipcMain.handle('file:openDb', async (): Promise<FileResult> => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(activeWindow(), {
      title: 'Open Tracker File',
      filters: [{ name: 'Tracker Database', extensions: ['db'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return { success: false };
    const chosen = filePaths[0];
    if (!fs.existsSync(chosen) || !safeChosenPath(chosen, ['.db'])) {
      return { success: false, error: 'Invalid file path.' };
    }
    currentDbPath = chosen;
    openDatabaseAt(chosen);
    return { success: true, filePath: chosen };
  } catch (err) { logError(`file:openDb ${err}`); return { success: false, error: String(err) }; }
});

ipcMain.handle('file:saveAs', async (): Promise<FileResult> => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(activeWindow(), {
      title: 'Save Tracker File As…',
      defaultPath: 'elite-status-tracker.db',
      filters: [{ name: 'Tracker Database', extensions: ['db'] }],
    });
    if (canceled || !filePath) return { success: false };
    if (!safeChosenPath(filePath, ['.db'])) return { success: false, error: 'Invalid file path.' };
    // Persist any WAL contents into the main db file, then copy it.
    try { getDatabase().pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    fs.copyFileSync(currentDbPath, filePath);
    currentDbPath = filePath;
    openDatabaseAt(filePath);
    return { success: true, filePath };
  } catch (err) { logError(`file:saveAs ${err}`); return { success: false, error: String(err) }; }
});

ipcMain.handle('file:exportJson', async (): Promise<FileResult> => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(activeWindow(), {
      title: 'Export Data as JSON',
      defaultPath: `elite-status-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { success: false };
    if (!safeChosenPath(filePath, ['.json'])) return { success: false, error: 'Invalid file path.' };
    const payload = buildFilePayload(getDatabase());
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    return { success: true, filePath, payload };
  } catch (err) { logError(`file:exportJson ${err}`); return { success: false, error: String(err) }; }
});

ipcMain.handle('file:importJson', async (): Promise<FileResult> => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(activeWindow(), {
      title: 'Import Data from JSON',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return { success: false };
    const chosen = filePaths[0];
    if (!fs.existsSync(chosen) || !safeChosenPath(chosen, ['.json'])) {
      return { success: false, error: 'Invalid file path.' };
    }
    const raw = fs.readFileSync(chosen, 'utf-8');
    const payload = JSON.parse(raw) as AppFilePayload;
    importFilePayload(getDatabase(), payload);
    return { success: true, filePath: chosen, payload };
  } catch (err) { logError(`file:importJson ${err}`); return { success: false, error: String(err) }; }
});
