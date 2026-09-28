# Elite Status Tracker v1.7.3

The dashboard now separates actual earnings from projected qualification. The
Windows installer is published on the [v1.7.3 release page](https://github.com/anndunkin/elite-status-tracker/releases/tag/v1.7.3).

## Download and install

[Download Elite Status Tracker Setup 1.7.3.exe](https://github.com/anndunkin/elite-status-tracker/releases/download/v1.7.3/Elite.Status.Tracker.Setup.1.7.3.exe).

Close the application, retain a backup of your tracker file, and run the installer
using your existing installation folder. Upgrade from v1.6.2 was tested with
synthetic trips; the database and trips were retained
([Windows validation run](https://github.com/anndunkin/elite-status-tracker/actions/runs/36482796204)).

The installer is unsigned: no signing private key was available. This limitation
is also stated in the [release notes](https://github.com/anndunkin/elite-status-tracker/releases/tag/v1.7.3).

- File size: 112,609,435 bytes.
- SHA-256: `ed3dc1dfa1d537f9a97c101b8ff0d631cb81aa2a56cbd77742aa5dc129f0fd84`

The file size and digest are the uploaded asset metadata from the
[GitHub release](https://github.com/anndunkin/elite-status-tracker/releases/tag/v1.7.3).
The download was checked and returned HTTP 200.

## Behavior

- **Actual earned:** YTD actual earnings toward the next actual tier, independent
  of held status, lifetime status, and forecast earnings.
- **Projected total:** All tiers, including totals from completed, booked, and
  planned travel, plus existing posted adjustments and card earnings.
- **Clear qualification language:** Forecast milestones say “Projected to meet.”
  “Top tier earned” appears only when actual annual earnings qualify.
- **Multiple metrics:** All requirements within a route must be met; alternative
  qualification routes are respected.
- **Tier scale:** Projected milestones are evenly spaced by tier rather than
  presented as a single-unit distance scale.
- **Preserved behavior:** Lifetime Million Miler progress, program detail pages,
  stored data, and file-management features remain intact.
- **Small windows:** The header wraps to keep the theme control visible, and
  program-card content aligns to the top.

These changes are documented in the
[v1.7.3 release](https://github.com/anndunkin/elite-status-tracker/releases/tag/v1.7.3).

## Verification results

The [successful Windows workflow](https://github.com/anndunkin/elite-status-tracker/actions/runs/36482796204)
passed all 228 automated tests, built the renderer and Electron application,
rebuilt the native database module, and packaged the Windows installer.
Installer lifecycle checks passed for:

- Previous-version clean installation and synthetic data creation.
- Upgrade from v1.6.2 with database and trip retention.
- Packaged dual-bar rendering, forecast separation, and program navigation.
- Renderer context isolation with Node integration disabled.
- Minimum-window layout and usable theme controls.
- Same-version reinstall/repair with data retention.
- Uninstallation removing the application but preserving the database.
- Reinstallation reopening the retained trips.

Additional local checks passed: renderer TypeScript validation, production build,
and dependency audit with zero reported vulnerabilities. The pre-existing
keyv/cacheable-request supply-chain protection overrides were retained.
The regression suite includes security, validation, boundary, functionality,
AA's March-February year, and the three travel lifecycle states.

Light/dark and narrow-layout browser checks used synthetic examples, not the
user's travel data. Windows evidence is attached to the successful workflow;
the initial light/dark captures caught a brief existing color transition, while
the final minimum-window capture shows the settled state. The test harness on
main now disables animations when capturing future screenshots.

## Release traceability

- Release tag: `v1.7.3`.
- Application commit: `91bdf71`.
- v1.7.0 and v1.7.1 were blocked before publication by test-harness assumptions.
- v1.7.2 was cancelled before publication to include the small-window header fix.
- No schema migration was added for this dashboard change.
