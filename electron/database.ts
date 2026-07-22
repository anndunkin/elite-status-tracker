import Database from 'better-sqlite3';
import path from 'path';
import type {
  Program, ProgramTier, ProgramRuleVersion, ProgramYearAdjustment, ProgramLastActivity,
  Trip, TripSegment, TripProgramEntry, TripCreate, TripUpdate, TripWithDetails,
  TierRequirement, ProgramProjection, AppFilePayload,
} from './types';
import { APP_FILE_VERSION } from './types';
import { SEED_PROGRAMS, OTHER_PROGRAM, SEED_RULES } from './programsSeed';
import {
  highestQualifiedTier, nextTierAbove, currentProgramYear, programYearOf, sumMetrics,
} from './rules';
import { seedHistoricalData } from './seedData';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron');
    const dbPath = path.join(app.getPath('userData'), 'elite-status-tracker.db');
    openDatabaseAt(dbPath);
  }
  return db!;
}

export function openDatabaseAt(dbPath: string): Database.Database {
  if (db) { try { db.close(); } catch { /* ignore */ } }
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  seedIfFresh(db);
  return db;
}

/** For tests: inject an in-memory database. */
export function setDatabase(testDb: Database.Database): void {
  db = testDb;
}

export function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS programs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('airline','hotel')),
      is_active INTEGER NOT NULL DEFAULT 1,
      year_type TEXT NOT NULL DEFAULT 'calendar' CHECK(year_type IN ('calendar','aa_status_year')),
      metric_keys TEXT NOT NULL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS program_rule_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id TEXT NOT NULL REFERENCES programs(id),
      effective_date TEXT NOT NULL,
      source_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_current INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS program_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_version_id INTEGER NOT NULL REFERENCES program_rule_versions(id) ON DELETE CASCADE,
      tier_name TEXT NOT NULL,
      tier_order INTEGER NOT NULL,
      requirements TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','booked','completed')),
      is_historical_estimate_date INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trip_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      origin_airport TEXT,
      destination_airport TEXT,
      distance_miles REAL,
      cost_usd REAL,
      program_id TEXT REFERENCES programs(id),
      fare_class TEXT
    );

    CREATE TABLE IF NOT EXISTS trip_program_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      program_id TEXT NOT NULL REFERENCES programs(id),
      is_estimate INTEGER NOT NULL,
      metric_values TEXT NOT NULL,
      card_bonus_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(trip_id, program_id, is_estimate)
    );

    CREATE TABLE IF NOT EXISTS program_year_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id TEXT NOT NULL REFERENCES programs(id),
      program_year INTEGER NOT NULL,
      adjustment_type TEXT NOT NULL,
      metric_values TEXT NOT NULL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS program_last_activity (
      program_id TEXT PRIMARY KEY REFERENCES programs(id),
      last_stay_date TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS rule_refresh_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now')),
      programs_reviewed TEXT,
      programs_updated TEXT,
      next_check_due TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

function metaGet(database: Database.Database, key: string): string | null {
  const row = database.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}
function metaSet(database: Database.Database, key: string, value: string): void {
  database.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Seed programs, tier rules, and historical trip data exactly once. */
export function seedIfFresh(database: Database.Database): void {
  if (metaGet(database, 'is_seeded') === '1') return;

  const insertProgram = database.prepare(`
    INSERT OR IGNORE INTO programs (id, name, type, is_active, year_type, metric_keys, notes)
    VALUES (@id, @name, @type, @is_active, @year_type, @metric_keys, @notes)`);
  const seedTx = database.transaction(() => {
    for (const p of [...SEED_PROGRAMS, OTHER_PROGRAM]) {
      insertProgram.run({
        id: p.id, name: p.name, type: p.type, is_active: p.is_active,
        year_type: p.year_type, metric_keys: JSON.stringify(p.metric_keys),
        notes: p.notes ?? null,
      });
    }
    for (const rule of SEED_RULES) {
      const rv = database.prepare(`
        INSERT INTO program_rule_versions (program_id, effective_date, source_notes, is_current)
        VALUES (?, ?, ?, 1)`).run(rule.program_id, rule.effective_date, rule.source_notes);
      const rvId = Number(rv.lastInsertRowid);
      for (const t of rule.tiers) {
        database.prepare(`
          INSERT INTO program_tiers (rule_version_id, tier_name, tier_order, requirements)
          VALUES (?, ?, ?, ?)`).run(rvId, t.tier_name, t.tier_order, JSON.stringify(t.requirements));
      }
    }
    // Historical trip / adjustment / last-activity data (V1 seed, isolated).
    seedHistoricalData(database);

    const today = new Date().toISOString().slice(0, 10);
    metaSet(database, 'db_created_at', new Date().toISOString());
    metaSet(database, 'first_launch', today);
    metaSet(database, 'schema_version', '1');
    metaSet(database, 'is_seeded', '1');
    // Initial refresh due date = 3 months from first launch.
    database.prepare(`INSERT INTO rule_refresh_log (programs_reviewed, programs_updated, next_check_due)
      VALUES ('[]', '[]', ?)`).run(addMonths(today, 3));
  });
  seedTx();
}

// ─── Programs ─────────────────────────────────────────────────────────────────

export function programsGetAll(database: Database.Database): Program[] {
  return database.prepare('SELECT * FROM programs ORDER BY is_active DESC, type, name').all() as Program[];
}
export function programGetById(database: Database.Database, id: string): Program | null {
  return (database.prepare('SELECT * FROM programs WHERE id = ?').get(id) as Program) ?? null;
}

export function programGetTiers(database: Database.Database, programId: string): {
  versions: ProgramRuleVersion[];
  tiersByVersion: Record<number, ProgramTier[]>;
} {
  const versions = database.prepare(
    'SELECT * FROM program_rule_versions WHERE program_id = ? ORDER BY effective_date DESC, id DESC'
  ).all(programId) as ProgramRuleVersion[];
  const tiersByVersion: Record<number, ProgramTier[]> = {};
  for (const v of versions) {
    tiersByVersion[v.id] = database.prepare(
      'SELECT * FROM program_tiers WHERE rule_version_id = ? ORDER BY tier_order'
    ).all(v.id) as ProgramTier[];
  }
  return { versions, tiersByVersion };
}

/** Create a new (current) rule version, demoting prior versions. Keeps history. */
export function programCreateRuleVersion(
  database: Database.Database,
  programId: string,
  effectiveDate: string,
  sourceNotes: string,
  tiers: Array<{ tier_name: string; tier_order: number; requirements: TierRequirement[] }>,
): number {
  if (!programGetById(database, programId)) throw new Error('Unknown program');
  if (!effectiveDate?.trim()) throw new Error('Effective date is required');
  const tx = database.transaction(() => {
    database.prepare('UPDATE program_rule_versions SET is_current = 0 WHERE program_id = ?').run(programId);
    const rv = database.prepare(`
      INSERT INTO program_rule_versions (program_id, effective_date, source_notes, is_current)
      VALUES (?, ?, ?, 1)`).run(programId, effectiveDate.trim(), sourceNotes ?? '');
    const rvId = Number(rv.lastInsertRowid);
    for (const t of tiers) {
      database.prepare(`
        INSERT INTO program_tiers (rule_version_id, tier_name, tier_order, requirements)
        VALUES (?, ?, ?, ?)`).run(rvId, t.tier_name, t.tier_order, JSON.stringify(t.requirements));
    }
    return rvId;
  });
  return tx();
}

function currentTiers(database: Database.Database, programId: string): Array<{
  tier_name: string; tier_order: number; requirements: TierRequirement[];
}> {
  const rv = database.prepare(
    'SELECT * FROM program_rule_versions WHERE program_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1'
  ).get(programId) as ProgramRuleVersion | undefined;
  if (!rv) return [];
  const tiers = database.prepare('SELECT * FROM program_tiers WHERE rule_version_id = ? ORDER BY tier_order').all(rv.id) as ProgramTier[];
  return tiers.map(t => ({ tier_name: t.tier_name, tier_order: t.tier_order, requirements: JSON.parse(t.requirements) as TierRequirement[] }));
}

export function lastActivityGetAll(database: Database.Database): ProgramLastActivity[] {
  return database.prepare('SELECT * FROM program_last_activity').all() as ProgramLastActivity[];
}

export function adjustmentsGetAll(database: Database.Database): ProgramYearAdjustment[] {
  return database.prepare('SELECT * FROM program_year_adjustments ORDER BY program_year DESC, program_id').all() as ProgramYearAdjustment[];
}

// ─── Trips ────────────────────────────────────────────────────────────────────

function hydrateTrip(database: Database.Database, trip: Trip): TripWithDetails {
  const entries = database.prepare('SELECT * FROM trip_program_entries WHERE trip_id = ?').all(trip.id) as TripProgramEntry[];
  const segments = database.prepare('SELECT * FROM trip_segments WHERE trip_id = ?').all(trip.id) as TripSegment[];
  return { ...trip, entries, segments };
}

export function tripGetAll(database: Database.Database): TripWithDetails[] {
  const trips = database.prepare('SELECT * FROM trips ORDER BY start_date DESC, id DESC').all() as Trip[];
  return trips.map(t => hydrateTrip(database, t));
}
export function tripGetById(database: Database.Database, id: number): TripWithDetails | null {
  const trip = database.prepare('SELECT * FROM trips WHERE id = ?').get(id) as Trip | undefined;
  return trip ? hydrateTrip(database, trip) : null;
}

function writeEntriesAndSegments(database: Database.Database, tripId: number, data: TripCreate | TripUpdate): void {
  if (data.entries) {
    database.prepare('DELETE FROM trip_program_entries WHERE trip_id = ?').run(tripId);
    for (const e of data.entries) {
      if (!e.program_id) continue;
      database.prepare(`
        INSERT INTO trip_program_entries (trip_id, program_id, is_estimate, metric_values, card_bonus_notes)
        VALUES (?, ?, ?, ?, ?)`).run(
        tripId, e.program_id, e.is_estimate ? 1 : 0,
        JSON.stringify(e.metric_values ?? {}), e.card_bonus_notes ?? null);
    }
  }
  if (data.segments) {
    database.prepare('DELETE FROM trip_segments WHERE trip_id = ?').run(tripId);
    for (const s of data.segments) {
      database.prepare(`
        INSERT INTO trip_segments (trip_id, origin_airport, destination_airport, distance_miles, cost_usd, program_id, fare_class)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        tripId, s.origin_airport ?? null, s.destination_airport ?? null,
        s.distance_miles ?? null, s.cost_usd ?? null, s.program_id ?? null, s.fare_class ?? null);
    }
  }
}

export function tripCreate(database: Database.Database, data: TripCreate): TripWithDetails {
  if (!data.label?.trim()) throw new Error('Trip label is required');
  if (!data.start_date?.trim()) throw new Error('Trip start date is required');
  const tx = database.transaction(() => {
    const res = database.prepare(`
      INSERT INTO trips (label, start_date, end_date, status, is_historical_estimate_date, notes)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      data.label.trim(), data.start_date.trim(), data.end_date ?? null,
      data.status ?? 'planned', data.is_historical_estimate_date ? 1 : 0, data.notes ?? null);
    const tripId = Number(res.lastInsertRowid);
    writeEntriesAndSegments(database, tripId, data);
    return tripId;
  });
  return tripGetById(database, tx())!;
}

export function tripUpdate(database: Database.Database, id: number, data: TripUpdate): TripWithDetails | null {
  const existing = database.prepare('SELECT * FROM trips WHERE id = ?').get(id) as Trip | undefined;
  if (!existing) return null;
  const merged = {
    label: (data.label ?? existing.label).trim(),
    start_date: (data.start_date ?? existing.start_date).trim(),
    end_date: data.end_date !== undefined ? data.end_date : existing.end_date,
    status: data.status ?? existing.status,
    is_historical_estimate_date: data.is_historical_estimate_date !== undefined
      ? (data.is_historical_estimate_date ? 1 : 0) : existing.is_historical_estimate_date,
    notes: data.notes !== undefined ? data.notes : existing.notes,
  };
  if (!merged.label) throw new Error('Trip label is required');
  const tx = database.transaction(() => {
    database.prepare(`
      UPDATE trips SET label=@label, start_date=@start_date, end_date=@end_date, status=@status,
        is_historical_estimate_date=@is_historical_estimate_date, notes=@notes, updated_at=datetime('now')
      WHERE id=@id`).run({ ...merged, id });
    writeEntriesAndSegments(database, id, data);
  });
  tx();
  return tripGetById(database, id);
}

export function tripDelete(database: Database.Database, id: number): boolean {
  return database.prepare('DELETE FROM trips WHERE id = ?').run(id).changes > 0;
}

// ─── Status projection ──────────────────────────────────────────────────────────

export function computeProjections(database: Database.Database, today: Date = new Date()): ProgramProjection[] {
  const programs = programsGetAll(database).filter(p => p.is_active === 1);
  const trips = tripGetAll(database);
  const adjustments = adjustmentsGetAll(database);
  const result: ProgramProjection[] = [];

  for (const program of programs) {
    const tiers = currentTiers(database, program.id);
    const programYear = currentProgramYear(today, program.year_type);

    const actualMaps: Array<Record<string, number>> = [];
    const estimateMaps: Array<Record<string, number>> = [];

    for (const trip of trips) {
      if (programYearOf(trip.start_date, program.year_type) !== programYear) continue;
      for (const e of trip.entries) {
        if (e.program_id !== program.id) continue;
        const mv = JSON.parse(e.metric_values) as Record<string, number>;
        if (e.is_estimate === 0 && trip.status === 'completed') {
          actualMaps.push(mv);
        } else if (e.is_estimate === 1 && (trip.status === 'planned' || trip.status === 'booked')) {
          estimateMaps.push(mv);
        }
      }
    }
    for (const adj of adjustments) {
      if (adj.program_id !== program.id || adj.program_year !== programYear) continue;
      actualMaps.push(JSON.parse(adj.metric_values) as Record<string, number>);
    }

    const currentTotals = sumMetrics(actualMaps);
    const projectedTotals = sumMetrics([...actualMaps, ...estimateMaps]);
    const currentTier = highestQualifiedTier(currentTotals, tiers);
    const projectedTier = highestQualifiedTier(projectedTotals, tiers);
    const nextTier = nextTierAbove(currentTier, tiers);

    result.push({
      program, program_year: programYear, currentTotals, projectedTotals,
      currentTier: currentTier?.tier_name ?? null,
      projectedTier: projectedTier?.tier_name ?? null,
      nextTier: nextTier?.tier_name ?? null,
      nextTierRequirements: nextTier?.requirements ?? null,
      tiers,
    });
  }
  return result;
}

// ─── Quarterly refresh ────────────────────────────────────────────────────────

export function refreshStatus(database: Database.Database, today: Date = new Date()): {
  due: boolean; nextCheckDue: string; lastChecked: string | null;
} {
  const latest = database.prepare(
    'SELECT * FROM rule_refresh_log ORDER BY id DESC LIMIT 1'
  ).get() as { checked_at: string; next_check_due: string } | undefined;
  const todayISO = today.toISOString().slice(0, 10);
  if (!latest) return { due: true, nextCheckDue: todayISO, lastChecked: null };
  return {
    due: todayISO >= latest.next_check_due,
    nextCheckDue: latest.next_check_due,
    lastChecked: latest.checked_at,
  };
}

export function refreshLogCheck(
  database: Database.Database, reviewed: string[], updated: string[], today: Date = new Date(),
): { nextCheckDue: string } {
  const todayISO = today.toISOString().slice(0, 10);
  const next = addMonths(todayISO, 3);
  database.prepare(`INSERT INTO rule_refresh_log (programs_reviewed, programs_updated, next_check_due)
    VALUES (?, ?, ?)`).run(JSON.stringify(reviewed), JSON.stringify(updated), next);
  return { nextCheckDue: next };
}

// ─── Portable JSON export / import ──────────────────────────────────────────────

export function buildFilePayload(database: Database.Database): AppFilePayload {
  const programs = programsGetAll(database);
  const rule_versions = database.prepare('SELECT * FROM program_rule_versions').all() as ProgramRuleVersion[];
  const tiers = database.prepare('SELECT * FROM program_tiers').all() as ProgramTier[];
  const trips = tripGetAll(database);
  const adjustments = adjustmentsGetAll(database);
  const last_activity = lastActivityGetAll(database);
  return {
    version: APP_FILE_VERSION, savedAt: new Date().toISOString(),
    programs, rule_versions, tiers, trips, adjustments, last_activity,
  };
}

export function importFilePayload(database: Database.Database, payload: AppFilePayload): void {
  if (!payload || payload.version !== APP_FILE_VERSION) throw new Error('Unsupported or invalid file version');
  const tx = database.transaction(() => {
    database.exec(`DELETE FROM trip_segments; DELETE FROM trip_program_entries; DELETE FROM trips;
      DELETE FROM program_year_adjustments; DELETE FROM program_last_activity;
      DELETE FROM program_tiers; DELETE FROM program_rule_versions; DELETE FROM programs;`);
    for (const p of payload.programs) {
      database.prepare(`INSERT INTO programs (id,name,type,is_active,year_type,metric_keys,notes)
        VALUES (?,?,?,?,?,?,?)`).run(p.id, p.name, p.type, p.is_active, p.year_type, p.metric_keys, p.notes ?? null);
    }
    for (const v of payload.rule_versions) {
      database.prepare(`INSERT INTO program_rule_versions (id,program_id,effective_date,source_notes,created_at,is_current)
        VALUES (?,?,?,?,?,?)`).run(v.id, v.program_id, v.effective_date, v.source_notes ?? null, v.created_at, v.is_current);
    }
    for (const t of payload.tiers) {
      database.prepare(`INSERT INTO program_tiers (id,rule_version_id,tier_name,tier_order,requirements)
        VALUES (?,?,?,?,?)`).run(t.id, t.rule_version_id, t.tier_name, t.tier_order, t.requirements);
    }
    for (const trip of payload.trips) {
      database.prepare(`INSERT INTO trips (id,label,start_date,end_date,status,is_historical_estimate_date,notes,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(trip.id, trip.label, trip.start_date, trip.end_date ?? null,
        trip.status, trip.is_historical_estimate_date, trip.notes ?? null, trip.created_at, trip.updated_at);
      for (const e of trip.entries) {
        database.prepare(`INSERT INTO trip_program_entries (id,trip_id,program_id,is_estimate,metric_values,card_bonus_notes,created_at)
          VALUES (?,?,?,?,?,?,?)`).run(e.id, e.trip_id, e.program_id, e.is_estimate, e.metric_values, e.card_bonus_notes ?? null, e.created_at);
      }
      for (const s of trip.segments) {
        database.prepare(`INSERT INTO trip_segments (id,trip_id,origin_airport,destination_airport,distance_miles,cost_usd,program_id,fare_class)
          VALUES (?,?,?,?,?,?,?,?)`).run(s.id, s.trip_id, s.origin_airport ?? null, s.destination_airport ?? null,
          s.distance_miles ?? null, s.cost_usd ?? null, s.program_id ?? null, s.fare_class ?? null);
      }
    }
    for (const a of payload.adjustments) {
      database.prepare(`INSERT INTO program_year_adjustments (id,program_id,program_year,adjustment_type,metric_values,notes)
        VALUES (?,?,?,?,?,?)`).run(a.id, a.program_id, a.program_year, a.adjustment_type, a.metric_values, a.notes ?? null);
    }
    for (const la of payload.last_activity) {
      database.prepare(`INSERT INTO program_last_activity (program_id,last_stay_date,notes)
        VALUES (?,?,?)`).run(la.program_id, la.last_stay_date ?? null, la.notes ?? null);
    }
    metaSet(database, 'is_seeded', '1');
  });
  tx();
}
