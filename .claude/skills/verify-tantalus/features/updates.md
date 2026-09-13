# Updates

Release builds check signed update metadata at launch and every six hours. Failures retry after 5, 10, 20 minutes and continue doubling up to six hours. Preview and debug builds never perform update checks.

A release update appears below the Allowance header, in Settings, and as `Update to v<x>` in the tray. Install update disables while downloading, verifies the signature, installs the platform bundle, and restarts. Failures restore the action and show an alert.

## Preview proof

Open Settings in the built Tantalus Preview app, confirm the displayed version, and click Check for updates. Capture the native window after the action returns. It must show `Dev and preview builds do not check for updates.` Real metadata, download, signature, privilege prompt, tray item, and relaunch need an installed release with a newer signed release and are unreachable from Preview by design.
