# Changelog

All notable changes to Elite Status Tracker are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.6.1] — 2026-08-13

### Changed
- Completed a full dependency modernization: Electron 43.4.0 and
  electron-builder 26.15.3, React / React DOM 19.2.8, React Router 7.18.2,
  Vite 8.2.1, Vitest 4.1.10, Tailwind CSS 4.3.3, TypeScript 7.0.2, and the
  current compatible versions of the testing libraries, Vite React plugin,
  type packages, PostCSS tooling, concurrently, and wait-on.
- Migrated Vite configuration to native ESM and Rolldown options; updated
  TypeScript resolution/types configuration for TypeScript 7; and migrated
  Tailwind's PostCSS integration and stylesheet directives/utilities for
  Tailwind 4.
- Replaced Vitest's removed `environmentMatchGlobs` option with explicit Node
  environment directives on the database/security suites and confined test
  discovery to `tests/`.

### Compatibility notes
- `better-sqlite3` is intentionally on 12.11.1: version 13.x segfaults in the
  current sandbox.
- `jsdom` is intentionally on 29.1.1, the newest Node 20-compatible release.
  jsdom 30 requires Node 22.22.2 or later.

### Validation
- Full Vitest suite: **198/198 passing** across six test files.
- Production renderer/Electron build and both TypeScript project checks pass.
- The `keyv@4.5.4` and `cacheable-request@7.0.4` security overrides were
  re-verified after installation.

## [1.6.0] — 2026-07-29

### Added
- **Per-segment Program tagging in the trip editor.** Each row under *Flight
  segments* now has a **Program** dropdown listing the active programs, plus a
  blank `—` option meaning "untagged". This is the missing piece that made Delta
  MQD / AA Loyalty Point auto-calculation feel broken: the segment editor had
  never had a program picker, so every segment it created was saved with an empty
  `program_id` and the derivation had to guess from the trip's program credit.
  - New segments are pre-tagged from the trip's own program entries: exactly one
    distinct program → pre-selected; several → blank, so the user picks which one
    earns the cost; none yet → blank. (A program can appear twice among the
    entries — once as an estimate, once as an actual — so the check is on the
    distinct set of program ids, not the entry count.)
  - Existing segments are never silently retagged when a program entry changes.
    An inline hint appears instead, and only when it would change an outcome: the
    trip credits Delta or AA *and* some priced segment is still untagged.
  - The Delta helper text now shows the running derived total ("Currently 500
    MQDs.") so the auto-calc is visibly working rather than being inferred from
    an empty input.

### Fixed
- **Mixed-program trips double-credited segment cost.** With no way to tag
  segments, a trip carrying both a Delta and an American credit fell through to
  `deriveSegmentCost`'s untagged fallback for *both* programs, so the same
  dollars counted toward MQDs and Loyalty Points. Tagging makes the split
  explicit; the tagged and untagged candidate sets are disjoint, so a tagged
  itinerary can no longer credit one dollar twice.
- **Clearing a metric input pinned the value to zero.** The trip editor stored
  `Number('') === 0` when a number field was emptied, and a stored `0` reads as
  "the user explicitly entered zero", permanently suppressing derivation from
  segment cost. Clearing a field now removes the key entirely, letting the
  auto-calc resume. This is the most likely reason MQDs/LPs had to be re-entered
  by hand after being blanked out once.
- **A stored `null` MQD no longer suppresses Delta derivation.** The Delta branch
  of `computeProjections` only treated `undefined` as absent, while the AA branch
  correctly treated both `undefined` and `null` that way. A portable-file
  export/import round-trip can turn a genuinely-absent key into a stored `null`,
  which silently switched Delta auto-calc off. Both branches now agree: only a
  real user-entered number (including an explicit `0`) wins over derivation.
- **AA Loyalty Point pre-fill preview always read 0.** The trip editor's LP
  pre-fill summed only segments explicitly tagged `aa` — of which the editor
  could never produce any — instead of applying the backend's tagged-preferred /
  untagged-fallback rule. Preview and stored value now use the same rule, via a
  shared `segmentCostForProgram` helper in `src/lib/metricLabels.ts`.
- **Empty-string segment `program_id` is normalized to SQL `NULL` on write.**
  Both read as "untagged" throughout the app, but `''` violates the
  `program_id TEXT REFERENCES programs(id)` foreign key and would surface as a
  write error. A segment tagged with a program id that does *not* exist is still
  rejected by that constraint, and because trip writes are transactional the
  whole trip rolls back rather than silently dropping the tag.

### Migrations
Both run at startup from `applyDataMigrations` and are reported in
`DataMigrationsSummary` for the app error log.
- **`stripDerivableZeroMetricsOnce`** — deletes the `mqd` key from Delta
  `trip_program_entries` and the `points` key from American ones wherever the
  stored value is `0` or `null`, so derivation from segment cost takes over.
  Gated by `app_meta.derivable_zeros_stripped` so it runs **exactly once** — a
  zero the user deliberately records afterwards is respected. Only
  `trip_program_entries` is swept; `program_year_adjustments` have no segments to
  derive from, so a zero there is meaningful and is left alone.
- **`normalizeSegmentProgramIds`** — rewrites any `trip_segments.program_id` of
  `''` to `NULL`. Idempotent, runs unconditionally.

No schema change: `trip_segments.program_id` has existed since v1.0, it simply
had no way to be set from the UI.

### Tests
- New `tests/segment-program-tagging.test.ts` (20 tests): tagged-segment
  derivation, a mixed Delta + AA trip splitting $400/$600 with no
  double-counting, untagged back-compat, explicit and `null` value precedence,
  award tickets with no cost, the `deriveSegmentCost` helper directly, the
  one-time migration and its run-once gate, and segment `program_id` referential
  integrity. Suite total 198, all passing.

## [1.5.1] — 2026-07-27

### Fixed
- **Delta Million Miler lifetime-mileage accrual bug.** The Lifetime Mileage /
  Million Miler card on the Delta program-detail page was showing 0 miles
  flown on completed segments since baseline, even for trips with a Delta
  program credit and completed flight segments (e.g. Ann's "DC" trip,
  2026-07-23, two segments ATL-DCA and DCA-ATL at 547 mi each = 1,094 mi
  total). Root cause: `accruedLifetimeMiles` in `electron/database.ts`
  filtered on the SEGMENT's own `program_id`, but the Trips.tsx segment editor
  has no per-segment program picker — new segments are always saved with an
  empty `program_id`, so they never matched. The query now credits a segment
  toward a program's lifetime mileage if EITHER the segment is explicitly
  tagged with that program, OR the segment is untagged and its trip carries a
  program-credit entry (`trip_program_entries`) for that program — matching
  the same fallback pattern already used successfully by the Delta MQD/AA LP
  segment-cost auto-calc. An `EXISTS` subquery (rather than a `JOIN`) ensures
  segments are never double-counted even if a trip somehow carries more than
  one program-credit row for the same program (e.g. an estimate row alongside
  an actual row).
- **Delta MQD and AA Loyalty Points segment-cost auto-calc** in
  `computeProjections` had the identical segment-`program_id` filtering bug
  (it happened to still "work" for MQD/LP display because most test/seed data
  tagged segments explicitly, but silently under-counted real untagged
  segments in some code paths). Both now use a shared `deriveSegmentCost`
  helper: sum `cost_usd` across segments explicitly tagged for the program if
  any exist, otherwise sum across ALL of the trip's segments. This avoids
  double-crediting cost on a mixed-itinerary trip (some segments explicitly
  tagged for a different program) while correctly handling the common
  untagged-segment case.

### Changed
- **Contributing Trips table (Delta program-detail page) now shows MM miles
  earned alongside MQDs.** Each Delta row's metrics column now reads e.g.
  `402 mqd · +1,094 mm` — the `+N mm` suffix (Million Miler miles earned from
  that trip's Delta segments, using the same tagged/untagged fallback as the
  MQD auto-calc) is appended only when greater than zero. Non-Delta programs
  are unaffected.
- **Removed the redundant "Fare" input from the trip segment editor**
  (Trips.tsx). The Cost $ field already captures what's needed for MQD/LP
  auto-calc, and the free-text Fare field was unused elsewhere in the app. The
  underlying `fare_class` column is kept on `trip_segments` for backward
  compatibility with existing data — it is simply no longer rendered, tracked
  in form state, or written to on save (writes `null` going forward).

### Tests
- 8 new tests covering the Million Miler accrual fix (untagged vs. explicitly
  tagged segments, no double-counting across multiple program-credit rows,
  cross-program isolation), the Delta MQD / AA LP auto-calc fix (untagged vs.
  tagged segments, mixed-itinerary isolation), and the Contributing Trips
  `+N mm` display (present when miles > 0, absent when 0, explicit-mqd
  override, non-Delta unaffected).
- Full suite: **178/178 passing** (up from 162/162 in v1.5.0).

## [1.5.0] — 2026-07-27

### Changed
- **Delta SkyMiles MQDs are now auto-calculated from flight segment cost** ($1
  spent = 1 MQD), instead of being a manually-typed metric. Add flight segments
  with a **Cost** value on a trip and the Delta program-credit entry derives its
  MQD total automatically at projection time; entering an explicit MQD value on
  the entry still overrides the auto-calc for cases where the posted MQD differs
  from raw spend (e.g. promotions). The Trip editor's Delta entry now hides the
  old manual MQD field and shows a helper line explaining the auto-calc.
- **Delta MQMs (Medallion Qualification Miles) have been dropped entirely.**
  Delta retired MQMs as a qualification metric, so `mqm` is no longer one of
  Delta's tracked metrics — only `mqd` remains. A one-time startup migration
  rewrites any database that still lists `mqm` in Delta's metric keys, strips any
  stored `mqm` values from existing Delta trip entries and adjustments, and
  (once, gated so it never repeats) clears out any 2026 Delta adjustments that
  were entered under the old MQM-inclusive rules.
- **American AAdvantage now tracks Loyalty Points (LPs) only** — the vestigial
  `spend` metric has been removed from AA's tracked metrics, matching how AA
  actually measures status today. The UI now labels AA's underlying `points`
  metric as **"LPs"** everywhere it is displayed (dashboard cards, tier
  requirements, program detail, trip entries, adjustments); the metric is still
  stored under the historical `points` key internally so existing data is
  unaffected.
- **AA Loyalty Points are now auto-calculated from flight segment cost**, using
  the earning multiplier for the AA elite tier you hold entering the current
  status year: 5x with no status, 7x Gold, 8x Platinum, 9x Platinum Pro, 11x
  Executive Platinum (held tier is the highest of your resolved lifetime floor,
  a current-year manual override, or the tier you actually qualified for in the
  prior AA status year). Add flight segments with a **Cost** value and the trip
  editor pre-fills an estimated LP value; enter the posted LP amount manually
  after the trip completes for an exact figure — an explicit value always wins
  over the auto-calc.
- A one-time startup migration rewrites any database that still lists `spend` in
  AA's metric keys down to `["points"]`, and strips any stored `spend` values
  from existing AA trip entries and adjustments (Hilton's and Marriott's own
  `spend` metrics are untouched — the migration is scoped to `program_id='aa'`
  only).

### Added
- **Delete adjustments.** The Program Detail page's "Year adjustments" table now
  has a **Delete** button (with a confirmation prompt) on every row, backed by a
  new `adjustments:delete` IPC channel and `adjustmentDelete()` data-layer
  function. A companion `adjustmentsDeleteForProgramYear()` bulk-delete function
  (and `adjustments:deleteForProgramYear` IPC channel) supports clearing all of a
  program's adjustments for a given program-year in one call — used internally by
  the one-time Delta 2026 cleanup migration described above.
- **Startup data-migration pipeline.** `applyDataMigrations()` now runs on every
  app launch (after the existing fresh-install seed step) and is fully additive
  and idempotent: it tops up any missing Delta Million Miler lifetime-mileage
  baseline row without ever overwriting one you already have, fixes Delta's and
  AA's metric-key lists if they still contain the retired `mqm`/`spend` keys,
  strips any leftover `mqm`/`spend` values out of stored entries and adjustments,
  and runs the one-time 2026 Delta adjustment cleanup — each step logs a summary
  count so you can see exactly what (if anything) changed on next launch.

### Documentation
- Updated `README.md`, `docs/USER_GUIDE.md`, and `docs/TECHNICAL.md` to describe
  Delta's MQD auto-calc and MQM removal, AA's LP auto-calc and `spend` removal,
  the adjustment-delete UI, and the new startup data-migration pipeline. Reiterated
  the multi-size app icon and Windows icon-cache reset steps (uninstall the
  previous version, delete `%LOCALAPPDATA%\IconCache.db` or run
  `ie4uinit.exe -show`, reinstall, reboot) since the icon fix from v1.4.0 only
  takes full effect after Windows' icon cache is cleared.

### Fixed
- **AA Loyalty Points: `null` metric values no longer silently drop LPs.** A
  trip entry whose `points` value was stored as `null` (rather than genuinely
  absent/`undefined` — this can happen after a portable-file JSON export/import
  round-trip) was being treated as "explicitly entered" and skipped the
  auto-calc entirely, silently zeroing out that trip's LP contribution. `null`
  is now treated exactly like `undefined`: the auto-calc still fires from
  segment cost. An explicit `0` is still honored as a real value and does not
  trigger the auto-calc.
- **Investigated a user report of AA LPs totaling ~34,000 versus an expected
  ~27,000 (~26% high).** A full audit of the trip / adjustment / card-earnings
  paths in `computeProjections` did not reproduce a double-count: each source is
  bucketed exactly once, the AA-specific rebuild fully replaces (rather than
  adds to) the raw pass for the current program-year, and an explicit `points`
  value always wins over the auto-calc, including alongside segment cost that
  would otherwise derive a larger number. No code path was found that inflates
  the total for well-formed data. To help pinpoint the discrepancy, every
  program's Program Detail page now shows a **per-source breakdown** (see
  "Added" below) so a total can be reconciled line-by-line against its trips,
  adjustments, and card earnings.

### Added
- **Metric source breakdown.** The Program Detail page now shows, for the
  current program-year, how much of each tracked metric came from **trips**,
  **year adjustments**, and **credit-card earnings** — with a total column that
  reconciles exactly to the displayed Year-to-date figure. For AA and Delta the
  Trips column reflects the auto-calculated LP/MQD value, not just
  manually-entered ones, so you can see precisely where an unexpectedly high or
  low total is coming from (e.g. a trip's auto-calc plus a separate card-earning
  entry logged for the same activity).

### Testing
- Extended `tests/functionality.test.ts` with coverage for all four v1.5
  migration helpers (`ensureLifetimeMileageRows`, `ensureDeltaMetricKeys`,
  `stripDeltaMqmValues`, `deleteDelta2026AdjustmentsOnce`, plus their AA
  counterparts `ensureAaMetricKeys`/`stripAaSpendValues`), Delta MQD and AA LP
  auto-derivation in `computeProjections` (including explicit-value overrides,
  estimate-vs-actual bucketing, and all five AA earning-rate tiers),
  `adjustmentDelete`/`adjustmentsDeleteForProgramYear` CRUD behavior, and
  the `null`-vs-`undefined` AA points guard, explicit-zero non-derivation, an
  explicit-value-wins-over-larger-derived-value case, and `metricSourceBreakdown`
  reconciliation for both AA and Delta. `tests/security.test.ts` gained
  ICO-container validation for the multi-size app icon and SQL-injection
  coverage for the new adjustment-delete queries. `tests/validation.test.ts` and
  `tests/boundary.test.ts` gained negative-id and not-found deletion cases. Full
  suite grew from 133 to 162, all passing.

## [1.4.0] — 2026-07-22

### Changed
- **Dashboard layout reorder.** The **program-status cards** are now the first
  thing you see under the year toggle; the **"Needs Update"** and **"Upcoming
  Trips"** panels have moved to *below* the card grid. The year toggle and the
  off-year banner are unchanged and still apply to the whole page. This is a
  presentation-only change — no data, projection, or trip-classification logic was
  touched.

### Fixed
- **Custom app icon now shows on the running app, its window, and the Windows
  taskbar** — not just on the installer and desktop shortcut. The root cause was
  that `createWindow()` never passed an `icon` option to Electron's
  `BrowserWindow`, so Windows fell back to the default Electron icon once the app
  was running. The window now receives a correctly resolved icon path (dev vs.
  packaged), the `assets/` folder ships into the packaged app's `resources/` via
  electron-builder `extraResources`, and `app.setAppUserModelId(...)` is set early
  on Windows so the taskbar associates the process with the app's own identity.

### Documentation
- Audited and refreshed `README.md`, `docs/USER_GUIDE.md`, and `docs/TECHNICAL.md`
  for accumulated drift across v1.1–v1.4 (three-part status, card earnings, manual
  status overrides, generalized lifetime status, Delta Million Miler, the v1.3
  year toggle / trip panels, and the current dashboard ordering), and documented
  the new icon-resolution/packaging mechanism.

### Testing
- Extended `tests/security.test.ts` with icon-path-resolution coverage
  (fixed-constant path, dev/packaged containment within the assets directory, no
  attacker-controlled input, `BrowserWindow` icon option + `setAppUserModelId`
  wiring) and a regression note that the dashboard reorder adds no IPC/data-access
  surface. Security suite grew from 16 to 24 tests; full suite 125 → 133, all
  passing.

## [1.3.0] — 2026-07-22

### Added
- **Dashboard "Needs Update" section.** Surfaces past trips that are still marked
  *planned* or *booked* even though their dates have passed — the trips you most
  likely need to mark complete (or adjust). Sorted oldest-first, each with an
  **Edit** action that jumps straight to that trip in the Trips editor. When there
  is nothing to reconcile, a small "All past trips are up to date" confirmation is
  shown instead of an empty panel.
- **Dashboard "Upcoming Trips" section.** Lists planned/booked trips still to come,
  soonest-first, with a status badge distinguishing *planned* from *booked* and the
  same one-click **Edit** action.
- **Dashboard year toggle.** A segmented control offers *last year*, *this year
  (default)*, and *next year*, labelled with the real calendar years. Selecting a
  year re-runs the entire dashboard — both the program-status cards and the two
  trip sections — as if viewed from that year, and the choice is remembered in the
  URL (`?year=`) so it survives navigation. A banner appears when you are not
  viewing the live current year.
  - **Projections** for the chosen year are computed as if today were Dec 31 of
    that year, so the current program-year resolves correctly for both calendar
    and AA (Mar 1–Feb) status-year programs.
  - **The "Needs Update" and "Upcoming" classifications always use today's real
    date** — only the calendar-year filter and the projection math shift with the
    selected year. Viewing *next year* correctly shows a not-yet-happened trip as
    *upcoming* rather than *overdue*; the mirror holds for *last year*.

## [1.2.0] — 2026-07-22

### Changed
- **Fresh installs now start with an empty trip history.** The V1 convenience
  seed (2012–2025 historical trips, adjustments, and last-activity markers) is no
  longer loaded into new databases — a brand-new tracker is a blank slate ready
  for real use. The app still seeds current program rules and reference data
  (the eight active programs plus lapsed ones, 2026 tier rules, Hilton lifetime
  Diamond, and the Delta Million Miler baseline) on every fresh database.
  - This change affects **new/never-before-opened databases only**. Opening an
    existing v1.0/v1.1 database preserves all of its trips, entries, card
    earnings, and adjustments — the seed gate (`app_meta.is_seeded`) short-circuits
    on any already-seeded file, so nothing is deleted or migrated destructively.
  - The historical seed source (`seedData.ts` / `seedTrips.json` /
    `seedCounts.json`) has been moved to a top-level `legacy/` folder for
    reference and is no longer imported by any active code path.

### Added
- **Manual status editing for any program**, from the Program Detail page's new
  **Edit Status** control:
  - **Status override** — directly set/correct the displayed **Current** tier for
    a program (e.g. a purchased/gifted status, status match, or challenge not
    captured by tracked earning activity). A plain override applies to the
    **current program-year only** (respecting the AA Mar 1–Feb window) and reverts
    to the calculated earned tier next year unless renewed. Stored in a new
    `program_status_overrides` table.
  - **Permanent / lifetime status** — a checkbox on the same form promotes the
    entry to a permanent floor via the existing generic `program_lifetime_status`
    mechanism (previously exposed only for Hilton, now available for **every**
    program). It never expires and never drops the displayed Current below itself.
  - Existing overrides and lifetime status show as badges with **edit** / **clear**
    affordances.
- **Explicit, testable precedence for the displayed “Current” tier:**
  `displayedCurrentTier = MAX(lifetimeFloorTier, currentYearOverrideTier, calculatedHeldTier)`
  by tier order. Any input may be absent; Year-to-date and Projected always keep
  showing the real earned progress underneath — an override never hides your
  earned numbers.

## [1.1.0] — 2026-07-22

### Added
- **Three-part status everywhere** — Dashboard and the new Program Detail page now
  show **Current** (tier held now, from the most recently completed program-year,
  floored by any lifetime status), **Year-to-date** (actuals in the current
  program-year), and **Projected** (YTD plus planned/booked estimates).
- **Clickable Dashboard cards** open a **Program Detail** page with the full numeric
  breakdown, contributing trips (linking to trip edit), year adjustments, card-earnings
  entries, the tier table, and any lifetime badge.
- **Card Earnings screen** — manually log dated credit-card elite credits for the four
  card-earning programs (Delta MQDs, American Loyalty Points, World of Hyatt nights,
  Marriott Bonvoy nights) with full CRUD, filtering, and automatic bucketing into the
  correct program-year for YTD/Projected (AA Mar 1–Feb window respected).
- **Generic lifetime status** (`program_lifetime_status`) that floors the displayed
  current tier. Seeded with **Hilton Honors lifetime Diamond**.
- **Delta Million Miler tracking** (`program_lifetime_mileage`) toward 3,000,000 miles,
  seeded with a baseline of **2,032,832 miles as of 2026-07-01**, accruing only from
  completed Delta segments flown after the baseline. Shown on the Delta Dashboard card
  and Program Detail as a section distinct from annual Medallion status.

### Changed
- **Marriott Bonvoy Ambassador** confirmed at **100 nights AND $23,000 spend**; the
  "$23K vs $25K conflicting sources" flag has been removed.

### Known data conflicts (still flagged for quarterly review)
- **World of Hyatt Explorist** — night threshold reported as **20 vs 30** nights.
  Seeded at 30; verify and update in Manage Rules.

## [1.0.0] — 2026-07-22

### Added
- Initial release.
- Dashboard with current vs. projected tier status and next-tier progress for the
  eight tracked airline and hotel programs.
- Trips screen with per-program credit entries (estimate + actual) and flight
  segments with automatic great-circle mileage from IATA codes.
- Programs screen with tier tables, rule-version history, and last-activity for
  lapsed programs.
- Manage Rules screen: editing thresholds creates a new, versioned rule set.
- Settings: light/dark theme, portable `.db` file management (New / Open /
  Save a copy), and JSON export/import with a versioned payload.
- Quarterly rule-review reminder (banner + Settings), defaulting to three months
  after first launch.
- 2026 tier thresholds seeded for all eight active programs, each with a source
  citation.
- Pre-loaded historical trip data (V1 convenience seed) covering 2012–2025:
  423 trips, 64 program-year adjustments, and last-activity markers.

### Known data conflicts (flagged for the first quarterly review)
- **Marriott Bonvoy Ambassador** — annual spend threshold reported as **$23K vs
  $25K** across sources. Seeded at $23,000; verify and update in Manage Rules.
- **World of Hyatt Explorist** — night threshold reported as **20 vs 30** nights.
  Seeded at 30; verify and update in Manage Rules.

### Security
- `contextIsolation` on, `nodeIntegration` off, `webSecurity` on.
- Session Content-Security-Policy restricts to local resources; external
  navigation and `window.open` are routed to the system browser.
- All SQL uses parameterized statements; file dialogs validate extensions.
- Windows installer is code-signed (self-signed certificate,
  CN=Ann Dunkin, O=Dunkin Global Advisors).
