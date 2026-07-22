import { useEffect, useState } from 'react';
import { useTheme } from '../theme';
import type { FileResult } from '../../electron/types';

export default function Settings() {
  const { theme, toggle } = useTheme();
  const [dbPath, setDbPath] = useState('');
  const [status, setStatus] = useState<{ due: boolean; nextCheckDue: string; lastChecked: string | null } | null>(null);
  const [msg, setMsg] = useState('');

  const refresh = () => {
    window.api.file.currentPath().then(setDbPath);
    window.api.refresh.status().then(setStatus);
  };
  useEffect(() => { refresh(); }, []);

  const handle = (label: string, fn: () => Promise<FileResult>) => async () => {
    setMsg('');
    const r = await fn();
    if (r.success) setMsg(`${label}: ${r.filePath ?? 'done'}`);
    else if (r.error) setMsg(`${label} failed: ${r.error}`);
    refresh();
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="card p-4">
        <h2 className="font-semibold mb-1">Appearance</h2>
        <p className="text-sm text-slate-500 mb-3">Current theme: {theme}</p>
        <button className="btn-primary" onClick={toggle}>Toggle light / dark</button>
      </section>

      <section className="card p-4">
        <h2 className="font-semibold mb-1">Data file</h2>
        <p className="text-xs text-slate-400 break-all mb-3">Current: {dbPath}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={handle('New', () => window.api.file.newDb())}>New tracker file…</button>
          <button className="btn-ghost" onClick={handle('Open', () => window.api.file.openDb())}>Open…</button>
          <button className="btn-ghost" onClick={handle('Saved copy', () => window.api.file.saveAs())}>Save a copy as…</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={handle('Exported', () => window.api.file.exportJson())}>Export JSON…</button>
          <button className="btn-ghost" onClick={handle('Imported', () => window.api.file.importJson())}>Import JSON…</button>
        </div>
        <p className="mt-2 text-[11px] text-amber-600">Note: New/Open/Import replace the currently loaded data. Export a copy first if unsure.</p>
      </section>

      <section className="card p-4">
        <h2 className="font-semibold mb-1">Quarterly rule review</h2>
        {status && (
          <p className="text-sm text-slate-500">
            {status.due ? 'A review is currently due.' : 'Up to date.'} Next check due: <b>{status.nextCheckDue}</b>.
            {status.lastChecked && <> Last checked: {status.lastChecked.slice(0, 10)}.</>}
          </p>
        )}
        <button className="btn-primary mt-3" onClick={handle('Review logged', async () => {
          const ps = await window.api.programs.getAll();
          await window.api.refresh.log(ps.filter(p => p.is_active === 1).map(p => p.id), []);
          return { success: true, filePath: 'logged (+3 months)' };
        })}>Mark reviewed now</button>
      </section>

      {msg && <div className="text-sm text-slate-600 dark:text-slate-300">{msg}</div>}
    </div>
  );
}
