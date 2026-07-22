# Elite Status Tracker — v1.2 Update Spec

Repo: `/home/user/workspace/elite-status-tracker`, pushed to
`https://github.com/anndunkin/elite-status-tracker`, currently at tag `v1.1.0` on `main`.
This is an INCREMENT — read the existing code first, especially `electron/database.ts`,
`electron/seedData.ts`, `electron/seedTrips.json`, `electron/rules.ts`,
`electron/main.ts`, `electron/preload.ts`, and the `ProgramDetail` page component added in
v1.1. Do not rewrite from scratch. Preserve all existing functionality and the 83 passing
tests unless a change below explicitly supersedes it.

Use `bash` with `api_credentials=["github"]` for all git/gh commands. Never use any GitHub
MCP/connector tool.

## 1. Strip the historical seed data (v2 cutover)

Per the v1.0.0 design (see the comment at the top of `electron/seedData.ts`: "V1 ONLY:
ships with historical trip data pre-loaded so Ann can test immediately. Remove this
import/call from database.ts before cutting v2."), Ann has now downloaded and tested v1.0.0
and v1.1.0 with the seeded historical data and confirmed she's done with it. Remove the
seed data from future builds:

- Remove the `import { seedHistoricalData } from './seedData'` call site(s) in
  `electron/database.ts` (both places referenced at lines ~180/220 and ~676 per the
  existing code — read current line numbers, they may have shifted after v1.1 changes) so
  a freshly created database starts completely empty (no trips, no adjustments, no
  last-activity markers, no card-earnings entries).
- **Keep** the program reference data seeding (the 8 active programs + lapsed reference
  programs, their current tier rules from `program_rule_versions`/`program_tiers`, the
  Hilton lifetime Diamond row, the Delta lifetime-mileage baseline row) — none of that is
  "historical trip data," it's the app's core rule/reference dataset and must still be
  seeded on every fresh database, exactly as it is now. Only strip the trip-history-derived
  seed content (`seedTrips.json`'s trips/adjustments/last-activity entries).
- Delete `electron/seedData.ts` and `electron/seedTrips.json` entirely (or leave them
  in the repo under a clearly-named `legacy/` or `archive/` folder if you'd rather preserve
  them for reference — your call, but they must not be imported/called from any active code
  path). Remove the now-dead `SeedEntry`/`SeedTrip`/`SeedAdjustment` types if they live only
  in that file and aren't reused elsewhere.
- Update `electron/database.ts`'s "create fresh DB" path so `is_seeded` semantics still
  make sense (e.g. it should now just mean "reference/rules data has been seeded," not
  "historical trips have been seeded" — rename the meta flag if that improves clarity, but
  don't break any existing DB files that already have `is_seeded='1'` set from v1.0/v1.1 —
  migration must be additive/backward compatible, never destructive to an existing user
  database file).
- This change affects NEW databases only. Do not write any migration that deletes trips
  from an existing user's `.db` file — Ann's real usage data (any trips/entries/card-earnings
  she has already added since installing v1.0/v1.1) must be fully preserved when she opens
  her existing database file with this new build. Only the "what gets seeded into a
  brand-new, never-before-opened database" behavior changes.
- Update `docs/USER_GUIDE.md`/`docs/TECHNICAL.md`/`CHANGELOG.md` to reflect that v1.2 ships
  with an empty trip history (fresh install = blank slate, ready for real use) while still
  reflecting current program rules out of the box.

## 2. Manual status override + lifetime status, for any program

Add the ability to manually set a program's status, from the Program Detail page, with two
independent capabilities Ann described:

**(a) Status override** — let Ann directly set/correct the tier that's displayed for a
program, e.g. she says "I bought up to Exec Plat on American" (a status that wasn't
reflected because the app's calculated logic didn't have it — e.g. purchased/gifted
status, elite status match/challenge, or any other real-world status not captured by
earned activity). This is a manual correction to what's shown, independent of the
calculated (earned) tier.

**(b) Permanent flag** — a checkbox (or equivalent toggle) on that same override, "This is
permanent / lifetime status." When checked, this manual entry behaves exactly like the
existing Hilton lifetime-Diamond mechanism from v1.1 (`program_lifetime_status` table) — it
becomes a permanent floor for that program's "Current" tier display that never expires and
never falls below it, regardless of future annual earning cycles. When unchecked, it's a
one-time override of the CURRENT program-year's displayed "Current" tier only (does not
persist into next year — next year's "Current" reverts to being calculated from actual
earned totals, unless Ann sets a new override again).

**Reconcile with v1.1's `program_lifetime_status` table** — do not build a second, separate
mechanism. Extend/reuse that table (or its logic) so:
- Setting a "permanent" override writes/updates a `program_lifetime_status` row for that
  program (tier_name, achieved_date optional, notes optional) — this is exactly the
  mechanism Hilton Diamond already uses. Generalize the UI so ANY program can have this set,
  not just Hilton (the backend was already described as generic in v1.1 — if the UI only
  exposed it for Hilton, open it up to all programs now).
- Setting a NON-permanent override needs a new concept since it's year-scoped rather than
  permanent. Add a lightweight table, e.g.:

```sql
CREATE TABLE program_status_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id TEXT NOT NULL REFERENCES programs(id),
  program_year INTEGER NOT NULL,   -- the program-year this override applies to (respect AA's Mar1-Feb28/29 window when computing which program_year a "now" override belongs to)
  tier_name TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```
  When present for the current program-year, this override takes precedence over (i.e.
  floors/replaces, whichever reads more naturally in the UI — recommend: "Current" display
  = override tier if one exists for the current program-year, else calculated tier) the
  calculated "Current" tier for that program-year in the three-part status display from
  v1.1 (Current / YTD / Projected). YTD and Projected should still show calculated earned
  progress underneath as before (an override doesn't hide the underlying earned numbers,
  same UX principle as the Hilton lifetime floor in v1.1 — Ann can still see her real earned
  progress even though the displayed "Current" reflects the override/floor).

**UI**: On Program Detail, add an "Edit Status" control (button/section) that opens a small
form: tier dropdown (populated from that program's current `program_tiers`, plus lifetime
tiers if distinct naming applies, e.g. AA's lifetime tiers are literally the same names as
its annual tiers — Gold/Platinum/Platinum Pro/Executive Platinum — so just reuse the tier
list), a "This is permanent / lifetime status" checkbox, optional notes/achieved-date field.
Submitting writes to the correct table per (a)/(b) above. Show existing overrides/lifetime
status clearly on the page (e.g. a badge + small "edit" / "clear" affordance) so Ann can see
and revise what's set. Clearing an override/lifetime status must be supported (delete the
row).

**Precedence rule for "Current" tier display** (make this explicit and testable): 
`displayedCurrentTier = MAX(lifetimeFloorTier, currentProgramYearOverrideTier, calculatedHeldTier)`
where "MAX" means highest tier by `tier_order`, and any of the three inputs may be absent
(no lifetime floor set, no override set for this program-year, or no calculable prior-year
data) — handle all absHigh/absent combinations gracefully, never crash, never show blank
when at least one is present.

## 5b. API surface

Add IPC handlers (main) + preload bridge + renderer API client functions for CRUD on
`program_status_overrides`, and extend existing `program_lifetime_status` CRUD/UI so it's
selectable for any program (not hardcoded to Hilton) from the Program Detail page's new
"Edit Status" control. Follow existing naming/registration conventions exactly, matching
how v1.1 wired up `card_earnings_entries` and `program_lifetime_status`.

## Testing

Update/add tests across the four existing suites covering: fresh-DB seeding contains
reference/rule data but zero historical trips (functionality/boundary); existing populated
DB files are untouched by the new build (no destructive migration — simulate opening a
pre-existing seeded DB and confirm trip counts are unchanged); status-override CRUD and
validation (validation/security — e.g. reject invalid tier names, invalid program ids);
the MAX-precedence resolution logic for displayed "Current" tier across all combinations of
lifetime floor / year override / calculated tier being present or absent (boundary +
functionality); AA Executive Platinum permanent-lifetime scenario end-to-end as a
regression fixture (since that's Ann's concrete example). All tests must pass — confirm the
full existing suite (83 tests from v1.1) still passes plus new tests, report the new total.

## Packaging & delivery (same process as v1.0.0/v1.1.0)

1. `npm install` (should need no new deps), `npm run build`, fix all TS errors.
2. `npm test` — all green.
3. `npm run electron:build` for Windows (nsis), reusing the prebuilt `better_sqlite3.node` via the existing afterPack hook.
4. Sign the installer with the existing cert identity (`CN=Ann Dunkin, O=Dunkin Global Advisors, OU=Software, C=US`) via the existing signing script.
5. Update `CHANGELOG.md` (v1.2.0 entry), `docs/TECHNICAL.md`, `docs/USER_GUIDE.md` to document: seed-data removal for fresh installs, and the new manual/lifetime status override feature (including the precedence rule) and how to use "Edit Status" on Program Detail.
6. Commit and push to `main`. Tag and create GitHub release `v1.2.0` with release notes. If `gh release upload` fails with HTTP 400 on the large binary (known sandbox proxy limitation on `uploads.github.com`), that's expected and non-blocking — note it, the installer will be delivered directly to the user instead.
7. Report back: (1) summary of every change against the 2 spec items above, (2) test results — pass/fail counts per suite and new total vs. 83, (3) confirmation the Windows build succeeded and was signed, with the exact local installer file path, (4) the GitHub release URL/tag and asset-upload outcome, (5) explicit confirmation that opening an existing pre-v1.2 database file does NOT lose any trip data (describe how you verified this), (6) confirmation of how you'd recommend Ann sets her AA status to Executive Platinum as a permanent/lifetime override once she has the new build (a one-line usage note).
