import { describe, it, expect } from 'vitest';
import { seededDb } from './helpers';
import {
  programsGetAll, tripGetAll, tripCreate, tripUpdate, tripDelete, tripGetById,
  adjustmentsGetAll, lastActivityGetAll, computeProjections,
  programCreateRuleVersion, programGetTiers, refreshStatus, refreshLogCheck,
  cardEarningsGetAll, cardEarningCreate, cardEarningUpdate, cardEarningDelete,
  lifetimeStatusGetAll, lifetimeStatusSet, lifetimeStatusClear,
  lifetimeMileageGetAll, accruedLifetimeMiles,
} from '../electron/database';
import { haversineMiles } from '../electron/airports';
import { qualifiesForTier, highestQualifiedTier, programYearOf, sumMetrics } from '../electron/rules';
import seed from '../electron/seedTrips.json';
import counts from '../electron/seedCounts.json';

describe('seed data import', () => {
  const db = seededDb();

  it('loads all 12 seed programs + Other', () => {
    const progs = programsGetAll(db);
    expect(progs.find(p => p.id === 'aa')).toBeTruthy();
    expect(progs.find(p => p.id === 'other')).toBeTruthy();
    expect(progs.length).toBe(13);
  });

  it('imports the exact trip count from the source', () => {
    expect(tripGetAll(db).length).toBe(seed.trips.length);
    expect(tripGetAll(db).length).toBe(423);
  });

  it('imports adjustments and last-activity records', () => {
    expect(adjustmentsGetAll(db).length).toBe(seed.adjustments.length);
    // last_activity dedupes by program_id (PRIMARY KEY)
    const la = lastActivityGetAll(db);
    expect(la.length).toBeGreaterThan(0);
    expect(la.length).toBeLessThanOrEqual(seed.last_activity.length);
  });

  it('matches per-program trip-entry counts from the converter', () => {
    const rows = db.prepare(
      'SELECT program_id, COUNT(*) c FROM trip_program_entries GROUP BY program_id'
    ).all() as Array<{ program_id: string; c: number }>;
    const byId = Object.fromEntries(rows.map(r => [r.program_id, r.c]));
    for (const [pid, meta] of Object.entries(counts as Record<string, { trips: number }>)) {
      if (meta.trips > 0) expect(byId[pid], `program ${pid}`).toBe(meta.trips);
    }
  });
});

describe('trip CRUD', () => {
  it('creates, updates, and deletes a trip with entries', () => {
    const db = seededDb();
    const before = tripGetAll(db).length;
    const created = tripCreate(db, {
      label: 'Test Run', start_date: '2026-04-01', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: { points: 5000, spend: 400 } }],
    });
    expect(created.id).toBeGreaterThan(0);
    expect(tripGetAll(db).length).toBe(before + 1);
    expect(created.entries[0].program_id).toBe('aa');

    const updated = tripUpdate(db, created.id, { label: 'Renamed', status: 'booked' });
    expect(updated?.label).toBe('Renamed');
    expect(updated?.status).toBe('booked');

    expect(tripDelete(db, created.id)).toBe(true);
    expect(tripGetById(db, created.id)).toBeNull();
  });
});

describe('projection correctness', () => {
  it('reflects a completed trip in current totals and tier', () => {
    const db = seededDb();
    // Clear existing seed noise for aa in the current program year by using a fresh empty db instead.
    tripCreate(db, {
      label: 'AA big year', start_date: '2026-06-01', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: { points: 80000 } }],
    });
    const proj = computeProjections(db, new Date('2026-06-15T00:00:00Z'));
    const aa = proj.find(p => p.program.id === 'aa')!;
    expect(aa.currentTotals.points).toBeGreaterThanOrEqual(80000);
    // 75k threshold = Platinum
    expect(['Platinum', 'Platinum Pro', 'Executive Platinum']).toContain(aa.currentTier);
  });

  it('adds estimates only into projected totals, not current', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'Planned DL', start_date: '2026-05-01', status: 'planned',
      entries: [{ program_id: 'dl', is_estimate: true, metric_values: { mqd: 9000 } }],
    });
    const proj = computeProjections(db, new Date('2026-05-15T00:00:00Z'));
    const dl = proj.find(p => p.program.id === 'dl')!;
    const cur = dl.currentTotals.mqd ?? 0;
    expect(dl.projectedTotals.mqd).toBe(cur + 9000);
  });
});

describe('Marriott Ambassador rule (v1.1 confirmation)', () => {
  it('requires 100 nights AND $23,000 spend, with the conflicting-sources flag removed', () => {
    const db = seededDb();
    const { versions, tiersByVersion } = programGetTiers(db, 'mb');
    const current = versions.find(v => v.is_current === 1)!;
    expect(current.source_notes).toMatch(/23,000|23000/);
    expect(current.source_notes).not.toMatch(/conflict|25,?000|verify/i);
    const amb = (tiersByVersion[current.id] ?? []).find(t => t.tier_name === 'Ambassador')!;
    const reqs = JSON.parse(amb.requirements) as Array<{ metric: string; threshold: number; group: number }>;
    const nights = reqs.find(r => r.metric === 'nights')!;
    const spend = reqs.find(r => r.metric === 'spend')!;
    expect(nights.threshold).toBe(100);
    expect(spend.threshold).toBe(23000);
    expect(nights.group).toBe(spend.group); // AND (same group)
  });

  it('leaves the Hyatt Explorist 20-vs-30 verification flag in place (seeded at 30)', () => {
    const db = seededDb();
    const { versions, tiersByVersion } = programGetTiers(db, 'wh');
    const current = versions.find(v => v.is_current === 1)!;
    expect(current.source_notes).toMatch(/20 vs 30|verify/i);
    const exp = (tiersByVersion[current.id] ?? []).find(t => t.tier_name === 'Explorist')!;
    const reqs = JSON.parse(exp.requirements) as Array<{ metric: string; threshold: number }>;
    expect(reqs.find(r => r.metric === 'nights')!.threshold).toBe(30);
  });
});

describe('card-earnings CRUD', () => {
  it('creates, lists, updates, and deletes a card-earnings entry', () => {
    const db = seededDb();
    const created = cardEarningCreate(db, {
      program_id: 'dl', entry_date: '2026-05-01', metric_key: 'mqd', amount: 2500, notes: 'Amex Platinum',
    });
    expect(created.id).toBeGreaterThan(0);
    expect(cardEarningsGetAll(db).some(c => c.id === created.id)).toBe(true);

    const updated = cardEarningUpdate(db, created.id, { amount: 3000 });
    expect(updated?.amount).toBe(3000);
    expect(updated?.metric_key).toBe('mqd'); // unchanged fields preserved

    expect(cardEarningDelete(db, created.id)).toBe(true);
    expect(cardEarningsGetAll(db).some(c => c.id === created.id)).toBe(false);
  });

  it('feeds card earnings into YTD and Projected totals via entry_date bucketing', () => {
    const db = seededDb();
    const dlBefore = computeProjections(db, new Date('2026-06-15T00:00:00Z')).find(p => p.program.id === 'dl')!;
    const ytdBefore = dlBefore.ytdTotals.mqd ?? 0;
    cardEarningCreate(db, { program_id: 'dl', entry_date: '2026-04-01', metric_key: 'mqd', amount: 4000, notes: null });
    const dlAfter = computeProjections(db, new Date('2026-06-15T00:00:00Z')).find(p => p.program.id === 'dl')!;
    expect(dlAfter.ytdTotals.mqd).toBe(ytdBefore + 4000);
    expect(dlAfter.projectedTotals.mqd).toBe((dlBefore.projectedTotals.mqd ?? 0) + 4000);
  });

  it('respects the AA Mar1–Feb window when bucketing card earnings', () => {
    const db = seededDb();
    // Feb 2026 belongs to the 2025 AA status year, so it must NOT land in the 2026 YTD.
    const aaBefore = computeProjections(db, new Date('2026-06-15T00:00:00Z')).find(p => p.program.id === 'aa')!;
    const ytdBefore = aaBefore.ytdTotals.points ?? 0;
    cardEarningCreate(db, { program_id: 'aa', entry_date: '2026-02-15', metric_key: 'points', amount: 5000, notes: null });
    const aaAfter = computeProjections(db, new Date('2026-06-15T00:00:00Z')).find(p => p.program.id === 'aa')!;
    expect(aaAfter.ytdTotals.points ?? 0).toBe(ytdBefore); // Feb → prior year, excluded
  });
});

describe('lifetime status floor', () => {
  it('seeds Hilton with lifetime Diamond status', () => {
    const db = seededDb();
    const hh = lifetimeStatusGetAll(db).find(l => l.program_id === 'hh');
    expect(hh?.tier_name).toBe('Diamond');
    expect(hh?.notes).toMatch(/permanent/i);
  });

  it('floors the displayed current tier at the lifetime tier even with no annual activity', () => {
    const db = seededDb();
    const hh = computeProjections(db).find(p => p.program.id === 'hh')!;
    expect(hh.lifetimeTier).toBe('Diamond');
    // currentStatusTier never drops below the lifetime tier.
    const tierOrder = (name: string | null) => hh.tiers.find(t => t.tier_name === name)?.tier_order ?? -1;
    expect(tierOrder(hh.currentStatusTier)).toBeGreaterThanOrEqual(tierOrder('Diamond'));
  });

  it('sets and clears a generic lifetime status for any program', () => {
    const db = seededDb();
    lifetimeStatusSet(db, { program_id: 'dl', tier_name: 'Diamond', achieved_date: '2020-01-01', notes: 'test' });
    expect(lifetimeStatusGetAll(db).find(l => l.program_id === 'dl')?.tier_name).toBe('Diamond');
    expect(lifetimeStatusClear(db, 'dl')).toBe(true);
    expect(lifetimeStatusGetAll(db).find(l => l.program_id === 'dl')).toBeUndefined();
  });
});

describe('three-part status (Current / YTD / Projected)', () => {
  it('separates held (prior year) from YTD (current actuals) from projected (plus estimates)', () => {
    const db = seededDb();
    const base = computeProjections(db, new Date('2026-07-01T00:00:00Z')).find(p => p.program.id === 'dl')!;
    const heldBase = base.heldTotals.mqd ?? 0;
    const ytdBase = base.ytdTotals.mqd ?? 0;
    const projBase = base.projectedTotals.mqd ?? 0;

    // Prior completed year (2025) actuals → held only.
    tripCreate(db, {
      label: 'DL 2025', start_date: '2025-06-01', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: { mqd: 16000 } }],
    });
    // Current year (2026) actual → YTD (and projected).
    tripCreate(db, {
      label: 'DL 2026 actual', start_date: '2026-06-01', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: { mqd: 6000 } }],
    });
    // Current year (2026) estimate → projected only.
    tripCreate(db, {
      label: 'DL 2026 planned', start_date: '2026-09-01', status: 'planned',
      entries: [{ program_id: 'dl', is_estimate: true, metric_values: { mqd: 10000 } }],
    });
    const dl = computeProjections(db, new Date('2026-07-01T00:00:00Z')).find(p => p.program.id === 'dl')!;
    expect(dl.heldFromYear).toBe(2025);
    expect(dl.heldTotals.mqd).toBe(heldBase + 16000);   // held changed, YTD did not
    expect(dl.ytdTotals.mqd).toBe(ytdBase + 6000);
    expect(dl.projectedTotals.mqd).toBe(projBase + 6000 + 10000);
  });
});

describe('Delta lifetime mileage (Million Miler)', () => {
  it('seeds the 3MM baseline at 2,032,832 miles as of 2026-07-01', () => {
    const db = seededDb();
    const dl = lifetimeMileageGetAll(db).find(m => m.program_id === 'dl')!;
    expect(dl.baseline_miles).toBe(2032832);
    expect(dl.baseline_date).toBe('2026-07-01');
    expect(dl.milestones.map(m => m.threshold)).toEqual([1000000, 2000000, 3000000, 5000000]);
  });

  it('accrues only completed Delta segments dated after the baseline', () => {
    const db = seededDb();
    // Before-baseline completed segment: must NOT accrue.
    tripCreate(db, {
      label: 'Pre-baseline', start_date: '2026-06-01', status: 'completed',
      segments: [{ origin_airport: 'SEA', destination_airport: 'JFK', distance_miles: 2000, program_id: 'dl' }],
    });
    // After-baseline completed segment: accrues.
    tripCreate(db, {
      label: 'Post-baseline', start_date: '2026-08-01', status: 'completed',
      segments: [{ origin_airport: 'SEA', destination_airport: 'NRT', distance_miles: 4800, program_id: 'dl' }],
    });
    // After-baseline but planned: must NOT accrue.
    tripCreate(db, {
      label: 'Planned', start_date: '2026-09-01', status: 'planned',
      segments: [{ origin_airport: 'SEA', destination_airport: 'LHR', distance_miles: 5000, program_id: 'dl' }],
    });
    const accrued = accruedLifetimeMiles(db, 'dl', '2026-07-01');
    expect(accrued).toBe(4800);
    const dl = lifetimeMileageGetAll(db).find(m => m.program_id === 'dl')!;
    expect(dl.currentMiles).toBe(2032832 + 4800);
    expect(dl.nextMilestone?.threshold).toBe(3000000);
    expect(dl.milesToNext).toBe(3000000 - (2032832 + 4800));
  });
});

describe('rule version management', () => {
  it('creates a new current version and demotes the old', () => {
    const db = seededDb();
    const newId = programCreateRuleVersion(db, 'aa', '2027-03-01', 'test update', [
      { tier_name: 'Gold', tier_order: 1, requirements: [{ metric: 'points', threshold: 45000, group: 0, op: 'AND' }] },
    ]);
    expect(newId).toBeGreaterThan(0);
    const { versions } = programGetTiers(db, 'aa');
    const current = versions.filter(v => v.is_current === 1);
    expect(current.length).toBe(1);
    expect(current[0].id).toBe(newId);
    expect(versions.length).toBeGreaterThanOrEqual(2); // history retained
  });
});

describe('airmile calculation spot checks', () => {
  it('SEA-NRT is a long-haul (~4700mi)', () => {
    const d = haversineMiles('SEA', 'NRT')!;
    expect(d).toBeGreaterThan(4500);
    expect(d).toBeLessThan(5000);
  });
  it('SFO-JFK transcon (~2580mi)', () => {
    const d = haversineMiles('SFO', 'JFK')!;
    expect(d).toBeGreaterThan(2400);
    expect(d).toBeLessThan(2700);
  });
  it('returns null for unknown codes', () => {
    expect(haversineMiles('SEA', 'ZZZ')).toBeNull();
  });
});

describe('quarterly refresh logic', () => {
  it('is not due immediately after a fresh seed (3 months out)', () => {
    const db = seededDb();
    const s = refreshStatus(db, new Date());
    expect(s.due).toBe(false);
  });
  it('becomes due after the next_check_due date', () => {
    const db = seededDb();
    const future = new Date();
    future.setMonth(future.getMonth() + 4);
    expect(refreshStatus(db, future).due).toBe(true);
  });
  it('logging a review pushes the next check 3 months out', () => {
    const db = seededDb();
    const today = new Date('2026-07-22T00:00:00Z');
    const { nextCheckDue } = refreshLogCheck(db, ['aa'], [], today);
    expect(nextCheckDue).toBe('2026-10-22');
  });
});

describe('pure rule helpers', () => {
  it('AND within a group, OR across groups', () => {
    const reqs = [
      { metric: 'pqp', threshold: 5000, group: 0, op: 'AND' as const },
      { metric: 'pqf', threshold: 15, group: 0, op: 'AND' as const },
      { metric: 'pqp', threshold: 6000, group: 1, op: 'AND' as const },
    ];
    expect(qualifiesForTier({ pqp: 5000, pqf: 15 }, reqs)).toBe(true);  // group 0 met
    expect(qualifiesForTier({ pqp: 6000 }, reqs)).toBe(true);            // group 1 met
    expect(qualifiesForTier({ pqp: 5000, pqf: 10 }, reqs)).toBe(false);  // neither
  });

  it('highestQualifiedTier picks the top met tier', () => {
    const tiers = [
      { tier_name: 'A', tier_order: 1, requirements: [{ metric: 'x', threshold: 10 }] },
      { tier_name: 'B', tier_order: 2, requirements: [{ metric: 'x', threshold: 20 }] },
    ];
    expect(highestQualifiedTier({ x: 25 }, tiers)?.tier_name).toBe('B');
    expect(highestQualifiedTier({ x: 15 }, tiers)?.tier_name).toBe('A');
    expect(highestQualifiedTier({ x: 5 }, tiers)).toBeNull();
  });

  it('sumMetrics merges maps', () => {
    expect(sumMetrics([{ a: 1 }, { a: 2, b: 3 }])).toEqual({ a: 3, b: 3 });
  });

  it('AA status year windows Jan/Feb into the prior year', () => {
    expect(programYearOf('2026-02-15', 'aa_status_year')).toBe(2025);
    expect(programYearOf('2026-03-01', 'aa_status_year')).toBe(2026);
    expect(programYearOf('2026-02-15', 'calendar')).toBe(2026);
  });
});
