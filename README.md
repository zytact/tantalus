# Tantalus

A Tauri 2 desktop app for Linux, macOS, and Windows that shows Codex, Claude, and Opencode usage from the system tray. Rust reads local credentials and calls the usage APIs. The React webview receives only a token-free usage snapshot.

Every provider reports a 5-hour and a 7-day window. Opencode adds a monthly one.

Named for Tantalus, who stood in water he could never drink under fruit he could never reach. The app shows you a limit you cannot exceed.

## Run

```sh
vp install
vp run tauri dev
```

`vp` is the [Vite+](https://viteplus.dev) CLI. Install it with `curl -fsSL https://vite.plus | bash`. It manages Node, pnpm, and the frontend toolchain.

Settings has a switch per provider. Switching one off stops Tantalus polling it: no credential read, no request, no tray line, and it leaves the allowance view entirely. Switching it back on refreshes that provider straight away. The choice is saved to `providers.json` in the app config directory and survives a restart.

Codex and Claude start on. Opencode is a separate paid plan, so it starts off; turn it on in Settings after `opencode auth login --provider opencode-go`.

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

## Privacy and behavior

- Each refresh re-reads every credential file. `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `XDG_DATA_HOME` win when they are set. Otherwise the app reads `.codex/auth.json`, `.claude/.credentials.json`, and `.local/share/opencode/auth.json` under the home directory, which is `$HOME` on Linux and macOS and `%USERPROFILE%` on Windows.
- Codex and Claude sign in with OAuth. Opencode stores a plain API key, and Tantalus reads the `opencode-go` entry of its `auth.json`. Other entries in that file are ignored.
- On Windows, if no credential file sits in the Windows home directory, the app looks inside every installed WSL distribution over the `\\wsl.localhost` share, covering `/root` and each `/home` user. Reaching that share starts the distribution, so the logins are found without signing in again on Windows.
- Rust owns the five-minute polling schedule. The webview receives token-free snapshot events and only asks Rust to refresh when the user presses Refresh.
- Network requests time out after 12 seconds. Refreshes do not overlap.
- For Codex the app tries WHAM usage first, then Codex usage, and fetches reset credits separately. Claude usage comes from `api.anthropic.com/api/oauth/usage`, Opencode Go usage from `opencode.ai/zen/go/v1/usage`.
- The providers are fetched together and fail independently, so a missing Claude login leaves the Codex reading intact.
- A switched-off provider is skipped everywhere: the five-minute poll, the Refresh button, and the tray menu. Switching it off also drops the figures it last read.
- Tokens and account IDs remain in Rust memory only. They are never sent to the webview, written to disk, or logged.
- Failed refreshes retain the last successful reading and label it stale.
