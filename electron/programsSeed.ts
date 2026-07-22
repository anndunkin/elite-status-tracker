// Static reference data: the 8 tracked programs (+ lapsed/reference-only) and the
// current (2026) tier thresholds. Loaded once on fresh-DB creation by database.ts.
import type { ProgramType, YearType, TierRequirement } from './types';

export interface SeedProgram {
  id: string;
  name: string;
  type: ProgramType;
  is_active: number;
  year_type: YearType;
  metric_keys: string[];
  notes?: string;
}

export const SEED_PROGRAMS: SeedProgram[] = [
  { id: 'aa', name: 'American AAdvantage', type: 'airline', is_active: 1, year_type: 'aa_status_year', metric_keys: ['points', 'spend'] },
  { id: 'dl', name: 'Delta SkyMiles', type: 'airline', is_active: 1, year_type: 'calendar', metric_keys: ['mqd', 'mqm'] },
  { id: 'as', name: 'Alaska / Atmos Rewards', type: 'airline', is_active: 1, year_type: 'calendar', metric_keys: ['points'] },
  { id: 'ua', name: 'United MileagePlus', type: 'airline', is_active: 1, year_type: 'calendar', metric_keys: ['pqp', 'pqf'] },
  { id: 'hh', name: 'Hilton Honors', type: 'hotel', is_active: 1, year_type: 'calendar', metric_keys: ['nights', 'stays', 'spend'] },
  { id: 'mb', name: 'Marriott Bonvoy', type: 'hotel', is_active: 1, year_type: 'calendar', metric_keys: ['nights', 'spend'] },
  { id: 'ih', name: 'IHG One Rewards', type: 'hotel', is_active: 1, year_type: 'calendar', metric_keys: ['nights', 'points'] },
  { id: 'wh', name: 'World of Hyatt', type: 'hotel', is_active: 1, year_type: 'calendar', metric_keys: ['nights', 'points'] },
  { id: 'omni', name: 'Omni Select Guest (lapsed)', type: 'hotel', is_active: 0, year_type: 'calendar', metric_keys: ['nights'], notes: 'Reference only — historical stays.' },
  { id: 'starwood', name: 'Starwood Preferred Guest (defunct)', type: 'hotel', is_active: 0, year_type: 'calendar', metric_keys: ['nights'], notes: 'Defunct — merged into Marriott Bonvoy.' },
  { id: 'fairmont', name: 'Fairmont President’s Club (defunct)', type: 'hotel', is_active: 0, year_type: 'calendar', metric_keys: ['nights'], notes: 'Defunct — merged into Marriott/Accor.' },
  { id: 'va', name: 'Virgin Atlantic Flying Club', type: 'airline', is_active: 0, year_type: 'calendar', metric_keys: ['miles'], notes: 'Reference only — miles expiration tracked.' },
];

// Also referenced by the seed importer as a fallback catch-all program.
export const OTHER_PROGRAM: SeedProgram = {
  id: 'other', name: 'Other / Unassigned', type: 'airline', is_active: 0, year_type: 'calendar', metric_keys: ['miles'], notes: 'Historical miles that could not be attributed to a specific airline.',
};

export interface SeedTier {
  tier_name: string;
  tier_order: number;
  requirements: TierRequirement[];
}

// requirements grouped by `group`: a tier qualifies if ALL requirements in ANY
// single group are met (AND within a group, OR across groups).
export interface SeedRuleSet {
  program_id: string;
  effective_date: string;
  source_notes: string;
  tiers: SeedTier[];
}

const g = (metric: string, threshold: number, group: number): TierRequirement =>
  ({ metric, threshold, group, op: 'AND' });

export const SEED_RULES: SeedRuleSet[] = [
  {
    program_id: 'aa', effective_date: '2026-03-01',
    source_notes: 'https://www.aa.com/web/i18n/aadvantage-program/discover/loyalty-points-status.html',
    tiers: [
      { tier_name: 'Gold', tier_order: 1, requirements: [g('points', 40000, 0)] },
      { tier_name: 'Platinum', tier_order: 2, requirements: [g('points', 75000, 0)] },
      { tier_name: 'Platinum Pro', tier_order: 3, requirements: [g('points', 125000, 0)] },
      { tier_name: 'Executive Platinum', tier_order: 4, requirements: [g('points', 200000, 0)] },
    ],
  },
  {
    program_id: 'dl', effective_date: '2026-01-01',
    source_notes: 'https://www.delta.com/us/en/skymiles/medallion-program/how-to-qualify',
    tiers: [
      { tier_name: 'Silver', tier_order: 1, requirements: [g('mqd', 5000, 0)] },
      { tier_name: 'Gold', tier_order: 2, requirements: [g('mqd', 10000, 0)] },
      { tier_name: 'Platinum', tier_order: 3, requirements: [g('mqd', 15000, 0)] },
      { tier_name: 'Diamond', tier_order: 4, requirements: [g('mqd', 28000, 0)] },
    ],
  },
  {
    program_id: 'as', effective_date: '2026-01-01',
    source_notes: 'https://onemileatatime.com/news/alaska-hawaiian-atmos-rewards-program/',
    tiers: [
      { tier_name: 'Silver', tier_order: 1, requirements: [g('points', 20000, 0)] },
      { tier_name: 'Gold', tier_order: 2, requirements: [g('points', 40000, 0)] },
      { tier_name: 'Platinum', tier_order: 3, requirements: [g('points', 80000, 0)] },
      { tier_name: 'Titanium', tier_order: 4, requirements: [g('points', 135000, 0)] },
    ],
  },
  {
    program_id: 'ua', effective_date: '2026-01-01',
    source_notes: 'https://thepointsguy.com/news/united-airlines-premier-status-pluspoints-changes/',
    tiers: [
      { tier_name: 'Silver', tier_order: 1, requirements: [g('pqp', 5000, 0), g('pqf', 15, 0), g('pqp', 6000, 1)] },
      { tier_name: 'Gold', tier_order: 2, requirements: [g('pqp', 10000, 0), g('pqf', 30, 0), g('pqp', 12000, 1)] },
      { tier_name: 'Platinum', tier_order: 3, requirements: [g('pqp', 15000, 0), g('pqf', 45, 0), g('pqp', 18000, 1)] },
      { tier_name: 'Premier 1K', tier_order: 4, requirements: [g('pqp', 22000, 0), g('pqf', 60, 0), g('pqp', 28000, 1)] },
    ],
  },
  {
    program_id: 'hh', effective_date: '2026-01-01',
    source_notes: 'https://www.hilton.com/en/p/hilton-honors/tier-updates/',
    tiers: [
      { tier_name: 'Silver', tier_order: 1, requirements: [g('nights', 10, 0), g('stays', 4, 1), g('spend', 2500, 2)] },
      { tier_name: 'Gold', tier_order: 2, requirements: [g('nights', 25, 0), g('stays', 15, 1), g('spend', 6000, 2)] },
      { tier_name: 'Diamond', tier_order: 3, requirements: [g('nights', 50, 0), g('stays', 25, 1), g('spend', 11500, 2)] },
      { tier_name: 'Diamond Reserve', tier_order: 4, requirements: [g('nights', 80, 0), g('spend', 18000, 0)] },
    ],
  },
  {
    program_id: 'mb', effective_date: '2026-01-01',
    source_notes: 'https://www.screened.com/blog/marriott-bonvoy-elite-status-changes-2026/ | NOTE: Ambassador spend threshold conflicting across sources, $23K vs $25K — verify at next quarterly refresh.',
    tiers: [
      { tier_name: 'Silver', tier_order: 1, requirements: [g('nights', 10, 0)] },
      { tier_name: 'Gold', tier_order: 2, requirements: [g('nights', 25, 0)] },
      { tier_name: 'Platinum', tier_order: 3, requirements: [g('nights', 50, 0)] },
      { tier_name: 'Titanium', tier_order: 4, requirements: [g('nights', 80, 0)] },
      { tier_name: 'Ambassador', tier_order: 5, requirements: [g('nights', 100, 0), g('spend', 23000, 0)] },
    ],
  },
  {
    program_id: 'ih', effective_date: '2026-01-01',
    source_notes: 'https://www.ihg.com/content/us/en/customer-care/member-tc',
    tiers: [
      { tier_name: 'Silver', tier_order: 1, requirements: [g('nights', 10, 0)] },
      { tier_name: 'Gold', tier_order: 2, requirements: [g('nights', 20, 0), g('points', 40000, 1)] },
      { tier_name: 'Platinum', tier_order: 3, requirements: [g('nights', 40, 0), g('points', 60000, 1)] },
      { tier_name: 'Diamond', tier_order: 4, requirements: [g('nights', 70, 0), g('points', 120000, 1)] },
    ],
  },
  {
    program_id: 'wh', effective_date: '2026-01-01',
    source_notes: 'https://frequentmiler.com/world-of-hyatt-complete-guide/ | NOTE: Explorist night threshold conflicting across sources, 20 vs 30 — verify at next quarterly refresh.',
    tiers: [
      { tier_name: 'Discoverist', tier_order: 1, requirements: [g('nights', 10, 0), g('points', 25000, 1)] },
      { tier_name: 'Explorist', tier_order: 2, requirements: [g('nights', 30, 0), g('points', 50000, 1)] },
      { tier_name: 'Globalist', tier_order: 3, requirements: [g('nights', 60, 0), g('points', 100000, 1)] },
    ],
  },
];
