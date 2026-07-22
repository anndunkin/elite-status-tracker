# Technical Documentation

## Architecture

Pure Electron main-process backend (no Express). The renderer (React) talks to
the main process only through a narrow `contextBridge` API defined in
`electron/preload.ts` and implemented as `ipcMain.handle` handlers in
`electron/main.ts`. All persistence is a local SQLite database via
`better-sqlite3`.

```
React (src/)  ──window.api──▶  preload.ts  ──ipc──▶  main.ts  ──▶  database.ts (SQLite)
                                                              └──▶  rules.ts / airports.ts
```

### Key modules (`electron/`)

- **types.ts** — all domain types and the `WindowApi` IPC surface.
- **database.ts** — schema, seed-once lifecycle, CRUD, projection, and the
  portable JSON payload builder/importer.
- **rules.ts** — pure, dependency-free status engine (tier qualification,
  program-year windowing, metric summing). Fully unit-tested.
- **programsSeed.ts** — the eight programs plus lapsed ones, and the 2026 tier
  rules with source citations.
- **airports.ts** — curated IATA reference and haversine distance.
- **seedData.ts** — **V1-only** historical data loader (see below).

## Data model

Ten tables: `programs`, `program_rule_versions`, `program_tiers`, `trips`,
`trip_segments`, `trip_program_entries`, `program_year_adjustments`,
`program_last_activity`, `rule_refresh_log`, `app_meta`.

- Tier requirements are stored as JSON `TierRequirement[]` on each tier.
  Requirements are grouped by a `group` index: **all** requirements within a
  group must be met (AND), and a tier qualifies if **any** group is satisfied
  (OR). This models cases like United (PQP+PQF *or* PQP-only) and Hilton
  (nights *or* stays *or* spend).
- `trip_program_entries` is uniquely keyed by `(trip_id, program_id, is_estimate)`
  so a trip can hold both an estimate and an actual for the same program.
- Rule edits never mutate history: `programCreateRuleVersion` demotes the prior
  `is_current` version and inserts a new one.

## Program-year windowing

Most programs use the calendar year. American AAdvantage uses a status year that
runs **Mar 1 – Feb 28/29**; January and February activity belongs to the window
that *started the previous March*. This is implemented in `programYearOf()` and
covered by boundary tests (including leap-year Feb 29).

## Status projection

`computeProjections()` computes, per active program and for the current program
year:

- **currentTotals** — actual entries (`is_estimate = 0`) on **completed** trips,
  plus all `program_year_adjustments` for that year.
- **projectedTotals** — currentTotals plus estimate entries on **planned/booked**
  trips.
- **currentTier / projectedTier** — highest tier whose requirements the
  respective totals satisfy; **nextTier** is the next tier above current.

## Seed data conversion

`scripts/convert_seed.py` parses the original spreadsheet dump
(`raw_spreadsheet_dump.json`, 14 yearly sheets) into `electron/seedTrips.json`.

- The header row is at sheet index 1; only the canonical left block (through the
  `Notes` column) is read — a right-side helper/duplicate block is ignored, and
  the "Petsitter Booked?" column is intentionally skipped.
- Each activity row becomes a trip with one entry per contributing program.
  Status = `completed` if the row's *Complete?* flag is set, else `booked` if
  *Booked?* is set, else `planned`. 2012 rows (no flag columns) are treated as
  completed.
- Rows whose first column names an adjustment (Bonus, Boost, Rollover, CC, CC
  Annual, Promotional, Feb 28 Reset) become `program_year_adjustments`.
- Reference rows (Last Hyatt/Omni/Starwood/Fairmont Stay, Virgin Atlantic
  Expiration) become `program_last_activity`.

### Metric mapping notes

The source tracked some airlines by *miles* while the current programs qualify by
*points/PQP/MQD*. To keep projections meaningful, historical values are mapped to
each program's **current qualifying metric** (e.g. Alaska → `points`, United →
`pqp`, Delta → `mqm`/`mqd`, American → `points`/`spend`). This is a pragmatic
normalization, not a claim that the historical unit equals the current one; treat
pre-2026 projections as directional.

### V1-only historical seed

`electron/seedData.ts` begins with the marker comment:

```
// V1 ONLY: ships with historical trip data pre-loaded so Ann can test immediately.
// Remove this import/call from database.ts before cutting v2.
```

To ship a clean v2 with no pre-loaded data, delete the `seedHistoricalData`
import and its call in `database.ts` (and optionally remove `seedData.ts` /
`seedTrips.json`). The seed runs exactly once, gated by the `app_meta.is_seeded`
flag.

## Packaging

- `electron-builder` with an NSIS installer (+ zip), x64.
- `scripts/afterPack.js` injects the prebuilt `better_sqlite3.node`
  (`prebuilt-win32-x64/`) into `app.asar.unpacked` — no native rebuild.
- `scripts/copy-electron-assets.js` copies `seedTrips.json` next to the compiled
  main so `require('./seedTrips.json')` resolves inside the asar.
- `build/sign.sh` code-signs the installer with `osslsigncode` using the
  self-signed certificate in `build/` (generated fresh for this app).

## Testing

Vitest, four node-environment suites:

- **security** — SQL-injection resistance, no `eval`/`new Function`, Electron
  hardening flags, CSP, navigation guards, preload surface, path-traversal guard.
- **validation** — required fields, CHECK constraints, airport lookups, JSON
  import schema/version, export→import round-trip.
- **boundary** — zero/negative/missing metrics, AA Feb 28/29 & Mar 1 boundaries,
  leap years, empty DB, one-tier-away, very large totals.
- **functionality** — CRUD, projection correctness, airmile spot checks, seed
  row counts per program, rule-version management, quarterly due-date logic.
