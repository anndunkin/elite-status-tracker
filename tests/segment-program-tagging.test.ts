import { describe, it, expect } from 'vitest';
import { seededDb } from './helpers';
import {
  computeProjections, tripCreate, tripGetAll, deriveSegmentCost,
  stripDerivableZeroMetricsOnce, normalizeSegmentProgramIds,
} from '../electron/database';
import type { TripSegment } from '../electron/types';

/**
 * Per-segment program tagging (v1.6). Delta MQDs and AA Loyalty Points are derived from the cost
 * of the segments belonging to that program; tagging a segment is what makes that mapping explicit
 * on a mixed-program trip. Untagged segments remain the fallback so pre-v1.6 trips are unaffected.
 */

const TODAY = new Date('2026-07-01T00:00:00Z');
const seg = (over: Partial<TripSegment> = {}) => ({
  origin_airport: 'SEA', destination_airport: 'JFK', distance_miles: 2422,
  cost_usd: null, program_id: null, fare_class: null, ...over,
});

const projectionFor = (db: ReturnType<typeof seededDb>, programId: string) =>
  computeProjections(db, TODAY).find(p => p.program.id === programId)!;

describe('functionality: tagged segments drive derivation', () => {
  it('a Delta-tagged $500 segment credits 500 MQDs', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'SEA-JFK', start_date: '2026-05-10', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: {} }],
      segments: [seg({ cost_usd: 500, program_id: 'dl' })],
    });
    expect(projectionFor(db, 'dl').ytdTotals.mqd).toBe(500);
  });

  it('splits a mixed Delta + AA trip by tag without double-counting', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'Mixed itinerary', start_date: '2026-05-10', status: 'completed',
      entries: [
        { program_id: 'dl', is_estimate: false, metric_values: {} },
        { program_id: 'aa', is_estimate: false, metric_values: {} },
      ],
      segments: [
        seg({ cost_usd: 400, program_id: 'dl' }),
        seg({ cost_usd: 600, program_id: 'aa' }),
      ],
    });
    // No prior-year data and no lifetime/override status for AA, so the earning multiplier is the
    // base 5x for "no status": 600 × 5 = 3000 LPs. Delta sees only its own $400 segment.
    expect(projectionFor(db, 'dl').ytdTotals.mqd).toBe(400);
    expect(projectionFor(db, 'aa').ytdTotals.points).toBe(3000);
  });

  it('sums several segments tagged for the same program', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'Multi-leg', start_date: '2026-05-10', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: {} }],
      segments: [
        seg({ cost_usd: 250, program_id: 'dl' }),
        seg({ cost_usd: 175, program_id: 'dl' }),
        seg({ cost_usd: 900, program_id: 'aa' }),
      ],
    });
    expect(projectionFor(db, 'dl').ytdTotals.mqd).toBe(425);
  });
});

describe('boundary: untagged-segment back-compat', () => {
  it('an untagged segment still credits a Delta-only trip', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'Legacy untagged', start_date: '2026-05-10', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: {} }],
      segments: [seg({ cost_usd: 500 })],
    });
    expect(projectionFor(db, 'dl').ytdTotals.mqd).toBe(500);
  });

  it('once one segment is tagged, untagged siblings stop counting toward that program', () => {
    // Tagged and untagged are disjoint candidate sets — the tagged set wins outright rather than
    // being added to, which is what keeps a mixed trip from crediting the same dollar twice.
    const db = seededDb();
    tripCreate(db, {
      label: 'Partially tagged', start_date: '2026-05-10', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: {} }],
      segments: [seg({ cost_usd: 400, program_id: 'dl' }), seg({ cost_usd: 600 })],
    });
    expect(projectionFor(db, 'dl').ytdTotals.mqd).toBe(400);
  });

  it('an explicitly entered MQD value beats derivation', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'Explicit MQDs', start_date: '2026-05-10', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: { mqd: 250 } }],
      segments: [seg({ cost_usd: 500, program_id: 'dl' })],
    });
    expect(projectionFor(db, 'dl').ytdTotals.mqd).toBe(250);
  });

  it('an explicitly entered LP value beats derivation', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'Explicit LPs', start_date: '2026-05-10', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: { points: 1234 } }],
      segments: [seg({ cost_usd: 600, program_id: 'aa' })],
    });
    expect(projectionFor(db, 'aa').ytdTotals.points).toBe(1234);
  });

  it('a null MQD (JSON round-trip of an absent key) still derives', () => {
    const db = seededDb();
    const trip = tripCreate(db, {
      label: 'Null MQDs', start_date: '2026-05-10', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: {} }],
      segments: [seg({ cost_usd: 500, program_id: 'dl' })],
    });
    db.prepare('UPDATE trip_program_entries SET metric_values = ? WHERE trip_id = ?')
      .run(JSON.stringify({ mqd: null }), trip.id);
    expect(projectionFor(db, 'dl').ytdTotals.mqd).toBe(500);
  });

  it('deriveSegmentCost ignores segments with no cost', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'Award ticket', start_date: '2026-05-10', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: {} }],
      segments: [seg({ cost_usd: null, program_id: 'dl' })],
    });
    expect(projectionFor(db, 'dl').ytdTotals.mqd).toBeUndefined();
  });
});

describe('deriveSegmentCost', () => {
  const withIds = (segs: Array<Partial<TripSegment>>): TripSegment[] =>
    segs.map((s, i) => ({ ...seg(s), id: i + 1, trip_id: 1 })) as TripSegment[];

  it('prefers tagged segments over untagged ones', () => {
    expect(deriveSegmentCost(withIds([
      { cost_usd: 100, program_id: 'dl' }, { cost_usd: 900 },
    ]), 'dl')).toBe(100);
  });
  it('falls back to untagged segments when none are tagged for the program', () => {
    expect(deriveSegmentCost(withIds([{ cost_usd: 100 }, { cost_usd: 200 }]), 'dl')).toBe(300);
  });
  it('treats an empty-string program_id as untagged', () => {
    expect(deriveSegmentCost(withIds([{ cost_usd: 100, program_id: '' }]), 'dl')).toBe(100);
  });
  it('returns 0 when every segment is tagged for another program', () => {
    expect(deriveSegmentCost(withIds([{ cost_usd: 100, program_id: 'aa' }]), 'dl')).toBe(0);
  });
});

describe('migration: strip derivable zeros', () => {
  it('strips a legacy mqd:0 so derivation takes over', () => {
    const db = seededDb();
    const trip = tripCreate(db, {
      label: 'Legacy zero', start_date: '2026-05-10', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: { mqd: 0 } }],
      segments: [seg({ cost_usd: 500, program_id: 'dl' })],
    });
    // Before: the stored 0 reads as "explicitly entered", suppressing derivation.
    expect(projectionFor(db, 'dl').ytdTotals.mqd).toBe(0);

    expect(stripDerivableZeroMetricsOnce(db)).toBe(1);

    const row = db.prepare('SELECT metric_values FROM trip_program_entries WHERE trip_id = ?')
      .get(trip.id) as { metric_values: string };
    expect(JSON.parse(row.metric_values)).not.toHaveProperty('mqd');
    expect(projectionFor(db, 'dl').ytdTotals.mqd).toBe(500);
  });

  it('strips a legacy AA points:0 and a null value, preserving other metrics', () => {
    const db = seededDb();
    const trip = tripCreate(db, {
      label: 'Legacy AA zero', start_date: '2026-05-10', status: 'completed',
      entries: [{ program_id: 'aa', is_estimate: false, metric_values: { points: 0 } }],
      segments: [seg({ cost_usd: 600, program_id: 'aa' })],
    });
    db.prepare('UPDATE trip_program_entries SET metric_values = ? WHERE trip_id = ?')
      .run(JSON.stringify({ points: null, miles: 2422 }), trip.id);

    expect(stripDerivableZeroMetricsOnce(db)).toBe(1);

    const row = db.prepare('SELECT metric_values FROM trip_program_entries WHERE trip_id = ?')
      .get(trip.id) as { metric_values: string };
    expect(JSON.parse(row.metric_values)).toEqual({ miles: 2422 });
    expect(projectionFor(db, 'aa').ytdTotals.points).toBe(3000);
  });

  it('leaves non-zero values and other programs untouched', () => {
    const db = seededDb();
    tripCreate(db, {
      label: 'Keep these', start_date: '2026-05-10', status: 'completed',
      entries: [
        { program_id: 'dl', is_estimate: false, metric_values: { mqd: 900 } },
        { program_id: 'as', is_estimate: false, metric_values: { points: 0 } },
      ],
    });
    expect(stripDerivableZeroMetricsOnce(db)).toBe(0);
    expect(projectionFor(db, 'dl').ytdTotals.mqd).toBe(900);
  });

  it('runs exactly once, so a zero recorded afterwards is respected', () => {
    const db = seededDb();
    expect(stripDerivableZeroMetricsOnce(db)).toBe(0);
    tripCreate(db, {
      label: 'Deliberate zero', start_date: '2026-05-10', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: { mqd: 0 } }],
      segments: [seg({ cost_usd: 500, program_id: 'dl' })],
    });
    expect(stripDerivableZeroMetricsOnce(db)).toBeNull();
    expect(projectionFor(db, 'dl').ytdTotals.mqd).toBe(0);
  });
});

describe('validation: segment program_id integrity', () => {
  it('rejects a segment tagged with a program that does not exist', () => {
    const db = seededDb();
    expect(() => tripCreate(db, {
      label: 'Bad tag', start_date: '2026-05-10', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: {} }],
      segments: [seg({ cost_usd: 500, program_id: 'nope' })],
    })).toThrow(/FOREIGN KEY/i);
    // tripCreate is transactional, so the whole trip rolls back.
    expect(tripGetAll(db)).toHaveLength(0);
  });

  it('stores an empty-string program_id as NULL rather than violating the foreign key', () => {
    const db = seededDb();
    const trip = tripCreate(db, {
      label: 'Blank tag', start_date: '2026-05-10', status: 'completed',
      entries: [{ program_id: 'dl', is_estimate: false, metric_values: {} }],
      segments: [seg({ cost_usd: 500, program_id: '' })],
    });
    expect(trip.segments[0].program_id).toBeNull();
    expect(projectionFor(db, 'dl').ytdTotals.mqd).toBe(500);
  });

  it('normalizeSegmentProgramIds rewrites pre-existing empty strings to NULL', () => {
    const db = seededDb();
    const trip = tripCreate(db, {
      label: 'Legacy blank', start_date: '2026-05-10', status: 'completed',
      segments: [seg({ cost_usd: 500 })],
    });
    // Bypass the insert path to simulate a row written before the normalization existed.
    db.pragma('foreign_keys = OFF');
    db.prepare(`UPDATE trip_segments SET program_id = '' WHERE trip_id = ?`).run(trip.id);
    db.pragma('foreign_keys = ON');

    expect(normalizeSegmentProgramIds(db)).toBe(1);
    expect(normalizeSegmentProgramIds(db)).toBe(0);
    const segments = db.prepare('SELECT program_id FROM trip_segments WHERE trip_id = ?')
      .all(trip.id) as Array<{ program_id: string | null }>;
    expect(segments[0].program_id).toBeNull();
  });
});
