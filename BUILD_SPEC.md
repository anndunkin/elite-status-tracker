# Elite Status Tracker — Build Specification

## Purpose

Desktop Electron app for Ann Dunkin to track travel activity toward airline/hotel elite
status across 8 loyalty programs. Tracks PLANNED trips (with pre-travel estimates) and
ACTUAL results (entered after travel), shows running totals vs. each program's current
tier thresholds, and reminds Ann every quarter to check whether program rules changed.

Repo: `https://github.com/anndunkin/elite-status-tracker` (already created, empty, on `main`, no README yet — you push first commit).
Local build directory: `/home/user/workspace/elite-status-tracker` (already contains this spec, `raw_spreadsheet_dump.json`, `prebuilt-win32-x64/better_sqlite3.node`).

Use `bash` with `api_credentials=["github"]` for all git/gh commands (push, PR, release). Never use the `github_mcp_direct` connector — its own tool description says not to use it here.

## Tech stack (must match sibling apps exactly)

- Electron 41.x + React 18 + TypeScript + Vite
- `better-sqlite3` (^12.x) for the local DB — pure Electron main-process backend (NO Express layer; follow `idp-manager` pattern, not `expense-tracker`'s Express pattern)
- react-router-dom for navigation
- Tailwind CSS for styling
- Vitest + @testing-library/react for tests
- electron-builder with NSIS installer for Windows, using the **exact** afterPack.js / prebuilt-win32-x64 pattern from idp-manager (already copied into this directory at `prebuilt-win32-x64/better_sqlite3.node` — reuse it, do not rebuild). Copy `idp-manager`'s `electron-builder.config.js` and `scripts/afterPack.js` structure verbatim, adjusting `appId`/`productName`.
- Self-signed code-signing cert, reuse identity: `CN=Ann Dunkin, O=Dunkin Global Advisors, OU=Software, C=US` (generate a new cert with this identity the same way expense-tracker's `build/sign.sh` does via osslsigncode — do not attempt to reuse the other apps' actual private key file, generate fresh).
- Test files named exactly: `tests/security_tests.*`, `tests/validation_tests.*`, `tests/boundary_tests.*`, `tests/functionality_tests.*` (use vitest/TS naming convention like idp-manager: `security.test.ts`, `validation.test.ts` etc. — i.e. adapt idp-manager's actual working test naming, not expense-tracker's Python naming, since this app has no Python layer)
- docs: `README.md`, `CHANGELOG.md`, `docs/TECHNICAL.md`, `docs/USER_GUIDE.md` — follow idp-manager's doc structure and depth
- File management: New / Open / Save As via File menu, portable SQLite file, plus JSON export/import with a version field, following idp-manager's `buildFilePayload`/`importFilePayload` pattern exactly. This satisfies the space instruction "full file management capability."
- Light/dark theme support (follow archival-calendar precedent)

## CRITICAL: seed data lifecycle

This is v1. It MUST ship with a pre-populated database (converted from the historical
spreadsheet, see below) so Ann can immediately see and test real data. Follow the
archival-calendar precedent: seed data loads **once** on fresh DB creation only, and is
never re-seeded. Structure the seeding code so that a maintainer can trivially strip it
for v2 (e.g. isolate it in `electron/seedData.ts` + `electron/seedTrips.json`, invoked
only from the "create fresh DB" path) — add a code comment at the top of
`electron/seedData.ts`: `// V1 ONLY: ships with historical trip data pre-loaded so Ann can
test immediately. Remove this import/call from database.ts before cutting v2.`

## Data source

`/home/user/workspace/elite-status-tracker/raw_spreadsheet_dump.json` — raw dump of all 14
sheets (2012-2020, 2022-2026; 2021 skipped, no data that year) from Ann's real historical
trip-planning spreadsheet. Each sheet is a 2D array of rows (row 0 = row 1 in Excel, etc.),
values_only, dates as ISO strings.

**Sheet shape evolved over the years** — column headers differ per sheet (see below). You must write a per-sheet (or per-era) parser. Common structure:
- Header row(s) near the top (row index 1 or 2, sometimes with a super-header row above it grouping columns per program)
- Data rows: one row per trip, columns = Month, Location, then a variable set of per-program metric columns (miles/points/EQDs/MQDs/MQMs/nights/stays/$), then `Airline Bonus Credit?`, `Booked?`, `Petsitter Booked?` (ignore this column — not relevant to status tracking), `Complete?`, `Notes`, and often a second block of duplicate/recomputed per-program columns further right (these look like a normalized re-statement of the same data for summation — treat the LEFT block as canonical raw entry and use it; the right-side "helper" columns can be ignored or used only for cross-validation, do not double count)
- Adjustment rows at the bottom, identified by Location/Month column containing strings like `Bonus`, `Boost`, `Rollover`, `CC`, `CC Annual`, `Promotional`, `Feb 28 Reset` — these are YEAR-LEVEL adjustments, not trips. Import each as a special adjustment record tied to (year, program, type) rather than a trip.
- A totals row (identified by blank Month/Location but numeric values in metric columns) — DO NOT import this as data; it's a checksum. You may use it to validate your parsed sums match (log a warning if they don't, but don't block import).
- Trailing rows with labels `Last Hyatt Stay`, `Last Omni Stay`, `Last Starwood Stay`/`Last Starwood Transaction`, `Last Fairmont Stay`, `Virgin Atlantic Expiration` — these are reference dates for LAPSED programs. Import as `program_last_activity` records (see schema) for programs: Hyatt (has since become active — still import the historical last-stay dates as historical trips are found in later years too), Omni, Starwood, Fairmont, Virgin Atlantic.

**Column → program/metric mapping** (build a lookup table per era; header text is inconsistent, match case-insensitively and by substring):

| Header text seen | Program | Metric type |
|---|---|---|
| AS Miles | Alaska/Atmos | miles |
| AA Miles, AA Points | American | points (renamed from miles to Loyalty Points-equivalent at some point — treat as `program_metric_value` with metric_key `points`) |
| AA EQDs | American | eqd (dollars spent, EQD = Elite Qualifying Dollars, AA's older metric — map to `spend`) |
| Delta Miles, Delta MQMs | Delta | mqm (miles) |
| Delta MQDs, MQDs | Delta | mqd (spend) |
| Other Miles | Delta or generic (varies by year — inspect Notes to disambiguate, else store as `program: "other"`, metric `miles`) |
| Hilton Stays | Hilton | stays |
| Hilton Nights | Hilton | nights |
| Intercontinental, Intercontinental nts | IHG | nights |
| Marriott nts | Marriott | nights |
| Marriott $ | Marriott | spend |
| Hyatt Nights | Hyatt | nights |
| United | United | miles or PQP (inspect column position/notes; recent years' "United" column with small integer values are likely miles/PQP-equivalent — store as `miles`) |

**Program identifiers to use in schema:** `aa` (American AAdvantage), `dl` (Delta SkyMiles), `as` (Alaska/Atmos Rewards), `ua` (United MileagePlus), `hh` (Hilton Honors), `mb` (Marriott Bonvoy), `ih` (IHG One Rewards), `wh` (World of Hyatt). Lapsed/reference-only: `omni`, `starwood` (defunct, merged into Marriott — still show historical reference), `fairmont` (defunct, merged — historical reference only), `va` (Virgin Atlantic).

Trip location + month + year + notes fields import directly. Since sheets only have Month (not day), set trip `start_date` to the 1st of that month/year as a placeholder — flag these seeded trips with a boolean `is_historical_estimate_date: true` so the UI can show "date approximate" instead of implying a real day-level date. `Booked?`/`Complete?` map to trip `status`: `Complete?` truthy → `completed`; else `Booked?` truthy → `booked`; else → `planned`.

## Schema design (SQLite via better-sqlite3)

```sql
-- Programs (static reference + user overrides)
CREATE TABLE programs (
  id TEXT PRIMARY KEY,          -- 'aa','dl','as','ua','hh','mb','ih','wh','omni','starwood','fairmont','va'
  name TEXT NOT NULL,           -- 'American AAdvantage'
  type TEXT NOT NULL,           -- 'airline' | 'hotel'
  is_active INTEGER NOT NULL DEFAULT 1,  -- 0 = lapsed/reference-only
  year_type TEXT NOT NULL DEFAULT 'calendar', -- 'calendar' | 'aa_status_year' (Mar1-Feb28/29)
  metric_keys TEXT NOT NULL,    -- JSON array, e.g. ["points","spend"] or ["nights","stays","spend"]
  notes TEXT
);

-- Program tiers (versioned rule sets, supports quarterly refresh history)
CREATE TABLE program_rule_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id TEXT NOT NULL REFERENCES programs(id),
  effective_date TEXT NOT NULL,   -- ISO date this rule version takes effect
  source_notes TEXT,              -- citation/URL of where rule was confirmed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_current INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE program_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_version_id INTEGER NOT NULL REFERENCES program_rule_versions(id),
  tier_name TEXT NOT NULL,        -- 'Gold','Platinum', etc.
  tier_order INTEGER NOT NULL,    -- 1=lowest
  requirements TEXT NOT NULL      -- JSON: [{"metric":"points","threshold":40000},{"metric":"segments","threshold":30,"op":"AND"}] -- supports OR (separate array entries with same group) / AND (op field) combinations
);

-- Trips
CREATE TABLE trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,            -- location/description, e.g. 'Honolulu Return'
  start_date TEXT NOT NULL,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'planned', -- 'planned' | 'booked' | 'completed'
  is_historical_estimate_date INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Trip segments (flights) — for airmile calculation
CREATE TABLE trip_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  origin_airport TEXT,            -- IATA code, e.g. 'ATL'
  destination_airport TEXT,       -- IATA code, e.g. 'SEA'
  distance_miles REAL,            -- auto-calculated great-circle distance, editable override
  cost_usd REAL,
  program_id TEXT REFERENCES programs(id),  -- which program earns from this segment
  fare_class TEXT
);

-- Per-trip, per-program earnings (estimate AND actual, one row per program per trip)
CREATE TABLE trip_program_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  program_id TEXT NOT NULL REFERENCES programs(id),
  is_estimate INTEGER NOT NULL,   -- 1 = pre-travel estimate, 0 = actual (post-travel)
  metric_values TEXT NOT NULL,    -- JSON: {"points":5622,"spend":1200,"nights":2}
  card_bonus_notes TEXT,          -- manual credit-card spend/bonus notes per user request
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(trip_id, program_id, is_estimate)
);

-- Year-level adjustments (Bonus, Rollover, CC, CC Annual, Promotional, Feb 28 Reset)
CREATE TABLE program_year_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id TEXT NOT NULL REFERENCES programs(id),
  program_year INTEGER NOT NULL,  -- the status-year this adjustment applies to (for AA, the year the Mar1 status-year starts)
  adjustment_type TEXT NOT NULL,  -- 'bonus' | 'rollover' | 'credit_card' | 'credit_card_annual' | 'promotional' | 'reset'
  metric_values TEXT NOT NULL,    -- JSON: {"points":9075}
  notes TEXT
);

-- Reference-only "last activity" for lapsed programs
CREATE TABLE program_last_activity (
  program_id TEXT PRIMARY KEY REFERENCES programs(id),
  last_stay_date TEXT,
  notes TEXT
);

-- Quarterly rule-refresh tracking
CREATE TABLE rule_refresh_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  programs_reviewed TEXT,         -- JSON array of program ids reviewed this check
  programs_updated TEXT,          -- JSON array of program ids where rules changed
  next_check_due TEXT NOT NULL    -- ISO date, = checked_at + 3 months
);

CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
); -- e.g. schema_version, db_created_at, is_seeded
```

## Airmile calculation

Implement great-circle (haversine) distance given two IATA airport codes. Ship a static
lookup table (JSON, `electron/airports.json`) of common US + international airport
codes/lat/lon — at minimum cover every airport code implied by the historical data's
"Location" text where identifiable (ATL, SEA, PDX, SFO, LAX, DEN, ORD, DCA, IAD, JFK, LHR,
CDG, and others as needed — a few hundred major airports is fine, use a reputable public
airports dataset, e.g. OpenFlights airports.dat, filtered to columns IATA/lat/lon/name). If
a code isn't found, let the user manually enter distance.

## Program tier rules to seed (program_rule_versions, effective 2026-01-01 except AA which is season-based)

Seed exactly these current (2026) tiers as the initial `program_rule_versions` /
`program_tiers` rows, each with `source_notes` containing the citation URL:

**American AAdvantage** (`aa`, year_type=`aa_status_year`, status year Mar 1–Feb 28/29):
- Gold: 40,000 points | Platinum: 75,000 points | Platinum Pro: 125,000 points | Executive Platinum: 200,000 points
- Source: https://www.aa.com/web/i18n/aadvantage-program/discover/loyalty-points-status.html

**Delta SkyMiles Medallion** (`dl`, calendar year, metric = mqd):
- Silver: $5,000 | Gold: $10,000 | Platinum: $15,000 | Diamond: $28,000
- Source: https://www.delta.com/us/en/skymiles/medallion-program/how-to-qualify

**Alaska/Atmos Rewards** (`as`, calendar year, metric = points):
- Silver: 20,000 | Gold: 40,000 | Platinum: 80,000 | Titanium: 135,000
- Source: https://onemileatatime.com/news/alaska-hawaiian-atmos-rewards-program/

**United MileagePlus Premier** (`ua`, calendar year, metrics = pqp AND pqf, OR pqp_only):
- Silver: (5,000 PQP AND 15 PQF) OR 6,000 PQP-only | Gold: (10,000 AND 30) OR 12,000 | Platinum: (15,000 AND 45) OR 18,000 | Premier 1K: (22,000 AND 60) OR 28,000
- Source: https://thepointsguy.com/news/united-airlines-premier-status-pluspoints-changes/

**Hilton Honors** (`hh`, calendar year, metrics = nights OR stays OR spend):
- Silver: 10 nights OR 4 stays OR $2,500 | Gold: 25 nights OR 15 stays OR $6,000 | Diamond: 50 nights OR 25 stays OR $11,500 | Diamond Reserve: 80 nights AND $18,000 (note: AND not OR)
- Source: https://www.hilton.com/en/p/hilton-honors/tier-updates/

**Marriott Bonvoy** (`mb`, calendar year, metrics = nights, Ambassador also requires spend):
- Silver: 10 nights | Gold: 25 nights | Platinum: 50 nights | Titanium: 80 nights | Ambassador: 100 nights AND $23,000 spend (flag in source_notes: "spend threshold conflicting across sources, $23K vs $25K — verify at next quarterly refresh")
- Source: https://www.screened.com/blog/marriott-bonvoy-elite-status-changes-2026/

**IHG One Rewards** (`ih`, calendar year, metrics = nights OR points):
- Silver: 10 nights | Gold: 20 nights OR 40,000 points | Platinum: 40 nights OR 60,000 points | Diamond: 70 nights OR 120,000 points
- Source: https://www.ihg.com/content/us/en/customer-care/member-tc

**World of Hyatt** (`wh`, calendar year, metrics = nights OR points):
- Discoverist: 10 nights OR 25,000 points | Explorist: 30 nights OR 50,000 points (flag in source_notes: "Explorist night threshold conflicting across sources, 20 vs 30 — verify at next quarterly refresh") | Globalist: 60 nights OR 100,000 points
- Source: https://frequentmiler.com/world-of-hyatt-complete-guide/

Set `rule_refresh_log.next_check_due` = 3 months from first app launch (store first-launch date in `app_meta`).

## Quarterly rule-refresh UX

On app launch, check `app_meta`/`rule_refresh_log` for the latest `next_check_due`. If
today >= next_check_due, show a modal/banner: "It's been 3 months since program rules were
last reviewed. Would you like to check for updates?" with Yes/Remind me later/Skip this
quarter. If Yes, let Ann pick which program(s) to mark as "needs manual rule update" (since
the app has no live internet access at runtime — it cannot auto-fetch; this must be a
manual data-entry flow where Ann edits the tier thresholds herself through a "Manage
Program Rules" screen, creating a new `program_rule_versions` row while keeping history of
the old one for audit). Log the check in `rule_refresh_log` regardless of answer, computing
the next `next_check_due` as +3 months.

## Status projection logic

For each active program, compute:
- **Actual current status**: sum all `trip_program_entries` where `is_estimate=0` (actuals) for trips with `status='completed'`, plus all `program_year_adjustments` for the current program-year, compared against current `program_tiers` thresholds (respecting each program's `year_type` window) → shows current qualified tier.
- **Expected status at year end**: same sum, but also including `is_estimate=1` (estimates) for trips with `status IN ('planned','booked')` whose date falls within the remainder of the current program year → shows projected tier.
- Correctly compute the AA program-year window (Mar 1–Feb 28/29) vs. calendar year for all others when bucketing trips/adjustments by year.
- Render both numbers per program as a dashboard (progress bar or similar) — current tier, points/nights/etc. so far, remaining to next tier, projected tier.

## UI screens (React)

1. **Dashboard** — one card per active program: current status, progress to next tier, expected year-end tier, small overview of upcoming planned trips.
2. **Trips** — list of trips (filter by year/status/program), add/edit trip form:
   - Trip basics (label, dates, status)
   - Per-program entry rows: pick program(s) this trip earns for → for airline programs, add segment(s) with origin/destination airport (auto-calc distance) + cost, program metrics auto-suggested from segment data but manually editable; for hotel programs, enter nights/spend directly. Both an "Estimate" set of fields (filled before travel) and an "Actual" set (filled after) — both visible side by side or toggle, per the two-set schema above.
   - Manual credit-card spend/bonus notes field per program per trip.
3. **Programs** — list of all 8 programs + lapsed ones; click into a program to see its current tier table, rule version history, and (for lapsed ones) last-stay reference date.
4. **Manage Program Rules** — edit tier thresholds for a program, creating a new versioned rule set; view history of past versions.
5. **Settings** — file management (New/Open/Save As/Export JSON/Import JSON), theme toggle, quarterly refresh reminder settings.

## Testing requirements (space instructions: security, validation, boundary, functionality)

Write vitest test files covering:
- `tests/security.test.ts` — SQL injection resistance (parameterized queries only), file path traversal protection in file-open dialogs, no `eval`/unsafe IPC exposure, contextIsolation enabled, nodeIntegration disabled in renderer.
- `tests/validation.test.ts` — form validation (required fields, numeric ranges, date validity, airport code format), schema validation on JSON import.
- `tests/boundary.test.ts` — zero/negative values, missing optional fields, AA year-boundary edge cases (trips exactly on Feb 28/29 or Mar 1), leap year handling, very large point totals, empty database state, single-tier-away-from-qualifying edge cases.
- `tests/functionality.test.ts` — CRUD on trips/programs/entries, status projection calculation correctness against known fixture data, airmile distance calculation accuracy (spot check known city pairs), seed data import correctness (row counts match source per year), quarterly refresh due-date logic.

All tests must pass before packaging. Fix any failures — do not ship with red tests.

## Packaging & delivery steps (in order)

1. `npm install`, `npm run build`, fix all TypeScript errors.
2. `npm test` (vitest run) — all green.
3. `npm run electron:build` targeting Windows (nsis) — verify the afterPack hook injects the prebuilt better_sqlite3.node correctly (check build logs for the "Injected prebuilt Win32 better_sqlite3.node" message).
4. Sign the resulting .exe/installer with the self-signed cert (CN=Ann Dunkin, O=Dunkin Global Advisors, OU=Software, C=US) using osslsigncode, following expense-tracker's `build/sign.sh` pattern.
5. Write README.md (setup/dev/build instructions + feature overview), CHANGELOG.md (v1.0.0 entry), docs/TECHNICAL.md (architecture, schema), docs/USER_GUIDE.md (how to use each screen).
6. Git init if needed, commit all source (exclude node_modules, dist, dist-installer via .gitignore), push to `https://github.com/anndunkin/elite-status-tracker` main branch.
7. Create a GitHub release (`gh release create v1.0.0`) attaching the signed Windows installer (.exe) as a release asset — this is the "download" Ann will use to test with the seeded data.
8. Report back: summary of what was built, test results (pass counts per suite), any known limitations/TODOs (e.g. Marriott Ambassador $23K vs $25K conflict, Hyatt Explorist 20 vs 30 nights conflict — flagged for first quarterly refresh), and the GitHub release URL.

## Out of scope for v1 (do not build)

- Live internet fetching of rule updates (manual entry only, per above)
- Mac/Linux signing (build targets can still include mac/linux per idp-manager's electron-builder config, but do not attempt signing for those platforms)
- Multi-user/cloud sync — single local file only, per established app family pattern
