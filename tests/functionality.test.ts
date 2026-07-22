import { describe, it, expect } from 'vitest';
import { seededDb } from './helpers';
import {
  programsGetAll, tripGetAll, tripCreate, tripUpdate, tripDelete, tripGetById,
  adjustmentsGetAll, lastActivityGetAll, computeProjections,
  programCreateRuleVersion, programGetTiers, refreshStatus, refreshLogCheck,
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
