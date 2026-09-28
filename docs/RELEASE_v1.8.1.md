# Elite Status Tracker v1.8.1

## Installer

[Download the Windows installer](https://github.com/anndunkin/elite-status-tracker/releases/download/v1.8.1/Elite.Status.Tracker.Setup.1.8.1.exe).
The [GitHub release](https://github.com/anndunkin/elite-status-tracker/releases/tag/v1.8.1)
contains the installer and release notes.

Close Elite Status Tracker, back up your tracker file, and run the installer
using your existing installation folder. Upgrade from v1.7.3 preserved the
database and synthetic test trips in the
[successful Windows validation run](https://github.com/anndunkin/elite-status-tracker/actions/runs/36487255220).

The installer remains unsigned because no signing private key is available.
This is disclosed in the [release notes](https://github.com/anndunkin/elite-status-tracker/releases/tag/v1.8.1).

- File: `Elite.Status.Tracker.Setup.1.8.1.exe`
- Size: 112,611,286 bytes
- GitHub asset SHA-256: `2ec30f96f24b0436d23e2450e0e55ca7ebaebfe105f7022e8bf219d3e59dde9b`

Size and checksum come from the [published release asset](https://github.com/anndunkin/elite-status-tracker/releases/tag/v1.8.1).
The direct download was checked and returned HTTP 200.

## Approved changes

- Actual earned continues to target the next tier using actual annual earnings.
- Projected tier positions now reflect numeric thresholds, not equal tier spacing.
- Tier labels and thresholds appear above the projected bar; the tier list is removed.
- Both bars retain compact total / target text.
- Requires appears only when the target offers alternative qualification routes.
- Combined requirements remain together in the numerical text.
- Multi-metric programs explicitly label the plotted metric; full qualification
  rules continue to determine status.
- Labels stagger when needed to avoid collisions in narrow cards.

These changes implement the approved mockup and qualification-route caveat,
as documented in the [release](https://github.com/anndunkin/elite-status-tracker/releases/tag/v1.8.1).
No database schema, program rules, lifetime mileage or file-management behavior changed.

## Verification

All 240 automated tests passed on Windows, followed by the packaged-runtime and
installer lifecycle checks
([workflow results](https://github.com/anndunkin/elite-status-tracker/actions/runs/36487255220)).
The Windows checks covered:

- American markers at 20%, 37.5% and 62.5%, with the top endpoint at 100%.
- 175,000 projected LPs filling 87.5% of the 200,000-point scale.
- No Requires line on American; alternative Requires lines retained on Hilton.
- No tier list beneath the bars.
- Actual/projected separation, program navigation and renderer isolation.
- Minimum desktop window layout after responsive labels settle.
- Upgrade from v1.7.3, same-version reinstall/repair, uninstall retaining the
  database, and reinstall reopening retained trips.

Local renderer TypeScript validation and production builds also passed.
The dependency audit reported zero vulnerabilities, with existing protected
dependency overrides retained. Browser checks found no label overlap or bar
overflow across the eight programs at 1360, 960 and 375 pixels, with light/dark
review, year switching and card-navigation checks.

Release application commit: `d80134d`; tag: `v1.8.1`.
The earlier v1.8.0 attempt was not published because its Windows test measured
a transient resize frame before labels finished repositioning.
