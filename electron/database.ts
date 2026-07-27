import Database from 'better-sqlite3';
import path from 'path';
import type {
  Program, ProgramTier, ProgramRuleVersion, ProgramYearAdjustment, ProgramLastActivity,
  Trip, TripSegment, TripProgramEntry, TripCreate, TripUpdate, TripWithDetails,
  TierRequirement, ProgramProjection, AppFilePayload,
  ProgramLifetimeStatus, ProgramLifetimeMileageRow, ProgramLifetimeMileageView,
  LifetimeMileageMilestone, CardEarningEntry, CardEarningInput, CardEarningUpdate,
  ProgramStatusOverride, ProgramStatusOverrideInput,
} from './types';
import { APP_FILE_VERSION } from './types';
import {
  SEED_PROGRAMS, OTHER_PROGRAM, SEED_RULES, SEED_LIFETIME_STATUS, SEED_LIFETIME_MILEAGE,
} from './programsSeed';
import {
  highestQualifiedTier, nextTierAbove, currentProgramYear, programYearOf, sumMetrics,
} from './rules';

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
  applyDataMigrations(db);
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

    CREATE TABLE IF NOT EXISTS program_lifetime_status (
      program_id TEXT PRIMARY KEY REFERENCES programs(id),
      tier_name TEXT NOT NULL,
      achieved_date TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS program_lifetime_mileage (
      program_id TEXT PRIMARY KEY REFERENCES programs(id),
      baseline_miles REAL NOT NULL,
      baseline_date TEXT NOT NULL,
      milestones TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS card_earnings_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id TEXT NOT NULL REFERENCES programs(id),
      entry_date TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      amount REAL NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS program_status_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id TEXT NOT NULL REFERENCES programs(id),
      program_year INTEGER NOT NULL,
      tier_name TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(program_id, program_year)
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

/**
 * Seed the app's core reference/rules dataset (programs, tier rule versions,
 * lifetime-status and lifetime-mileage reference rows) exactly once, on a
 * brand-new database. No historical trip data is seeded — a fresh install is a
 * blank slate ready for real use. Gated by `app_meta.is_seeded='1'`, which now
 * means "reference/rules data has been seeded" (existing v1.0/v1.1 databases
 * that already have the flag set are left completely untouched).
 */
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
    for (const ls of SEED_LIFETIME_STATUS) {
      database.prepare(`INSERT OR IGNORE INTO program_lifetime_status (program_id, tier_name, achieved_date, notes)
        VALUES (?, ?, ?, ?)`).run(ls.program_id, ls.tier_name, ls.achieved_date, ls.notes);
    }
    for (const lm of SEED_LIFETIME_MILEAGE) {
      database.prepare(`INSERT OR IGNORE INTO program_lifetime_mileage (program_id, baseline_miles, baseline_date, milestones)
        VALUES (?, ?, ?, ?)`).run(lm.program_id, lm.baseline_miles, lm.baseline_date, JSON.stringify(lm.milestones));
    }

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

// ─── Startup data migrations (v1.5) ──────────────────────────────────────────
//
// Run unconditionally at the end of openDatabaseAt, on every launch, after
// seedIfFresh. Each helper is idempotent and safe to call repeatedly.

export interface DataMigrationsSummary {
  mileageAdded: number;
  metricKeysFixed: boolean;
  mqmStripped: number;
  delta2026AdjustmentsCleared: number | null;
  aaMetricKeysFixed: boolean;
  aaSpendStripped: number;
}

/** INSERT OR IGNORE each SEED_LIFETIME_MILEAGE row; never rewrites an existing baseline. */
export function ensureLifetimeMileageRows(database: Database.Database): number {
  let added = 0;
  const insert = database.prepare(`
    INSERT OR IGNORE INTO program_lifetime_mileage (program_id, baseline_miles, baseline_date, milestones)
    VALUES (?, ?, ?, ?)`);
  for (const lm of SEED_LIFETIME_MILEAGE) {
    const res = insert.run(lm.program_id, lm.baseline_miles, lm.baseline_date, JSON.stringify(lm.milestones));
    if (res.changes > 0) added += 1;
  }
  return added;
}

/** If programs.metric_keys for 'dl' still contains 'mqm', rewrite to ["mqd"]. */
export function ensureDeltaMetricKeys(database: Database.Database): boolean {
  const row = database.prepare('SELECT metric_keys FROM programs WHERE id = ?').get('dl') as { metric_keys: string } | undefined;
  if (!row) return false;
  let keys: string[] = [];
  try { keys = JSON.parse(row.metric_keys) as string[]; } catch { return false; }
  if (!keys.includes('mqm')) return false;
  const fixed = keys.filter(k => k !== 'mqm');
  database.prepare('UPDATE programs SET metric_keys = ? WHERE id = ?').run(JSON.stringify(fixed), 'dl');
  return true;
}

/** Strip any 'mqm' key from Delta trip_program_entries / program_year_adjustments metric_values JSON. Returns rows changed. */
export function stripDeltaMqmValues(database: Database.Database): number {
  let updated = 0;

  const entries = database.prepare(
    `SELECT id, metric_values FROM trip_program_entries WHERE program_id = ?`
  ).all('dl') as Array<{ id: number; metric_values: string }>;
  const updEntry = database.prepare('UPDATE trip_program_entries SET metric_values = ? WHERE id = ?');
  for (const e of entries) {
    let mv: Record<string, number>;
    try { mv = JSON.parse(e.metric_values) as Record<string, number>; } catch { continue; }
    if (!('mqm' in mv)) continue;
    const { mqm: _mqm, ...rest } = mv;
    updEntry.run(JSON.stringify(rest), e.id);
    updated += 1;
  }

  const adjustments = database.prepare(
    `SELECT id, metric_values FROM program_year_adjustments WHERE program_id = ?`
  ).all('dl') as Array<{ id: number; metric_values: string }>;
  const updAdj = database.prepare('UPDATE program_year_adjustments SET metric_values = ? WHERE id = ?');
  for (const a of adjustments) {
    let mv: Record<string, number>;
    try { mv = JSON.parse(a.metric_values) as Record<string, number>; } catch { continue; }
    if (!('mqm' in mv)) continue;
    const { mqm: _mqm, ...rest } = mv;
    updAdj.run(JSON.stringify(rest), a.id);
    updated += 1;
  }

  return updated;
}

/** One-time cleanup: delete 2026 Delta adjustments, gated by app_meta.delta_2026_adjustments_cleared. */
export function deleteDelta2026AdjustmentsOnce(database: Database.Database): number | null {
  if (metaGet(database, 'delta_2026_adjustments_cleared')) return null;
  const count = adjustmentsDeleteForProgramYear(database, 'dl', 2026);
  metaSet(database, 'delta_2026_adjustments_cleared', new Date().toISOString().slice(0, 10));
  return count;
}

/** If programs.metric_keys for 'aa' still contains 'spend', rewrite to ["points"]. */
export function ensureAaMetricKeys(database: Database.Database): boolean {
  const row = database.prepare('SELECT metric_keys FROM programs WHERE id = ?').get('aa') as { metric_keys: string } | undefined;
  if (!row) return false;
  let keys: string[] = [];
  try { keys = JSON.parse(row.metric_keys) as string[]; } catch { return false; }
  if (!keys.includes('spend')) return false;
  const fixed = keys.filter(k => k !== 'spend');
  database.prepare('UPDATE programs SET metric_keys = ? WHERE id = ?').run(JSON.stringify(fixed), 'aa');
  return true;
}

/** Strip any 'spend' key from AA trip_program_entries / program_year_adjustments metric_values JSON. Returns rows changed. */
export function stripAaSpendValues(database: Database.Database): number {
  let updated = 0;

  const entries = database.prepare(
    `SELECT id, metric_values FROM trip_program_entries WHERE program_id = ?`
  ).all('aa') as Array<{ id: number; metric_values: string }>;
  const updEntry = database.prepare('UPDATE trip_program_entries SET metric_values = ? WHERE id = ?');
  for (const e of entries) {
    let mv: Record<string, number>;
    try { mv = JSON.parse(e.metric_values) as Record<string, number>; } catch { continue; }
    if (!('spend' in mv)) continue;
    const { spend: _spend, ...rest } = mv;
    updEntry.run(JSON.stringify(rest), e.id);
    updated += 1;
  }

  const adjustments = database.prepare(
    `SELECT id, metric_values FROM program_year_adjustments WHERE program_id = ?`
  ).all('aa') as Array<{ id: number; metric_values: string }>;
  const updAdj = database.prepare('UPDATE program_year_adjustments SET metric_values = ? WHERE id = ?');
  for (const a of adjustments) {
    let mv: Record<string, number>;
    try { mv = JSON.parse(a.metric_values) as Record<string, number>; } catch { continue; }
    if (!('spend' in mv)) continue;
    const { spend: _spend, ...rest } = mv;
    updAdj.run(JSON.stringify(rest), a.id);
    updated += 1;
  }

  return updated;
}

/** Runs all v1.5 startup migrations, in order, and returns a summary for logging. */
export function applyDataMigrations(database: Database.Database): DataMigrationsSummary {
  const mileageAdded = ensureLifetimeMileageRows(database);
  const metricKeysFixed = ensureDeltaMetricKeys(database);
  const mqmStripped = stripDeltaMqmValues(database);
  const delta2026AdjustmentsCleared = deleteDelta2026AdjustmentsOnce(database);
  const aaMetricKeysFixed = ensureAaMetricKeys(database);
  const aaSpendStripped = stripAaSpendValues(database);
  return {
    mileageAdded, metricKeysFixed, mqmStripped, delta2026AdjustmentsCleared,
    aaMetricKeysFixed, aaSpendStripped,
  };
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

export function adjustmentDelete(database: Database.Database, id: number): boolean {
  return database.prepare('DELETE FROM program_year_adjustments WHERE id = ?').run(id).changes > 0;
}

export function adjustmentsDeleteForProgramYear(database: Database.Database, programId: string, year: number): number {
  return database.prepare('DELETE FROM program_year_adjustments WHERE program_id = ? AND program_year = ?')
    .run(programId, year).changes;
}

// ─── Lifetime status ────────────────────────────────────────────────────────────

export function lifetimeStatusGetAll(database: Database.Database): ProgramLifetimeStatus[] {
  return database.prepare('SELECT * FROM program_lifetime_status').all() as ProgramLifetimeStatus[];
}

export function lifetimeStatusSet(database: Database.Database, data: ProgramLifetimeStatus): ProgramLifetimeStatus {
  if (!programGetById(database, data.program_id)) throw new Error('Unknown program');
  if (!data.tier_name?.trim()) throw new Error('Lifetime tier name is required');
  assertValidTier(database, data.program_id, data.tier_name.trim());
  database.prepare(`INSERT INTO program_lifetime_status (program_id, tier_name, achieved_date, notes)
    VALUES (@program_id, @tier_name, @achieved_date, @notes)
    ON CONFLICT(program_id) DO UPDATE SET
      tier_name = excluded.tier_name, achieved_date = excluded.achieved_date, notes = excluded.notes`)
    .run({
      program_id: data.program_id, tier_name: data.tier_name.trim(),
      achieved_date: data.achieved_date ?? null, notes: data.notes ?? null,
    });
  return database.prepare('SELECT * FROM program_lifetime_status WHERE program_id = ?').get(data.program_id) as ProgramLifetimeStatus;
}

export function lifetimeStatusClear(database: Database.Database, programId: string): boolean {
  return database.prepare('DELETE FROM program_lifetime_status WHERE program_id = ?').run(programId).changes > 0;
}

// ─── Lifetime mileage (Million Miler) ────────────────────────────────────────────

/**
 * Flown miles accrued from completed segments of the given program after baseline_date.
 *
 * A segment counts toward a program's lifetime mileage if EITHER:
 *   (a) the segment itself has an explicit program_id matching this program (legacy /
 *       manually-tagged segments), OR
 *   (b) the segment has no program_id set (the common case — the Trips.tsx segment editor
 *       has no per-segment program dropdown) AND the trip it belongs to has a program credit
 *       entry (trip_program_entries) for this program.
 * These two conditions are mutually exclusive on program_id (explicit vs. empty), so a plain
 * OR cannot double-count a given segment. The EXISTS subquery (rather than a JOIN to
 * trip_program_entries) also guarantees no row multiplication if a trip somehow had more than
 * one program-credit entry for the same program (e.g. one estimate + one actual row, which the
 * `UNIQUE(trip_id, program_id, is_estimate)` constraint permits) — each segment is still only
 * summed once.
 */
export function accruedLifetimeMiles(database: Database.Database, programId: string, baselineDate: string): number {
  const row = database.prepare(`
    SELECT COALESCE(SUM(s.distance_miles), 0) AS miles
    FROM trip_segments s
    JOIN trips t ON t.id = s.trip_id
    WHERE t.status = 'completed'
      AND s.distance_miles IS NOT NULL AND t.start_date > ?
      AND (
        s.program_id = ?
        OR (
          (s.program_id IS NULL OR s.program_id = '')
          AND EXISTS (
            SELECT 1 FROM trip_program_entries e
            WHERE e.trip_id = t.id AND e.program_id = ?
          )
        )
      )`).get(baselineDate, programId, programId) as { miles: number };
  return row.miles ?? 0;
}

export function lifetimeMileageGetAll(database: Database.Database): ProgramLifetimeMileageView[] {
  const rows = database.prepare('SELECT * FROM program_lifetime_mileage').all() as ProgramLifetimeMileageRow[];
  return rows.map(r => toMileageView(database, r));
}

function toMileageView(database: Database.Database, r: ProgramLifetimeMileageRow): ProgramLifetimeMileageView {
  let milestones: LifetimeMileageMilestone[] = [];
  try { milestones = JSON.parse(r.milestones) as LifetimeMileageMilestone[]; } catch { /* ignore */ }
  milestones = [...milestones].sort((a, b) => a.threshold - b.threshold);
  const accruedSinceBaseline = accruedLifetimeMiles(database, r.program_id, r.baseline_date);
  const currentMiles = r.baseline_miles + accruedSinceBaseline;
  const nextMilestone = milestones.find(m => m.threshold > currentMiles) ?? null;
  return {
    program_id: r.program_id,
    baseline_miles: r.baseline_miles,
    baseline_date: r.baseline_date,
    milestones,
    accruedSinceBaseline,
    currentMiles,
    nextMilestone,
    milesToNext: nextMilestone ? nextMilestone.threshold - currentMiles : null,
  };
}

// ─── Card-earnings entries ────────────────────────────────────────────────────

export function cardEarningsGetAll(database: Database.Database): CardEarningEntry[] {
  return database.prepare('SELECT * FROM card_earnings_entries ORDER BY entry_date DESC, id DESC').all() as CardEarningEntry[];
}

function validateCardEarning(database: Database.Database, program_id: string, entry_date: string, metric_key: string, amount: number): void {
  if (!programGetById(database, program_id)) throw new Error('Unknown program');
  if (!entry_date?.trim()) throw new Error('Entry date is required');
  if (!metric_key?.trim()) throw new Error('Metric key is required');
  if (typeof amount !== 'number' || Number.isNaN(amount)) throw new Error('Amount must be a number');
}

export function cardEarningCreate(database: Database.Database, data: CardEarningInput): CardEarningEntry {
  validateCardEarning(database, data.program_id, data.entry_date, data.metric_key, data.amount);
  const res = database.prepare(`
    INSERT INTO card_earnings_entries (program_id, entry_date, metric_key, amount, notes)
    VALUES (?, ?, ?, ?, ?)`).run(
    data.program_id, data.entry_date.trim(), data.metric_key.trim(), data.amount, data.notes ?? null);
  return database.prepare('SELECT * FROM card_earnings_entries WHERE id = ?').get(Number(res.lastInsertRowid)) as CardEarningEntry;
}

export function cardEarningUpdate(database: Database.Database, id: number, data: CardEarningUpdate): CardEarningEntry | null {
  const existing = database.prepare('SELECT * FROM card_earnings_entries WHERE id = ?').get(id) as CardEarningEntry | undefined;
  if (!existing) return null;
  const merged = {
    program_id: data.program_id ?? existing.program_id,
    entry_date: (data.entry_date ?? existing.entry_date),
    metric_key: (data.metric_key ?? existing.metric_key),
    amount: data.amount !== undefined ? data.amount : existing.amount,
    notes: data.notes !== undefined ? data.notes : existing.notes,
  };
  validateCardEarning(database, merged.program_id, merged.entry_date, merged.metric_key, merged.amount);
  database.prepare(`UPDATE card_earnings_entries
    SET program_id=@program_id, entry_date=@entry_date, metric_key=@metric_key, amount=@amount, notes=@notes
    WHERE id=@id`).run({ ...merged, entry_date: merged.entry_date.trim(), metric_key: merged.metric_key.trim(), id });
  return database.prepare('SELECT * FROM card_earnings_entries WHERE id = ?').get(id) as CardEarningEntry;
}

export function cardEarningDelete(database: Database.Database, id: number): boolean {
  return database.prepare('DELETE FROM card_earnings_entries WHERE id = ?').run(id).changes > 0;
}

// ─── Manual status overrides (current-program-year, non-permanent) ───────────────

/** Tier names valid for a program: its current tier list (lifetime tiers reuse the same names). */
function validTierNames(database: Database.Database, programId: string): Set<string> {
  return new Set(currentTiers(database, programId).map(t => t.tier_name));
}

/** Guard: the given tier must belong to the program's current tier set. */
function assertValidTier(database: Database.Database, programId: string, tierName: string): void {
  if (!validTierNames(database, programId).has(tierName)) {
    throw new Error(`Unknown tier "${tierName}" for program ${programId}`);
  }
}

export function statusOverridesGetAll(database: Database.Database): ProgramStatusOverride[] {
  return database.prepare(
    'SELECT * FROM program_status_overrides ORDER BY program_id, program_year DESC'
  ).all() as ProgramStatusOverride[];
}

/** Upsert the (one) override for a program in a given program-year. */
export function statusOverrideSet(database: Database.Database, data: ProgramStatusOverrideInput): ProgramStatusOverride {
  if (!programGetById(database, data.program_id)) throw new Error('Unknown program');
  if (!Number.isInteger(data.program_year)) throw new Error('A valid program year is required');
  if (!data.tier_name?.trim()) throw new Error('Tier name is required');
  const tier = data.tier_name.trim();
  assertValidTier(database, data.program_id, tier);
  database.prepare(`INSERT INTO program_status_overrides (program_id, program_year, tier_name, notes)
    VALUES (@program_id, @program_year, @tier_name, @notes)
    ON CONFLICT(program_id, program_year) DO UPDATE SET
      tier_name = excluded.tier_name, notes = excluded.notes`)
    .run({ program_id: data.program_id, program_year: data.program_year, tier_name: tier, notes: data.notes ?? null });
  return database.prepare('SELECT * FROM program_status_overrides WHERE program_id = ? AND program_year = ?')
    .get(data.program_id, data.program_year) as ProgramStatusOverride;
}

export function statusOverrideClear(database: Database.Database, programId: string, programYear: number): boolean {
  return database.prepare('DELETE FROM program_status_overrides WHERE program_id = ? AND program_year = ?')
    .run(programId, programYear).changes > 0;
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

/** AA per-dollar Loyalty Point earning multiplier, by tier held entering the status year. */
export function statusMultiplierForAA(tier: string | null | undefined): number {
  switch (tier) {
    case 'Gold': return 7;
    case 'Platinum': return 8;
    case 'Platinum Pro': return 9;
    case 'Executive Platinum': return 11;
    default: return 5; // null / undefined / 'No status'
  }
}

/**
 * Sum `cost_usd` across a trip's segments for a given program, preferring segments explicitly
 * tagged with that program_id, but falling back to ALL of the trip's segments when none are
 * explicitly tagged (the common case, since the segment editor has no per-segment program
 * picker). This avoids double-crediting a mixed-program trip (one where some segments ARE
 * explicitly tagged for a different program) while still working for the untagged-segment case.
 */
function deriveSegmentCost(segments: TripSegment[], programId: string): number {
  const taggedSegs = segments.filter(s => s.program_id === programId && typeof s.cost_usd === 'number');
  const untaggedSegs = segments.filter(s => !s.program_id && typeof s.cost_usd === 'number');
  const costSource = taggedSegs.length > 0 ? taggedSegs : untaggedSegs;
  return costSource.reduce((sum, s) => sum + (s.cost_usd as number), 0);
}

export function computeProjections(database: Database.Database, today: Date = new Date()): ProgramProjection[] {
  const programs = programsGetAll(database).filter(p => p.is_active === 1);
  const trips = tripGetAll(database);
  const adjustments = adjustmentsGetAll(database);
  const cardEarnings = cardEarningsGetAll(database);
  const lifetimeStatuses = lifetimeStatusGetAll(database);
  const statusOverrides = statusOverridesGetAll(database);
  const lifetimeMileage = lifetimeMileageGetAll(database);
  const result: ProgramProjection[] = [];

  for (const program of programs) {
    const tiers = currentTiers(database, program.id);
    const programYear = currentProgramYear(today, program.year_type);

    // Bucket every actual/estimate metric map by the program-year it belongs to.
    const actualByYear = new Map<number, Array<Record<string, number>>>();
    const estimateByYear = new Map<number, Array<Record<string, number>>>();
    const pushYear = (map: Map<number, Array<Record<string, number>>>, year: number, mv: Record<string, number>) => {
      if (!map.has(year)) map.set(year, []);
      map.get(year)!.push(mv);
    };

    // Raw pass: bucket metric maps using only explicitly-entered values (no AA points
    // derivation yet, since that needs the resolved held/lifetime/override tier below,
    // which itself is computed from these same per-year totals for *prior* years).
    // Also track each source's contribution to the CURRENT program-year separately
    // (trips / adjustments / card earnings), for the diagnostic source breakdown below.
    const currentYearTripActuals: Array<Record<string, number>> = [];
    const currentYearAdjActuals: Array<Record<string, number>> = [];
    const currentYearCardActuals: Array<Record<string, number>> = [];
    for (const trip of trips) {
      const year = programYearOf(trip.start_date, program.year_type);
      for (const e of trip.entries) {
        if (e.program_id !== program.id) continue;
        let mv = JSON.parse(e.metric_values) as Record<string, number>;
        // Delta MQDs are derived automatically from segment cost when not explicitly entered.
        // Segments are rarely tagged with an explicit program_id (Trips.tsx has no per-segment
        // program dropdown), so prefer explicitly-tagged Delta segments if any exist, but fall
        // back to ALL of the trip's segments when none are explicitly tagged — this is safe
        // because we only reach this branch for a trip_program_entries row that IS for Delta
        // (program.id === 'dl' here), so an untagged segment on this trip belongs to this
        // credit unless some other segment was explicitly tagged for a different program.
        if (program.id === 'dl' && mv.mqd === undefined) {
          const derivedMqd = deriveSegmentCost(trip.segments, 'dl');
          if (derivedMqd > 0) mv = { ...mv, mqd: derivedMqd };
        }
        if (e.is_estimate === 0 && trip.status === 'completed') {
          pushYear(actualByYear, year, mv);
          if (year === programYear) currentYearTripActuals.push(mv);
        }
        else if (e.is_estimate === 1 && (trip.status === 'planned' || trip.status === 'booked')) pushYear(estimateByYear, year, mv);
      }
    }
    for (const adj of adjustments) {
      if (adj.program_id !== program.id) continue;
      const mv = JSON.parse(adj.metric_values) as Record<string, number>;
      pushYear(actualByYear, adj.program_year, mv);
      if (adj.program_year === programYear) currentYearAdjActuals.push(mv);
    }
    for (const ce of cardEarnings) {
      if (ce.program_id !== program.id) continue;
      const year = programYearOf(ce.entry_date, program.year_type);
      const mv = { [ce.metric_key]: ce.amount };
      pushYear(actualByYear, year, mv);
      if (year === programYear) currentYearCardActuals.push(mv);
    }

    const currentActuals = actualByYear.get(programYear) ?? [];
    const currentEstimates = estimateByYear.get(programYear) ?? [];
    const ytdTotals = sumMetrics(currentActuals);
    const projectedTotals = sumMetrics([...currentActuals, ...currentEstimates]);
    const ytdTier = highestQualifiedTier(ytdTotals, tiers);
    const projectedTier = highestQualifiedTier(projectedTotals, tiers);

    // "Current": tier held now, from the most recent completed (closed) program-year.
    const priorYears = [...actualByYear.keys()].filter(y => y < programYear).sort((a, b) => b - a);
    const heldFromYear = priorYears.length ? priorYears[0] : null;
    const heldTotals = heldFromYear != null ? sumMetrics(actualByYear.get(heldFromYear)!) : {};
    const heldTier = heldFromYear != null ? highestQualifiedTier(heldTotals, tiers) : null;

    // Displayed "Current" tier = the highest (by tier_order) of three possibly-absent inputs:
    //   lifetime floor · current-program-year manual override · calculated held tier.
    const lifetimeStatus = lifetimeStatuses.find(l => l.program_id === program.id) ?? null;
    const statusOverride = statusOverrides.find(
      o => o.program_id === program.id && o.program_year === programYear) ?? null;
    const orderOf = (name: string | null | undefined): number =>
      name ? (tiers.find(t => t.tier_name === name)?.tier_order ?? -1) : -1;
    let currentStatusTier: string | null = null;
    let bestOrder = Number.NEGATIVE_INFINITY;
    const consider = (name: string | null | undefined) => {
      if (!name) return;
      const ord = orderOf(name);
      if (ord > bestOrder) { bestOrder = ord; currentStatusTier = name; }
    };
    consider(heldTier?.tier_name);
    consider(lifetimeStatus?.tier_name);
    consider(statusOverride?.tier_name);

    // AA Loyalty Points are derived automatically from segment cost, using the earning
    // multiplier for the tier held entering the current status year (currentStatusTier,
    // resolved just above from heldTier / lifetimeStatus / statusOverride). Recompute this
    // program-year's actual/estimate totals with derived points folded in where the user
    // hasn't entered an explicit value.
    let currentActualsFinal = currentActuals;
    let currentEstimatesFinal = currentEstimates;
    let aaDerivedTripActuals: Record<string, number>[] | null = null;
    if (program.id === 'aa') {
      const multiplier = statusMultiplierForAA(currentStatusTier);
      const deriveForTrip = (trip: TripWithDetails, mv: Record<string, number>): Record<string, number> => {
        // An explicit user-entered value (including an explicit 0) always wins. Only
        // undefined/null (missing or cleared) triggers derivation from segment cost —
        // JSON round-trips (e.g. portable-file import/export) can turn a genuinely-absent
        // key into a stored `null`, which must be treated the same as `undefined` here.
        if (mv.points !== undefined && mv.points !== null) return mv;
        const costs = deriveSegmentCost(trip.segments, 'aa');
        if (costs <= 0) return mv;
        const derivedPoints = Math.round(costs * multiplier);
        if (derivedPoints <= 0) return mv;
        return { ...mv, points: derivedPoints };
      };
      const aaActuals: Record<string, number>[] = [];
      const aaEstimates: Record<string, number>[] = [];
      for (const trip of trips) {
        const year = programYearOf(trip.start_date, program.year_type);
        if (year !== programYear) continue;
        for (const e of trip.entries) {
          if (e.program_id !== 'aa') continue;
          const mv = JSON.parse(e.metric_values) as Record<string, number>;
          const derived = deriveForTrip(trip, mv);
          if (e.is_estimate === 0 && trip.status === 'completed') aaActuals.push(derived);
          else if (e.is_estimate === 1 && (trip.status === 'planned' || trip.status === 'booked')) aaEstimates.push(derived);
        }
      }
      // Non-trip actuals (adjustments, card earnings) for the current year are unaffected by derivation;
      // rebuild them directly from source rather than trying to separate them out of currentActuals.
      const adjAndCardActuals: Record<string, number>[] = [];
      for (const adj of adjustments) {
        if (adj.program_id !== 'aa' || adj.program_year !== programYear) continue;
        adjAndCardActuals.push(JSON.parse(adj.metric_values) as Record<string, number>);
      }
      for (const ce of cardEarnings) {
        if (ce.program_id !== 'aa') continue;
        if (programYearOf(ce.entry_date, program.year_type) !== programYear) continue;
        adjAndCardActuals.push({ [ce.metric_key]: ce.amount });
      }
      currentActualsFinal = [...aaActuals, ...adjAndCardActuals];
      currentEstimatesFinal = aaEstimates;
      aaDerivedTripActuals = aaActuals;
    }

    // Diagnostic source breakdown: for each metric key present in the current program-year's
    // final actuals, how much came from trips vs. adjustments vs. card earnings. For AA this
    // uses the DERIVED trip values (aaActuals, computed above), not the raw explicitly-entered
    // ones, so the breakdown always reconciles to ytdTotalsFinal below.
    const breakdownTripActuals = program.id === 'aa' ? (aaDerivedTripActuals ?? []) : currentYearTripActuals;
    const tripSourceTotals = sumMetrics(breakdownTripActuals);
    const adjSourceTotals = sumMetrics(currentYearAdjActuals);
    const cardSourceTotals = sumMetrics(currentYearCardActuals);
    const breakdownKeys = new Set<string>([
      ...Object.keys(tripSourceTotals), ...Object.keys(adjSourceTotals), ...Object.keys(cardSourceTotals),
    ]);
    const metricSourceBreakdown: Record<string, { trips: number; adjustments: number; cardEarnings: number }> = {};
    for (const key of breakdownKeys) {
      metricSourceBreakdown[key] = {
        trips: tripSourceTotals[key] ?? 0,
        adjustments: adjSourceTotals[key] ?? 0,
        cardEarnings: cardSourceTotals[key] ?? 0,
      };
    }

    const ytdTotalsFinal = program.id === 'aa' ? sumMetrics(currentActualsFinal) : ytdTotals;
    const projectedTotalsFinal = program.id === 'aa'
      ? sumMetrics([...currentActualsFinal, ...currentEstimatesFinal]) : projectedTotals;
    const ytdTierFinal = program.id === 'aa' ? highestQualifiedTier(ytdTotalsFinal, tiers) : ytdTier;
    const projectedTierFinal = program.id === 'aa' ? highestQualifiedTier(projectedTotalsFinal, tiers) : projectedTier;

    const nextTier = nextTierAbove(ytdTierFinal, tiers);

    result.push({
      program, program_year: programYear,
      currentTotals: ytdTotalsFinal, projectedTotals: projectedTotalsFinal,
      currentTier: ytdTierFinal?.tier_name ?? null,
      projectedTier: projectedTierFinal?.tier_name ?? null,
      heldTier: heldTier?.tier_name ?? null,
      heldFromYear,
      heldTotals,
      ytdTotals: ytdTotalsFinal,
      ytdTier: ytdTierFinal?.tier_name ?? null,
      lifetimeTier: lifetimeStatus?.tier_name ?? null,
      overrideTier: statusOverride?.tier_name ?? null,
      currentStatusTier,
      lifetimeStatus,
      statusOverride,
      lifetimeMileage: lifetimeMileage.find(m => m.program_id === program.id) ?? null,
      nextTier: nextTier?.tier_name ?? null,
      nextTierRequirements: nextTier?.requirements ?? null,
      tiers,
      metricSourceBreakdown,
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
  const lifetime_status = lifetimeStatusGetAll(database);
  const lifetime_mileage = database.prepare('SELECT * FROM program_lifetime_mileage').all() as ProgramLifetimeMileageRow[];
  const card_earnings = cardEarningsGetAll(database);
  const status_overrides = statusOverridesGetAll(database);
  return {
    version: APP_FILE_VERSION, savedAt: new Date().toISOString(),
    programs, rule_versions, tiers, trips, adjustments, last_activity,
    lifetime_status, lifetime_mileage, card_earnings, status_overrides,
  };
}

export function importFilePayload(database: Database.Database, payload: AppFilePayload): void {
  if (!payload || payload.version !== APP_FILE_VERSION) throw new Error('Unsupported or invalid file version');
  const tx = database.transaction(() => {
    database.exec(`DELETE FROM program_status_overrides; DELETE FROM card_earnings_entries;
      DELETE FROM program_lifetime_mileage; DELETE FROM program_lifetime_status;
      DELETE FROM trip_segments; DELETE FROM trip_program_entries; DELETE FROM trips;
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
    for (const ls of payload.lifetime_status ?? []) {
      database.prepare(`INSERT INTO program_lifetime_status (program_id,tier_name,achieved_date,notes)
        VALUES (?,?,?,?)`).run(ls.program_id, ls.tier_name, ls.achieved_date ?? null, ls.notes ?? null);
    }
    for (const lm of payload.lifetime_mileage ?? []) {
      database.prepare(`INSERT INTO program_lifetime_mileage (program_id,baseline_miles,baseline_date,milestones)
        VALUES (?,?,?,?)`).run(lm.program_id, lm.baseline_miles, lm.baseline_date, lm.milestones);
    }
    for (const ce of payload.card_earnings ?? []) {
      database.prepare(`INSERT INTO card_earnings_entries (id,program_id,entry_date,metric_key,amount,notes,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(ce.id, ce.program_id, ce.entry_date, ce.metric_key, ce.amount, ce.notes ?? null, ce.created_at);
    }
    for (const so of payload.status_overrides ?? []) {
      database.prepare(`INSERT INTO program_status_overrides (id,program_id,program_year,tier_name,notes,created_at)
        VALUES (?,?,?,?,?,?)`).run(so.id, so.program_id, so.program_year, so.tier_name, so.notes ?? null, so.created_at);
    }
    metaSet(database, 'is_seeded', '1');
  });
  tx();
}
