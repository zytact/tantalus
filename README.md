# Tantalus

An Electron app for Linux, macOS, and Windows that shows Codex, Claude, and Opencode usage from the system tray. The main process reads local credentials and calls the usage APIs. The React window receives only a token-free usage snapshot.

Claude reports a 5-hour and a 7-day window, and Opencode adds a monthly one. Codex reports whichever windows the plan has: a 5-hour and a 7-day one on Plus, a monthly one alone on Go and free. OpenAI switches the 5-hour window off for a plan from time to time, so Tantalus shows the windows a reading carries rather than assuming a fixed set.

Named for Tantalus, who stood in water he could never drink under fruit he could never reach. The app shows you a limit you cannot exceed.

## Run

```sh
vp install
vp run dev
```

`vp` is the [Vite+](https://viteplus.dev) CLI. Install it with `curl -fsSL https://vite.plus | bash`. It manages Node, pnpm, and the toolchain. `vp run dev` serves the page with hot reload and rebuilds the main process as it changes; main process changes take effect on the next launch.

Settings has a switch per provider. Switching one off stops Tantalus polling it: no credential read, no request, no tray line, and it leaves the allowance view entirely. Switching it back on refreshes that provider straight away. The choice is saved to `providers.json` in the app config directory and survives a restart.

Codex and Claude start on. Opencode is a separate paid plan, so it starts off; turn it on in Settings after `opencode auth login --provider opencode-go`.

Press **Ctrl+R**, or **Cmd+R** on macOS, to refresh.

Launching Tantalus opens the window. Closing it leaves the app running in the tray, and the tray's **Show usage** item opens the window again. Only one instance runs at a time, so launching it a second time reopens the window of the one already running. **Quit** exits the app and stops polling.

## Build and check

```sh
vp check
vp test
vp build
vp pack
vp run package
```

`vp check` verifies formatting with Oxfmt, lints with Oxlint, and type checks. Add `--fix` to rewrite instead of report. A pre-commit hook runs `vp staged`, which applies `vp check --fix` to the staged files.

`vp run package` builds the page and the main process, then `scripts/package.ts` runs electron-builder into `release/tantalus/`: a deb and an rpm on Linux, a dmg and an updater zip on macOS, and an NSIS installer on Windows. Build each platform's bundles on that platform. Add `-- --dir` to stop at the unpacked app. Assembling the Linux packages needs `rpmbuild`, and electron-builder's bundled fpm needs `libcrypt.so.1`, which Fedora ships as `libxcrypt-compat`.

## Preview builds

A preview is a separate app. `src/main/identity.ts` gives it its own product name, app id, and executable name, so it installs beside a release build and keeps its own settings directory, autostart entry, and single-instance lock. Nothing it does touches the release install. Its mark is blue rather than orange, and the app picks that mark by reading back the name it was bundled with, so the icon can never disagree with the identity. macOS draws the preview tray icon in color, since the two marks share a silhouette and a template image would render them identically.

Build one locally:

```sh
vp build && vp pack && node scripts/package.ts --preview --dir
```

`build/icons/preview/` holds the blue set. electron-builder makes each platform's icon from the 512-pixel `icon.png`, so recoloring `icon.png` and `tray.png` from the release pair is the whole job:

```sh
cd build/icons
magick icon.png -fuzz 18% -fill '#4C6EF5' -opaque '#FC5A19' preview/icon.png
magick tray.png -fuzz 18% -fill '#4C6EF5' -opaque '#FC5A19' preview/tray.png
```

## Updates

A release build checks `latest.json` on the latest published GitHub release at launch and every 6 hours, and Settings has a **Check for updates** button that runs the same check on demand. When it finds a newer version, the window shows an **Install update** banner and the tray menu gains an item that opens the window. Installing downloads the update for the bundle the app was installed from (the deb, the rpm, the NSIS installer, or a zip on macOS), verifies its Ed25519 signature, installs it, and relaunches. A deb or rpm install asks for an administrator password through polkit. On macOS the new app replaces the old one in place, so the app needs write access to its folder. Dev and preview builds never check.

macOS builds are ad-hoc signed rather than signed with an Apple Developer ID, so the first launch of a downloaded dmg needs **Open** from the app's context menu, or `xattr -dr com.apple.quarantine /Applications/Tantalus.app`. Updates arrive without that step, since the app downloads them itself.

The release workflow signs every bundle with the private key in the `UPDATE_SIGNING_KEY` secret through `scripts/sign-update.ts`, and writes `latest.json` into the draft release. Installed apps see a release only after its draft is published. The matching public key lives in `src/main/release.ts`. Losing the private key means existing installs reject every later update, so keep a copy outside GitHub. To make a new pair:

```sh
openssl genpkey -algorithm ed25519 -out update-signing-key.pem
openssl pkey -in update-signing-key.pem -pubout
```

## Privacy and behavior

- Each refresh re-reads every credential file. `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `XDG_DATA_HOME` win when they are set. Otherwise the app reads `.codex/auth.json`, `.claude/.credentials.json`, and `.local/share/opencode/auth.json` under the home directory, which is `$HOME` on Linux and macOS and `%USERPROFILE%` on Windows.
- Codex and Claude sign in with OAuth. Opencode stores a plain API key, and Tantalus reads the `opencode-go` entry of its `auth.json`. Other entries in that file are ignored.
- On Windows, if no credential file sits in the Windows home directory, the app looks inside every installed WSL distribution over the `\\wsl.localhost` share, covering `/root` and each `/home` user. Reaching that share starts the distribution, so the logins are found without signing in again on Windows.
- The main process owns the five-minute polling schedule. The window receives token-free snapshot events and only asks the main process to refresh when the user presses Refresh.
- Network requests time out after 12 seconds. Refreshes do not overlap.
- For Codex the app tries WHAM usage first, then Codex usage, and fetches reset credits separately. Claude usage comes from `api.anthropic.com/api/oauth/usage`, Opencode Go usage from `opencode.ai/zen/go/v1/usage`.
- The providers are fetched together and fail independently, so a missing Claude login leaves the Codex reading intact.
- A switched-off provider is skipped everywhere: the five-minute poll, the Refresh button, and the tray menu. Switching it off also drops the figures it last read.
- Tokens and account IDs remain in main process memory only. They are never sent to the window, written to disk, or logged.
- A credential file that exists but holds no key for that provider reads as not signed in rather than as a failed refresh. Opencode shares one `auth.json` across every provider it can log into, so the file is usually there before the Go key is.
- Failed refreshes retain the last successful reading and label it stale.
