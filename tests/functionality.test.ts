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
  ensureLifetimeMileageRows, ensureDeltaMetricKeys, stripDeltaMqmValues,
  deleteDelta2026AdjustmentsOnce, applyDataMigrations,
  adjustmentDelete, adjustmentsDeleteForProgramYear,
  ensureAaMetricKeys, stripAaSpendValues, statusMultiplierForAA,
} from '../electron/database';
import { haversineMiles } from '../electron/airports';
import {
  qualifiesForTier, highestQualifiedTier, programYearOf, sumMetrics,
  viewYearToDate, selectDashboardTrips,
} from '../electron/rules';

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

describe('dashboard year-view projection (viewYear → synthetic today)', () => {
  it('viewYearToDate omitted returns the real "now" (default behavior unchanged)', () => {
    const now = new Date('2026-07-01T12:00:00Z');
    expect(viewYearToDate(undefined, now)).toBe(now);
    expect(viewYearToDate(null, now)).toBe(now);
  });

  it('a calendar program buckets to the selected view year', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'DL 2025', start_date: '2025-06-01', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: { mqd: 12000 } }],
    });
    const view2025 = computeProjections(db, viewYearToDate(2025)).find(p => p.program.id === 'dl')!;
    expect(view2025.program_year).toBe(2025);
    expect(view2025.ytdTotals.mqd).toBe(12000);

    // Same DB viewed as 2026: 2025 activity is no longer YTD — it becomes the held (prior-year) tier.
    const view2026 = computeProjections(db, viewYearToDate(2026)).find(p => p.program.id === 'dl')!;
    expect(view2026.program_year).toBe(2026);
    expect(view2026.ytdTotals.mqd ?? 0).toBe(0);
    expect(view2026.heldFromYear).toBe(2025);
  });

  it('AA (non-calendar year_type) resolves the expected status-year for a view, incl. a Feb boundary crossing', () => {
    const db = seededDb();
    // Feb 2027 activity belongs to the AA status-year that STARTED in Mar 2026 → AA year 2026.
    tripCreate(db, {
      label: 'AA Feb 2027', start_date: '2027-02-10', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: { points: 50000 } }],
    });
    const view2026 = computeProjections(db, viewYearToDate(2026)).find(p => p.program.id === 'aa')!;
    const view2027 = computeProjections(db, viewYearToDate(2027)).find(p => p.program.id === 'aa')!;
    expect(view2026.program_year).toBe(2026);
    expect(view2026.ytdTotals.points).toBe(50000); // Feb 2027 → AA 2026 window
    expect(view2027.program_year).toBe(2027);
    expect(view2027.ytdTotals.points ?? 0).toBe(0);
  });
});

describe('dashboard trip sections (REAL now drives overdue/upcoming, viewYear only filters by calendar year)', () => {
  const now = new Date('2026-07-15T00:00:00Z'); // the REAL "today" in these tests

  it('classifies the current-year trips into overdue vs upcoming vs completed', () => {
    const db = seededDb();
    tripCreate(db, { label: 'Past not done', start_date: '2026-01-10', status: 'planned' });
    tripCreate(db, { label: 'Future', start_date: '2026-12-20', status: 'booked' });
    tripCreate(db, { label: 'Done', start_date: '2026-02-02', status: 'completed' });
    const { needsUpdate, upcoming } = selectDashboardTrips(tripGetAll(db), 2026, now);
    expect(needsUpdate.map(t => t.label)).toEqual(['Past not done']);
    expect(upcoming.map(t => t.label)).toEqual(['Future']);
  });

  it('sorts needs-update oldest-first and upcoming soonest-first', () => {
    const db = seededDb();
    tripCreate(db, { label: 'Overdue B', start_date: '2026-03-01', status: 'planned' });
    tripCreate(db, { label: 'Overdue A', start_date: '2026-01-01', status: 'planned' });
    tripCreate(db, { label: 'Upcoming Late', start_date: '2026-12-01', status: 'booked' });
    tripCreate(db, { label: 'Upcoming Soon', start_date: '2026-08-01', status: 'booked' });
    const { needsUpdate, upcoming } = selectDashboardTrips(tripGetAll(db), 2026, now);
    expect(needsUpdate.map(t => t.label)).toEqual(['Overdue A', 'Overdue B']);
    expect(upcoming.map(t => t.label)).toEqual(['Upcoming Soon', 'Upcoming Late']);
  });

  it('viewing NEXT year: a future trip that has not happened is UPCOMING, never overdue', () => {
    const db = seededDb();
    tripCreate(db, { label: 'Next-year trip', start_date: '2027-03-01', status: 'planned' });
    const { needsUpdate, upcoming } = selectDashboardTrips(tripGetAll(db), 2027, now);
    expect(needsUpdate).toEqual([]);                       // NOT overdue — it hasn't happened yet
    expect(upcoming.map(t => t.label)).toEqual(['Next-year trip']);
  });

  it('viewing LAST year (mirror): a past uncompleted trip is OVERDUE, upcoming is empty', () => {
    const db = seededDb();
    tripCreate(db, { label: 'Last-year trip', start_date: '2025-05-01', status: 'booked' });
    const { needsUpdate, upcoming } = selectDashboardTrips(tripGetAll(db), 2025, now);
    expect(needsUpdate.map(t => t.label)).toEqual(['Last-year trip']);
    expect(upcoming).toEqual([]);
  });

  it('a viewYear with only completed trips yields two legitimately-empty sections', () => {
    const db = seededDb();
    tripCreate(db, { label: 'Done 2027', start_date: '2027-04-01', status: 'completed' });
    const { needsUpdate, upcoming } = selectDashboardTrips(tripGetAll(db), 2027, now);
    expect(needsUpdate).toEqual([]);
    expect(upcoming).toEqual([]);
  });

  it('restricts each section to the selected calendar year of start_date', () => {
    const db = seededDb();
    tripCreate(db, { label: '2025 overdue', start_date: '2025-06-01', status: 'planned' });
    tripCreate(db, { label: '2026 overdue', start_date: '2026-06-01', status: 'planned' });
    expect(selectDashboardTrips(tripGetAll(db), 2025, now).needsUpdate.map(t => t.label)).toEqual(['2025 overdue']);
    expect(selectDashboardTrips(tripGetAll(db), 2026, now).needsUpdate.map(t => t.label)).toEqual(['2026 overdue']);
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

describe('v1.5 startup migrations', () => {
  it('ensureLifetimeMileageRows inserts a missing Delta row but never overwrites an existing baseline', () => {
    const db = seededDb();
    // Fresh seed already has the dl row (baseline 2032832) — running the migration must be a no-op.
    expect(ensureLifetimeMileageRows(db)).toBe(0);
    expect(lifetimeMileageGetAll(db).find(m => m.program_id === 'dl')?.baseline_miles).toBe(2032832);

    // Simulate a DB whose lifetime-mileage row was stripped (predates the v1.4 seed).
    db.prepare('DELETE FROM program_lifetime_mileage WHERE program_id = ?').run('dl');
    expect(lifetimeMileageGetAll(db).find(m => m.program_id === 'dl')).toBeUndefined();
    const added = ensureLifetimeMileageRows(db);
    expect(added).toBe(1);
    const restored = lifetimeMileageGetAll(db).find(m => m.program_id === 'dl');
    expect(restored?.baseline_miles).toBe(2032832);

    // Mutate the baseline to simulate the user's own tracked adjustment, then re-run: must not overwrite.
    db.prepare('UPDATE program_lifetime_mileage SET baseline_miles = ? WHERE program_id = ?').run(999, 'dl');
    expect(ensureLifetimeMileageRows(db)).toBe(0);
    expect(lifetimeMileageGetAll(db).find(m => m.program_id === 'dl')?.baseline_miles).toBe(999);
  });

  it('ensureDeltaMetricKeys rewrites ["mqd","mqm"] to ["mqd"]', () => {
    const db = seededDb();
    db.prepare('UPDATE programs SET metric_keys = ? WHERE id = ?').run(JSON.stringify(['mqd', 'mqm']), 'dl');
    expect(ensureDeltaMetricKeys(db)).toBe(true);
    const row = db.prepare('SELECT metric_keys FROM programs WHERE id = ?').get('dl') as { metric_keys: string };
    expect(JSON.parse(row.metric_keys)).toEqual(['mqd']);
    // Idempotent: running again finds nothing to fix.
    expect(ensureDeltaMetricKeys(db)).toBe(false);
  });

  it('stripDeltaMqmValues removes mqm keys from Delta entries and adjustments; other programs untouched', () => {
    const db = seededDb();
    const trip = tripCreate(db, {
      label: 'DL with mqm', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: { mqd: 1000, mqm: 5000 } }],
    });
    db.prepare(`INSERT INTO program_year_adjustments (program_id, program_year, adjustment_type, metric_values, notes)
      VALUES (?, ?, ?, ?, ?)`).run('dl', 2026, 'bonus', JSON.stringify({ mqd: 200, mqm: 800 }), null);
    // Other program: mqm-like key should never be touched even if present.
    const aaTrip = tripCreate(db, {
      label: 'AA unaffected', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: { points: 100, mqm: 999 } }],
    });

    const updated = stripDeltaMqmValues(db);
    expect(updated).toBe(2); // one dl entry + one dl adjustment

    const dlEntry = tripGetById(db, trip.id)!.entries.find(e => e.program_id === 'dl')!;
    expect(JSON.parse(dlEntry.metric_values)).toEqual({ mqd: 1000 });

    const adj = adjustmentsGetAll(db).find(a => a.program_id === 'dl' && a.program_year === 2026)!;
    expect(JSON.parse(adj.metric_values)).toEqual({ mqd: 200 });

    // AA entry keeps its (coincidental) mqm key untouched.
    const aaEntry = tripGetById(db, aaTrip.id)!.entries.find(e => e.program_id === 'aa')!;
    expect(JSON.parse(aaEntry.metric_values)).toEqual({ points: 100, mqm: 999 });
  });

  it('computeProjections derives mqd from segment cost_usd on a Delta trip with no explicit mqd', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'DL cost-derived', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: {} }],
      segments: [
        { origin_airport: 'SEA', destination_airport: 'JFK', distance_miles: 2000, cost_usd: 350, program_id: 'dl' },
        { origin_airport: 'JFK', destination_airport: 'SEA', distance_miles: 2000, cost_usd: 300, program_id: 'dl' },
      ],
    });
    const dl = computeProjections(db, new Date('2026-06-01T00:00:00Z')).find(p => p.program.id === 'dl')!;
    expect(dl.ytdTotals.mqd).toBe(650);
  });

  it('an explicit mqd in metric_values overrides segment-cost derivation', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'DL explicit mqd', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: { mqd: 42 } }],
      segments: [{ origin_airport: 'SEA', destination_airport: 'JFK', distance_miles: 2000, cost_usd: 999, program_id: 'dl' }],
    });
    const dl = computeProjections(db, new Date('2026-06-01T00:00:00Z')).find(p => p.program.id === 'dl')!;
    expect(dl.ytdTotals.mqd).toBe(42);
  });

  it('derives estimate vs. actual mqd correctly by trip status', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'DL planned cost-derived', start_date: '2026-09-01', status: 'planned',
      entries: [{ program_id: 'dl', is_estimate: true, metric_values: {} }],
      segments: [{ origin_airport: 'SEA', destination_airport: 'JFK', distance_miles: 2000, cost_usd: 500, program_id: 'dl' }],
    });
    const dl = computeProjections(db, new Date('2026-06-01T00:00:00Z')).find(p => p.program.id === 'dl')!;
    expect(dl.ytdTotals.mqd ?? 0).toBe(0);
    expect(dl.projectedTotals.mqd).toBe(500);
  });

  it('skips derivation when no segments have a numeric cost', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'DL no cost', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: {} }],
      segments: [{ origin_airport: 'SEA', destination_airport: 'JFK', distance_miles: 2000, program_id: 'dl' }],
    });
    const dl = computeProjections(db, new Date('2026-06-01T00:00:00Z')).find(p => p.program.id === 'dl')!;
    expect(dl.ytdTotals.mqd ?? 0).toBe(0);
  });

  it('adjustmentDelete removes the row; adjustmentsDeleteForProgramYear returns the deletion count', () => {
    const db = seededDb();
    const res = db.prepare(`INSERT INTO program_year_adjustments (program_id, program_year, adjustment_type, metric_values, notes)
      VALUES (?, ?, ?, ?, ?)`).run('dl', 2026, 'bonus', JSON.stringify({ mqd: 100 }), null);
    const id = Number(res.lastInsertRowid);
    expect(adjustmentsGetAll(db).some(a => a.id === id)).toBe(true);
    expect(adjustmentDelete(db, id)).toBe(true);
    expect(adjustmentsGetAll(db).some(a => a.id === id)).toBe(false);

    db.prepare(`INSERT INTO program_year_adjustments (program_id, program_year, adjustment_type, metric_values, notes)
      VALUES (?, ?, ?, ?, ?)`).run('dl', 2026, 'bonus', JSON.stringify({ mqd: 1 }), null);
    db.prepare(`INSERT INTO program_year_adjustments (program_id, program_year, adjustment_type, metric_values, notes)
      VALUES (?, ?, ?, ?, ?)`).run('dl', 2026, 'promotional', JSON.stringify({ mqd: 2 }), null);
    const count = adjustmentsDeleteForProgramYear(db, 'dl', 2026);
    expect(count).toBe(2);
  });

  it('Delta-2026 cleanup migration runs once, gated by app_meta', () => {
    const db = seededDb();
    db.prepare(`INSERT INTO program_year_adjustments (program_id, program_year, adjustment_type, metric_values, notes)
      VALUES (?, ?, ?, ?, ?)`).run('dl', 2026, 'bonus', JSON.stringify({ mqd: 100 }), null);
    db.prepare(`INSERT INTO program_year_adjustments (program_id, program_year, adjustment_type, metric_values, notes)
      VALUES (?, ?, ?, ?, ?)`).run('dl', 2025, 'bonus', JSON.stringify({ mqd: 100 }), null); // different year, untouched

    const firstRun = deleteDelta2026AdjustmentsOnce(db);
    expect(firstRun).toBe(1);
    expect(adjustmentsGetAll(db).some(a => a.program_id === 'dl' && a.program_year === 2026)).toBe(false);
    expect(adjustmentsGetAll(db).some(a => a.program_id === 'dl' && a.program_year === 2025)).toBe(true);

    // Gate: re-running is a no-op (returns null since already cleared).
    const secondRun = deleteDelta2026AdjustmentsOnce(db);
    expect(secondRun).toBeNull();
  });

  it('applyDataMigrations runs all four migrations and returns a summary', () => {
    const db = seededDb();
    const summary = applyDataMigrations(db);
    expect(summary).toHaveProperty('mileageAdded');
    expect(summary).toHaveProperty('metricKeysFixed');
    expect(summary).toHaveProperty('mqmStripped');
    expect(summary).toHaveProperty('delta2026AdjustmentsCleared');
    // On a fresh seeded db there's nothing to migrate except the one-time cleanup gate flip.
    expect(summary.mileageAdded).toBe(0);
    expect(summary.metricKeysFixed).toBe(false);
    expect(summary.mqmStripped).toBe(0);
  });
});

describe('v1.5 AA AAdvantage: drop spend, derive LPs from segment cost', () => {
  it('ensureAaMetricKeys rewrites ["points","spend"] to ["points"]', () => {
    const db = seededDb();
    db.prepare('UPDATE programs SET metric_keys = ? WHERE id = ?').run(JSON.stringify(['points', 'spend']), 'aa');
    expect(ensureAaMetricKeys(db)).toBe(true);
    const row = db.prepare('SELECT metric_keys FROM programs WHERE id = ?').get('aa') as { metric_keys: string };
    expect(JSON.parse(row.metric_keys)).toEqual(['points']);
    expect(ensureAaMetricKeys(db)).toBe(false); // idempotent
  });

  it('stripAaSpendValues removes spend from AA entries/adjustments only; Hilton/Marriott spend untouched', () => {
    const db = seededDb();
    const aaTrip = tripCreate(db, {
      label: 'AA with spend', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: { points: 1000, spend: 500 } }],
    });
    db.prepare(`INSERT INTO program_year_adjustments (program_id, program_year, adjustment_type, metric_values, notes)
      VALUES (?, ?, ?, ?, ?)`).run('aa', 2026, 'bonus', JSON.stringify({ points: 200, spend: 50 }), null);
    const hhTrip = tripCreate(db, {
      label: 'Hilton unaffected', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'hh', is_estimate: false, metric_values: { nights: 3, spend: 900 } }],
    });
    const mbTrip = tripCreate(db, {
      label: 'Marriott unaffected', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'mb', is_estimate: false, metric_values: { nights: 2, spend: 700 } }],
    });

    const updated = stripAaSpendValues(db);
    expect(updated).toBe(2); // one aa entry + one aa adjustment

    const aaEntry = tripGetById(db, aaTrip.id)!.entries.find(e => e.program_id === 'aa')!;
    expect(JSON.parse(aaEntry.metric_values)).toEqual({ points: 1000 });
    const adj = adjustmentsGetAll(db).find(a => a.program_id === 'aa' && a.program_year === 2026)!;
    expect(JSON.parse(adj.metric_values)).toEqual({ points: 200 });

    const hhEntry = tripGetById(db, hhTrip.id)!.entries.find(e => e.program_id === 'hh')!;
    expect(JSON.parse(hhEntry.metric_values)).toEqual({ nights: 3, spend: 900 });
    const mbEntry = tripGetById(db, mbTrip.id)!.entries.find(e => e.program_id === 'mb')!;
    expect(JSON.parse(mbEntry.metric_values)).toEqual({ nights: 2, spend: 700 });
  });

  it('statusMultiplierForAA returns the correct rate per tier', () => {
    expect(statusMultiplierForAA(null)).toBe(5);
    expect(statusMultiplierForAA('No status')).toBe(5);
    expect(statusMultiplierForAA('Gold')).toBe(7);
    expect(statusMultiplierForAA('Platinum')).toBe(8);
    expect(statusMultiplierForAA('Platinum Pro')).toBe(9);
    expect(statusMultiplierForAA('Executive Platinum')).toBe(11);
  });

  it('computeProjections derives points = round(cost * 5) for AA when the user holds no status', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'AA base rate', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: {} }],
      segments: [{ origin_airport: 'DFW', destination_airport: 'ORD', distance_miles: 800, cost_usd: 300, program_id: 'aa' }],
    });
    const aa = computeProjections(db, new Date('2026-06-01T00:00:00Z')).find(p => p.program.id === 'aa')!;
    expect(aa.ytdTotals.points).toBe(1500); // 300 * 5
  });

  it('computeProjections derives points = round(cost * 8) for AA when the held tier is Platinum', () => {
    const db = seededDb();
    // Prior AA status year (aa_status_year: Mar-Feb) actuals that qualify for Platinum,
    // so it is the tier "held" entering the current status year.
    const aaBefore = computeProjections(db, new Date('2026-06-01T00:00:00Z')).find(p => p.program.id === 'aa')!;
    const platinumThreshold = aaBefore.tiers.find(t => t.tier_name === 'Platinum')!.requirements[0].threshold;
    tripCreate(db, {
      label: 'AA prior year Platinum qualifying', start_date: '2025-06-01', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: { points: platinumThreshold } }],
    });
    tripCreate(db, {
      label: 'AA current year cost-derived', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: {} }],
      segments: [{ origin_airport: 'DFW', destination_airport: 'ORD', distance_miles: 800, cost_usd: 300, program_id: 'aa' }],
    });
    const aa = computeProjections(db, new Date('2026-06-01T00:00:00Z')).find(p => p.program.id === 'aa')!;
    expect(aa.heldTier).toBe('Platinum');
    expect(aa.ytdTotals.points).toBe(2400); // 300 * 8
  });

  it('computeProjections derives points = round(cost * 11) for AA with a current-year Executive Platinum override', () => {
    const db = seededDb();
    statusOverrideSet(db, { program_id: 'aa', program_year: 2026, tier_name: 'Executive Platinum', notes: null });
    tripCreate(db, {
      label: 'AA override rate', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: {} }],
      segments: [{ origin_airport: 'DFW', destination_airport: 'ORD', distance_miles: 800, cost_usd: 300, program_id: 'aa' }],
    });
    const aa = computeProjections(db, new Date('2026-06-01T00:00:00Z')).find(p => p.program.id === 'aa')!;
    expect(aa.currentStatusTier).toBe('Executive Platinum');
    expect(aa.ytdTotals.points).toBe(3300); // 300 * 11
  });

  it('an explicit points value in metric_values overrides the AA auto-calc', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'AA explicit points', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: { points: 77 } }],
      segments: [{ origin_airport: 'DFW', destination_airport: 'ORD', distance_miles: 800, cost_usd: 999, program_id: 'aa' }],
    });
    const aa = computeProjections(db, new Date('2026-06-01T00:00:00Z')).find(p => p.program.id === 'aa')!;
    expect(aa.ytdTotals.points).toBe(77);
  });

  // v1.5.1: fixes for a reported ~26% AA Loyalty Points overcount (34K actual vs ~27K expected).
  // Root-cause audit found computeProjections' arithmetic itself does not double-count trips,
  // adjustments, or card earnings (each source is bucketed exactly once, and the AA-specific
  // rebuild fully replaces rather than adds to the raw pass). The one confirmed defect was that
  // `mv.points === null` (e.g. from a portable-file JSON round-trip turning an absent key into a
  // stored null) was NOT treated the same as `undefined`, silently dropping that entry's LPs from
  // the total instead of deriving them — an undercount, not the reported overcount. Since no
  // code-level overcount mechanism could be reproduced against valid data, a per-source
  // (trips/adjustments/card earnings) diagnostic breakdown was added instead so the discrepancy
  // can be pinpointed against the user's actual data (see metricSourceBreakdown below).
  it('mv.points === null is treated like undefined: derivation still fires from segment cost', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'AA null points (e.g. from JSON import)', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: { points: null as unknown as number } }],
      segments: [{ origin_airport: 'DFW', destination_airport: 'ORD', distance_miles: 800, cost_usd: 300, program_id: 'aa' }],
    });
    const aa = computeProjections(db, new Date('2026-06-01T00:00:00Z')).find(p => p.program.id === 'aa')!;
    expect(aa.ytdTotals.points).toBe(1500); // 300 * 5 (base rate, no held status)
  });

  it('mv.points === 0 (explicit zero) is honored and does NOT trigger derivation', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'AA explicit zero points', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: { points: 0 } }],
      segments: [{ origin_airport: 'DFW', destination_airport: 'ORD', distance_miles: 800, cost_usd: 300, program_id: 'aa' }],
    });
    const aa = computeProjections(db, new Date('2026-06-01T00:00:00Z')).find(p => p.program.id === 'aa')!;
    expect(aa.ytdTotals.points ?? 0).toBe(0); // stays 0, not 0 + 1500
  });

  it('an explicit points value wins even alongside segment cost that would derive a larger amount', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'AA explicit 15000 with $2000 cost segments', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: { points: 15000 } }],
      segments: [{ origin_airport: 'DFW', destination_airport: 'LHR', distance_miles: 4700, cost_usd: 2000, program_id: 'aa' }],
    });
    const aa = computeProjections(db, new Date('2026-06-01T00:00:00Z')).find(p => p.program.id === 'aa')!;
    expect(aa.ytdTotals.points).toBe(15000); // NOT 15000 + (2000*5)=25000
  });

  it('metricSourceBreakdown reconciles trips + adjustments + card earnings to the YTD total (AA)', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'AA trip 1', start_date: '2026-04-01', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: {} }],
      segments: [{ origin_airport: 'DFW', destination_airport: 'ORD', distance_miles: 800, cost_usd: 1000, program_id: 'aa' }],
    });
    tripCreate(db, {
      label: 'AA trip 2', start_date: '2026-05-01', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: {} }],
      segments: [{ origin_airport: 'DFW', destination_airport: 'LAX', distance_miles: 1200, cost_usd: 1400, program_id: 'aa' }],
    });
    cardEarningCreate(db, { program_id: 'aa', entry_date: '2026-04-15', metric_key: 'points', amount: 5000, notes: null });
    cardEarningCreate(db, { program_id: 'aa', entry_date: '2026-05-15', metric_key: 'points', amount: 5000, notes: null });
    db.prepare(`INSERT INTO program_year_adjustments (program_id, program_year, adjustment_type, metric_values, notes)
      VALUES (?, ?, ?, ?, ?)`).run('aa', 2026, 'bonus', JSON.stringify({ points: 2000 }), null);

    const aa = computeProjections(db, new Date('2026-06-01T00:00:00Z')).find(p => p.program.id === 'aa')!;
    const b = aa.metricSourceBreakdown.points;
    expect(b.trips).toBe(12000); // (1000*5) + (1400*5) = 5000 + 7000
    expect(b.cardEarnings).toBe(10000);
    expect(b.adjustments).toBe(2000);
    expect(b.trips + b.adjustments + b.cardEarnings).toBe(aa.ytdTotals.points);
    expect(aa.ytdTotals.points).toBe(24000);
  });

  it('metricSourceBreakdown reconciles trips + adjustments + card earnings to the YTD total (Delta MQD)', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'Delta trip', start_date: '2026-04-01', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: {} }],
      segments: [{ origin_airport: 'ATL', destination_airport: 'JFK', distance_miles: 760, cost_usd: 400, program_id: 'dl' }],
    });
    cardEarningCreate(db, { program_id: 'dl', entry_date: '2026-04-20', metric_key: 'mqd', amount: 300, notes: null });
    db.prepare(`INSERT INTO program_year_adjustments (program_id, program_year, adjustment_type, metric_values, notes)
      VALUES (?, ?, ?, ?, ?)`).run('dl', 2026, 'bonus', JSON.stringify({ mqd: 100 }), null);

    const dl = computeProjections(db, new Date('2026-06-01T00:00:00Z')).find(p => p.program.id === 'dl')!;
    const b = dl.metricSourceBreakdown.mqd;
    expect(b.trips).toBe(400);
    expect(b.cardEarnings).toBe(300);
    expect(b.adjustments).toBe(100);
    expect(b.trips + b.adjustments + b.cardEarnings).toBe(dl.ytdTotals.mqd);
    expect(dl.ytdTotals.mqd).toBe(800);
  });
});
