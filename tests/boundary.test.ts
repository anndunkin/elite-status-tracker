import { describe, it, expect } from 'vitest';
import { seededDb, emptyDb } from './helpers';
import {
  computeProjections, tripCreate, lifetimeMileageGetAll, accruedLifetimeMiles,
  statusOverrideSet, statusOverrideClear,
  adjustmentDelete, adjustmentsDeleteForProgramYear,
} from '../electron/database';
import {
  qualifiesForTier, programYearOf, isLeapYear, currentProgramYear, sumMetrics,
  classifyTripByDate, viewYearToDate, MIN_VIEW_YEAR, MAX_VIEW_YEAR,
} from '../electron/rules';

describe('empty database', () => {
  it('projects programs with zero totals and no tier', () => {
    // empty schema has no programs seeded, so projections is []
    const db = emptyDb();
    expect(computeProjections(db)).toEqual([]);
  });
});

describe('status-override edge cases', () => {
  it('a lone override is displayed even with no earned/held data (never blank when one input present)', () => {
    const db = seededDb();
    statusOverrideSet(db, { program_id: 'aa', program_year: 2026, tier_name: 'Gold' });
    const aa = computeProjections(db, new Date('2026-07-01T00:00:00Z')).find(p => p.program.id === 'aa')!;
    expect(aa.heldTier).toBeNull();
    expect(aa.currentStatusTier).toBe('Gold');
  });
  it('clearing a non-existent override returns false without throwing', () => {
    const db = seededDb();
    expect(statusOverrideClear(db, 'aa', 1999)).toBe(false);
  });
});

describe('zero / negative / missing values', () => {
  it('zero threshold is always met', () => {
    expect(qualifiesForTier({ x: 0 }, [{ metric: 'x', threshold: 0 }])).toBe(true);
  });
  it('missing metric counts as zero', () => {
    expect(qualifiesForTier({}, [{ metric: 'x', threshold: 1 }])).toBe(false);
    expect(qualifiesForTier({}, [{ metric: 'x', threshold: 0 }])).toBe(true);
  });
  it('empty requirement list never qualifies', () => {
    expect(qualifiesForTier({ x: 999 }, [])).toBe(false);
  });
  it('sumMetrics ignores NaN', () => {
    expect(sumMetrics([{ a: NaN as unknown as number }, { a: 5 }])).toEqual({ a: 5 });
  });
});

describe('AA status-year boundaries', () => {
  it('Feb 28 belongs to the prior status year', () => {
    expect(programYearOf('2026-02-28', 'aa_status_year')).toBe(2025);
  });
  it('Feb 29 on a leap year belongs to prior status year', () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(programYearOf('2028-02-29', 'aa_status_year')).toBe(2027);
  });
  it('Mar 1 starts the new status year', () => {
    expect(programYearOf('2026-03-01', 'aa_status_year')).toBe(2026);
  });
  it('Dec 31 stays in the same status year', () => {
    expect(programYearOf('2026-12-31', 'aa_status_year')).toBe(2026);
  });
});

describe('leap year detection', () => {
  it.each([
    [2000, true], [2024, true], [2028, true],
    [1900, false], [2023, false], [2100, false],
  ])('isLeapYear(%i) === %s', (y, expected) => {
    expect(isLeapYear(y)).toBe(expected);
  });
});

describe('one tier away', () => {
  it('projects the next tier and its requirements', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'AA just under Plat', start_date: '2026-06-01', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: { points: 40000 } }],
    });
    const proj = computeProjections(db, new Date('2026-06-15T00:00:00Z'));
    const aa = proj.find(p => p.program.id === 'aa')!;
    expect(aa.nextTier).toBeTruthy();
    expect(aa.nextTierRequirements?.length).toBeGreaterThan(0);
  });
});

describe('lifetime mileage boundaries', () => {
  it('with no post-baseline segments, currentMiles equals the baseline', () => {
    const db = seededDb();
    expect(accruedLifetimeMiles(db, 'dl', '2026-07-01')).toBe(0);
    const dl = lifetimeMileageGetAll(db).find(m => m.program_id === 'dl')!;
    expect(dl.currentMiles).toBe(dl.baseline_miles);
    expect(dl.nextMilestone?.threshold).toBe(3000000); // first threshold strictly above 2,032,832
  });

  it('a segment dated exactly on the baseline date does not accrue (strictly after)', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'On baseline', start_date: '2026-07-01', status: 'completed',
      segments: [{ origin_airport: 'SEA', destination_airport: 'JFK', distance_miles: 2000, program_id: 'dl' }],
    });
    expect(accruedLifetimeMiles(db, 'dl', '2026-07-01')).toBe(0);
  });

  it('reaching the top milestone leaves no next milestone', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'Huge', start_date: '2026-08-01', status: 'completed',
      segments: [{ origin_airport: 'SEA', destination_airport: 'NRT', distance_miles: 3_000_000, program_id: 'dl' }],
    });
    const dl = lifetimeMileageGetAll(db).find(m => m.program_id === 'dl')!;
    expect(dl.currentMiles).toBeGreaterThan(5000000);
    expect(dl.nextMilestone).toBeNull();
    expect(dl.milesToNext).toBeNull();
  });
});

describe('classifyTripByDate boundaries (REAL now)', () => {
  const now = new Date('2026-07-15T00:00:00Z');
  it('a completed trip is never overdue or upcoming', () => {
    expect(classifyTripByDate({ start_date: '2026-01-01', status: 'completed' }, now)).toBe('neither');
  });
  it('a planned trip ending the day before today is overdue', () => {
    expect(classifyTripByDate({ start_date: '2026-07-14', status: 'planned' }, now)).toBe('overdue');
  });
  it('a booked trip starting exactly today is upcoming (today counts as still-to-come)', () => {
    expect(classifyTripByDate({ start_date: '2026-07-15', status: 'booked' }, now)).toBe('upcoming');
  });
  it('a planned trip starting the day after today is upcoming', () => {
    expect(classifyTripByDate({ start_date: '2026-07-16', status: 'planned' }, now)).toBe('upcoming');
  });
  it('an in-progress trip (started, end_date still in the future) is neither', () => {
    expect(classifyTripByDate({ start_date: '2026-07-10', end_date: '2026-07-20', status: 'booked' }, now)).toBe('neither');
  });
  it('uses end_date (not start_date) to decide overdue — a trip that started but ended before today is overdue', () => {
    expect(classifyTripByDate({ start_date: '2026-07-01', end_date: '2026-07-05', status: 'planned' }, now)).toBe('overdue');
  });
});

describe('viewYearToDate clamping', () => {
  const now = new Date('2026-07-15T00:00:00Z');
  it('null / undefined return real now unchanged', () => {
    expect(viewYearToDate(null, now)).toBe(now);
    expect(viewYearToDate(undefined, now)).toBe(now);
  });
  it('a plain year maps to Dec 31 UTC of that year', () => {
    const d = viewYearToDate(2027, now);
    expect(d.toISOString().slice(0, 10)).toBe('2027-12-31');
  });
  it('clamps below MIN_VIEW_YEAR', () => {
    expect(viewYearToDate(1500, now).getUTCFullYear()).toBe(MIN_VIEW_YEAR);
  });
  it('clamps above MAX_VIEW_YEAR', () => {
    expect(viewYearToDate(9999, now).getUTCFullYear()).toBe(MAX_VIEW_YEAR);
  });
  it('truncates a fractional year toward zero', () => {
    expect(viewYearToDate(2027.9, now).getUTCFullYear()).toBe(2027);
  });
});

describe('large totals', () => {
  it('handles very large metric values without overflow', () => {
    const big = 5_000_000;
    expect(qualifiesForTier({ points: big }, [{ metric: 'points', threshold: 200000 }])).toBe(true);
    expect(currentProgramYear(new Date('2026-07-22'), 'calendar')).toBe(2026);
  });
});

describe('adjustment deletion boundary cases (v1.5)', () => {
  it('deleting a non-existent adjustment id returns false', () => {
    const db = seededDb();
    expect(adjustmentDelete(db, 999999)).toBe(false);
  });
  it('deleteForProgramYear with no matching rows returns 0', () => {
    const db = seededDb();
    expect(adjustmentsDeleteForProgramYear(db, 'dl', 1999)).toBe(0);
    expect(adjustmentsDeleteForProgramYear(db, 'nope', 2026)).toBe(0);
  });
});
