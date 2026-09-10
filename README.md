# Tantalus

A Tauri 2 desktop app for Linux, macOS, and Windows that shows Codex and Claude 5-hour and 7-day usage from the system tray. Rust reads local credentials and calls the usage APIs. The React webview receives only a token-free usage snapshot.

Named for Tantalus, who stood in water he could never drink under fruit he could never reach. The app shows you a limit you cannot exceed.

## Run

```sh
vp install
vp run tauri dev
```

`vp` is the [Vite+](https://viteplus.dev) CLI. Install it with `curl -fsSL https://vite.plus | bash`. It manages Node, pnpm, and the frontend toolchain.

Settings has a switch per provider. Switching one off stops Tantalus polling it: no credential read, no request, no tray line, and it leaves the allowance view entirely. Switching it back on refreshes that provider straight away. The choice is saved to `providers.json` in the app config directory and survives a restart.

Launching Tantalus opens the window. Closing it leaves the app running in the tray, and the tray's **Show usage** item opens the window again. Only one instance runs at a time, so launching it a second time reopens the window of the one already running. **Quit** exits the app and stops polling.

## Build and check

```sh
vp check
vp test
vp build
cd src-tauri && cargo test
vp run tauri build
```

`vp check` verifies formatting with Oxfmt, lints with Oxlint, and type checks. Add `--fix` to rewrite instead of report. A pre-commit hook runs `vp staged`, which applies `vp check --fix` to the staged files.

Build each platform's installer on that platform. Tauri does not cross-compile desktop bundles.

- Linux needs Tauri's GTK/WebKit dependencies and a tray implementation. On Fedora that means `webkit2gtk4.1-devel`, `gtk3-devel`, and `libappindicator-gtk3-devel` or the Ayatana equivalent. Install them through your system package manager, not through this project.
- macOS needs Xcode command line tools.
- Windows needs the MSVC build tools and WebView2, which ships with Windows 11 and current Windows 10.

## Preview builds

Every pull request builds **Tantalus Preview**: deb and rpm, an Apple silicon dmg, and a Windows NSIS installer, attached to the workflow run and linked from a comment on the PR.

A preview is a separate app. `src-tauri/tauri.preview.conf.json` gives it its own product name, bundle identifier and binary name, so it installs beside a release build and keeps its own settings file, autostart entry and single-instance lock. Nothing it does touches the release install. Its mark is blue rather than orange, in the tray and everywhere else, and the `preview` cargo feature swaps in the matching tray icon.

`src-tauri/icons/preview/` holds that blue set, regenerated from `icon.png` with `vp run tauri icon src-tauri/icons/preview/icon.png -o src-tauri/icons/preview`.

Build one locally the same way CI does:

```sh
vp run tauri build --config src-tauri/tauri.preview.conf.json --features preview
```

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
