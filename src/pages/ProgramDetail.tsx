import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  Program, ProgramProjection, ProgramYearAdjustment, TripWithDetails,
  CardEarningEntry, ProgramRuleVersion, ProgramTier, TierRequirement,
} from '../../electron/types';
import { programYearOf } from '../../electron/rules';

function reqText(reqs: TierRequirement[]): string {
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

function totalsText(totals: Record<string, number>): string {
  const keys = Object.keys(totals);
  if (!keys.length) return '—';
  return keys.map(k => `${totals[k].toLocaleString()} ${k}`).join(', ');
}

export default function ProgramDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [program, setProgram] = useState<Program | null>(null);
  const [proj, setProj] = useState<ProgramProjection | null>(null);
  const [trips, setTrips] = useState<TripWithDetails[]>([]);
  const [adjustments, setAdjustments] = useState<ProgramYearAdjustment[]>([]);
  const [cardEarnings, setCardEarnings] = useState<CardEarningEntry[]>([]);
  const [tiers, setTiers] = useState<{ versions: ProgramRuleVersion[]; tiersByVersion: Record<number, ProgramTier[]> } | null>(null);

  useEffect(() => {
    window.api.programs.getById(id).then(setProgram);
    window.api.projection.all().then(all => setProj(all.find(p => p.program.id === id) ?? null));
    window.api.trips.getAll().then(setTrips);
    window.api.adjustments.all().then(setAdjustments);
    window.api.cardEarnings.getAll().then(setCardEarnings);
    window.api.programs.getTiers(id).then(setTiers);
  }, [id]);

  const year = proj?.program_year ?? null;

  const contributingTrips = useMemo(() => {
    if (!program || year == null) return [];
    return trips
      .map(t => ({ trip: t, entries: t.entries.filter(e => e.program_id === id) }))
      .filter(x => x.entries.length > 0 && programYearOf(x.trip.start_date, program.year_type) === year);
  }, [trips, program, year, id]);

  const yearAdjustments = useMemo(
    () => adjustments.filter(a => a.program_id === id && a.program_year === year),
    [adjustments, id, year]);

  const yearCardEarnings = useMemo(() => {
    if (!program || year == null) return [];
    return cardEarnings.filter(c => c.program_id === id && programYearOf(c.entry_date, program.year_type) === year);
  }, [cardEarnings, program, year, id]);

  if (!program || !proj) return <p className="text-slate-400">Loading…</p>;
  const lm = proj.lifetimeMileage;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <button className="btn-ghost" onClick={() => navigate('/')}>← Dashboard</button>
        <h1 className="text-2xl font-bold">{program.name}</h1>
        <span className="text-xs text-slate-400 uppercase">{program.type} · {year} program-year</span>
        {proj.lifetimeStatus && (
          <span className="ml-auto inline-block rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-3 py-1 text-xs font-semibold">
            ★ Lifetime {proj.lifetimeStatus.tier_name}
          </span>
        )}
      </div>

      {/* Three-part status */}
      <section className="card p-4">
        <h2 className="font-semibold mb-3">{lm ? 'Annual Medallion Status' : 'Status'}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 p-3">
            <p className="text-xs uppercase text-slate-400">Current (held)</p>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{proj.currentStatusTier ?? 'No status'}</p>
            <p className="text-[11px] text-slate-500">
              {proj.lifetimeTier ? `Lifetime floor: ${proj.lifetimeTier}. ` : ''}
              {proj.heldFromYear != null ? `Earned from ${proj.heldFromYear}: ${proj.heldTier ?? 'none'} (${totalsText(proj.heldTotals)})` : 'No completed program-year data.'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <p className="text-xs uppercase text-slate-400">Year-to-date</p>
            <p className="text-lg font-bold">{proj.ytdTier ?? 'No status'}</p>
            <p className="text-[11px] text-slate-500">{totalsText(proj.ytdTotals)}</p>
          </div>
          <div className="rounded-lg border border-primary-200 dark:border-primary-800 p-3">
            <p className="text-xs uppercase text-slate-400">Projected</p>
            <p className="text-lg font-bold text-primary-600 dark:text-primary-400">{proj.projectedTier ?? 'No status'}</p>
            <p className="text-[11px] text-slate-500">{totalsText(proj.projectedTotals)}</p>
          </div>
        </div>
      </section>

      {/* Delta lifetime mileage */}
      {lm && (
        <section className="card p-4">
          <h2 className="font-semibold mb-2">Lifetime Mileage / Million Miler</h2>
          <p className="text-sm text-slate-500 mb-2">
            Baseline {lm.baseline_miles.toLocaleString()} mi as of {lm.baseline_date}, plus {lm.accruedSinceBaseline.toLocaleString()} mi
            flown on completed Delta segments since.
          </p>
          <p className="text-2xl font-bold">{lm.currentMiles.toLocaleString()} <span className="text-sm font-normal text-slate-400">lifetime miles</span></p>
          {lm.nextMilestone && (
            <div className="mt-3">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-500">Next: <b>{lm.nextMilestone.label}</b></span>
                <span className="text-slate-400">{lm.milesToNext?.toLocaleString()} mi to go</span>
              </div>
              <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div className="h-full bg-amber-500" style={{ width: `${Math.min(100, Math.round((lm.currentMiles / lm.nextMilestone.threshold) * 100))}%` }} />
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            {lm.milestones.map(m => (
              <span key={m.threshold} className={`rounded-full px-2 py-0.5 ${lm.currentMiles >= m.threshold ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                {m.label} {lm.currentMiles >= m.threshold ? '✓' : ''}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Contributing trips */}
      <section className="card p-4">
        <h2 className="font-semibold mb-2">Contributing trips ({year})</h2>
        {contributingTrips.length === 0 ? (
          <p className="text-sm text-slate-400">No trips credited to this program this year.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase">
                <th className="py-1">Date</th><th>Trip</th><th>Status</th><th>Type</th><th>Metrics</th><th></th>
              </tr>
            </thead>
            <tbody>
              {contributingTrips.map(({ trip, entries }) =>
                entries.map(e => (
                  <tr key={`${trip.id}-${e.id}`} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 text-slate-500">{trip.start_date}{trip.is_historical_estimate_date ? ' *' : ''}</td>
                    <td className="py-1.5 font-medium">{trip.label}</td>
                    <td className="py-1.5">{trip.status}</td>
                    <td className="py-1.5">{e.is_estimate === 1 ? 'estimate' : 'actual'}</td>
                    <td className="py-1.5 text-slate-600 dark:text-slate-300">{totalsText(JSON.parse(e.metric_values))}</td>
                    <td className="py-1.5 text-right">
                      <button className="btn-ghost text-xs" onClick={() => navigate(`/trips?edit=${trip.id}`)}>Edit</button>
                    </td>
                  </tr>
                )))}
            </tbody>
          </table>
        )}
      </section>

      {/* Card earnings */}
      {yearCardEarnings.length > 0 && (
        <section className="card p-4">
          <h2 className="font-semibold mb-2">Credit-card earnings ({year})</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase"><th className="py-1">Date</th><th>Amount</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {yearCardEarnings.map(c => (
                <tr key={c.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 text-slate-500">{c.entry_date}</td>
                  <td className="py-1.5">{c.amount.toLocaleString()} {c.metric_key}</td>
                  <td className="py-1.5 text-slate-500">{c.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Year adjustments */}
      {yearAdjustments.length > 0 && (
        <section className="card p-4">
          <h2 className="font-semibold mb-2">Year adjustments ({year})</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase"><th className="py-1">Type</th><th>Metrics</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {yearAdjustments.map(a => (
                <tr key={a.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5">{a.adjustment_type}</td>
                  <td className="py-1.5 text-slate-600 dark:text-slate-300">{totalsText(JSON.parse(a.metric_values))}</td>
                  <td className="py-1.5 text-slate-500">{a.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Tier table */}
      {tiers && (() => {
        const current = tiers.versions.find(v => v.is_current === 1) ?? tiers.versions[0];
        const list = current ? tiers.tiersByVersion[current.id] ?? [] : [];
        return (
          <section className="card p-4">
            <h2 className="font-semibold mb-2">Tier requirements{current ? ` (effective ${current.effective_date})` : ''}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 uppercase"><th className="py-1">Tier</th><th>Requirements</th></tr>
              </thead>
              <tbody>
                {list.map(t => (
                  <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 font-medium">{t.tier_name}</td>
                    <td className="py-1.5 text-slate-600 dark:text-slate-300">{reqText(JSON.parse(t.requirements))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })()}
    </div>
  );
}
