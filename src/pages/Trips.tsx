import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  Program, TripWithDetails, TripCreate, TripStatus, TripEntryInput, SegmentInput,
} from '../../electron/types';
import { displayMetricKey, statusMultiplierForAAPreview } from '../lib/metricLabels';

const STATUSES: TripStatus[] = ['planned', 'booked', 'completed'];

interface EntryDraft { program_id: string; is_estimate: boolean; metric_values: Record<string, number>; card_bonus_notes: string; }
interface SegDraft { origin_airport: string; destination_airport: string; distance_miles: number | null; cost_usd: number | null; program_id: string; }
type Draft = Omit<TripCreate, 'entries' | 'segments'> & { id?: number; entries: EntryDraft[]; segments: SegDraft[] };

const emptyDraft = (): Draft => ({
  label: '', start_date: new Date().toISOString().slice(0, 10), end_date: '',
  status: 'planned', is_historical_estimate_date: false, notes: '',
  entries: [], segments: [],
});

function metricKeys(p: Program): string[] {
  try { return JSON.parse(p.metric_keys) as string[]; } catch { return []; }
}

export default function Trips() {
  const [trips, setTrips] = useState<TripWithDetails[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [editing, setEditing] = useState<null | (Draft)>(null);
  const [error, setError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  const load = () => {
    window.api.trips.getAll().then(setTrips);
    window.api.programs.getAll().then(setPrograms);
  };
  useEffect(() => { load(); }, []);

  const activePrograms = useMemo(() => programs.filter(p => p.is_active === 1), [programs]);
  const progById = useMemo(() => Object.fromEntries(programs.map(p => [p.id, p])), [programs]);

  const openNew = () => { setError(''); setEditing(emptyDraft()); };

  const openEdit = (t: TripWithDetails) => {
    setError('');
    setEditing({
      id: t.id, label: t.label, start_date: t.start_date, end_date: t.end_date ?? '',
      status: t.status, is_historical_estimate_date: !!t.is_historical_estimate_date, notes: t.notes ?? '',
      entries: t.entries.map(e => ({
        program_id: e.program_id, is_estimate: e.is_estimate === 1,
        metric_values: JSON.parse(e.metric_values) as Record<string, number>,
        card_bonus_notes: e.card_bonus_notes ?? '',
      })),
      segments: t.segments.map(s => ({
        origin_airport: s.origin_airport ?? '', destination_airport: s.destination_airport ?? '',
        distance_miles: s.distance_miles, cost_usd: s.cost_usd, program_id: s.program_id ?? '',
      })),
    });
  };

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId || editing) return;
    const t = trips.find(x => String(x.id) === editId);
    if (t) {
      openEdit(t);
      searchParams.delete('edit');
      setSearchParams(searchParams, { replace: true });
    }
  }, [trips, searchParams]);

  const save = async () => {
    if (!editing) return;
    if (!editing.label.trim()) { setError('Trip label is required.'); return; }
    if (!editing.start_date) { setError('Start date is required.'); return; }
    const payload: TripCreate = {
      label: editing.label.trim(),
      start_date: editing.start_date,
      end_date: editing.end_date || null,
      status: editing.status,
      is_historical_estimate_date: editing.is_historical_estimate_date,
      notes: editing.notes || null,
      entries: editing.entries
        .filter(e => e.program_id)
        .map<TripEntryInput>(e => ({
          program_id: e.program_id, is_estimate: e.is_estimate,
          metric_values: e.metric_values, card_bonus_notes: e.card_bonus_notes || undefined,
        })),
      segments: editing.segments
        .filter(s => s.origin_airport || s.destination_airport || s.distance_miles)
        .map<SegmentInput>(s => ({
          origin_airport: s.origin_airport || null, destination_airport: s.destination_airport || null,
          distance_miles: s.distance_miles, cost_usd: s.cost_usd,
          program_id: s.program_id || null, fare_class: null,
        })),
    };
    try {
      if (editing.id) await window.api.trips.update(editing.id, payload);
      else await window.api.trips.create(payload);
      setEditing(null);
      load();
    } catch (err) { setError(String(err)); }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this trip and all its entries?')) return;
    await window.api.trips.delete(id);
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Trips</h1>
          <p className="text-sm text-slate-500">{trips.length} trips</p>
        </div>
        <button className="btn-primary" onClick={openNew}>+ Add Trip</button>
      </div>

      <div className="card divide-y divide-slate-100 dark:divide-slate-800">
        {trips.map(t => (
          <div key={t.id} className="flex items-center gap-4 p-3">
            <div className="w-24 text-xs text-slate-400">{t.start_date}{t.is_historical_estimate_date ? ' *' : ''}</div>
            <div className="flex-1">
              <div className="font-medium">{t.label}</div>
              <div className="text-xs text-slate-500">
                {t.entries.map(e => `${progById[e.program_id]?.name ?? e.program_id}${e.is_estimate ? ' (est)' : ''}`).join(', ') || 'no program entries'}
              </div>
            </div>
            <span className={`text-xs rounded-full px-2 py-0.5 ${
              t.status === 'completed' ? 'bg-emerald-100 text-emerald-700'
              : t.status === 'booked' ? 'bg-blue-100 text-blue-700'
              : 'bg-slate-100 text-slate-600'}`}>{t.status}</span>
            <button className="btn-ghost" onClick={() => openEdit(t)}>Edit</button>
            <button className="btn-ghost text-red-600" onClick={() => remove(t.id)}>Delete</button>
          </div>
        ))}
        {trips.length === 0 && <div className="p-6 text-center text-slate-400">No trips yet.</div>}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">* start date is a historical estimate (month/day approximated from the source spreadsheet).</p>

      {editing && (
        <TripEditor
          draft={editing}
          setDraft={setEditing}
          activePrograms={activePrograms}
          metricKeys={metricKeys}
          error={error}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function TripEditor({ draft, setDraft, activePrograms, metricKeys, error, onSave, onCancel }: {
  draft: Draft;
  setDraft: (d: any) => void;
  activePrograms: Program[];
  metricKeys: (p: Program) => string[];
  error: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  const upd = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });

  const addEntry = () => upd({ entries: [...draft.entries, { program_id: activePrograms[0]?.id ?? '', is_estimate: draft.status !== 'completed', metric_values: {}, card_bonus_notes: '' }] });
  const setEntry = (i: number, patch: Partial<EntryDraft>) =>
    upd({ entries: draft.entries.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const delEntry = (i: number) => upd({ entries: draft.entries.filter((_, j) => j !== i) });

  const addSeg = () => upd({ segments: [...draft.segments, { origin_airport: '', destination_airport: '', distance_miles: null, cost_usd: null, program_id: '' }] });
  const setSeg = (i: number, patch: Partial<SegDraft>) =>
    upd({ segments: draft.segments.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const delSeg = (i: number) => upd({ segments: draft.segments.filter((_, j) => j !== i) });

  const autoDistance = async (i: number) => {
    const s = draft.segments[i];
    if (!s.origin_airport || !s.destination_airport) return;
    const d = await window.api.airports.distance(s.origin_airport, s.destination_airport);
    if (d != null) setSeg(i, { distance_miles: d });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 p-6 overflow-auto" onClick={onCancel}>
      <div className="card w-full max-w-3xl p-5 my-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-3">{draft.id ? 'Edit Trip' : 'Add Trip'}</h2>
        {error && <div className="mb-3 rounded bg-red-100 text-red-700 px-3 py-2 text-sm">{error}</div>}

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Label</label>
            <input className="input" value={draft.label} onChange={e => upd({ label: e.target.value })} placeholder="e.g. Seattle → Tokyo" />
          </div>
          <div>
            <label className="label">Start date</label>
            <input type="date" className="input" value={draft.start_date} onChange={e => upd({ start_date: e.target.value })} />
          </div>
          <div>
            <label className="label">End date (optional)</label>
            <input type="date" className="input" value={draft.end_date ?? ''} onChange={e => upd({ end_date: e.target.value })} />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={draft.status} onChange={e => upd({ status: e.target.value as TripStatus })}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <input id="hist" type="checkbox" checked={!!draft.is_historical_estimate_date} onChange={e => upd({ is_historical_estimate_date: e.target.checked })} />
            <label htmlFor="hist" className="text-sm text-slate-600 dark:text-slate-300">Historical estimate date</label>
          </div>
          <div className="col-span-2">
            <label className="label">Notes</label>
            <input className="input" value={draft.notes ?? ''} onChange={e => upd({ notes: e.target.value })} />
          </div>
        </div>

        {/* Program entries */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">Program credit</h3>
            <button className="btn-ghost" onClick={addEntry}>+ Entry</button>
          </div>
          <div className="space-y-3">
            {draft.entries.map((e, i) => {
              const prog = activePrograms.find(p => p.id === e.program_id);
              const keys = prog ? metricKeys(prog) : [];
              const isDelta = prog?.id === 'dl';
              const isAA = prog?.id === 'aa';
              const visibleKeys = isDelta ? keys.filter(k => k !== 'mqd') : keys;
              // AA Loyalty Points: auto-fill from segment cost (base 5x multiplier; the exact
              // multiplier for the tier held this status year is resolved server-side in
              // computeProjections — this is just a convenience pre-fill, not the final value).
              const aaAutoFillPoints = isAA && e.metric_values.points === undefined
                ? Math.round(draft.segments
                    .filter(s => s.program_id === 'aa' && typeof s.cost_usd === 'number')
                    .reduce((sum, s) => sum + (s.cost_usd as number), 0) * statusMultiplierForAAPreview(null))
                : null;
              return (
                <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <select className="input max-w-[200px]" value={e.program_id} onChange={ev => setEntry(i, { program_id: ev.target.value, metric_values: {} })}>
                      {activePrograms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <label className="text-xs flex items-center gap-1">
                      <input type="checkbox" checked={e.is_estimate} onChange={ev => setEntry(i, { is_estimate: ev.target.checked })} />
                      estimate
                    </label>
                    <button className="btn-ghost text-red-600 ml-auto" onClick={() => delEntry(i)}>Remove</button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {visibleKeys.map(k => (
                      <div key={k}>
                        <label className="label">{displayMetricKey(prog?.id, k)}</label>
                        <input type="number" className="input w-32"
                          value={isAA && k === 'points' && e.metric_values.points === undefined && aaAutoFillPoints
                            ? aaAutoFillPoints : (e.metric_values[k] ?? '')}
                          placeholder={isAA && k === 'points' && aaAutoFillPoints ? String(aaAutoFillPoints) : undefined}
                          onChange={ev => setEntry(i, { metric_values: { ...e.metric_values, [k]: Number(ev.target.value) } })} />
                      </div>
                    ))}
                  </div>
                  {isDelta && (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Delta MQDs auto-calculated from segment cost ($1 = 1 MQD). Add flight segments with a Cost value below.
                    </p>
                  )}
                  {isAA && (
                    <p className="mt-2 text-[11px] text-slate-500">
                      AA Loyalty Points auto-calculated from segment cost × your current AA earning multiplier.
                      Add flight segments with a Cost value below to estimate. Enter posted LPs manually after
                      the trip completes if you want exact values.
                    </p>
                  )}
                  <div className="mt-2">
                    <label className="label">Card / bonus notes</label>
                    <input className="input" value={e.card_bonus_notes} onChange={ev => setEntry(i, { card_bonus_notes: ev.target.value })} />
                  </div>
                </div>
              );
            })}
            {draft.entries.length === 0 && <p className="text-xs text-slate-400">No program entries. Add one to credit this trip toward a program.</p>}
          </div>
        </div>

        {/* Segments */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">Flight segments (optional)</h3>
            <button className="btn-ghost" onClick={addSeg}>+ Segment</button>
          </div>
          <div className="space-y-2">
            {draft.segments.map((s, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                <div><label className="label">From</label><input className="input w-24 uppercase" value={s.origin_airport} onChange={e => setSeg(i, { origin_airport: e.target.value.toUpperCase() })} onBlur={() => autoDistance(i)} /></div>
                <div><label className="label">To</label><input className="input w-24 uppercase" value={s.destination_airport} onChange={e => setSeg(i, { destination_airport: e.target.value.toUpperCase() })} onBlur={() => autoDistance(i)} /></div>
                <div><label className="label">Miles</label><input type="number" className="input w-28" value={s.distance_miles ?? ''} onChange={e => setSeg(i, { distance_miles: e.target.value === '' ? null : Number(e.target.value) })} /></div>
                <div><label className="label">Cost $</label><input type="number" className="input w-24" value={s.cost_usd ?? ''} onChange={e => setSeg(i, { cost_usd: e.target.value === '' ? null : Number(e.target.value) })} /></div>
                <button className="btn-ghost text-red-600" onClick={() => delSeg(i)}>×</button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={onSave}>Save Trip</button>
        </div>
      </div>
    </div>
  );
}
