import { useEffect, useMemo, useState } from 'react';
import type { CardEarningEntry, CardEarningInput } from '../../electron/types';

// The exactly-four programs that earn elite credit via credit-card spend.
const CARD_PROGRAMS = [
  { id: 'dl', name: 'Delta SkyMiles', metric_key: 'mqd', unit: 'MQDs' },
  { id: 'aa', name: 'American AAdvantage', metric_key: 'points', unit: 'LPs' },
  { id: 'wh', name: 'World of Hyatt', metric_key: 'nights', unit: 'nights' },
  { id: 'mb', name: 'Marriott Bonvoy', metric_key: 'nights', unit: 'nights' },
] as const;

const progOf = (id: string) => CARD_PROGRAMS.find(p => p.id === id);

interface Draft { id?: number; program_id: string; entry_date: string; amount: number | ''; notes: string; }

const emptyDraft = (): Draft => ({
  program_id: 'dl', entry_date: new Date().toISOString().slice(0, 10), amount: '', notes: '',
});

export default function CardEarnings() {
  const [entries, setEntries] = useState<CardEarningEntry[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<string>('all');

  const load = () => window.api.cardEarnings.getAll().then(setEntries);
  useEffect(() => { load(); }, []);

  const shown = useMemo(
    () => entries.filter(e => filter === 'all' || e.program_id === filter),
    [entries, filter]);

  const save = async () => {
    if (!editing) return;
    setError('');
    const prog = progOf(editing.program_id);
    if (!prog) { setError('Pick a program.'); return; }
    if (!editing.entry_date) { setError('Date is required.'); return; }
    if (editing.amount === '' || Number.isNaN(Number(editing.amount))) { setError('Amount must be a number.'); return; }
    const payload: CardEarningInput = {
      program_id: editing.program_id,
      entry_date: editing.entry_date,
      metric_key: prog.metric_key,
      amount: Number(editing.amount),
      notes: editing.notes || null,
    };
    try {
      if (editing.id) await window.api.cardEarnings.update(editing.id, payload);
      else await window.api.cardEarnings.create(payload);
      setEditing(null);
      load();
    } catch (err) { setError(String(err)); }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this card-earnings entry?')) return;
    await window.api.cardEarnings.delete(id);
    load();
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">Card Earnings</h1>
        <button className="btn-primary" onClick={() => { setError(''); setEditing(emptyDraft()); }}>+ Add Entry</button>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Log elite-qualifying credits earned through credit-card spend (not tied to a trip). Entries are dated so they
        bucket into the correct program-year for your YTD and Projected status.
      </p>

      <div className="mb-3 flex items-center gap-2">
        <label className="label mb-0">Filter</label>
        <select className="input max-w-[220px]" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All programs</option>
          {CARD_PROGRAMS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="card divide-y divide-slate-100 dark:divide-slate-800">
        {shown.map(e => {
          const prog = progOf(e.program_id);
          return (
            <div key={e.id} className="flex items-center gap-4 p-3">
              <div className="w-24 text-xs text-slate-400">{e.entry_date}</div>
              <div className="flex-1">
                <div className="font-medium">{prog?.name ?? e.program_id}</div>
                {e.notes && <div className="text-xs text-slate-500">{e.notes}</div>}
              </div>
              <div className="text-sm font-semibold">{e.amount.toLocaleString()} {prog?.unit ?? e.metric_key}</div>
              <button className="btn-ghost" onClick={() => setEditing({ id: e.id, program_id: e.program_id, entry_date: e.entry_date, amount: e.amount, notes: e.notes ?? '' })}>Edit</button>
              <button className="btn-ghost text-red-600" onClick={() => remove(e.id)}>Delete</button>
            </div>
          );
        })}
        {shown.length === 0 && <div className="p-6 text-center text-slate-400">No card-earnings entries yet.</div>}
      </div>

      {editing && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 p-6 overflow-auto" onClick={() => setEditing(null)}>
          <div className="card w-full max-w-lg p-5 my-6" onClick={ev => ev.stopPropagation()}>
            <h2 className="text-lg font-bold mb-3">{editing.id ? 'Edit Entry' : 'Add Card Earnings'}</h2>
            {error && <div className="mb-3 rounded bg-red-100 text-red-700 px-3 py-2 text-sm">{error}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Program</label>
                <select className="input" value={editing.program_id} onChange={e => setEditing({ ...editing, program_id: e.target.value })}>
                  {CARD_PROGRAMS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Date</label>
                <input type="date" className="input" value={editing.entry_date} onChange={e => setEditing({ ...editing, entry_date: e.target.value })} />
              </div>
              <div>
                <label className="label">Amount ({progOf(editing.program_id)?.unit})</label>
                <input type="number" className="input" value={editing.amount}
                  onChange={e => setEditing({ ...editing, amount: e.target.value === '' ? '' : Number(e.target.value) })} />
              </div>
              <div className="col-span-2">
                <label className="label">Notes (optional)</label>
                <input className="input" value={editing.notes} placeholder="e.g. Amex Platinum anniversary credit"
                  onChange={e => setEditing({ ...editing, notes: e.target.value })} />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
