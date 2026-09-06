# Tantalus

A Tauri 2 desktop app for Linux, macOS, and Windows that shows Codex 5-hour and 7-day usage from the system tray. Rust reads local credentials and calls the usage APIs. The React webview receives only a token-free usage snapshot.

Named for Tantalus, who stood in water he could never drink under fruit he could never reach. The app shows you a limit you cannot exceed.

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

Build each platform's installer on that platform. Tauri does not cross-compile desktop bundles.

- Linux needs Tauri's GTK/WebKit dependencies and a tray implementation. On Fedora that means `webkit2gtk4.1-devel`, `gtk3-devel`, and `libappindicator-gtk3-devel` or the Ayatana equivalent. Install them through your system package manager, not through this project.
- macOS needs Xcode command line tools.
- Windows needs the MSVC build tools and WebView2, which ships with Windows 11 and current Windows 10.

## Privacy and behavior

- Each refresh re-reads the credential file. `CODEX_HOME` wins when it is set. Otherwise the app reads `.codex/auth.json` under the home directory, which is `$HOME` on Linux and macOS and `%USERPROFILE%` on Windows.
- On Windows, if no credential file sits in the Windows home directory, the app looks inside every installed WSL distribution over the `\\wsl.localhost` share, covering `/root` and each `/home` user. Reaching that share starts the distribution, so the login is found without running `codex login` again on Windows.
- Rust owns the one-minute polling schedule. The webview receives token-free snapshot events and only asks Rust to refresh when the user presses Refresh.
- Network requests time out after 12 seconds. Refreshes do not overlap.
- The app tries WHAM usage first, then Codex usage, and fetches reset credits separately.
- Tokens and account IDs remain in Rust memory only. They are never sent to the webview, written to disk, or logged.
- Failed refreshes retain the last successful reading and label it stale.
