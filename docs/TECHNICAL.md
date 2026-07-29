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
- (`legacy/seedData.ts` — the retired V1-only historical data loader, archived and
  no longer imported; see "Historical seed removed in v1.2" below.)

## Data model

Fourteen tables: `programs`, `program_rule_versions`, `program_tiers`, `trips`,
`trip_segments`, `trip_program_entries`, `program_year_adjustments`,
`program_last_activity`, `rule_refresh_log`, `app_meta`, the v1.1 additions
`program_lifetime_status`, `program_lifetime_mileage`, `card_earnings_entries`,
and the v1.2 addition `program_status_overrides`.

- `program_status_overrides` (`id`, `program_id`, `program_year`, `tier_name`,
  `notes?`, `created_at`, `UNIQUE(program_id, program_year)`) — a one-time,
  program-year-scoped manual override of the displayed **Current** tier (e.g. a
  purchased/gifted status or status match). Non-permanent: it applies only to its
  `program_year` and does not persist into future years. Permanent/lifetime status
  reuses `program_lifetime_status` instead (now settable for any program, not just
  Hilton). Both are validated: the tier name must belong to the program's current
  tier set.

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
- **currentStatusTier** — the tier actually displayed as "Current":
  `MAX(lifetimeFloorTier, currentYearOverrideTier, calculatedHeldTier)` by
  `tier_order`. Any of the three inputs may be absent; the result is `null` only
  when all are. A lifetime floor never drops the displayed tier below itself, and
  a current-program-year override (from `program_status_overrides`, bucketed by
  `programYearOf` so AA's Mar 1–Feb window is respected) participates in the same
  MAX. YTD and Projected are computed independently, so an override or floor never
  hides the underlying earned progress.
- **overrideTier** — the current-program-year manual override tier, if any.
- **lifetimeStatus / statusOverride / lifetimeMileage** — attached per program for display.
- **nextTier** — the next tier above the YTD tier.

`currentTotals`/`currentTier` are retained as aliases of the YTD values for
backward compatibility with v1.0.0 consumers and tests.

## Dashboard year view & trip attention lists (v1.3)

`computeProjections(db, today = new Date())` already keys the "current"
program-year off a supplied `today`. The dashboard year toggle reuses that lever
rather than adding any new projection path:

- `projection:all` (IPC) accepts an optional `viewYear?: number`. `main.ts` maps it
  through `viewYearToDate(viewYear)` before calling `computeProjections`.
- **`viewYearToDate(viewYear, now?)`** (in `rules.ts`, pure/dependency-free):
  returns the real `now` when `viewYear` is `null`/`undefined`/non-finite (so the
  default "live" view is byte-for-byte unchanged), otherwise `Date.UTC(y, 11, 31)`
  (Dec 31) with `y` truncated and clamped to `[MIN_VIEW_YEAR, MAX_VIEW_YEAR]`
  (2000–2100). Anchoring to Dec 31 makes `currentProgramYear` resolve to the
  selected year for **both** `calendar` and `aa_status_year` programs. It never
  throws on garbage input — the validation suite exercises `NaN`/`±Infinity`/
  strings/absurd magnitudes.
- The **two trip lists** are computed client-side in `Dashboard.tsx` from
  `trips.getAll()` via **`selectDashboardTrips(trips, viewYear, now)`** (also pure,
  in `rules.ts`). It filters to trips whose `start_date` **calendar** year equals
  `viewYear`, then classifies each with **`classifyTripByDate(trip, now)`** using
  the **real `now`** (never the simulated view date):
  - `completed` → `neither`.
  - `end_date ?? start_date` before today → `overdue` (feeds *Needs Update*).
  - `start_date` today-or-later → `upcoming` (feeds *Upcoming Trips*).
  - otherwise (in-progress) → `neither`.
  `needsUpdate` sorts oldest-first, `upcoming` soonest-first. This is the core
  invariant: **the real current date drives overdue/upcoming; `viewYear` drives
  only the calendar-year filter and the projection calculation.**
- The selected year is persisted in the URL `?year=` param via `useSearchParams`;
  the client clamps it to `[realCurrentYear−1, realCurrentYear+1]` for the toggle
  and passes `undefined` (not the year) when viewing the live current year.
- Both lists reuse the existing Trips `?edit=<tripId>` deep link — no new endpoint.

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

### Historical seed removed in v1.2

The V1 convenience seed (historical trips/adjustments/last-activity) is no longer
loaded. `seedData.ts`, `seedTrips.json`, and `seedCounts.json` have been moved to
the top-level `legacy/` folder and are not imported by any active code path;
`scripts/convert_seed.py` is retained only for regenerating that archived data.

`seedIfFresh()` in `database.ts` now seeds **only** the reference/rules dataset
(programs, tier rule versions, the Hilton lifetime-Diamond row, and the Delta
Million Miler baseline). It runs exactly once, gated by `app_meta.is_seeded`,
which now means "reference/rules data has been seeded." Because the gate
short-circuits on any database that already has the flag set, existing v1.0/v1.1
databases are never re-seeded or migrated — their user data is fully preserved.
A brand-new database therefore starts with zero trips.

## Packaging

- `electron-builder` with an NSIS installer (+ zip), x64. Build the Windows
  targets explicitly with `npx electron-builder --config electron-builder.config.js --win`
  (electron-builder otherwise defaults to the host platform).
- `scripts/afterPack.js` injects the prebuilt `better_sqlite3.node`
  (`prebuilt-win32-x64/`) into `app.asar.unpacked` — no native rebuild.
- `scripts/copy-electron-assets.js` copies any runtime JSON assets next to the
  compiled main inside the asar. As of v1.2 there are none (the historical seed
  JSON was removed from the active build), but the hook is retained for future use.
- `build/sign.sh` code-signs the installer with `osslsigncode` using the
  self-signed certificate in `build/` (generated fresh for this app).

### Application icon resolution (v1.4)

Windows shows two conceptually different icons: the **file** icon Explorer paints
for the `.exe` (embedded resource, set by electron-builder's `win.icon`) and the
**running-app/taskbar/window** icon (set by the `BrowserWindow` `icon` option). The
former was always correct; the latter fell back to Electron's default because
`createWindow()` passed no `icon`. v1.4 wires up the running-app icon:

- **`electron/iconPath.ts`** — a pure, Electron-free resolver
  (`resolveIconPath({ isPackaged, resourcesPath, dirname })`). In dev the compiled
  main sits at `electron/dist/main.js`, so the repo `assets/` folder is two levels
  up (`../../assets/icon.ico`). When packaged the icon ships in the app's
  `resources/assets/` (see below), resolved via `process.resourcesPath`. The
  filename is a hard-coded constant (`ICON_FILE = 'icon.ico'`) — no user/renderer
  input ever participates, and `iconPathWithinAssets()` asserts the result stays
  inside the assets directory. Both are unit-tested in the security suite.
- **`electron/main.ts`** — `appIconPath()` feeds `app.isPackaged`,
  `process.resourcesPath`, and `__dirname` into the resolver and passes the result
  as the `BrowserWindow` `icon` option. On Windows,
  `app.setAppUserModelId('com.dunkinglobal.elitestatustracker')` (matching the
  electron-builder `appId`) runs at the very start of `whenReady`, before the
  window is created, so the taskbar associates the process — including pinned
  shortcuts and window grouping — with the app's own identity rather than the
  generic Electron one.
- **`electron-builder.config.js`** — an `extraResources` entry
  (`{ from: "assets", to: "assets" }`) copies the icon artwork into the packaged
  app's `resources/assets/` so the file physically exists at runtime (the installer
  header's own icon is not readable by the running process). `win.icon` and
  `signAndEditExecutable: false` are unchanged; the signing pipeline is untouched.
- **Windows icon cache**: because Windows aggressively caches shell icons by
  path/hash, upgrading from a pre-v1.4 install (single-size or missing icon) may
  keep showing the stale icon even after the new build is installed. If this
  happens: uninstall the previous version, delete
  `%LOCALAPPDATA%\IconCache.db` (or run `ie4uinit.exe -show` to force an icon
  cache rebuild), reinstall, then reboot (or at minimum restart Explorer).

### Startup data migrations & metric derivation (v1.5)

v1.5 introduces an idempotent startup migration pipeline plus two auto-derived
metrics, all in `electron/database.ts`:

- **`applyDataMigrations(db)`** runs on every `openDatabaseAt(...)` call, after
  `seedIfFresh`, and is safe to call repeatedly. It runs, in order:
  1. `ensureLifetimeMileageRows(db)` — `INSERT OR IGNORE`s any `SEED_LIFETIME_MILEAGE`
     row that's missing (e.g. the Delta Million Miler baseline), never
     overwriting an existing row.
  2. `ensureDeltaMetricKeys(db)` / `ensureAaMetricKeys(db)` — rewrite
     `programs.metric_keys` for `dl`/`aa` to drop the retired `mqm`/`spend` keys
     if still present.
  3. `stripDeltaMqmValues(db)` / `stripAaSpendValues(db)` — remove any leftover
     `mqm`/`spend` key from stored `trip_program_entries`/`program_year_adjustments`
     JSON for `dl`/`aa` respectively; other programs (including Hilton's and
     Marriott's own `spend` metric) are untouched.
  4. `deleteDelta2026AdjustmentsOnce(db)` — one-time cleanup of 2026 Delta
     adjustments entered under the old MQM-inclusive rules, gated by an
     `app_meta` key (`delta_2026_adjustments_cleared`) so it never re-runs.
  5. (v1.6) `stripDerivableZeroMetricsOnce(db)` — deletes the `mqd` key from `dl`
     `trip_program_entries` and the `points` key from `aa` ones wherever the
     stored value is `0` or `null`, so segment-cost derivation takes over. Gated
     by `app_meta.derivable_zeros_stripped` so it runs exactly once: a zero the
     user records *after* the migration is a deliberate value and is preserved.
     Only `trip_program_entries` is swept — `program_year_adjustments` have no
     segments to derive from, so a zero there is meaningful.
  6. (v1.6) `normalizeSegmentProgramIds(db)` — rewrites `trip_segments.program_id`
     of `''` to `NULL`. Both read as "untagged" everywhere, but `''` violates the
     column's `REFERENCES programs(id)` constraint. Idempotent.
  Each step returns a count/boolean folded into a `DataMigrationsSummary` that
  `main.ts` logs via `logError()` on every launch.
- **`deriveSegmentCost(segments, programId)`** (exported) is the single rule both
  derivations use to decide which segment costs belong to a program: sum
  `cost_usd` across segments explicitly tagged with `programId`, or — when none
  are tagged for it — across the trip's *untagged* segments. The two candidate
  sets are disjoint on `program_id`, so a tagged itinerary can never credit one
  dollar to two programs, while an untagged one behaves exactly as it did before
  v1.6 (which is what keeps historical trips intact). `src/lib/metricLabels.ts`
  carries a renderer-safe mirror, `segmentCostForProgram`, so the Trip editor's
  previews match the stored result; keep the two in sync.
- **Delta MQD derivation**: inside `computeProjections`'s trip/entry loop, if
  `program.id === 'dl'` and the entry's `metric_values.mqd` is `undefined` or
  `null`, `deriveSegmentCost(trip.segments, 'dl')` becomes the MQD value ($1 =
  1 MQD). An explicit `mqd` — including an explicit `0` — always wins.
- **AA LP derivation**: because the multiplier depends on the tier held
  *entering* the current AA status year — which itself depends on prior-year
  totals — `computeProjections` first buckets every program's actual/estimate
  metrics using only explicitly-entered values (as before), resolves
  `heldTier`/`lifetimeStatus`/`statusOverride`/`currentStatusTier` from that raw
  data, and only then (for `program.id === 'aa'` alone) re-derives the current
  program-year's totals: any AA entry with `metric_values.points === undefined`
  gets `points = Math.round(segmentCosts * statusMultiplierForAA(currentStatusTier))`.
  `statusMultiplierForAA` is exported from `electron/database.ts` (5x/7x/8x/9x/11x
  for no-status/Gold/Platinum/Platinum Pro/Executive Platinum); a renderer-safe
  duplicate, `statusMultiplierForAAPreview`, lives in `src/lib/metricLabels.ts`
  for the Trip editor's convenience pre-fill only, so the browser bundle never
  imports `electron/database.ts` (which pulls in `better-sqlite3`/Node builtins).
- **Display-only metric renaming**: `displayMetricKey(programId, key)` in
  `src/lib/metricLabels.ts` maps AA's stored `points` key to the label "LPs"
  wherever metric totals or tier requirements are rendered
  (`Dashboard.tsx`, `ProgramDetail.tsx`, `Trips.tsx`); no other program or
  storage key is affected.
- **Adjustment delete**: `adjustmentDelete(db, id)` and
  `adjustmentsDeleteForProgramYear(db, programId, year)` (both parameterized
  queries) back the `adjustments:delete` / `adjustments:deleteForProgramYear`
  IPC channels and the Program Detail page's per-row **Delete** button.
- **`null` treated like `undefined` in AA derivation**: `mv.points === null`
  (which can arise from a portable-file JSON export/import round-trip turning a
  genuinely-absent key into a stored `null`) is now guarded alongside
  `mv.points === undefined` in `deriveForTrip`'s skip check, so it correctly
  falls through to the segment-cost auto-calc instead of silently contributing
  zero LPs. An explicit `0` is unaffected and still short-circuits derivation.
  (v1.6) The Delta branch now applies the same `undefined || null` guard, so the
  two derivations agree on what "absent" means.
- **Per-segment program tagging (v1.6)**: `trip_segments.program_id` has existed
  since v1.0 but had no UI, so every segment the editor produced was `NULL` and
  `deriveSegmentCost` always took its untagged fallback — correct for a
  single-program trip, but double-crediting a mixed-program one. `Trips.tsx` now
  renders a Program `<select>` per segment row (blank `—` = untagged) and
  pre-selects the trip's program when the trip's entries name exactly one
  *distinct* `program_id` (a program may appear twice, as an estimate and an
  actual, so the entry count alone is not a safe signal). Existing segments are
  never auto-retagged; an inline hint appears instead when the trip credits
  `dl`/`aa` and some priced segment is untagged. `writeEntriesAndSegments` stores
  `s.program_id || null`; an unknown non-empty id is rejected by the foreign key,
  and since trip writes are transactional the whole trip rolls back.
- **Clearing a metric input removes the key (v1.6)**: `withMetricValue` in
  `Trips.tsx` deletes the metric key when the input is emptied, instead of storing
  `Number('') === 0`. A stored `0` reads as an explicit user value and permanently
  suppresses MQD/LP derivation — the bug behind "I have to add the MQDs manually".
- **`metricSourceBreakdown`**: `computeProjections` tracks each current
  program-year metric map's origin (trip / adjustment / card earning)
  separately as it buckets the raw pass, and — for AA — substitutes the derived
  trip values (`aaDerivedTripActuals`) so the breakdown always reconciles
  exactly to `ytdTotals`. Surfaced on `ProgramProjection.metricSourceBreakdown`
  and rendered as a per-metric trips/adjustments/card-earnings/total table on
  the Program Detail page, to make source-of-truth discrepancies auditable
  without needing to inspect the database directly.

## Testing

Vitest, node-environment suites:

- **security** — SQL-injection resistance, no `eval`/`new Function`, Electron
  hardening flags, CSP, navigation guards, preload surface, path-traversal guard,
  icon-path resolution (v1.4): the `BrowserWindow` icon option and
  `setAppUserModelId` wiring, the fixed-constant icon path, dev/packaged
  containment within the assets directory, and a regression assertion that the
  dashboard panel reorder adds no IPC/data-access surface; and (v1.5) ICO
  container/multi-size validation for `assets/icon.ico`, plus parameterized-query
  coverage for `adjustmentDelete`/`adjustmentsDeleteForProgramYear`.
- **validation** — required fields, CHECK constraints, airport lookups, JSON
  import schema/version, export→import round-trip.
- **boundary** — zero/negative/missing metrics, AA Feb 28/29 & Mar 1 boundaries,
  leap years, empty DB, one-tier-away, very large totals, `classifyTripByDate`
  edge dates (day-before/on/day-after today, in-progress, `end_date`-driven),
  `viewYearToDate` clamping (min/max/fractional/Dec-31 mapping), and (v1.5)
  non-existent-id and no-match cases for adjustment deletion.
- **functionality** — CRUD, projection correctness, airmile spot checks,
  fresh-DB seeding (reference/rules present, zero historical trips),
  non-destructive re-seed of an existing populated DB, rule-version management,
  quarterly due-date logic, card-earnings CRUD + YTD/Projected wiring,
  lifetime-status floor, three-part status separation, Delta lifetime-mileage
  accrual, Marriott/Hyatt rule confirmation, MAX-precedence current-tier
  resolution across all present/absent combinations, the AA Executive
  Platinum permanent-lifetime regression fixture, the v1.3 dashboard year-view
  (synthetic `today` projection for both year types incl. an AA status-year
  boundary crossing; `selectDashboardTrips` restricting to the selected calendar
  year while classifying against the real `now`; the "viewing next year → future
  trip is upcoming not overdue" case and its last-year mirror; legitimately-empty
  sections), (v1.5) all four Delta/AA startup migration helpers, Delta MQD
  and AA LP auto-derivation in `computeProjections` (explicit-value overrides,
  estimate/actual bucketing, all five AA earning-rate tiers), and
  `adjustmentDelete`/`adjustmentsDeleteForProgramYear` CRUD, plus the AA
  `null`-vs-`undefined` derivation guard, explicit-zero and
  explicit-wins-over-larger-derived cases, and `metricSourceBreakdown`
  reconciliation for both AA and Delta.

- **segment-program-tagging** (v1.6) — per-segment program tagging end to end:
  tagged segments crediting the right program, a mixed Delta + AA trip splitting
  $400/$600 with no double-counting, untagged back-compat, a tagged segment
  suppressing its untagged siblings, explicit and `null` value precedence, award
  tickets with no cost, `deriveSegmentCost` directly, `stripDerivableZeroMetricsOnce`
  including its run-once gate, and segment `program_id` referential integrity
  (unknown id rejected by the foreign key and the trip write rolled back; `''`
  normalized to `NULL`).

198 tests total (61 from v1.0.0, 22 for v1.1, 19 for v1.2, 23 for v1.3, 8 for v1.4,
29 for v1.5, 16 for v1.5.1, 20 for v1.6), all passing. The security suite is 28
tests (24 through v1.4 + 4 icon-container/adjustment-delete tests in v1.5).

The portable JSON payload is at `APP_FILE_VERSION = 3` (adds `status_overrides`).
