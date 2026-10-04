# Updates

Release builds check `latest.json` on the latest GitHub release at launch and every six hours. Failures retry after 5, 10, 20 minutes and continue doubling up to six hours. Preview and debug builds never perform update checks.

A release update appears below the Allowance header, in Settings, and as `Update to v<x>` in the tray. The remote access page never shows it. What's new opens the release notes. Any required notices must be acknowledged before Install update becomes available. During installation, a progress strip replaces the offer, measures download progress when the size is known, and shows later steps without a percentage. The main process verifies the Ed25519 signature, installs the platform bundle, and relaunches. Failures restore the action and show an alert. When the installed version is below the release's minimum supported version, the offer instead asks for a fresh install and opens the latest release page.

## Preview proof

Open Settings in the built Tantalus Preview app, confirm the displayed version, and click Check for updates. Capture the window after the action returns. It must show `Dev and preview builds do not check for updates.` Metadata, release notes, notice acknowledgement, progress, signature verification, privilege prompt, tray item, relaunch, and fresh-install fallback need an installed release with a suitable newer signed release and are unreachable from Preview by design. Record that prerequisite rather than simulating a release in Preview.
