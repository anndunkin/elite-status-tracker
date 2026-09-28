# v1.8.0 QA inventory

## User-visible acceptance checks

- Actual bar remains based only on actual annual earnings toward the next tier.
- Projected bar includes completed, booked and planned travel and uses numeric,
  proportional tier positions. AA markers are at 20%, 37.5%, 62.5% and 100%;
  175,000 LPs fills 87.5% of the 200,000 LP scale.
- Tier names and thresholds appear above the projected bar. No tier list remains.
- Single routes show only total / target. Alternative routes retain Requires.
- AND metrics are all present in the numerical text, while OR alternatives remain
  visible with currency formatting for spend.
- Primary metric is explicit for programs with multiple metrics. Status continues
  to depend on all qualification rules, not just numeric fill.
- Top tier, zero activity, near-threshold, over-target, invalid and custom rules
  remain safe and understandable.
- Label bounds/collisions, year switching, card navigation, light/dark mode,
  1360px desktop, 960px minimum desktop width, and 375px preview are checked.

## Automated checks

- 240 Vitest tests: functionality, validation, boundaries, security, trip attribution,
  contributing metrics, dashboard and projection integration.
- Renderer and Electron production builds, renderer TypeScript check, npm audit.
- Windows release gate: previous installer v1.7.3, upgrade, actual packaged-runtime
  assertions for AA proportional positions and Hilton alternative requirements,
  navigation, minimum-size bounds, theme controls and renderer isolation.
- Same-version reinstall/repair, uninstall preserving the database, and reinstall
  reopening the retained trips.

## Exploratory checks

- Marriott reaches the top nights threshold but not the spend requirement:
  numeric bar may fill, but projected status does not claim Ambassador.
- Hyatt qualifies through points while nights remain zero: the bar explicitly
  names nights and the alternative Requires line remains visible.
- Densely spaced or coincident thresholds keep their real positions and stagger
  text vertically instead of substituting equal-distance tier markers.

## Unchanged limitations

No signing private key is available. The Windows installer remains unsigned.
No program rule refresh or database schema migration is included in this UI change.
