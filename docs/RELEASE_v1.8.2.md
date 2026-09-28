# Elite Status Tracker v1.8.2

## Download

[Download the Windows installer](https://github.com/anndunkin/elite-status-tracker/releases/download/v1.8.2/Elite.Status.Tracker.Setup.1.8.2.exe).
The [release page](https://github.com/anndunkin/elite-status-tracker/releases/tag/v1.8.2)
also contains the installer and changelog.

- Installer: `Elite.Status.Tracker.Setup.1.8.2.exe`
- Size: 112,610,734 bytes
- GitHub asset SHA-256: `088535e2e1d2257714100cc365019094b428d6500e8dc8553c46a9945db19baa`

The size and checksum are reported by the
[published release asset](https://github.com/anndunkin/elite-status-tracker/releases/tag/v1.8.2).
The direct installer download was verified with HTTP 200.

## Scope

Only the annual progress component changes in the desktop UI. Once actual annual
earnings meet the top-tier requirements, both annual bars are replaced with
“Top status achieved 🎉” using the approved existing message styling.
Current, YTD and Projected rows and totals, lifetime status badge and Million Miler
gauge remain untouched. No database schema, program-rule or file-management changes.
Synthetic preview data demonstrates Delta's top-tier state with lifetime indicators.

## Verification checklist

- Exact top threshold and above: show one celebration and no annual bars.
- Below threshold, projected-only top, held/lifetime-only top: retain both bars.
- AND qualification: all conditions required; OR qualification: any complete route.
- Invalid values and missing rules: never celebrate falsely.
- Reduced actual earnings: restore bars on rerender.
- Lifetime badge, mileage gauge, status rows and totals remain present and styled.
- Desktop and narrow viewport, light and dark themes: inspect the card and overflow.
- Year selection, theme toggle and card navigation: exercise normal controls.
- Windows packaged runtime, renderer isolation, upgrade from v1.8.1,
  same-version reinstall/repair, uninstall data retention and reinstall.

## Local results

All 247 tests passed. Renderer TypeScript validation and both production builds passed.
The dependency audit reported zero vulnerabilities after a compatible Undici patch.
Protected keyv/cacheable-request overrides remain unchanged.

## Windows and visual results

The Windows suite, production build, native database rebuild, installer packaging
and all runtime/lifecycle checks passed in the
[Windows validation workflow](https://github.com/anndunkin/elite-status-tracker/actions/runs/36498428387).
The checks verified Delta's celebration with no annual bars, preserved lifetime badge
and totals, the remaining programs' dual bars, renderer isolation and navigation.
Upgrade from v1.8.1, same-version reinstall/repair, uninstall retaining the database,
and reinstall reopening retained trips all passed in that workflow.

Browser visual checks covered light/dark themes and 1360-, 960- and 375-pixel widths.
The lifetime badge and 70%-filled Million Miler gauge remained visible, with no
horizontal page or annual-bar overflow. Year switching, theme switching and the
preview's card-navigation/back flow were exercised.
The preview uses illustrative data only; the desktop app uses the user's own file.

Application commit: `67812df`; tag: `v1.8.2`.

## Installation and signing

Close the app, back up the tracker file, and install into the existing installation
folder. The Windows installer remains unsigned: no signing private key is available,
as disclosed in the
[release notes](https://github.com/anndunkin/elite-status-tracker/releases/tag/v1.8.2).
