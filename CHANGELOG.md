# Changelog

All notable changes to Elite Status Tracker are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

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
