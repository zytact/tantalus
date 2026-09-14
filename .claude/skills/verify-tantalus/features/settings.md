# Settings

Settings contains provider switches for Codex, Claude, and Opencode, the Open at login switch, the Local network and Tailscale switches, the build version, and Check for updates. Back returns to the existing allowance snapshot.

Open at login registers a login item on macOS and Windows, and an XDG autostart entry on Linux, launching with `--hidden`. It reads the operating-system state on each Settings mount, shows Checking or Saving during work, and keeps the old value on failure. The version comes from `package.json`. The adjacent update action has its own busy and error states. The remote access switches are described in the remote access feature.

## Preview proof

Open Settings in Tantalus Preview and capture the window. Confirm all three providers, Open at login, Local network, Tailscale, Version, and Check for updates. Toggle one provider and verify persistence per the provider feature. Record the original autostart state, toggle it, reopen Settings to confirm the operating-system value, then restore it. Check for updates must report that dev and preview builds do not update. A full `--hidden` login proof requires a real login-session restart.
