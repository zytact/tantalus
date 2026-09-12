# Updates

Rust checks the `latest.json` on the latest GitHub release at launch and every 6 hours, retrying
after 5 minutes when a check fails. Dev builds (`debug_assertions`) and preview builds never check.

## Sub-features

- A found release shows a `role=region[name="Update available"]` banner under the Allowance header
  reading `Version <x> is available.` with an `Install update` button.
- The tray menu gains `Update to v<x>` above `Show usage`. Clicking it opens the window.
- `Install update` reads `Installing` with `aria-busy=true` while Rust downloads, verifies the
  signature and installs. A deb or rpm install asks for a password through polkit. Success relaunches
  the app. A failure, including a cancelled prompt, puts the button back with a `role=alert` notice.

## Browser proof

After the mock is installed and remounted, `window.__TANTALUS_MOCK__.offerUpdate("0.0.9")` stands in
for a finished check and emits `update-available`. Click `Install update` and read the busy state in
the same tick. `window.__TANTALUS_MOCK__.fail("install_update")` drives the failure notice.

## Manual only

The real check, download, signature check, polkit prompt and relaunch need an installed release
build and a newer published release. The tray item needs a real desktop.
