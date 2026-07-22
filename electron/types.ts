// ─── Domain types ───────────────────────────────────────────────────────────

export type ProgramType = 'airline' | 'hotel';
export type YearType = 'calendar' | 'aa_status_year';

export interface Program {
  id: string;
  name: string;
  type: ProgramType;
  is_active: number;      // 1 | 0
  year_type: YearType;
  metric_keys: string;    // JSON array string
  notes: string | null;
}

export interface TierRequirement {
  metric: string;
  threshold: number;
  op?: 'AND';   // requirements sharing the same group with op:'AND' must all be met
  group?: number; // group index; separate groups are OR-ed together
}

export interface ProgramTier {
  id: number;
  rule_version_id: number;
  tier_name: string;
  tier_order: number;
  requirements: string;   // JSON of TierRequirement[]
}

export interface ProgramRuleVersion {
  id: number;
  program_id: string;
  effective_date: string;
  source_notes: string | null;
  created_at: string;
  is_current: number;
}

export type TripStatus = 'planned' | 'booked' | 'completed';

export interface Trip {
  id: number;
  label: string;
  start_date: string;
  end_date: string | null;
  status: TripStatus;
  is_historical_estimate_date: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TripSegment {
  id: number;
  trip_id: number;
  origin_airport: string | null;
  destination_airport: string | null;
  distance_miles: number | null;
  cost_usd: number | null;
  program_id: string | null;
  fare_class: string | null;
}

export interface TripProgramEntry {
  id: number;
  trip_id: number;
  program_id: string;
  is_estimate: number;    // 1 estimate, 0 actual
  metric_values: string;  // JSON: {points:..,spend:..}
  card_bonus_notes: string | null;
  created_at: string;
}

export type AdjustmentType =
  | 'bonus' | 'rollover' | 'credit_card' | 'credit_card_annual' | 'promotional' | 'reset';

export interface ProgramYearAdjustment {
  id: number;
  program_id: string;
  program_year: number;
  adjustment_type: AdjustmentType;
  metric_values: string;  // JSON
  notes: string | null;
}

export interface ProgramLastActivity {
  program_id: string;
  last_stay_date: string | null;
  notes: string | null;
}

export interface RuleRefreshLog {
  id: number;
  checked_at: string;
  programs_reviewed: string | null;
  programs_updated: string | null;
  next_check_due: string;
}

// ─── Lifetime status / mileage & card-earnings (v1.1) ──────────────────────────

/** A permanent tier held independent of annual re-qualification (e.g. Hilton Lifetime Diamond). */
export interface ProgramLifetimeStatus {
  program_id: string;
  tier_name: string;
  achieved_date: string | null;
  notes: string | null;
}

export interface LifetimeMileageMilestone {
  label: string;
  threshold: number;
}

/** Row as stored: milestones is a JSON string. */
export interface ProgramLifetimeMileageRow {
  program_id: string;
  baseline_miles: number;
  baseline_date: string;
  milestones: string;
}

/** Computed view: current lifetime miles = baseline + accrued flown miles since baseline_date. */
export interface ProgramLifetimeMileageView {
  program_id: string;
  baseline_miles: number;
  baseline_date: string;
  milestones: LifetimeMileageMilestone[];
  accruedSinceBaseline: number;
  currentMiles: number;
  nextMilestone: LifetimeMileageMilestone | null;
  milesToNext: number | null;
}

/**
 * A one-time, program-year-scoped manual override of the displayed "Current"
 * tier for a program (e.g. a purchased/gifted status or status-match that isn't
 * captured by tracked earning activity). Unlike a lifetime status, it does not
 * persist into future program-years.
 */
export interface ProgramStatusOverride {
  id: number;
  program_id: string;
  program_year: number;
  tier_name: string;
  notes: string | null;
  created_at: string;
}

export interface ProgramStatusOverrideInput {
  program_id: string;
  program_year: number;
  tier_name: string;
  notes?: string | null;
}

export type CardMetricKey = 'mqd' | 'points' | 'nights';

/** Manual credit-card-driven elite qualifying credit, dated so it buckets by program-year. */
export interface CardEarningEntry {
  id: number;
  program_id: string;
  entry_date: string;
  metric_key: string;
  amount: number;
  notes: string | null;
  created_at: string;
}

export interface CardEarningInput {
  program_id: string;
  entry_date: string;
  metric_key: string;
  amount: number;
  notes?: string | null;
}

export type CardEarningUpdate = Partial<CardEarningInput>;

// ─── Input / create shapes ────────────────────────────────────────────────────

export interface TripEntryInput {
  program_id: string;
  is_estimate: boolean;
  metric_values: Record<string, number>;
  card_bonus_notes?: string;
}

export interface SegmentInput {
  origin_airport?: string | null;
  destination_airport?: string | null;
  distance_miles?: number | null;
  cost_usd?: number | null;
  program_id?: string | null;
  fare_class?: string | null;
}

export interface TripCreate {
  label: string;
  start_date: string;
  end_date?: string | null;
  status?: TripStatus;
  is_historical_estimate_date?: boolean;
  notes?: string | null;
  entries?: TripEntryInput[];
  segments?: SegmentInput[];
}

export type TripUpdate = Partial<TripCreate>;

export interface TripWithDetails extends Trip {
  entries: TripProgramEntry[];
  segments: TripSegment[];
}

// ─── Projection view types ─────────────────────────────────────────────────────

export interface ProgramProjection {
  program: Program;
  program_year: number;
  // v1.0.0 compat fields (currentTotals/currentTier == year-to-date actuals/tier).
  currentTotals: Record<string, number>;
  projectedTotals: Record<string, number>;
  currentTier: string | null;
  projectedTier: string | null;
  // v1.1 three-part status ─────────────────────────────────────────────────────
  // "Current": tier actually held now, from the most recent completed program-year.
  heldTier: string | null;
  heldFromYear: number | null;
  heldTotals: Record<string, number>;
  // "Year-to-date": actual progress within the current in-progress program-year.
  ytdTotals: Record<string, number>;
  ytdTier: string | null;
  // Lifetime status floor: displayed current tier never drops below a lifetime tier.
  lifetimeTier: string | null;
  // Manual current-program-year override of the displayed "Current" tier, if set.
  overrideTier: string | null;
  currentStatusTier: string | null; // MAX(heldTier, lifetimeTier, overrideTier) by tier_order
  lifetimeStatus: ProgramLifetimeStatus | null;
  statusOverride: ProgramStatusOverride | null;
  lifetimeMileage: ProgramLifetimeMileageView | null;
  // Progress toward next tier (headline gauge, based on projected totals).
  nextTier: string | null;
  nextTierRequirements: TierRequirement[] | null;
  tiers: Array<{ tier_name: string; tier_order: number; requirements: TierRequirement[] }>;
}

// ─── File payload (portable snapshot + JSON export/import) ──────────────────────

export const APP_FILE_VERSION = 3;

export interface AppFilePayload {
  version: number;
  savedAt: string;
  programs: Program[];
  rule_versions: ProgramRuleVersion[];
  tiers: ProgramTier[];
  trips: Array<Trip & { entries: TripProgramEntry[]; segments: TripSegment[] }>;
  adjustments: ProgramYearAdjustment[];
  last_activity: ProgramLastActivity[];
  lifetime_status: ProgramLifetimeStatus[];
  lifetime_mileage: ProgramLifetimeMileageRow[];
  card_earnings: CardEarningEntry[];
  status_overrides: ProgramStatusOverride[];
}

export interface FileResult {
  success: boolean;
  filePath?: string;
  payload?: AppFilePayload;
  error?: string;
}

// ─── IPC API surface ────────────────────────────────────────────────────────────

export interface WindowApi {
  programs: {
    getAll: () => Promise<Program[]>;
    getById: (id: string) => Promise<Program | null>;
    getTiers: (programId: string) => Promise<{
      versions: ProgramRuleVersion[];
      tiersByVersion: Record<number, ProgramTier[]>;
    }>;
    createRuleVersion: (programId: string, effective_date: string, source_notes: string,
      tiers: Array<{ tier_name: string; tier_order: number; requirements: TierRequirement[] }>) => Promise<number>;
    lastActivity: () => Promise<ProgramLastActivity[]>;
  };
  lifetime: {
    status: () => Promise<ProgramLifetimeStatus[]>;
    setStatus: (data: ProgramLifetimeStatus) => Promise<ProgramLifetimeStatus>;
    clearStatus: (programId: string) => Promise<boolean>;
    mileage: () => Promise<ProgramLifetimeMileageView[]>;
  };
  cardEarnings: {
    getAll: () => Promise<CardEarningEntry[]>;
    create: (data: CardEarningInput) => Promise<CardEarningEntry>;
    update: (id: number, data: CardEarningUpdate) => Promise<CardEarningEntry | null>;
    delete: (id: number) => Promise<boolean>;
  };
  statusOverrides: {
    getAll: () => Promise<ProgramStatusOverride[]>;
    set: (data: ProgramStatusOverrideInput) => Promise<ProgramStatusOverride>;
    clear: (programId: string, programYear: number) => Promise<boolean>;
  };
  trips: {
    getAll: () => Promise<TripWithDetails[]>;
    getById: (id: number) => Promise<TripWithDetails | null>;
    create: (data: TripCreate) => Promise<TripWithDetails>;
    update: (id: number, data: TripUpdate) => Promise<TripWithDetails | null>;
    delete: (id: number) => Promise<boolean>;
  };
  projection: {
    all: () => Promise<ProgramProjection[]>;
  };
  adjustments: {
    all: () => Promise<ProgramYearAdjustment[]>;
  };
  airports: {
    distance: (a: string, b: string) => Promise<number | null>;
    lookup: (code: string) => Promise<{ code: string; name: string; lat: number; lon: number } | null>;
  };
  refresh: {
    status: () => Promise<{ due: boolean; nextCheckDue: string; lastChecked: string | null }>;
    log: (reviewed: string[], updated: string[]) => Promise<{ nextCheckDue: string }>;
  };
  file: {
    exportJson: () => Promise<FileResult>;
    importJson: () => Promise<FileResult>;
    newDb: () => Promise<FileResult>;
    openDb: () => Promise<FileResult>;
    saveAs: () => Promise<FileResult>;
    currentPath: () => Promise<string>;
  };
}

declare global {
  interface Window {
    api: WindowApi;
  }
}
