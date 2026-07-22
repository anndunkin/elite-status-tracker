import type { TierRequirement, YearType, TripStatus } from './types';

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

// ─── Dashboard year-view helpers ────────────────────────────────────────────────

export const MIN_VIEW_YEAR = 2000;
export const MAX_VIEW_YEAR = 2100;

/**
 * Resolve the synthetic "today" used to anchor a dashboard year-view.
 * - Omitted/null/non-finite viewYear → the real `now` (default behavior, unchanged).
 * - A finite viewYear is truncated to an integer and clamped to [MIN,MAX]_VIEW_YEAR,
 *   then mapped to Dec 31 (UTC) of that year so every program's currentProgramYear —
 *   calendar AND aa_status_year — resolves to that year. Never throws.
 */
export function viewYearToDate(viewYear: number | null | undefined, now: Date = new Date()): Date {
  if (viewYear === null || viewYear === undefined) return now;
  if (typeof viewYear !== 'number' || !Number.isFinite(viewYear)) return now;
  const y = Math.min(MAX_VIEW_YEAR, Math.max(MIN_VIEW_YEAR, Math.trunc(viewYear)));
  return new Date(Date.UTC(y, 11, 31));
}

/** Calendar year of an ISO date (YYYY-MM-DD or full ISO), interpreted in UTC. */
export function calendarYearOf(dateISO: string): number {
  return new Date(dateISO + (dateISO.length <= 10 ? 'T00:00:00Z' : '')).getUTCFullYear();
}

export type DashboardBucket = 'overdue' | 'upcoming' | 'neither';

export interface DashboardTripLike {
  start_date: string;
  end_date?: string | null;
  status: TripStatus;
}

/**
 * Classify a trip relative to the REAL current date `now` (never the simulated
 * year-view date). A completed trip is never overdue/upcoming. The "past" test
 * uses `end_date ?? start_date` (the most conservative, latest date), so a trip
 * still in progress (started, not yet ended) is neither overdue nor upcoming.
 */
export function classifyTripByDate(trip: DashboardTripLike, now: Date): DashboardBucket {
  if (trip.status === 'completed') return 'neither';
  const todayISO = now.toISOString().slice(0, 10);
  const startISO = trip.start_date.slice(0, 10);
  const endISO = (trip.end_date ?? trip.start_date).slice(0, 10);
  if (endISO < todayISO) return 'overdue';    // whole trip is in the past, not marked complete
  if (startISO >= todayISO) return 'upcoming'; // starts today or later
  return 'neither';                            // in progress
}

/**
 * Split trips into the two dashboard sections for a given viewYear. The
 * overdue/upcoming decision always uses the REAL `now`; viewYear only restricts
 * the result to trips whose start_date calendar year equals viewYear. Both lists
 * are sorted oldest-first by start_date.
 */
export function selectDashboardTrips<T extends DashboardTripLike>(
  trips: T[], viewYear: number, now: Date,
): { needsUpdate: T[]; upcoming: T[] } {
  const needsUpdate: T[] = [];
  const upcoming: T[] = [];
  for (const t of trips) {
    if (calendarYearOf(t.start_date) !== viewYear) continue;
    const bucket = classifyTripByDate(t, now);
    if (bucket === 'overdue') needsUpdate.push(t);
    else if (bucket === 'upcoming') upcoming.push(t);
  }
  const byStart = (a: T, b: T) => a.start_date.localeCompare(b.start_date);
  needsUpdate.sort(byStart);
  upcoming.sort(byStart);
  return { needsUpdate, upcoming };
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
