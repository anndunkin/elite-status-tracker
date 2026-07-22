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
- **programsSeed.ts** — the eight programs plus lapsed ones, the 2026 tier
  rules with source citations, and the v1.1 lifetime-status / lifetime-mileage
  seeds (Hilton lifetime Diamond; Delta Million Miler baseline).
- **airports.ts** — curated IATA reference and haversine distance.
- **seedData.ts** — **V1-only** historical data loader (see below).

## Data model

Thirteen tables: `programs`, `program_rule_versions`, `program_tiers`, `trips`,
`trip_segments`, `trip_program_entries`, `program_year_adjustments`,
`program_last_activity`, `rule_refresh_log`, `app_meta`, and the v1.1 additions
`program_lifetime_status`, `program_lifetime_mileage`, `card_earnings_entries`.

- `program_lifetime_status` (`program_id` PK, `tier_name`, `achieved_date?`,
  `notes?`) — a generic lifetime/permanent tier that floors the displayed current
  status. Seeded with Hilton (`hh`) → Diamond.
- `program_lifetime_mileage` (`program_id` PK, `baseline_miles`, `baseline_date`,
  `milestones` JSON) — cumulative lifetime mileage tracking. Seeded with Delta
  (`dl`) at 2,032,832 miles as of 2026-07-01 with 1M/2M/3M/5M milestones. Current
  miles = baseline + `SUM(distance_miles)` of completed segments for that program
  dated strictly after `baseline_date`.
- `card_earnings_entries` (`id`, `program_id`, `entry_date`, `metric_key`,
  `amount` REAL, `notes?`, `created_at`) — manually logged credit-card elite
  credits, bucketed into a program-year by `entry_date`.

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

`computeProjections()` buckets every actual/estimate metric map by the
program-year it belongs to (trips by `start_date`, adjustments by
`program_year`, card earnings by `entry_date`) and computes, per active program:

- **ytdTotals / ytdTier** — actual entries (`is_estimate = 0`) on **completed**
  trips, plus `program_year_adjustments` and card earnings, in the **current**
  program-year.
- **projectedTotals / projectedTier** — ytdTotals plus estimate entries on
  **planned/booked** trips in the current year.
- **heldTier / heldFromYear / heldTotals** — the tier carried over from the most
  recent **completed** (prior) program-year with activity.
- **currentStatusTier** — the tier actually held now: `MAX(heldTier, lifetimeTier)`
  by `tier_order`, so it never drops below a lifetime status (e.g. Hilton lifetime
  Diamond). Falls back gracefully to `heldTier`, then `null`, when data is absent.
- **lifetimeStatus / lifetimeMileage** — attached per program for display.
- **nextTier** — the next tier above the YTD tier.

`currentTotals`/`currentTier` are retained as aliases of the YTD values for
backward compatibility with v1.0.0 consumers and tests.

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

- `electron-builder` with an NSIS installer (+ zip), x64. Build the Windows
  targets explicitly with `npx electron-builder --config electron-builder.config.js --win`
  (electron-builder otherwise defaults to the host platform).
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
  row counts per program, rule-version management, quarterly due-date logic,
  card-earnings CRUD + YTD/Projected wiring, lifetime-status floor, three-part
  status separation, Delta lifetime-mileage accrual, Marriott/Hyatt rule
  confirmation.

83 tests total (61 from v1.0.0 plus 22 for v1.1), all passing.
