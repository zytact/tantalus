# Tantalus

A Tauri 2 desktop app for Linux, macOS, and Windows that shows Codex, Claude, and Opencode usage from the system tray. Rust reads local credentials and calls the usage APIs. The React webview receives only a token-free usage snapshot.

Claude reports a 5-hour and a 7-day window, and Opencode adds a monthly one. Codex reports whichever windows the plan has: a 5-hour and a 7-day one on Plus, a monthly one alone on Go and free. OpenAI switches the 5-hour window off for a plan from time to time, so Tantalus shows the windows a reading carries rather than assuming a fixed set.

Named for Tantalus, who stood in water he could never drink under fruit he could never reach. The app shows you a limit you cannot exceed.

## Run

```sh
vp install
vp run tauri dev
```

`vp` is the [Vite+](https://viteplus.dev) CLI. Install it with `curl -fsSL https://vite.plus | bash`. It manages Node, pnpm, and the frontend toolchain.

Settings has a switch per provider. Switching one off stops Tantalus polling it: no credential read, no request, no tray line, and it leaves the allowance view entirely. Switching it back on refreshes that provider straight away. The choice is saved to `providers.json` in the app config directory and survives a restart.

Codex and Claude start on. Opencode is a separate paid plan, so it starts off; turn it on in Settings after `opencode auth login --provider opencode-go`.

Press **Ctrl+R**, or **Cmd+R** on macOS, to refresh.

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

Every pull request builds **Tantalus Preview**: deb and rpm, an Apple silicon dmg, and a Windows NSIS installer. A comment on the PR carries a download link per platform, posted when the run starts and updated as each platform finishes, so a slow platform never holds up the others.

A preview is a separate app. `src-tauri/tauri.preview.conf.json` gives it its own product name, bundle identifier and binary name, so it installs beside a release build and keeps its own settings file, autostart entry and single-instance lock. Nothing it does touches the release install. Its mark is blue rather than orange, and the app picks that mark by reading back the identifier it was bundled with, so the icon can never disagree with the identity. macOS draws the preview tray icon in color, since the two marks share a silhouette and a template image would render them identically.

Build one locally the same way CI does:

```sh
vp run tauri build --config src-tauri/tauri.preview.conf.json
```

`src-tauri/icons/preview/` holds the blue set. Recolor `icon.png` and `tray.png` from the release pair, then regenerate the platform icons from the recolored source:

```sh
cd src-tauri/icons
magick icon.png -fuzz 18% -fill '#4C6EF5' -opaque '#FC5A19' preview/icon.png
magick tray.png -fuzz 18% -fill '#4C6EF5' -opaque '#FC5A19' preview/tray.png
cd ../.. && vp run tauri icon src-tauri/icons/preview/icon.png -o src-tauri/icons/preview
```

`tauri icon` writes the sizes the bundle needs and a set of extras this project does not commit. It never writes `tray.png`, which the two `magick` lines above cover.

## Updates

A release build checks `latest.json` on the latest published GitHub release at launch and every 6 hours. When it finds a newer version, the window shows an **Install update** banner and the tray menu gains an item that opens the window. Installing downloads the bundle the app was installed from (deb, rpm, dmg, or NSIS), verifies its signature, installs it, and relaunches. A deb or rpm install asks for an administrator password through polkit. Dev and preview builds never check.

The release workflow signs every bundle with the key in the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets, turned on by `src-tauri/tauri.release.conf.json`, and writes `latest.json` into the draft release. Installed apps see a release only after its draft is published. The matching public key lives in `src-tauri/tauri.conf.json`. Losing the private key means existing installs reject every later update, so keep a copy outside GitHub.

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
- A credential file that exists but holds no key for that provider reads as not signed in rather than as a failed refresh. Opencode shares one `auth.json` across every provider it can log into, so the file is usually there before the Go key is.
- Failed refreshes retain the last successful reading and label it stale.
