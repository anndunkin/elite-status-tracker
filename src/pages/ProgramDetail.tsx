import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  Program, ProgramProjection, ProgramYearAdjustment, TripWithDetails,
  CardEarningEntry, ProgramRuleVersion, ProgramTier, TierRequirement,
} from '../../electron/types';
import { programYearOf } from '../../electron/rules';
import { displayMetricKey } from '../lib/metricLabels';

function reqText(reqs: TierRequirement[], programId?: string): string {
  const groups = new Map<number, TierRequirement[]>();
  for (const r of reqs) {
    const k = r.group ?? 0;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  return [...groups.values()]
    .map(g => g.map(r => `${r.threshold.toLocaleString()} ${displayMetricKey(programId, r.metric)}`).join(' + '))
    .join('  OR  ');
}

function totalsText(totals: Record<string, number>, programId?: string): string {
  const keys = Object.keys(totals);
  if (!keys.length) return '—';
  return keys.map(k => `${totals[k].toLocaleString()} ${displayMetricKey(programId, k)}`).join(', ');
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

  // Edit-status form state.
  const [editing, setEditing] = useState(false);
  const [formTier, setFormTier] = useState('');
  const [formPermanent, setFormPermanent] = useState(false);
  const [formNotes, setFormNotes] = useState('');
  const [formAchieved, setFormAchieved] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    window.api.programs.getById(id).then(setProgram);
    window.api.projection.all().then(all => setProj(all.find(p => p.program.id === id) ?? null));
    window.api.trips.getAll().then(setTrips);
    window.api.adjustments.all().then(setAdjustments);
    window.api.cardEarnings.getAll().then(setCardEarnings);
    window.api.programs.getTiers(id).then(setTiers);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const year = proj?.program_year ?? null;

  // Tier names for the current rule version, ordered — populates the tier dropdown.
  const currentTierList = useMemo(() => {
    if (!tiers) return [] as ProgramTier[];
    const current = tiers.versions.find(v => v.is_current === 1) ?? tiers.versions[0];
    return current ? (tiers.tiersByVersion[current.id] ?? []) : [];
  }, [tiers]);

  function openEditor() {
    if (!proj) return;
    // Pre-fill from an existing lifetime status (permanent) or current-year override.
    if (proj.lifetimeStatus) {
      setFormPermanent(true);
      setFormTier(proj.lifetimeStatus.tier_name);
      setFormNotes(proj.lifetimeStatus.notes ?? '');
      setFormAchieved(proj.lifetimeStatus.achieved_date ?? '');
    } else if (proj.statusOverride) {
      setFormPermanent(false);
      setFormTier(proj.statusOverride.tier_name);
      setFormNotes(proj.statusOverride.notes ?? '');
      setFormAchieved('');
    } else {
      setFormPermanent(false);
      setFormTier(currentTierList[0]?.tier_name ?? '');
      setFormNotes('');
      setFormAchieved('');
    }
    setFormError(null);
    setEditing(true);
  }

  async function submitStatus() {
    if (!proj || !formTier) { setFormError('Pick a tier.'); return; }
    try {
      if (formPermanent) {
        await window.api.lifetime.setStatus({
          program_id: id, tier_name: formTier,
          achieved_date: formAchieved.trim() || null, notes: formNotes.trim() || null,
        });
      } else {
        await window.api.statusOverrides.set({
          program_id: id, program_year: proj.program_year, tier_name: formTier,
          notes: formNotes.trim() || null,
        });
      }
      setEditing(false);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  async function clearLifetime() {
    await window.api.lifetime.clearStatus(id);
    load();
  }
  async function clearOverride() {
    if (!proj) return;
    await window.api.statusOverrides.clear(id, proj.program_year);
    load();
  }

  const contributingTrips = useMemo(() => {
    if (!program || year == null) return [];
    return trips
      .map(t => ({ trip: t, entries: t.entries.filter(e => e.program_id === id) }))
      .filter(x => x.entries.length > 0 && programYearOf(x.trip.start_date, program.year_type) === year);
  }, [trips, program, year, id]);

  const yearAdjustments = useMemo(
    () => adjustments.filter(a => a.program_id === id && a.program_year === year),
    [adjustments, id, year]);

  async function removeAdjustment(adjId: number) {
    if (!confirm('Delete this adjustment?')) return;
    await window.api.adjustments.delete(adjId);
    load();
  }

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
              {proj.heldFromYear != null ? `Earned from ${proj.heldFromYear}: ${proj.heldTier ?? 'none'} (${totalsText(proj.heldTotals, id)})` : 'No completed program-year data.'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <p className="text-xs uppercase text-slate-400">Year-to-date</p>
            <p className="text-lg font-bold">{proj.ytdTier ?? 'No status'}</p>
            <p className="text-[11px] text-slate-500">{totalsText(proj.ytdTotals, id)}</p>
          </div>
          <div className="rounded-lg border border-primary-200 dark:border-primary-800 p-3">
            <p className="text-xs uppercase text-slate-400">Projected</p>
            <p className="text-lg font-bold text-primary-600 dark:text-primary-400">{proj.projectedTier ?? 'No status'}</p>
            <p className="text-[11px] text-slate-500">{totalsText(proj.projectedTotals, id)}</p>
          </div>
        </div>

        {/* v1.5.1: source breakdown so a metric total can be reconciled against its components. */}
        {proj.metricSourceBreakdown && Object.keys(proj.metricSourceBreakdown).length > 0 && (
          <div className="mt-4">
            <p className="text-xs uppercase text-slate-400 mb-1">Where these {year}-to-date numbers come from</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="py-1 pr-2">Metric</th>
                  <th className="py-1 pr-2">Trips</th>
                  <th className="py-1 pr-2">Adjustments</th>
                  <th className="py-1 pr-2">Card earnings</th>
                  <th className="py-1 pr-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(proj.metricSourceBreakdown).map(([key, b]) => (
                  <tr key={key} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1 pr-2 font-medium">{displayMetricKey(id, key)}</td>
                    <td className="py-1 pr-2">{b.trips.toLocaleString()}</td>
                    <td className="py-1 pr-2">{b.adjustments.toLocaleString()}</td>
                    <td className="py-1 pr-2">{b.cardEarnings.toLocaleString()}</td>
                    <td className="py-1 pr-2 font-semibold">{(b.trips + b.adjustments + b.cardEarnings).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-slate-500">
              For American AAdvantage and Delta SkyMiles, the Trips column reflects the
              auto-calculated LP/MQD value (from flight segment cost), not just manually-entered
              values. If a total looks too high, check here first for a source you didn't expect
              (e.g. a trip's auto-calc plus a separate card-earnings entry for the same activity).
            </p>
          </div>
        )}
      </section>

      {/* Manual status editing (override + lifetime) */}
      <section className="card p-4">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="font-semibold">Status</h2>
          <div className="ml-auto flex flex-wrap gap-2 items-center">
            {proj.lifetimeStatus && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-3 py-1 text-xs font-semibold">
                ★ Lifetime {proj.lifetimeStatus.tier_name}
                <button className="ml-1 underline hover:no-underline" onClick={clearLifetime}>clear</button>
              </span>
            )}
            {proj.statusOverride && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 px-3 py-1 text-xs font-semibold">
                {year} override: {proj.statusOverride.tier_name}
                <button className="ml-1 underline hover:no-underline" onClick={clearOverride}>clear</button>
              </span>
            )}
            <button className="btn-primary text-xs" onClick={openEditor}>Edit Status</button>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">
          Displayed “Current” is the highest of your calculated held tier, any lifetime floor, and any
          current-program-year override. Setting a status here does not change your earned Year-to-date or
          Projected numbers below.
        </p>

        {editing && (
          <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block text-xs uppercase text-slate-400 mb-1">Tier</span>
                <select className="input w-full" value={formTier} onChange={e => setFormTier(e.target.value)}>
                  {currentTierList.length === 0 && <option value="">(no tiers)</option>}
                  {currentTierList.map(t => (
                    <option key={t.id} value={t.tier_name}>{t.tier_name}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs uppercase text-slate-400 mb-1">
                  {formPermanent ? 'Achieved date (optional)' : 'Achieved date (permanent only)'}
                </span>
                <input type="date" className="input w-full" value={formAchieved}
                  disabled={!formPermanent}
                  onChange={e => setFormAchieved(e.target.value)} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={formPermanent} onChange={e => setFormPermanent(e.target.checked)} />
              <span>This is permanent / lifetime status (never expires; floors “Current” every year)</span>
            </label>
            <label className="text-sm block">
              <span className="block text-xs uppercase text-slate-400 mb-1">Notes (optional)</span>
              <input className="input w-full" value={formNotes} placeholder="e.g. Bought up to Exec Plat"
                onChange={e => setFormNotes(e.target.value)} />
            </label>
            {formError && <p className="text-sm text-red-500">{formError}</p>}
            <div className="flex gap-2">
              <button className="btn-primary text-sm" onClick={submitStatus}>Save</button>
              <button className="btn-ghost text-sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
            <p className="text-[11px] text-slate-500">
              {formPermanent
                ? 'Permanent status is stored as a lifetime floor for this program and applies to every program-year.'
                : `A one-time override applies to the ${year} program-year only; next year reverts to your earned tier unless you set a new override.`}
            </p>
          </div>
        )}
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
                    <td className="py-1.5 text-slate-600 dark:text-slate-300">{totalsText(JSON.parse(e.metric_values), id)}</td>
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
              <tr className="text-left text-xs text-slate-400 uppercase"><th className="py-1">Type</th><th>Metrics</th><th>Notes</th><th></th></tr>
            </thead>
            <tbody>
              {yearAdjustments.map(a => (
                <tr key={a.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5">{a.adjustment_type}</td>
                  <td className="py-1.5 text-slate-600 dark:text-slate-300">{totalsText(JSON.parse(a.metric_values), id)}</td>
                  <td className="py-1.5 text-slate-500">{a.notes ?? ''}</td>
                  <td className="py-1.5 text-right">
                    <button className="btn-ghost text-xs text-red-600" onClick={() => removeAdjustment(a.id)}>Delete</button>
                  </td>
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
                    <td className="py-1.5 text-slate-600 dark:text-slate-300">{reqText(JSON.parse(t.requirements), id)}</td>
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
