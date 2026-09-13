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

All UI proof uses the built native Tantalus Preview app and window screenshots. Do not use a browser or injected Tauri mock. The preview's product name, identifier, binary, settings, autostart entry, and single-instance lock are separate from the installed release.

Fixture suites prove parsing and formatting edges. The preview proves the real React webview, Rust commands, tray, settings persistence, and live credential paths. Account plans expose different window combinations, so prove the windows the account actually reports.
