# Elite Status Tracker — v1.1 Update Spec

Repo already exists at `/home/user/workspace/elite-status-tracker` (pushed to
`https://github.com/anndunkin/elite-status-tracker`, tag v1.0.0 on `main`). This is an
INCREMENT — read the existing code first (`electron/database.ts`, `electron/rules.ts`,
`electron/seedData.ts`, `electron/types.ts`, `src/pages/*`) and modify/extend it. Do not
rewrite from scratch. Preserve all existing v1.0.0 functionality, schema data, and tests
unless a change below explicitly supersedes it.

Use `bash` with `api_credentials=["github"]` for all git/gh commands. Never use any GitHub
MCP/connector tool.

## 1. Marriott Ambassador confirmed at $23,000

Ann confirmed the Ambassador spend threshold is correct as-is: **100 nights AND $23,000
spend**. Remove the "conflicting sources, verify" flag/note from that tier's
`source_notes` in `program_rule_versions`/`program_tiers` — it's now confirmed, not a
to-verify item. Leave Hyatt Explorist's 20-vs-30-nights flag in place (still unresolved,
seeded at 30 — no change there).

## 2. Hilton lifetime Diamond status

Ann holds **lifetime Diamond** status with Hilton Honors — this is permanent, not
re-earned annually. Add a `lifetime_tier` concept:

- Extend `programs` table (or add a new `program_lifetime_status` table) to record a
  permanent/lifetime tier achieved, independent of annual qualification. Schema suggestion:

```sql
CREATE TABLE program_lifetime_status (
  program_id TEXT PRIMARY KEY REFERENCES programs(id),
  tier_name TEXT NOT NULL,        -- e.g. 'Diamond'
  achieved_date TEXT,             -- optional, nullable if unknown
  notes TEXT
);
```

- Seed one row: `hh` (Hilton Honors) → `Diamond`, notes: "Lifetime Diamond status — permanent, not re-earned annually."
- On the Dashboard and Program detail screens, when a program has a lifetime status, display it prominently (e.g. a badge "Lifetime Diamond") and the program's "Current status" should reflect at minimum the lifetime tier (i.e. current displayed tier = MAX(lifetime tier, annually-qualified tier) — Ann can never fall below her lifetime tier for Hilton). Still show her annual YTD/projected earning progress underneath for informational purposes (e.g. if she wants to reach Diamond Reserve, which lifetime Diamond does not cover).
- Keep this generic (not Hilton-specific in code) so any program can have a `program_lifetime_status` row in the future (e.g. if Ann later attains AA lifetime Platinum, Marriott Lifetime Titanium, etc. — already partially covered by American's existing lifetime-miles design if present, reconcile if there's overlap in `electron/rules.ts`).

## 3. Three-part status display: Current / Year-to-date / Projected

Redefine the status metrics shown per program (Dashboard cards AND Program detail screens) to exactly three values, replacing/clarifying whatever the v1.0.0 "current vs projected" pair currently shows:

- **Current**: the tier actually held right now, i.e. the tier earned/qualified from the most recently *completed* program-year (last year's final total compared to thresholds). This does NOT change during the current in-progress year (except see lifetime-tier floor above) — it only updates once a program-year closes out.
- **Year-to-date (YTD)**: sum of all ACTUAL (`is_estimate=0`) entries for trips with `status='completed'`, plus manual credit-card-earnings entries (see #4) and `program_year_adjustments`, all falling within the CURRENT in-progress program-year window (respecting each program's `year_type` — calendar vs. AA's Mar1-Feb28/29). Compare against tier thresholds to show "YTD tier" (what tier YTD totals alone would qualify for) alongside the raw YTD numbers.
- **Projected**: YTD totals + estimated/planned earnings from trips with `status IN ('planned','booked')` whose dates fall within the remainder of the current program-year (this is exactly what "expected year-end" meant in v1.0.0 — keep that calculation, just relabel/reposition it as "Projected" and make sure it's YTD + future-estimate, not total-from-scratch).

Update `electron/rules.ts` (or wherever `computeProgramStatus`-equivalent logic lives) to return all three values distinctly: `{ currentTier, ytdTotals, ytdTier, projectedTotals, projectedTier }` per program. Update Dashboard cards and Program detail views to show all three clearly labeled (e.g. three-column layout or three stacked rows per program card: "Current: Platinum" / "YTD: 42,000 pts (Gold)" / "Projected: 78,000 pts (Platinum)").

For "Current" tier computation, you need last-completed-program-year totals — compute this the same way as YTD but for the prior closed program-year window instead of the current one. If insufficient historical data exists to compute a genuinely completed prior year for a program, fall back gracefully (e.g. show "Current: Gold (from 2025)" using whatever the most recent fully-closed year's data yields, or "No completed program-year data" if truly none exists — do not crash or show blank).

## 4. Dashboard cards must be clickable → drill into underlying data

Each program card on the Dashboard must be clickable (or have an explicit "View details"
affordance) and navigate to that program's detail page (likely the existing Program detail
route from v1.0.0, extend it if needed) showing:
- The three status values from #3 with full numeric breakdown per metric (not just the tier name — show the actual point/night/dollar totals contributing to YTD and Projected, ideally broken down by contributing trip and by adjustment/credit-card entries so Ann can audit where numbers come from).
- A table/list of the underlying trips and entries (both estimate and actual) that fed into the current program-year's totals, each linking to the trip's edit view.
- The year-level adjustments (bonus/rollover/credit card/etc.) contributing to this program-year.
- Rule tier table and lifetime status badge if applicable (already covered by #2/#3).

## 5. New screen: manual credit-card earnings entry

Add a new screen/route (e.g. "Card Earnings" in nav) for manually logging elite-qualifying
credit-card-driven earnings, since these aren't tied to a specific trip. Cover exactly
these four (extensible to more programs later, but only these four need UI now):
- Delta SkyMiles — MQDs earned via credit card spend
- American AAdvantage — Loyalty Points (LPs) earned via credit card spend
- World of Hyatt — nights earned via credit card spend (e.g. milestone/anniversary night credits)
- Marriott Bonvoy — nights earned via credit card spend (e.g. card-anniversary free night / elite night credits from spend)

Each entry needs: program (fixed to one of the 4 above, dropdown), **date** (per Ann's
answer — entries are dated so they bucket correctly into the right program-year for
YTD/Projected calculations), amount (numeric, with the correct unit label: "MQDs" / "LPs" /
"nights" / "nights"), and an optional notes field (e.g. "Amex Platinum anniversary
statement credit," "Bonvoy Brilliant free night"). List view shows all past entries,
sortable/filterable by program and date, with edit/delete.

Schema: add a table, e.g.:

```sql
CREATE TABLE card_earnings_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id TEXT NOT NULL REFERENCES programs(id),  -- constrain to 'dl','aa','wh','mb' in the UI layer
  entry_date TEXT NOT NULL,
  metric_key TEXT NOT NULL,      -- 'mqd' | 'points' | 'nights'
  amount REAL NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Wire these into the YTD/Projected calculation in `electron/rules.ts` — they must be summed
alongside `trip_program_entries` and `program_year_adjustments` when bucketing by
program-year, using `entry_date` for the year-window determination (respecting AA's
Mar1-Feb28/29 window for the `aa` program).

Make sure the Dashboard drill-through (#4) for these 4 programs also lists contributing
card-earnings entries alongside trips/adjustments, so Ann can audit the full picture.

## 5b. Add API surface

Add the necessary Electron IPC handlers (main process) + preload bridge methods +
renderer API client functions for: CRUD on `card_earnings_entries`, CRUD on
`program_lifetime_status`, and the new three-part status computation. Follow the exact
naming/registration conventions already established in `electron/main.ts` /
`electron/preload.ts` / the renderer's existing API client module for v1.0.0's
trips/programs endpoints — match the pattern exactly (e.g. same IPC channel naming scheme,
same contextBridge exposure pattern, same error-handling wrapper if one exists).

## 6. Delta 3,000,000-mile lifetime status (Million Miler) tracking

Delta has its own separate lifetime-mile milestone program (unrelated to annual Medallion
tiers) — commonly called "Million Miler," at tiers of 1M / 2M / 3M (Ann wants specifically
3MM tracked) / 5M lifetime flown miles. Add support for this as a distinct lifetime-mileage
counter, separate from the annual MQD-based Medallion tracking already in the app.

**Baseline data found in the historical spreadsheet**: the "2026" sheet has a `3MM` column.
Row 9 (March, "Hawaii" trip) shows the base reading **2,004,496**. Subsequent rows in that
column are PER-TRIP INCREMENTS, not running cumulatives (4290 + 4428 + 1094 + 1560 + 1852 +
4362 + 1052 + 0 + 8604 + 1094 = 28,336). Base + increments = 2,004,496 + 28,336 =
**2,032,832**, which matches the sheet's year-to-date totals row exactly (confirms this
reading). The most recent contributing row is the "July DC" trip. Use **2,032,832** as the
current lifetime-mile baseline/starting point, with `baseline_date` = **2026-07-01** (1st
of the month of that most recent contributing row). Treat earlier years' sheets as not
having tracked this metric — it only appears starting in the "2026" sheet, so no
retroactive lifetime-mile accrual needs to be computed from pre-2026 trips.

Implementation:
- Add a lifetime-mileage counter, e.g. new table:

```sql
CREATE TABLE program_lifetime_mileage (
  program_id TEXT PRIMARY KEY REFERENCES programs(id),  -- 'dl' for now, keep generic for future extension (e.g. AA lifetime miles already exists in rules.ts if applicable — reconcile, don't duplicate)
  baseline_miles REAL NOT NULL,       -- known cumulative total as of baseline_date
  baseline_date TEXT NOT NULL,
  milestones TEXT NOT NULL             -- JSON array e.g. [{"label":"1,000,000 Miler","threshold":1000000},{"label":"2,000,000 Miler","threshold":2000000},{"label":"3,000,000 Miler","threshold":3000000},{"label":"5,000,000 Miler","threshold":5000000}]
);
```

- Seed one row: `dl`, `baseline_miles = 2032832`, `baseline_date` = the date of that most
  recent reading found in the 2026 sheet (inspect the sheet's row dates/months to pin down
  the exact month — use the last month with a non-null 3MM value before the "Boost" adjustment row, and use the 1st of that month as the date), `milestones` = the four thresholds above.
- Going forward, lifetime miles accrue from actual flown segment distance on Delta-coded
  trip segments (`trip_segments` where the trip's program is `dl` and `is_estimate=0`/actual, i.e. completed trips) — ADD each completed trip's Delta segment distance to the baseline to get current lifetime total. Do not double count: the baseline already includes everything up through its baseline_date, so only sum segment distances from trips completed AFTER baseline_date.
- Display on Dashboard (Delta card) and Program detail page: current lifetime mile total, progress bar/countdown to 3,000,000 (primary target per Ann's request), with the next lower/higher milestones shown for context (e.g. "2,032,832 / 3,000,000 — 967,168 miles to Million Miler 3MM status").
- This is entirely separate from the existing Delta Medallion (annual MQD tier) tracking — both should be visible on the Delta program detail page as two distinct sections ("Annual Medallion Status" vs. "Lifetime Mileage / Million Miler").

## Testing

Update/add tests in the existing four suites (`tests/security.test.ts`,
`tests/validation.test.ts`, `tests/boundary.test.ts`, `tests/functionality.test.ts`) to
cover all new functionality: card-earnings CRUD and validation, lifetime-status floor logic
(Hilton never shows below Diamond), three-part status calculation correctness (current vs
YTD vs projected with known fixture data, including the AA non-calendar-year edge case
still working correctly), Delta lifetime mileage accumulation math. All tests must pass —
do not ship with red or skipped tests. Confirm the full existing v1.0.0 test suite (61
tests) still passes alongside new tests.

## Packaging & delivery (same as v1.0.0 process)

1. `npm install` (if any new deps needed — should not be, this is pure app-layer work), `npm run build`, fix all TS errors.
2. `npm test` — all green (v1.0.0's 61 plus new tests).
3. `npm run electron:build` for Windows (nsis), reusing the prebuilt `better_sqlite3.node` via the existing afterPack hook — do not modify that packaging pipeline unless something in this update requires a new native dependency (it should not).
4. Sign the installer with the same self-signed cert identity (`CN=Ann Dunkin, O=Dunkin Global Advisors, OU=Software, C=US`) using the existing `build/sign.sh`-equivalent script.
5. Update `CHANGELOG.md` with a v1.1.0 entry describing all changes above. Update `docs/TECHNICAL.md` and `docs/USER_GUIDE.md` to document the new screens/schema.
6. Commit and push to `main` on `https://github.com/anndunkin/elite-status-tracker`. Tag and create a GitHub release `v1.1.0` with release notes (asset upload to the release may fail in this sandbox due to a known GitHub proxy limitation on `uploads.github.com` for large binaries — if `gh release upload` fails with HTTP 400, do not treat this as a blocking failure; just note it in your final report so the installer can be delivered directly instead).
7. Report back: summary of every change implemented, test results (pass/fail counts, total count vs. v1.0.0's 61), confirmation the Windows build succeeded and was signed (include exact installer file path in the workspace), the GitHub release URL/tag, and explicit confirmation of the Delta 3MM baseline value used (2,032,832) and its baseline date.
