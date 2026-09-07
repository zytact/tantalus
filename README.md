# Tantalus

A Tauri 2 desktop app for Linux, macOS, and Windows that shows Codex and Claude 5-hour and 7-day usage from the system tray. Rust reads local credentials and calls the usage APIs. The React webview receives only a token-free usage snapshot.

Named for Tantalus, who stood in water he could never drink under fruit he could never reach. The app shows you a limit you cannot exceed.

## Run

```sh
pnpm install
pnpm tauri dev
```

Each provider has its own header row with a switch. Switching a provider off stops Tantalus polling it: no credential read, no request, no tray line, and its windows and credits leave the window. Switching it back on refreshes that provider straight away. The choice is saved to `providers.json` in the app config directory and survives a restart.

Closing the window hides it in the tray. Use the tray's **Show usage** item to bring it back. **Quit** exits the app and stops polling.

## Build and check

```sh
pnpm build
pnpm test
cd src-tauri && cargo test
pnpm tauri build
```

Build each platform's installer on that platform. Tauri does not cross-compile desktop bundles.

- Linux needs Tauri's GTK/WebKit dependencies and a tray implementation. On Fedora that means `webkit2gtk4.1-devel`, `gtk3-devel`, and `libappindicator-gtk3-devel` or the Ayatana equivalent. Install them through your system package manager, not through this project.
- macOS needs Xcode command line tools.
- Windows needs the MSVC build tools and WebView2, which ships with Windows 11 and current Windows 10.

## Privacy and behavior

- Each refresh re-reads both credential files. `CODEX_HOME` and `CLAUDE_CONFIG_DIR` win when they are set. Otherwise the app reads `.codex/auth.json` and `.claude/.credentials.json` under the home directory, which is `$HOME` on Linux and macOS and `%USERPROFILE%` on Windows.
- On Windows, if no credential file sits in the Windows home directory, the app looks inside every installed WSL distribution over the `\\wsl.localhost` share, covering `/root` and each `/home` user. Reaching that share starts the distribution, so the logins are found without signing in again on Windows.
- Rust owns the five-minute polling schedule. The webview receives token-free snapshot events and only asks Rust to refresh when the user presses Refresh.
- Network requests time out after 12 seconds. Refreshes do not overlap.
- For Codex the app tries WHAM usage first, then Codex usage, and fetches reset credits separately. Claude usage comes from `api.anthropic.com/api/oauth/usage`.
- The two providers are fetched together and fail independently, so a missing Claude login leaves the Codex reading intact.
- A switched-off provider is skipped everywhere: the five-minute poll, the Refresh button, and the tray menu. Switching it off also drops the figures it last read.
- Tokens and account IDs remain in Rust memory only. They are never sent to the webview, written to disk, or logged.
- Failed refreshes retain the last successful reading and label it stale.
