import { describe, it, expect } from 'vitest';
import { seededDb, emptyDb } from './helpers';
import {
  tripCreate, tripUpdate, programCreateRuleVersion, importFilePayload, buildFilePayload,
  cardEarningCreate, cardEarningUpdate, lifetimeStatusSet,
} from '../electron/database';
import { lookupAirport, haversineMiles } from '../electron/airports';
import { APP_FILE_VERSION } from '../electron/types';

describe('trip field validation', () => {
  it('rejects a trip without a label', () => {
    const db = seededDb();
    expect(() => tripCreate(db, { label: '  ', start_date: '2026-01-01' })).toThrow(/label/i);
  });
  it('rejects a trip without a start date', () => {
    const db = seededDb();
    expect(() => tripCreate(db, { label: 'X', start_date: '' })).toThrow(/date/i);
  });
  it('returns null when updating a non-existent trip', () => {
    const db = seededDb();
    expect(tripUpdate(db, 999999, { label: 'X' })).toBeNull();
  });
  it('enforces the status CHECK constraint', () => {
    const db = seededDb();
    expect(() => tripCreate(db, { label: 'Bad', start_date: '2026-01-01', status: 'bogus' as any })).toThrow();
  });
});

describe('rule version validation', () => {
  it('rejects an unknown program', () => {
    const db = seededDb();
    expect(() => programCreateRuleVersion(db, 'nope', '2026-01-01', '', [])).toThrow(/unknown/i);
  });
  it('requires an effective date', () => {
    const db = seededDb();
    expect(() => programCreateRuleVersion(db, 'aa', '  ', '', [])).toThrow(/date/i);
  });
});

describe('card-earnings validation', () => {
  it('rejects an unknown program', () => {
    const db = seededDb();
    expect(() => cardEarningCreate(db, { program_id: 'nope', entry_date: '2026-05-01', metric_key: 'mqd', amount: 100, notes: null })).toThrow(/unknown/i);
  });
  it('requires an entry date', () => {
    const db = seededDb();
    expect(() => cardEarningCreate(db, { program_id: 'dl', entry_date: '  ', metric_key: 'mqd', amount: 100, notes: null })).toThrow(/date/i);
  });
  it('rejects a non-numeric amount', () => {
    const db = seededDb();
    expect(() => cardEarningCreate(db, { program_id: 'dl', entry_date: '2026-05-01', metric_key: 'mqd', amount: NaN, notes: null })).toThrow(/amount/i);
  });
  it('returns null when updating a non-existent entry', () => {
    const db = seededDb();
    expect(cardEarningUpdate(db, 999999, { amount: 1 })).toBeNull();
  });
});

describe('lifetime status validation', () => {
  it('rejects an unknown program', () => {
    const db = seededDb();
    expect(() => lifetimeStatusSet(db, { program_id: 'nope', tier_name: 'Diamond', achieved_date: null, notes: null })).toThrow(/unknown/i);
  });
  it('requires a tier name', () => {
    const db = seededDb();
    expect(() => lifetimeStatusSet(db, { program_id: 'dl', tier_name: '  ', achieved_date: null, notes: null })).toThrow(/tier/i);
  });
});

describe('airport validation', () => {
  it('looks up a known IATA code case-insensitively', () => {
    expect(lookupAirport('sea')?.code).toBe('SEA');
  });
  it('returns null for unknown or empty codes', () => {
    expect(lookupAirport('ZZZ')).toBeNull();
    expect(lookupAirport('')).toBeNull();
  });
  it('distance is null when either endpoint is unknown', () => {
    expect(haversineMiles('SEA', 'ZZZ')).toBeNull();
    expect(haversineMiles('', 'SEA')).toBeNull();
  });
});

describe('JSON import schema', () => {
  it('rejects a payload with the wrong version', () => {
    const db = seededDb();
    const payload = buildFilePayload(db);
    (payload as any).version = 999;
    expect(() => importFilePayload(emptyDb(), payload)).toThrow(/version/i);
  });
  it('rejects a null/garbage payload', () => {
    expect(() => importFilePayload(emptyDb(), null as any)).toThrow();
  });
  it('round-trips a valid export back into a fresh database', () => {
    const src = seededDb();
    const payload = buildFilePayload(src);
    expect(payload.version).toBe(APP_FILE_VERSION);
    const dst = emptyDb();
    importFilePayload(dst, payload);
    const tripCount = dst.prepare('SELECT COUNT(*) c FROM trips').get() as { c: number };
    expect(tripCount.c).toBe(payload.trips.length);
  });

  it('round-trips the v1.1 lifetime-status, lifetime-mileage, and card-earnings tables', () => {
    const src = seededDb();
    cardEarningCreate(src, { program_id: 'dl', entry_date: '2026-05-01', metric_key: 'mqd', amount: 1234, notes: 'x' });
    const payload = buildFilePayload(src);
    expect(payload.lifetime_status?.length).toBeGreaterThan(0);
    expect(payload.lifetime_mileage?.length).toBeGreaterThan(0);
    expect(payload.card_earnings?.length).toBeGreaterThan(0);
    const dst = emptyDb();
    importFilePayload(dst, payload);
    expect((dst.prepare('SELECT COUNT(*) c FROM program_lifetime_status').get() as { c: number }).c).toBe(payload.lifetime_status!.length);
    expect((dst.prepare('SELECT COUNT(*) c FROM program_lifetime_mileage').get() as { c: number }).c).toBe(payload.lifetime_mileage!.length);
    expect((dst.prepare('SELECT COUNT(*) c FROM card_earnings_entries').get() as { c: number }).c).toBe(payload.card_earnings!.length);
  });
});
