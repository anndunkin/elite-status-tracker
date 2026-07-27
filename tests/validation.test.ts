import { describe, it, expect } from 'vitest';
import { seededDb, emptyDb } from './helpers';
import {
  tripCreate, tripUpdate, programCreateRuleVersion, importFilePayload, buildFilePayload,
  cardEarningCreate, cardEarningUpdate, lifetimeStatusSet,
  statusOverrideSet, statusOverridesGetAll, statusOverrideClear,
  adjustmentDelete,
} from '../electron/database';
import { lookupAirport, haversineMiles } from '../electron/airports';
import { viewYearToDate } from '../electron/rules';
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

describe('dashboard viewYear validation (never throws, always yields a usable date)', () => {
  const now = new Date('2026-07-15T00:00:00Z');
  it('falls back to real now for non-numeric / non-finite input', () => {
    expect(viewYearToDate(NaN, now)).toBe(now);
    expect(viewYearToDate(Infinity, now)).toBe(now);
    expect(viewYearToDate(-Infinity, now)).toBe(now);
    expect(viewYearToDate('2027' as unknown as number, now)).toBe(now);
  });
  it('clamps an absurd far-future or far-past year into range without throwing', () => {
    expect(() => viewYearToDate(9_999_999, now)).not.toThrow();
    expect(viewYearToDate(9_999_999, now).getUTCFullYear()).toBe(2100);
    expect(viewYearToDate(-9_999_999, now).getUTCFullYear()).toBe(2000);
  });
  it('always returns a valid Date object', () => {
    for (const v of [null, undefined, NaN, 0, 2026, 2027.9, 1e9]) {
      const d = viewYearToDate(v as number, now);
      expect(d instanceof Date).toBe(true);
      expect(Number.isNaN(d.getTime())).toBe(false);
    }
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

  it('round-trips manual status overrides', () => {
    const src = seededDb();
    statusOverrideSet(src, { program_id: 'aa', program_year: 2026, tier_name: 'Executive Platinum', notes: 'bought up' });
    const payload = buildFilePayload(src);
    expect(payload.status_overrides.length).toBe(1);
    const dst = emptyDb();
    importFilePayload(dst, payload);
    expect((dst.prepare('SELECT COUNT(*) c FROM program_status_overrides').get() as { c: number }).c).toBe(1);
  });
});

describe('manual status override validation', () => {
  it('rejects an unknown program id', () => {
    const db = seededDb();
    expect(() => statusOverrideSet(db, { program_id: 'nope', program_year: 2026, tier_name: 'Gold' })).toThrow(/program/i);
  });
  it('rejects a tier name that is not valid for the program', () => {
    const db = seededDb();
    // "Diamond" is not an American AAdvantage tier.
    expect(() => statusOverrideSet(db, { program_id: 'aa', program_year: 2026, tier_name: 'Diamond' })).toThrow(/tier/i);
  });
  it('rejects a blank tier name and a non-integer program year', () => {
    const db = seededDb();
    expect(() => statusOverrideSet(db, { program_id: 'aa', program_year: 2026, tier_name: '  ' })).toThrow(/tier/i);
    expect(() => statusOverrideSet(db, { program_id: 'aa', program_year: 2026.5, tier_name: 'Gold' })).toThrow(/year/i);
  });
  it('accepts a valid tier, upserts by (program, year), and clears', () => {
    const db = seededDb();
    statusOverrideSet(db, { program_id: 'aa', program_year: 2026, tier_name: 'Gold' });
    statusOverrideSet(db, { program_id: 'aa', program_year: 2026, tier_name: 'Executive Platinum', notes: 'corrected' });
    const all = statusOverridesGetAll(db).filter(o => o.program_id === 'aa' && o.program_year === 2026);
    expect(all.length).toBe(1); // upsert, not duplicate
    expect(all[0].tier_name).toBe('Executive Platinum');
    expect(statusOverrideClear(db, 'aa', 2026)).toBe(true);
    expect(statusOverridesGetAll(db).some(o => o.program_id === 'aa' && o.program_year === 2026)).toBe(false);
  });
  it('rejects an invalid tier name for a generalized (non-Hilton) lifetime status', () => {
    const db = seededDb();
    expect(() => lifetimeStatusSet(db, { program_id: 'aa', tier_name: 'Nonsense', achieved_date: null, notes: null })).toThrow(/tier/i);
  });
});

describe('adjustment deletion validation (v1.5)', () => {
  it('rejects negative deletion ids gracefully (no throw, no match)', () => {
    const db = seededDb();
    expect(() => adjustmentDelete(db, -1)).not.toThrow();
    expect(adjustmentDelete(db, -1)).toBe(false);
  });
});
