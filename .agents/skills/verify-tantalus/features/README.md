# Tantalus feature map

One file covers each user-facing feature backed by `src/`, `src-tauri/src/`, and the README.

- [short-window](short-window.md) - 5-hour usage entry
- [long-window](long-window.md) - 7-day usage entry
- [monthly-window](monthly-window.md) - 30-day usage entry
- [reset-credits](reset-credits.md) - Codex banked reset credits
- [manual-refresh](manual-refresh.md) - button, shortcut, tray refresh, and failure states
- [provider-switch](provider-switch.md) - provider enablement and persistence
- [settings](settings.md) - providers, version, updates, and open at login
- [tray-and-autorefresh](tray-and-autorefresh.md) - tray menu, polling, and token privacy
- [updates](updates.md) - release update checks and installation

All UI proof uses the built native Tantalus Preview app and window screenshots. Do not use a browser or injected Tauri mock. Fixture usage from `launch.sh --mock` is allowed because only the network answers change. The preview's product name, identifier, binary, settings, autostart entry, and single-instance lock are separate from the installed release.

Fixture suites prove parsing and formatting edges. The preview proves the real React webview, Rust commands, tray, and settings persistence. Real mode proves live credential paths and the windows the account actually reports. Mock mode proves specific figures and states on demand, so each proof below names a scenario.
