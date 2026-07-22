import type { TierRequirement, YearType } from './types';

export type Totals = Record<string, number>;

/**
 * A tier qualifies if ALL requirements in ANY single group are satisfied
 * (AND within a group, OR across groups). A tier with a single group of one
 * requirement is the common case.
 */
export function qualifiesForTier(totals: Totals, requirements: TierRequirement[]): boolean {
  if (!requirements.length) return false;
  const groups = new Map<number, TierRequirement[]>();
  for (const r of requirements) {
    const gk = r.group ?? 0;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk)!.push(r);
  }
  for (const reqs of groups.values()) {
    const allMet = reqs.every(r => (totals[r.metric] ?? 0) >= r.threshold);
    if (allMet) return true;
  }
  return false;
}

export interface TierLike {
  tier_name: string;
  tier_order: number;
  requirements: TierRequirement[];
}

/** Returns the highest tier_order tier whose requirements are met, or null. */
export function highestQualifiedTier(totals: Totals, tiers: TierLike[]): TierLike | null {
  const sorted = [...tiers].sort((a, b) => a.tier_order - b.tier_order);
  let best: TierLike | null = null;
  for (const t of sorted) {
    if (qualifiesForTier(totals, t.requirements)) best = t;
  }
  return best;
}

/** The next tier above the currently-qualified one (or the lowest, if none yet). */
export function nextTierAbove(current: TierLike | null, tiers: TierLike[]): TierLike | null {
  const sorted = [...tiers].sort((a, b) => a.tier_order - b.tier_order);
  if (!current) return sorted[0] ?? null;
  return sorted.find(t => t.tier_order > current.tier_order) ?? null;
}

/**
 * The status-year an activity date belongs to.
 * - calendar: the calendar year.
 * - aa_status_year: American's Mar 1–Feb 28/29 window. Jan/Feb belong to the
 *   window that STARTED the previous March. Everything Mar–Dec belongs to the
 *   window starting that March.
 */
export function programYearOf(dateISO: string, yearType: YearType): number {
  const d = new Date(dateISO + (dateISO.length <= 10 ? 'T00:00:00' : ''));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-based
  if (yearType === 'aa_status_year') {
    return m <= 1 ? y - 1 : y; // Jan(0)/Feb(1) -> previous status year
  }
  return y;
}

/** The current status-year for a program given "today". */
export function currentProgramYear(today: Date, yearType: YearType): number {
  const iso = today.toISOString().slice(0, 10);
  return programYearOf(iso, yearType);
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Sum a list of metric maps into a single totals map. */
export function sumMetrics(maps: Array<Record<string, number>>): Totals {
  const out: Totals = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'number' && !Number.isNaN(v)) out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}
