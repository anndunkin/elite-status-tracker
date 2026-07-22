// V1 ONLY: ships with historical trip data pre-loaded so Ann can test immediately. Remove this import/call from database.ts before cutting v2.
import type Database from 'better-sqlite3';
import seed from './seedTrips.json';

interface SeedEntry {
  program_id: string;
  metric_values: Record<string, number>;
  card_bonus_notes?: string | null;
}
interface SeedTrip {
  label: string;
  start_date: string;
  end_date?: string | null;
  status: 'planned' | 'booked' | 'completed';
  is_historical_estimate_date?: boolean;
  notes?: string | null;
  entries: SeedEntry[];
}
interface SeedAdjustment {
  program_id: string;
  program_year: number;
  adjustment_type: string;
  metric_values: Record<string, number>;
  notes?: string | null;
}
interface SeedLastActivity {
  program_id: string;
  last_stay_date: string | null;
  notes?: string | null;
}
interface SeedFile {
  trips: SeedTrip[];
  adjustments: SeedAdjustment[];
  last_activity: SeedLastActivity[];
}

/**
 * Inserts the pre-converted historical trips, program-year adjustments, and
 * last-activity markers from the original spreadsheet. Historical trip entries
 * are stored as ACTUALS (is_estimate=0). last_activity is upserted by program_id
 * (the raw feed carries one row per source sheet; the newest date wins).
 */
export function seedHistoricalData(database: Database.Database): void {
  const data = seed as unknown as SeedFile;

  const insertTrip = database.prepare(`
    INSERT INTO trips (label, start_date, end_date, status, is_historical_estimate_date, notes)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const insertEntry = database.prepare(`
    INSERT OR IGNORE INTO trip_program_entries (trip_id, program_id, is_estimate, metric_values, card_bonus_notes)
    VALUES (?, ?, 0, ?, ?)`);
  const insertAdjustment = database.prepare(`
    INSERT INTO program_year_adjustments (program_id, program_year, adjustment_type, metric_values, notes)
    VALUES (?, ?, ?, ?, ?)`);
  const upsertLastActivity = database.prepare(`
    INSERT INTO program_last_activity (program_id, last_stay_date, notes)
    VALUES (@program_id, @last_stay_date, @notes)
    ON CONFLICT(program_id) DO UPDATE SET
      last_stay_date = CASE
        WHEN excluded.last_stay_date IS NULL THEN program_last_activity.last_stay_date
        WHEN program_last_activity.last_stay_date IS NULL THEN excluded.last_stay_date
        WHEN excluded.last_stay_date > program_last_activity.last_stay_date THEN excluded.last_stay_date
        ELSE program_last_activity.last_stay_date
      END,
      notes = excluded.notes`);

  const programExists = (id: string): boolean =>
    !!database.prepare('SELECT 1 FROM programs WHERE id = ?').get(id);

  for (const trip of data.trips) {
    const res = insertTrip.run(
      trip.label, trip.start_date, trip.end_date ?? null,
      trip.status, trip.is_historical_estimate_date ? 1 : 0, trip.notes ?? null,
    );
    const tripId = Number(res.lastInsertRowid);
    for (const e of trip.entries) {
      if (!programExists(e.program_id)) continue;
      insertEntry.run(tripId, e.program_id, JSON.stringify(e.metric_values ?? {}), e.card_bonus_notes ?? null);
    }
  }

  for (const adj of data.adjustments) {
    if (!programExists(adj.program_id)) continue;
    insertAdjustment.run(
      adj.program_id, adj.program_year, adj.adjustment_type,
      JSON.stringify(adj.metric_values ?? {}), adj.notes ?? null,
    );
  }

  for (const la of data.last_activity) {
    if (!programExists(la.program_id)) continue;
    upsertLastActivity.run({
      program_id: la.program_id,
      last_stay_date: la.last_stay_date ?? null,
      notes: la.notes ?? null,
    });
  }
}
