import { describe, it, expect } from 'vitest';
import { contributingMetricsText, deriveSegmentSum } from '../src/pages/ProgramDetail';
import type { TripWithDetails, TripSegment } from '../electron/types';

// v1.5.1: Contributing Trips (ProgramDetail.tsx) metrics-column display. For Delta entries, MM
// miles earned on that trip should be appended after the (possibly auto-calculated) mqd figure,
// e.g. "402 mqd \u00b7 +1,094 mm" \u2014 using Ann's real "DC" trip numbers (ATL-DCA 547mi/$185,
// DCA-ATL 547mi/$217; total $402 mqd, 1,094 mm).

function seg(overrides: Partial<TripSegment>): TripSegment {
  return {
    id: 0, trip_id: 0, origin_airport: null, destination_airport: null,
    distance_miles: null, cost_usd: null, program_id: null, fare_class: null,
    ...overrides,
  };
}

function trip(segments: TripSegment[], overrides: Partial<TripWithDetails> = {}): TripWithDetails {
  return {
    id: 1, label: 'DC', start_date: '2026-07-23', end_date: '2026-07-26', status: 'completed',
    is_historical_estimate_date: 1, notes: null, created_at: '', updated_at: '',
    entries: [], segments,
    ...overrides,
  };
}

describe('v1.5.1: Contributing Trips metrics column appends MM miles for Delta', () => {
  it('Delta trip with MM miles shows "X mqd \u00b7 +Y mm" (Ann\'s DC trip: 402 mqd, 1,094 mm)', () => {
    const t = trip([
      seg({ origin_airport: 'ATL', destination_airport: 'DCA', distance_miles: 547, cost_usd: 185 }),
      seg({ origin_airport: 'DCA', destination_airport: 'ATL', distance_miles: 547, cost_usd: 217 }),
    ]);
    const text = contributingMetricsText(t, 'dl', {});
    expect(text).toBe('402 mqd \u00b7 +1,094 mm');
  });

  it('Delta trip with 0 MM miles shows only "X mqd" (no mm suffix)', () => {
    const t = trip([
      seg({ origin_airport: 'ATL', destination_airport: 'DCA', distance_miles: null, cost_usd: 185 }),
    ]);
    const text = contributingMetricsText(t, 'dl', {});
    expect(text).toBe('185 mqd');
    expect(text).not.toContain('mm');
  });

  it('honors an explicit mqd value in metric_values instead of re-deriving from segment cost', () => {
    const t = trip([
      seg({ origin_airport: 'ATL', destination_airport: 'DCA', distance_miles: 547, cost_usd: 999 }),
    ]);
    const text = contributingMetricsText(t, 'dl', { mqd: 42 });
    expect(text).toBe('42 mqd \u00b7 +547 mm');
  });

  it('non-Delta programs are unaffected (no mm suffix ever appended)', () => {
    const t = trip([
      seg({ origin_airport: 'DFW', destination_airport: 'ORD', distance_miles: 800, cost_usd: 300 }),
    ]);
    const text = contributingMetricsText(t, 'aa', { points: 1500 });
    expect(text).toBe('1,500 LPs');
  });

  it('a trip with no metrics at all and no segments renders the placeholder dash', () => {
    const t = trip([]);
    const text = contributingMetricsText(t, 'dl', {});
    expect(text).toBe('\u2014');
  });

  it('deriveSegmentSum prefers explicitly-tagged segments over untagged ones when both exist', () => {
    const segments = [
      seg({ distance_miles: 100, program_id: 'dl' }),
      seg({ distance_miles: 999 }), // untagged, should be ignored since a tagged one exists
    ];
    expect(deriveSegmentSum(segments, 'dl', 'distance_miles')).toBe(100);
  });

  it('deriveSegmentSum falls back to all segments when none are explicitly tagged', () => {
    const segments = [
      seg({ distance_miles: 100 }),
      seg({ distance_miles: 200 }),
    ];
    expect(deriveSegmentSum(segments, 'dl', 'distance_miles')).toBe(300);
  });
});
