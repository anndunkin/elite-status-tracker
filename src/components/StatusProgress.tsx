import type { ProgramProjection, TierRequirement } from '../../electron/types';
import { displayMetricKey } from '../lib/metricLabels';
import { progressPercent, statusProgress } from '../lib/statusProgress';

function requirementsText(reqs: TierRequirement[], id: string, totals?: Record<string, number>) {
  const groups = new Map<number, string[]>();
  for (const r of reqs) {
    const key = r.group ?? 0;
    const value = totals ? `${(totals[r.metric] ?? 0).toLocaleString()} / ` : '';
    groups.set(key, [...(groups.get(key) ?? []), `${value}${r.threshold.toLocaleString()} ${displayMetricKey(id, r.metric)}`]);
  }
  return [...groups.values()].map(g => g.join(' + ')).join(' OR ');
}

export default function StatusProgress({ projection: p }: { projection: ProgramProjection }) {
  const actual = statusProgress(p.ytdTotals, p.tiers);
  const projected = statusProgress(p.projectedTotals, p.tiers);
  if (!actual.tiers.length) return <p className="mt-3 text-xs text-slate-500">No tier rules available.</p>;
  const pct = progressPercent(actual.actualFraction);
  const actualText = actual.next
    ? requirementsText(actual.next.requirements, p.program.id, p.ytdTotals)
    : `Top tier earned: ${actual.earned?.tier_name}`;

  return (
    <div className="mt-4 space-y-4 text-xs" data-testid={`status-progress-${p.program.id}`}>
      <div>
        <div className="flex flex-wrap justify-between gap-x-2 gap-y-1 mb-1">
          <span className="font-semibold">Actual earned</span>
          <span className="text-slate-600 dark:text-slate-300">
            {actual.next ? `Next: ${actual.next.tier_name} · ${pct}%` : 'Top tier earned'}
          </span>
        </div>
        <div role="progressbar" aria-label={`${p.program.name}: actual earned`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
          aria-valuetext={actualText}
          className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
          <div className="h-full bg-emerald-600" style={{ width: `${actual.actualFraction * 100}%` }} />
        </div>
        <p className="mt-1 text-slate-600 dark:text-slate-300 break-words">{actualText}</p>
      </div>
      <div>
        <div className="flex flex-wrap justify-between gap-x-2 gap-y-1 mb-1">
          <span className="font-semibold">Projected total</span>
          <span className="text-primary-700 dark:text-primary-300">
            {projected.earned ? `Projected: ${projected.earned.tier_name}` : 'No tier projected yet'}
          </span>
        </div>
        <div className="relative h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"
          role="progressbar" aria-label={`${p.program.name}: projected total`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent(projected.projectedFraction)}
          aria-valuetext={`Projected ${projected.earned?.tier_name ?? 'no status'}; completed, booked and planned travel included. Tier milestones are evenly spaced.`}>
          <div className="h-full bg-primary-600" style={{ width: `${projected.projectedFraction * 100}%` }} />
          {projected.tiers.slice(0, -1).map((t, i) => (
            <span key={t.tier_order} aria-hidden="true" className="absolute top-0 h-full border-l-2 border-white dark:border-slate-900"
              style={{ left: `${(i + 1) / projected.tiers.length * 100}%` }} />
          ))}
        </div>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          Completed + booked + planned travel. Tier milestones evenly spaced.
        </p>
        <ul className="mt-2 space-y-1.5" aria-label="All projected tier milestones">
          {projected.tiers.map((t, i) => (
            <li key={t.tier_order} className="flex items-start gap-2">
              <span className="shrink-0 text-slate-500 dark:text-slate-400 tabular-nums">{i + 1}.</span>
              <span className="min-w-0">
                <span className="font-medium">{t.tier_name}</span>
                <span className={projected.qualified[i] ? 'text-primary-700 dark:text-primary-300' : 'text-slate-500 dark:text-slate-400'}>
                  {projected.qualified[i] ? ' · Projected to meet' : ' · Not yet projected'}
                </span>
                <span className="block text-slate-500 dark:text-slate-400 break-words">{requirementsText(t.requirements, p.program.id)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
