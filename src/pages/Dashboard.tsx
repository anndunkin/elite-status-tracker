import { useEffect, useState } from 'react';
import type { ProgramProjection, TierRequirement } from '../../electron/types';

function reqLabel(reqs: TierRequirement[]): string {
  const groups = new Map<number, TierRequirement[]>();
  for (const r of reqs) {
    const k = r.group ?? 0;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  return [...groups.values()]
    .map(g => g.map(r => `${r.threshold.toLocaleString()} ${r.metric}`).join(' + '))
    .join('  OR  ');
}

function progressToNext(p: ProgramProjection): { pct: number; text: string } | null {
  if (!p.nextTierRequirements?.length) return null;
  // Use the first (primary) requirement group as the headline gauge.
  const primary = p.nextTierRequirements.filter(r => (r.group ?? 0) === (p.nextTierRequirements![0].group ?? 0));
  const parts = primary.map(r => {
    const have = p.projectedTotals[r.metric] ?? 0;
    return { metric: r.metric, have, need: r.threshold };
  });
  const lead = parts[0];
  const pct = Math.min(100, Math.round((lead.have / lead.need) * 100));
  const text = parts.map(x => `${x.have.toLocaleString()} / ${x.need.toLocaleString()} ${x.metric}`).join(', ');
  return { pct, text };
}

function TierBadge({ label, tone }: { label: string | null; tone: 'current' | 'projected' }) {
  const base = 'inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold';
  const cls = tone === 'current'
    ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100'
    : 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300';
  return <span className={`${base} ${cls}`}>{label ?? 'No status'}</span>;
}

export default function Dashboard() {
  const [rows, setRows] = useState<ProgramProjection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.api.projection.all().then(r => { setRows(r); setLoading(false); });
  }, []);

  if (loading) return <p className="text-slate-500">Loading projections…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Status Dashboard</h1>
      <p className="text-slate-500 mb-6 text-sm">
        Current status is from completed trips and posted adjustments. Projected status adds planned &amp; booked estimates.
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(p => {
          const prog = progressToNext(p);
          return (
            <div key={p.program.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-semibold">{p.program.name}</h2>
                  <p className="text-xs text-slate-400 uppercase">{p.program.type} · {p.program_year} year</p>
                </div>
                <span className="text-xs rounded bg-slate-100 dark:bg-slate-800 px-2 py-1 text-slate-500">
                  {p.program.type === 'airline' ? '✈' : '🏨'}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-500">Now:</span>
                <TierBadge label={p.currentTier} tone="current" />
                <span className="text-slate-400">→ Projected:</span>
                <TierBadge label={p.projectedTier} tone="projected" />
              </div>

              <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                {Object.keys(p.currentTotals).length === 0
                  ? <span>No activity this year yet.</span>
                  : Object.entries(p.projectedTotals).map(([k, v]) => (
                      <span key={k} className="mr-3">
                        <span className="font-semibold text-slate-700 dark:text-slate-200">{v.toLocaleString()}</span> {k}
                      </span>
                    ))}
              </div>

              {p.nextTier ? (
                <div className="mt-4">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-500">Next: <b>{p.nextTier}</b></span>
                    {prog && <span className="text-slate-400">{prog.pct}%</span>}
                  </div>
                  {prog && (
                    <>
                      <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full bg-primary-600" style={{ width: `${prog.pct}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">{prog.text}</p>
                    </>
                  )}
                  {p.nextTierRequirements && (
                    <p className="mt-1 text-[11px] text-slate-400">Requires: {reqLabel(p.nextTierRequirements)}</p>
                  )}
                </div>
              ) : (
                <p className="mt-4 text-xs font-medium text-emerald-600">Top tier reached 🎉</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
