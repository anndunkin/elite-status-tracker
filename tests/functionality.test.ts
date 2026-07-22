import { describe, it, expect } from 'vitest';
import { seededDb } from './helpers';
import {
  programsGetAll, tripGetAll, tripCreate, tripUpdate, tripDelete, tripGetById,
  adjustmentsGetAll, lastActivityGetAll, computeProjections, seedIfFresh,
  programCreateRuleVersion, programGetTiers, refreshStatus, refreshLogCheck,
  cardEarningsGetAll, cardEarningCreate, cardEarningUpdate, cardEarningDelete,
  lifetimeStatusGetAll, lifetimeStatusSet, lifetimeStatusClear,
  lifetimeMileageGetAll, accruedLifetimeMiles,
  statusOverrideSet, statusOverrideClear,
} from '../electron/database';
import { haversineMiles } from '../electron/airports';
import { qualifiesForTier, highestQualifiedTier, programYearOf, sumMetrics } from '../electron/rules';

describe('fresh-database seeding (v1.2: reference/rules only, no historical trips)', () => {
  const db = seededDb();

  it('loads all 12 seed programs + Other', () => {
    const progs = programsGetAll(db);
    expect(progs.find(p => p.id === 'aa')).toBeTruthy();
    expect(progs.find(p => p.id === 'other')).toBeTruthy();
    expect(progs.length).toBe(13);
  });

  it('seeds the current tier rules for every active program', () => {
    for (const p of programsGetAll(db).filter(x => x.is_active === 1)) {
      const { versions, tiersByVersion } = programGetTiers(db, p.id);
      const current = versions.find(v => v.is_current === 1);
      expect(current, `program ${p.id} has a current rule version`).toBeTruthy();
      expect((tiersByVersion[current!.id] ?? []).length, `program ${p.id} has tiers`).toBeGreaterThan(0);
    }
  });

  it('starts a fresh database with ZERO historical trips / adjustments / last-activity / card earnings', () => {
    expect(tripGetAll(db).length).toBe(0);
    expect(adjustmentsGetAll(db).length).toBe(0);
    expect(lastActivityGetAll(db).length).toBe(0);
    expect(cardEarningsGetAll(db).length).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM trip_program_entries').get()).toEqual({ c: 0 });
  });

  it('still seeds the reference lifetime data (Hilton lifetime Diamond, Delta 3MM baseline)', () => {
    expect(lifetimeStatusGetAll(db).find(l => l.program_id === 'hh')?.tier_name).toBe('Diamond');
    expect(lifetimeMileageGetAll(db).find(m => m.program_id === 'dl')?.baseline_miles).toBe(2032832);
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

describe('no historical-data loss for existing databases (v1.2 non-destructive)', () => {
  it('re-running the fresh-seed path on an already-seeded DB neither wipes nor duplicates user data', () => {
    const db = seededDb(); // is_seeded already '1' after reference/rules seed
    // Simulate Ann's real usage accumulated under v1.0/v1.1.
    tripCreate(db, {
      label: 'Real completed trip', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: { points: 1000 } }],
    });
    tripCreate(db, {
      label: 'Real planned trip', start_date: '2026-09-01', status: 'planned',
      entries: [{ program_id: 'dl', is_estimate: true, metric_values: { mqd: 500 } }],
    });
    cardEarningCreate(db, { program_id: 'dl', entry_date: '2026-05-01', metric_key: 'mqd', amount: 500, notes: null });
    const tripsBefore = tripGetAll(db).length;
    const ceBefore = cardEarningsGetAll(db).length;
    expect(tripsBefore).toBe(2);

    // openDatabaseAt() runs initSchema + seedIfFresh on every open; this must be a no-op here.
    seedIfFresh(db);
    seedIfFresh(db);

    expect(tripGetAll(db).length).toBe(tripsBefore); // untouched, not wiped
    expect(cardEarningsGetAll(db).length).toBe(ceBefore);
    // And no duplicate reference programs were inserted.
    expect(programsGetAll(db).length).toBe(13);
  });
});

describe('displayed "Current" tier precedence = MAX(lifetime floor, year override, calculated held)', () => {
  // Delta tiers: Silver(1) < Gold(2) < Platinum(3) < Diamond(4).
  const at = new Date('2026-07-01T00:00:00Z'); // calendar program-year 2026
  const dlProj = (db: ReturnType<typeof seededDb>) =>
    computeProjections(db, at).find(p => p.program.id === 'dl')!;
  const addHeldGold = (db: ReturnType<typeof seededDb>) =>
    tripCreate(db, {
      label: 'DL prior year', start_date: '2025-06-01', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: { mqd: 12000 } }], // Gold=10k, <Platinum 15k
    });

  it('none present → no displayed current status', () => {
    const dl = dlProj(seededDb());
    expect(dl.currentStatusTier).toBeNull();
    expect(dl.heldTier).toBeNull();
    expect(dl.lifetimeTier).toBeNull();
    expect(dl.overrideTier).toBeNull();
  });
  it('only calculated held', () => {
    const db = seededDb(); addHeldGold(db);
    expect(dlProj(db).currentStatusTier).toBe('Gold');
  });
  it('only current-year override', () => {
    const db = seededDb();
    statusOverrideSet(db, { program_id: 'dl', program_year: 2026, tier_name: 'Platinum' });
    expect(dlProj(db).currentStatusTier).toBe('Platinum');
  });
  it('only lifetime floor', () => {
    const db = seededDb();
    lifetimeStatusSet(db, { program_id: 'dl', tier_name: 'Diamond', achieved_date: null, notes: null });
    expect(dlProj(db).currentStatusTier).toBe('Diamond');
  });
  it('held Gold vs higher override Platinum → override wins', () => {
    const db = seededDb(); addHeldGold(db);
    statusOverrideSet(db, { program_id: 'dl', program_year: 2026, tier_name: 'Platinum' });
    expect(dlProj(db).currentStatusTier).toBe('Platinum');
  });
  it('held Gold vs lower override Silver → held wins (MAX, not replace)', () => {
    const db = seededDb(); addHeldGold(db);
    statusOverrideSet(db, { program_id: 'dl', program_year: 2026, tier_name: 'Silver' });
    expect(dlProj(db).currentStatusTier).toBe('Gold');
  });
  it('all three present → highest (lifetime Diamond) wins, YTD stays independent', () => {
    const db = seededDb(); addHeldGold(db);
    statusOverrideSet(db, { program_id: 'dl', program_year: 2026, tier_name: 'Platinum' });
    lifetimeStatusSet(db, { program_id: 'dl', tier_name: 'Diamond', achieved_date: null, notes: null });
    const dl = dlProj(db);
    expect(dl.currentStatusTier).toBe('Diamond');
    expect(dl.heldTier).toBe('Gold');       // underlying earned progress still visible
    expect(dl.overrideTier).toBe('Platinum');
    expect(dl.lifetimeTier).toBe('Diamond');
  });
  it('a prior-year override does not affect the current program-year', () => {
    const db = seededDb();
    statusOverrideSet(db, { program_id: 'dl', program_year: 2025, tier_name: 'Diamond' });
    expect(dlProj(db).currentStatusTier).toBeNull(); // 2025 override, not 2026
    expect(statusOverrideClear(db, 'dl', 2025)).toBe(true);
  });
});

describe('AA Executive Platinum permanent-lifetime scenario (Ann fixture)', () => {
  it('sets Exec Plat as a permanent floor that shows every program-year without inventing earned progress', () => {
    const db = seededDb();
    // Ann bought up to Exec Plat; it is not reflected by tracked activity.
    lifetimeStatusSet(db, {
      program_id: 'aa', tier_name: 'Executive Platinum',
      achieved_date: '2026-07-01', notes: 'Bought up to Exec Plat',
    });
    const y2026 = computeProjections(db, new Date('2026-07-01T00:00:00Z')).find(p => p.program.id === 'aa')!;
    expect(y2026.currentStatusTier).toBe('Executive Platinum');
    expect(y2026.lifetimeTier).toBe('Executive Platinum');
    expect(y2026.ytdTier).toBeNull();       // no earned activity — floor doesn't fabricate YTD
    expect(y2026.projectedTier).toBeNull();
    // Still applies in a later status year (permanent, never expires).
    const y2028 = computeProjections(db, new Date('2028-06-01T00:00:00Z')).find(p => p.program.id === 'aa')!;
    expect(y2028.currentStatusTier).toBe('Executive Platinum');
    // Clearing it removes the floor.
    lifetimeStatusClear(db, 'aa');
    const cleared = computeProjections(db, new Date('2026-07-01T00:00:00Z')).find(p => p.program.id === 'aa')!;
    expect(cleared.currentStatusTier).toBeNull();
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
