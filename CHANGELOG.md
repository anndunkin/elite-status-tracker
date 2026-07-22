# Changelog

All notable changes to Elite Status Tracker are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

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
