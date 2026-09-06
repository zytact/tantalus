# Codex Usage Tray

A Linux-first Tauri 2 desktop app that shows Codex 5-hour and 7-day usage from the system tray. Rust reads local credentials and calls the usage APIs. The React webview receives only a token-free usage snapshot.

## Run

```sh
pnpm install
pnpm tauri dev
```

Closing the window hides it in the tray. Use the tray's **Show usage** item to bring it back. **Quit** exits the app and stops polling.

## Build and check

```sh
pnpm build
pnpm test
cd src-tauri && cargo test
pnpm tauri build
```

Linux builds require Tauri's GTK/WebKit dependencies and a tray implementation. On Fedora, the relevant development packages include `webkit2gtk4.1-devel`, `gtk3-devel`, and `libappindicator-gtk3-devel` or the Ayatana equivalent. Install them through your system package manager, not through this project.

## Privacy and behavior

- Each refresh re-reads `${CODEX_HOME:-$HOME/.codex}/auth.json`.
- Rust owns the one-minute polling schedule. The webview receives token-free snapshot events and only asks Rust to refresh when the user presses Refresh.
- Network requests time out after 12 seconds. Refreshes do not overlap.
- The app tries WHAM usage first, then Codex usage, and fetches reset credits separately.
- Tokens and account IDs remain in Rust memory only. They are never sent to the webview, written to disk, or logged.
- Failed refreshes retain the last successful reading and label it stale.
