import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

function totalsText(totals: Record<string, number>): string {
  const keys = Object.keys(totals);
  if (!keys.length) return '—';
  return keys.map(k => `${totals[k].toLocaleString()} ${k}`).join(', ');
}

function StatusRow({ label, tier, totals, tone }:
  { label: string; tier: string | null; totals?: Record<string, number>; tone: 'current' | 'ytd' | 'projected' }) {
  const badge = tone === 'current'
    ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
    : tone === 'ytd'
      ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100'
      : 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300';
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-xs uppercase text-slate-400 w-20 shrink-0">{label}</span>
      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge}`}>{tier ?? 'No status'}</span>
      {totals && <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400 text-right">{totalsText(totals)}</span>}
    </div>
  );
}

export default function Dashboard() {
  const [rows, setRows] = useState<ProgramProjection[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    window.api.projection.all().then(r => { setRows(r); setLoading(false); });
  }, []);

  if (loading) return <p className="text-slate-500">Loading projections…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Status Dashboard</h1>
      <p className="text-slate-500 mb-6 text-sm">
        <b>Current</b> = tier held now (from your last completed program-year, floored by any lifetime status).
        <b> YTD</b> = actual progress in the current program-year. <b>Projected</b> = YTD plus planned &amp; booked estimates.
        Click any card to drill into the underlying trips and entries.
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(p => {
          const prog = progressToNext(p);
          const lm = p.lifetimeMileage;
          const lmPct = lm && lm.nextMilestone
            ? Math.min(100, Math.round((lm.currentMiles / lm.nextMilestone.threshold) * 100)) : 0;
          return (
            <button
              key={p.program.id}
              onClick={() => navigate(`/programs/${p.program.id}`)}
              className="card p-4 text-left hover:ring-2 hover:ring-primary-500 transition focus:outline-none focus:ring-2 focus:ring-primary-500">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-semibold">{p.program.name}</h2>
                  <p className="text-xs text-slate-400 uppercase">{p.program.type} · {p.program_year} year</p>
                </div>
                <span className="text-xs rounded bg-slate-100 dark:bg-slate-800 px-2 py-1 text-slate-500">
                  {p.program.type === 'airline' ? '✈' : '🏨'}
                </span>
              </div>

              {p.lifetimeStatus && (
                <div className="mt-2">
                  <span className="inline-block rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-2.5 py-0.5 text-xs font-semibold">
                    ★ Lifetime {p.lifetimeStatus.tier_name}
                  </span>
                </div>
              )}

              <div className="mt-3 space-y-1.5">
                <StatusRow label="Current" tier={p.currentStatusTier} tone="current" />
                <StatusRow label="YTD" tier={p.ytdTier} totals={p.ytdTotals} tone="ytd" />
                <StatusRow label="Projected" tier={p.projectedTier} totals={p.projectedTotals} tone="projected" />
              </div>

              {lm && (
                <div className="mt-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 p-2">
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>Million Miler (lifetime)</span>
                    <span>{lm.currentMiles.toLocaleString()} mi</span>
                  </div>
                  {lm.nextMilestone && (
                    <>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full bg-amber-500" style={{ width: `${lmPct}%` }} />
                      </div>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {lm.milesToNext?.toLocaleString()} mi to {lm.nextMilestone.label}
                      </p>
                    </>
                  )}
                </div>
              )}

              {p.nextTier ? (
                <div className="mt-3">
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
                <p className="mt-3 text-xs font-medium text-emerald-600">Top tier reached 🎉</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
