import { useLayoutEffect, useRef, useState } from 'react';
import type { ProgramProjection, TierRequirement } from '../../electron/types';
import { displayMetricKey } from '../lib/metricLabels';
import { progressPercent, requirementProgress, statusProgress, type projectionScale } from '../lib/statusProgress';

function groupRequirements(reqs: TierRequirement[]) {
  const groups = new Map<number, TierRequirement[]>();
  for (const r of reqs) groups.set(r.group ?? 0, [...(groups.get(r.group ?? 0) ?? []), r]);
  return [...groups.values()];
}

function metricAmount(value: number, metric: string) {
  const safe = Number.isFinite(value) ? value : 0;
  return `${metric === 'spend' ? '$' : ''}${safe.toLocaleString()}`;
}

function requirementsText(reqs: TierRequirement[], id: string, totals?: Record<string, number>) {
  return groupRequirements(reqs).map(g => g.map(r => {
    const value = totals ? `${metricAmount(totals[r.metric] ?? 0, r.metric)} / ` : '';
    return `${value}${metricAmount(r.threshold, r.metric)} ${displayMetricKey(id, r.metric)}`;
  }).join(' + ')).join(' OR ');
}

/** Actual bar and its numbers use the strongest complete qualification route. */
function bestRoute(reqs: TierRequirement[], totals: Record<string, number>) {
  return groupRequirements(reqs).sort((a, b) => requirementProgress(totals, b) - requirementProgress(totals, a))[0] ?? [];
}

function AlternativeRequirements({ requirements, id }: { requirements: TierRequirement[]; id: string }) {
  return groupRequirements(requirements).length > 1
    ? <p className="mt-1 text-slate-500 dark:text-slate-400 break-words">Requires: {requirementsText(requirements, id)}</p>
    : null;
}

type Scale = NonNullable<ReturnType<typeof projectionScale>>;
const compact = (n: number) => n >= 1000 ? `${Number((n / 1000).toFixed(2))}k` : n.toLocaleString();

/** Keep labels on their true numeric ticks; stagger only when measured text collides. */
function TierScale({ scale, id }: { scale: Scale; id: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ height: number; labels: { left: number; bottom: number }[] } | null>(null);
  useLayoutEffect(() => {
    let previousWidth = -1;
    const measure = () => {
      const width = root.current?.clientWidth ?? 0;
      if (!width || width === previousWidth) return;
      previousWidth = width;
      const nodes = [...root.current!.querySelectorAll<HTMLElement>('[data-tier-label]')];
      const rowHeight = Math.max(...nodes.map(n => n.offsetHeight), 36) + 6;
      const rows: { start: number; end: number }[][] = [[{ start: 0, end: 9 }]];
      const labels = nodes.map((node, i) => {
        const labelWidth = node.offsetWidth;
        const start = Math.max(0, Math.min(width - labelWidth, scale.milestones[i].fraction * width - labelWidth / 2));
        const end = start + labelWidth;
        let row = rows.findIndex(intervals => intervals.every(r => end + 6 <= r.start || start >= r.end + 6));
        if (row < 0) { row = rows.length; rows.push([]); }
        rows[row].push({ start, end });
        return { left: start, bottom: row * rowHeight + 8 };
      });
      setLayout({ height: rows.length * rowHeight + 8, labels });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, [scale.milestones.map(m => `${m.tier.tier_name}:${m.threshold}`).join('|')]);

  return <div ref={root} className="relative mt-2 text-xs text-slate-500 dark:text-slate-400"
    style={{ height: layout?.height ?? 62 }} aria-label={`Tier thresholds in ${displayMetricKey(id, scale.metric)}`}>
    <span className="absolute bottom-2 left-0" aria-hidden="true">0</span>
    {scale.milestones.map((m, i) => {
      const pos = layout?.labels[i];
      return <span key={m.tier.tier_order}>
        <span aria-hidden="true" className="absolute bottom-0 border-l border-slate-300 dark:border-slate-600"
          style={{ left: `${m.fraction * 100}%`, height: pos ? pos.bottom - 2 : 6, transform: m.fraction === 1 ? 'translateX(-100%)' : undefined }} />
        <span data-tier-label data-testid={`tier-label-${id}-${m.tier.tier_order}`}
          className="absolute text-center leading-tight"
          title={`${m.tier.tier_name}: ${requirementsText(m.tier.requirements, id)}`}
          style={{
            width: 'max-content', maxWidth: 76, overflowWrap: 'anywhere',
            left: pos ? pos.left : `${m.fraction * 100}%`, bottom: pos?.bottom ?? 8,
            transform: pos ? undefined : m.fraction === 1 ? 'translateX(-100%)' : 'translateX(-50%)',
          }}>
          <span className="block font-medium text-slate-600 dark:text-slate-300">{m.tier.tier_name}</span>
          <span className="block">{scale.metric === 'spend' ? '$' : ''}{compact(m.threshold)}</span>
        </span>
      </span>;
    })}
  </div>;
}

export default function StatusProgress({ projection: p }: { projection: ProgramProjection }) {
  const actual = statusProgress(p.ytdTotals, p.tiers);
  const projected = statusProgress(p.projectedTotals, p.tiers);
  if (!actual.tiers.length) return <p className="mt-3 text-xs text-slate-500">No tier rules available.</p>;
  const actualTarget = actual.next ?? actual.earned;
  const projectedTarget = projected.next ?? projected.earned;
  const actualReqs = actualTarget?.requirements ?? [];
  const projectedReqs = projectedTarget?.requirements ?? [];
  const pct = progressPercent(actual.actualFraction);
  const actualText = requirementsText(bestRoute(actualReqs, p.ytdTotals), p.program.id, p.ytdTotals);
  const scale = projected.scale;
  // Show the plotted route's complete set of metrics, including AND conditions.
  // Alternative routes remain explicit in Requires, without a tier list.
  const projectedRoute = groupRequirements(projectedReqs).find(g => g.some(r => r.metric === scale?.metric)) ?? [];
  const projectedText = requirementsText(projectedRoute, p.program.id, p.projectedTotals);
  const multiMetric = new Set(p.tiers.flatMap(t => t.requirements.map(r => r.metric))).size > 1;

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
        <AlternativeRequirements requirements={actualReqs} id={p.program.id} />
      </div>
      <div>
        <div className="flex flex-wrap justify-between gap-x-2 gap-y-1 mb-1">
          <span className="font-semibold">Projected total{multiMetric && scale ? ` · ${displayMetricKey(p.program.id, scale.metric)}` : ''}</span>
          <span className="text-primary-700 dark:text-primary-300">
            {projected.next ? `Next: ${projected.next.tier_name}` : `Projected: ${projected.earned?.tier_name}`}
          </span>
        </div>
        {scale ? <>
          <TierScale scale={scale} id={p.program.id} />
          <div className="relative h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"
            role="progressbar" aria-label={`${p.program.name}: projected total`}
            aria-valuemin={0} aria-valuemax={scale.maximum} aria-valuenow={Math.min(scale.maximum, scale.value)}
            aria-valuetext={`${scale.value.toLocaleString()} ${displayMetricKey(p.program.id, scale.metric)} on a 0 to ${scale.maximum.toLocaleString()} scale. Projected status: ${projected.earned?.tier_name ?? 'none'}. Completed, booked and planned travel included. All requirements determine status.`}>
            <div className="h-full bg-primary-600" data-testid={`projected-fill-${p.program.id}`} style={{ width: `${scale.fraction * 100}%` }} />
            {scale.milestones.filter(m => m.fraction < 1).map(m => (
              <span key={m.tier.tier_order} aria-hidden="true" data-testid={`tier-tick-${p.program.id}-${m.tier.tier_order}`}
                className="absolute top-0 h-full border-l-2 border-white dark:border-slate-900"
                style={{ left: `${m.fraction * 100}%` }} />
            ))}
          </div>
        </> : <p className="text-slate-500">No common numeric scale in these tier rules.</p>}
        <p className="mt-1 text-slate-600 dark:text-slate-300 break-words">{projectedText || requirementsText(projectedReqs, p.program.id, p.projectedTotals)}</p>
        <AlternativeRequirements requirements={projectedReqs} id={p.program.id} />
      </div>
    </div>
  );
}
