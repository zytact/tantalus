# Settings

The Settings page reports the installed Tantalus version and controls whether
the operating system opens Tantalus at login.

## Sub-features

- The Allowance header has a `Settings` button, and Settings has a `Back`
  button. Returning keeps the existing usage snapshot and refresh state.
- Version comes from `getVersion()`, which reads the current Tauri bundle
  version. A failed lookup shows `Unavailable` without blocking the startup
  preference.
- `role=switch[name="Open at login"]` reflects `isEnabled()` from the official
  autostart plugin. The app renders `Checking`, not an unchecked switch, until
  that value arrives.
- Switching on calls `enable()` and switching off calls `disable()`. The switch
  changes only after the plugin call succeeds. A failed call keeps the previous
  state and announces an inline alert.

## Browser proof

Launch the isolated Vite server and install `scripts/tauri-mock.js` as described
in the parent skill. The mock answers the app version and all three autostart
commands without touching the operating system.

1. Click `Settings`. Confirm the heading, `v0.0.3`, and an off
   `role=switch[name="Open at login"]`.
2. Click the switch. Confirm it turns on and
   `localStorage["tantalus-mock-autostart"]` is `"true"`.
3. Click `Back`, then `Settings`. Confirm the switch remains on.
4. Run `window.__TANTALUS_MOCK__.fail("plugin:autostart|disable")`, click the
   switch, and confirm it stays on while the alert reads
   `Could not turn off opening at login.`
5. Run `window.__TANTALUS_MOCK__.reset()` after the proof.

The browser proves navigation, copy, state transitions, failure handling, and
the mock persistence boundary. It cannot prove OS startup registration.

## Native proof

On a real desktop, note the existing autostart state, toggle it, call Settings
again to confirm the plugin reads the new state, then restore the original
setting. Skip this step when the desktop runtime or tray dependencies are not
available, and report the limitation.
