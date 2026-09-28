import type { TierRequirement } from '../../electron/types';
import { highestQualifiedTier, nextTierAbove, qualifiesForTier, type TierLike, type Totals } from '../../electron/rules';

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** AND within a route, OR across routes. Invalid rules never imply completion. */
export function requirementProgress(totals: Totals, requirements: TierRequirement[], baseline: TierRequirement[] = []): number {
  const groups = new Map<number, number[]>();
  for (const r of requirements) {
    const group = r.group ?? 0;
    const raw = totals[r.metric] ?? 0;
    const value = Number.isFinite(raw) ? raw : 0;
    const prior = baseline.find(b => b.metric === r.metric && (b.group ?? 0) === group);
    const start = prior && Number.isFinite(prior.threshold) ? Math.max(0, prior.threshold) : 0;
    const valid = Number.isFinite(r.threshold) && r.threshold > 0;
    const denominator = r.threshold > start ? r.threshold - start : r.threshold;
    const fraction = !valid ? 0 : value >= r.threshold ? 1 : clamp((value - start) / denominator);
    groups.set(group, [...(groups.get(group) ?? []), fraction]);
  }
  return groups.size ? Math.max(...[...groups.values()].map(g => Math.min(...g))) : 0;
}

/** Floor rather than round: never display 100% before all requirements are met. */
export function progressPercent(fraction: number): number {
  return Math.floor(clamp(fraction) * 100);
}

/** A real numeric axis; never mix nights, dollars and points into a rank scale. */
export function projectionScale(totals: Totals, tiers: TierLike[]) {
  const metric = tiers[0]?.requirements[0]?.metric ?? null;
  const thresholds = tiers.map(t => t.requirements.find(r => r.metric === metric)?.threshold);
  if (!metric || thresholds.some(t => t === undefined || !Number.isFinite(t) || t <= 0)) return null;
  const maximum = Math.max(...thresholds as number[]);
  const value = Number.isFinite(totals[metric]) ? Math.max(0, totals[metric]) : 0;
  return {
    metric, maximum, value, fraction: clamp(value / maximum),
    milestones: tiers.map((tier, i) => ({ tier, threshold: thresholds[i]!, fraction: thresholds[i]! / maximum })),
  };
}

export function statusProgress(totals: Totals, inputTiers: TierLike[]) {
  const tiers = [...inputTiers].sort((a, b) => a.tier_order - b.tier_order);
  const earned = highestQualifiedTier(totals, tiers);
  const next = nextTierAbove(earned, tiers);
  const scale = projectionScale(totals, tiers);
  return {
    tiers, earned, next,
    actualFraction: next ? requirementProgress(totals, next.requirements) : tiers.length ? 1 : 0,
    projectedFraction: scale?.fraction ?? 0,
    scale,
    qualified: tiers.map(t => qualifiesForTier(totals, t.requirements)),
  };
}
