import { describe, it, expect } from 'vitest';
import { seededDb, emptyDb } from './helpers';
import {
  tripCreate, tripUpdate, programCreateRuleVersion, importFilePayload, buildFilePayload,
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
});
