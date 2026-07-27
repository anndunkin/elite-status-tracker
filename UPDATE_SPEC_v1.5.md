# Elite Status Tracker v1.5 — Spec

Delivered: 2026-07-27
Prior: v1.4.0

## Problem statements

1. **Taskbar icon still Electron default.** After installing v1.4.0 and rebooting,
   the running window and taskbar entry still show the default Electron icon.
2. **Delta Million Miler progress bar not visible.** The dashboard Delta card
   should show a progress bar toward the next MM milestone, but it does not
   render on the installed app.
3. **Delta MQD calculation.** MQDs should be derived automatically from the
   segment cost the user enters, not typed manually.
4. **Delta MQMs are obsolete.** Delta moved to a pure MQD-only qualification
   model. `mqm` must be removed from Delta's metric_keys and rules.
5. **Delta Million Miler credit** is now driven purely by miles flown
   (segment `distance_miles`), which the app already accrues since baseline.
6. **Remove 2026 Delta adjustments.** The user has now logged the actual
   activity those adjustments were compensating for; the adjustments would
   otherwise double-count.

## Deliverables

### 1. Icon fix

- Regenerate `assets/icon.ico` as a **multi-image ICO** containing 16, 20, 24,
  32, 40, 48, 64, 96, 128, 256 pixel PNG variants. Windows picks the closest
  size for the taskbar, alt-tab, and title bar. A single-size 16/32 ICO (v1.4)
  looks blurry or falls back to the default in many contexts.
- Keep the existing `BrowserWindow({ icon })`, `app.setAppUserModelId(...)`,
  and `extraResources: assets/` wiring from v1.4 — those were correct.
- User-side: Windows caches shortcut icons aggressively. Ship a short
  instruction in the release notes: uninstall the previous version, delete
  `%LOCALAPPDATA%\IconCache.db` (or run `ie4uinit.exe -show`), reinstall, then
  reboot.

### 2. Lifetime-mileage startup top-up migration

- New helper `ensureLifetimeMileageRows(db)` called from `openDatabaseAt` after
  `initSchema` runs, on every launch:
  - For each `SEED_LIFETIME_MILEAGE` entry, `INSERT OR IGNORE` a row.
  - Existing rows are untouched (never rewrite baseline_miles/date/milestones).
- This fixes users whose DB predates the v1.4 lifetime-mileage seed or who
  imported/exported without it. Delta MM progress bar reappears.

### 3. Delta MQD auto-derivation + MQM removal

Data-model changes:

- `SEED_PROGRAMS` for `dl`: change `metric_keys` from `['mqd', 'mqm']` to
  `['mqd']`.
- Add a startup migration `ensureDeltaMetricKeys(db)` that rewrites the
  persisted `programs.metric_keys` for `program_id='dl'` to `["mqd"]` if it
  still contains `mqm`. (Existing installs won't reset on their own because
  the seed uses `INSERT OR IGNORE`.)
- Add a startup migration `stripDeltaMqmValues(db)` that walks
  `trip_program_entries` and `program_year_adjustments` rows for `dl` and
  removes any `mqm` key from the stored `metric_values` JSON. Log a one-line
  summary to the app error log for auditability.

Auto-computation:

- In `computeProjections`, when bucketing a Delta trip entry into a
  program-year totals map, compute `mqd` from the trip's segments (sum of
  `cost_usd` across all segments whose `program_id` is `dl` OR unspecified
  when the entry is on Delta) **whenever the entry's stored `metric_values`
  does not include an explicit `mqd`**. This preserves manual overrides while
  making the common case (user just enters cost per segment) work.
- Rule of thumb: MQDs = eligible ticket price, 1 MQD per $1. We treat the
  user-entered segment cost as the eligible fare.
- Continue treating estimate vs. actual bucketing identically — an estimate
  trip's segment costs feed the estimate totals, actual trips feed YTD.

Trip editor UX (`src/pages/Trips.tsx`):

- Delta entries no longer expose `mqm` (since `metric_keys` drops it).
- When the selected program is Delta, hide the `mqd` numeric input and show a
  read-only helper line: *"Delta MQDs are calculated automatically from
  segment cost ($1 = 1 MQD). Add flight segments with a Cost value below."*
- Keep the raw `metric_values` editor available for other programs unchanged.

Million Miler:

- No code change to accrual: `accruedLifetimeMiles` already sums
  `distance_miles` from completed segments where `s.program_id = 'dl'` and
  `t.start_date > baseline_date`. Ensure the trip editor guidance mentions
  that segments on Delta contribute to Million Miler when the trip is marked
  completed.

### 4. Delete year adjustments + one-time Delta-2026 cleanup

Backend:

- Add `adjustmentDelete(db, id)` in `electron/database.ts` returning `boolean`.
- Add `adjustmentsDeleteForProgramYear(db, programId, year)` returning count.
- Add IPC handlers:
  - `adjustments:delete` → `adjustmentDelete`
  - `adjustments:deleteForProgramYear` → `adjustmentsDeleteForProgramYear`
- Expose on `WindowApi.adjustments` in `preload.ts` and `types.ts`:
  - `delete(id)`, `deleteForProgramYear(programId, year)`.

One-time cleanup migration:

- After schema init, if `app_meta.delta_2026_adjustments_cleared` is not set,
  call `adjustmentsDeleteForProgramYear(db, 'dl', 2026)`, log the count to
  the error log, and set the meta key to today's ISO date.
- Idempotent — no-op on subsequent launches.

UI:

- On `ProgramDetail.tsx`, in the existing "Year adjustments" section, render
  a **Delete** button per row that calls `window.api.adjustments.delete(id)`
  then reloads. `confirm(...)` prompt before deletion.

### 5. Version + docs

- Bump `package.json` to `1.5.0`.
- New `CHANGELOG.md` `[1.5.0]` section documenting all above.
- New `UPDATE_SPEC_v1.5.md` (this file — leave in repo).
- Refresh relevant sections of `docs/USER_GUIDE.md` and `docs/TECHNICAL.md`
  to describe:
  - The new Delta MQD auto-calc (cost → mqd),
  - MQM removed from Delta,
  - How Million Miler mileage works and where the progress bar shows,
  - New adjustment delete UI,
  - The one-time Delta-2026 adjustment cleanup migration,
  - The multi-size icon and Windows icon-cache reset instructions.

### 6. Tests

Add to the existing suites (do not lower any counts):

- **security.test.ts**
  - `icon.ico` at `assets/icon.ico` is a valid ICO and contains at least the
    16, 32, 48, and 256 sized entries (read the ICONDIR + entries from disk).
  - `adjustments:delete` and `adjustments:deleteForProgramYear` are
    parameterized queries — malicious id/programId strings do not drop tables.
- **functionality.test.ts**
  - `ensureLifetimeMileageRows` inserts a missing Delta row on a DB that has
    it stripped, but does not overwrite an existing baseline.
  - `ensureDeltaMetricKeys` rewrites `["mqd","mqm"]` → `["mqd"]`.
  - `stripDeltaMqmValues` removes `mqm` keys from Delta entries and Delta
    adjustments; other programs untouched.
  - `computeProjections` derives `mqd` from segment `cost_usd` on a Delta
    trip with no explicit `mqd` in metric_values; explicit `mqd` overrides.
  - `computeProjections` derives estimate vs. actual `mqd` correctly by
    trip status.
  - `adjustmentDelete` removes the row; `adjustmentsDeleteForProgramYear`
    returns the deletion count.
  - Delta-2026 cleanup migration runs once (meta key gates it).
- **validation.test.ts**
  - Rejects negative deletion ids gracefully.
- **boundary.test.ts**
  - Deleting a non-existent adjustment id returns `false`.
  - `deleteForProgramYear` with no matching rows returns 0.

Target: 133 → **≥ 145** tests, all passing.

### 6b. American AAdvantage: drop `spend`, derive LPs from segment cost

Added mid-implementation as additional v1.5 scope, applied in the same release:

- **Drop `spend` from AA's `metric_keys`.** AA status is pure Loyalty Points
  (LPs) — the `spend` metric was unused vestigial noise. `programsSeed.ts`'s
  `aa` entry now lists `metric_keys: ['points']` only.
- **Display-only rename**: the UI labels AA's `points` metric as **"LPs"**
  wherever metric keys are rendered (dashboard cards, tier requirements,
  program detail, trip entries, adjustments), via a shared
  `displayMetricKey(programId, key)` helper in `src/lib/metricLabels.ts`. The
  underlying storage key remains `points` — no data migration needed for the
  rename itself.
- **Startup migrations** `ensureAaMetricKeys(db)` and `stripAaSpendValues(db)`,
  same pattern as the Delta `mqm` migrations, scoped to `program_id='aa'` only
  (Hilton's and Marriott's own `spend` metrics are untouched). Both run inside
  `applyDataMigrations`.
- **`computeProjections` derives AA `points` from segment cost** when not
  explicitly entered: `derivedPoints = Math.round(costs * statusMultiplierForAA(currentHeldAaTier))`,
  where `costs` is the sum of `cost_usd` across the trip's AA segments and the
  multiplier depends on the tier held entering the current AA status year (5x
  no status, 7x Gold, 8x Platinum, 9x Platinum Pro, 11x Executive Platinum). An
  explicit `points` value on the entry always overrides the auto-calc.
- **Trip editor UX**: the AA entry's `points` input stays editable (unlike
  Delta's hidden MQD field) but is pre-filled with the estimated auto-calc value
  (base 5x, via a renderer-safe `statusMultiplierForAAPreview` in
  `src/lib/metricLabels.ts`) when empty, plus a helper line explaining the
  auto-calc and that posted LPs can be entered manually after the trip.
- **Tests**: `ensureAaMetricKeys`, `stripAaSpendValues` (AA-only, Hilton/Marriott
  untouched), `statusMultiplierForAA` per-tier rates, `computeProjections`
  AA-derivation at all five tiers plus explicit-value override.

Revised target: 145 → **≥ 155** tests, all passing.

### 7. Build, package, sign, ship

- `npm run build` (renderer + main).
- `npm run test` — all green.
- `npx electron-builder --config electron-builder.config.js --win zip nsis`.
- Deliver the **zip** archive of the built app under `dist-installer/` (also
  keep NSIS installer alongside). No code signing is set up (per config); do
  not attempt to sign.
- Commit changes with a clear message and push `main`.
