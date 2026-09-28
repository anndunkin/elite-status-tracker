# v1.7.0 QA inventory

## Required behavior

- Actual bar uses YTD totals and next earned tier, independent of held/lifetime and forecast status.
- Forecast bar includes completed, planned, and booked activity, adjustments and card earnings.
- All configured tiers remain visible, with forecast-specific qualification wording.
- Actual top-tier and projected top-tier states remain distinct.
- Threshold boundaries, empty rules, negative/invalid values, custom rule ordering,
  AND requirements, OR routes, and text escaping are covered by regression tests.
- Year switching refreshes projection inputs; American Airlines retains March-February boundaries.

## Automated checks

- `npm test`: 228 tests across functionality, security, validation, boundaries,
  segment attribution, contributing trips, dashboard, and projection integration.
- `npm run build` and `npx tsc --noEmit -p tsconfig.json`.
- `npm audit`: compatible dependency patches applied; protected overrides retained.
- `node scripts/windows-smoke.cjs` on Windows CI: install v1.6.2, seed synthetic
  trips, upgrade to this release, verify retained trips, render both bars, check
  renderer isolation, navigate to program details, capture light/dark and 960x640
  screenshots, reinstall same version, uninstall while retaining data, then
  reinstall and verify the original trips again.
- Windows QA screenshots and step results are uploaded as workflow artifacts.
  A failed smoke check blocks release publication.

## Visual review

Review the synthetic preview at desktop, narrow viewport, and light/dark settings.
Check all eight programs, multiline qualification routes, empty actual earnings,
earned top tier, and projections several tiers above actual. Check cards and
progress labels for clipping and horizontal overflow.

## Limitations

- No code-signing key is available. The installer is unsigned, not trust-signed
  or self-signed. The public certificate in the repository cannot sign binaries.
- Reinstall/repair testing means same-version installation over an existing
  install, not an MSI repair mode. This application uses NSIS.
- Browser preview uses synthetic examples only and does not implement desktop file dialogs.
