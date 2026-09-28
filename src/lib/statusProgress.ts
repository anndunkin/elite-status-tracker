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

export function statusProgress(totals: Totals, inputTiers: TierLike[]) {
  const tiers = [...inputTiers].sort((a, b) => a.tier_order - b.tier_order);
  const earned = highestQualifiedTier(totals, tiers);
  const next = nextTierAbove(earned, tiers);
  const earnedIndex = earned ? tiers.indexOf(earned) : -1;
  // Each tier occupies one equal interval. Interpolate the next interval using
  // its full qualification routes, not just the first metric or first route.
  const interval = next ? requirementProgress(totals, next.requirements, earned?.requirements) : 0;
  return {
    tiers, earned, next,
    actualFraction: next ? requirementProgress(totals, next.requirements) : tiers.length ? 1 : 0,
    projectedFraction: tiers.length ? (earnedIndex + 1 + interval) / tiers.length : 0,
    qualified: tiers.map(t => qualifiesForTier(totals, t.requirements)),
  };
}
