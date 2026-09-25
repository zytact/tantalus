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

Launching Tantalus opens the window. Closing it leaves the app running in the tray, and the tray's **Open Tantalus** item opens the window again. Only one instance runs at a time, so launching it a second time reopens the window of the one already running. **Quit** exits the app and stops polling.

## Dragon and tortoise

Tantalus learns how fast you usually move each window, separately for every window of every provider and hub account. When a window moves much faster than that, a dragon rides its bar. When it moves much slower while you are working, a tortoise does. Hover or focus the creature for the numbers. It is separate from the pace label, which compares what you have used with how much of the window has passed.

The rate comes from the time between the last few 1% ticks of the window's own percentage, never from tokens or cost. Each window watches for a while before it starts: 5 hours for the 5-hour window, 3.5 days for the 7-day one and 5 days for the monthly one. It also needs one stretch of use. Its usual pace is the median of its recent readings. Settings turns both creatures off, picks how big a change they wait for (Calm 4×, Normal 2.5× or Eager 1.6×), and shows what each window has learned. The log lives in `pace-log.json` and the setting in `pace-creatures.json`, both in the app config directory.

A window that is not moving shows nothing, since idle is not slow. To tell the two apart, Tantalus checks when a local Codex, Claude Code or Opencode session file last changed. It reads only modification times, never contents. A session cannot say which account it used, so when several accounts of one provider are shown, including hub accounts, the activity goes to the one whose window moved last.

The dragon and tortoise icons are by [Delapouite](https://delapouite.com) from [game-icons.net](https://game-icons.net), under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

## Remote access

Settings has two switches that let other devices open a read-only copy of the allowance page. It has no Refresh button and no Settings, and it updates whenever the app refreshes. Both start off, and the choice is saved to `remote-access.json` in the app config directory.

**Local network** listens on every interface at port 4747, so `http://<machine address>:4747` works from any device on the same network. Settings lists the addresses. Anyone on that network can read the page, and a firewall such as firewalld may need the port opened.

**Tailscale** listens on `127.0.0.1:4747` and runs `tailscale serve --bg --https=8443` to proxy it, so `https://<machine>.<tailnet>.ts.net:8443` works from any device on your tailnet. Tailscale keeps the route in its own config, so the link returns an error while Tantalus is closed. Switching it off runs `tailscale serve --https=8443 off`. Tailscale keeps one route per HTTPS port, so switching it on replaces anything you already serve on 8443, and switching it off removes it. It needs Tailscale installed and signed in, with Serve and HTTPS certificates allowed for the tailnet. On Linux, running `serve` without root also needs `sudo tailscale set --operator=$USER` once.

The server answers only requests addressed to an IP address, a single-label or `.local` name, or a `ts.net` name. Any other domain gets a 403, so a website cannot point its own domain at your machine and read the page from your browser.

If the port is taken at launch, Settings says why the routes are not being served. A preview build uses ports 4748 and 8444, so it runs beside a release.

## Build and check

```sh
vp check
vp test
vp build
vp pack
vp run package
```

`vp check` verifies formatting with Oxfmt, lints with Oxlint, and type checks. Add `--fix` to rewrite instead of report. A pre-commit hook runs `vp staged`, which applies `vp check --fix` to the staged files.

`vp run package` builds the page and the main process, then `scripts/package.ts` runs electron-builder into `release/tantalus/`: a deb and an rpm on Linux, a dmg and an updater tarball on macOS, and an NSIS installer on Windows. Build each platform's bundles on that platform. Add `-- --dir` to stop at the unpacked app. Assembling the Linux packages needs `rpmbuild`, and electron-builder's bundled fpm needs `libcrypt.so.1`, which Fedora ships as `libxcrypt-compat`.

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

A release build checks `latest.json` on the latest published GitHub release at launch and every 6 hours, and Settings has a **Check for updates** button that runs the same check on demand. When it finds a newer version, the window shows an **Install update** banner and the tray menu gains an item that opens the window. Installing downloads the update for the bundle the app was installed from (the deb, the rpm, the NSIS installer, or an app tarball on macOS), verifies its Minisign Ed25519 signature, installs it, and relaunches. A deb or rpm install asks for an administrator password through polkit. On macOS the new app replaces the old one in place, so the app needs write access to its folder. Dev and preview builds never check.

macOS builds are ad-hoc signed rather than signed with an Apple Developer ID, so the first launch of a downloaded dmg needs **Open** from the app's context menu, or `xattr -dr com.apple.quarantine /Applications/Tantalus.app`. Updates arrive without that step, since the app downloads them itself.

The release workflow signs every bundle with the existing Tauri Minisign key in the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets through `scripts/sign-update.ts`, and writes `latest.json` into the draft release. Installed Tauri and Electron versions trust that same key. The matching public key lives in `src/main/release.ts`. Losing the private key means existing installs reject every later update, so keep a copy outside GitHub.

Direct in-app updates cover the latest 15 published releases. Older versions show a link to the latest release for a fresh install after quitting Tantalus. The release workflow writes the oldest eligible version into `latest.json`; the app checks it again before installing. Add urgent notices to `release-notices.json` with a unique `id`, plain `message`, and inclusive `fromVersion` and `throughVersion` for the running app. Add `platforms` only when the notice applies to specific systems, using `linux`, `darwin`, or `win32`. Matching notices appear beside the install button and require acknowledgement. The workflow carries them into later manifests while an affected version remains eligible for direct updates, then drops them. Versions published before this notice support cannot display or enforce these fields.

For example, an entry that addresses only Linux users running version 0.0.20 is:

```json
{
  "id": "restart-before-update",
  "message": "Quit and reopen Tantalus before installing this update.",
  "fromVersion": "0.0.20",
  "throughVersion": "0.0.20",
  "platforms": ["linux"]
}
```

## Privacy and behavior

- Each refresh re-reads every credential file. `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `XDG_DATA_HOME` win when they are set. Otherwise the app reads `.codex/auth.json`, `.claude/.credentials.json`, and `.local/share/opencode/auth.json` under the home directory, which is `$HOME` on Linux and macOS and `%USERPROFILE%` on Windows.
- Codex and Claude sign in with OAuth. Opencode stores a plain API key, and Tantalus reads the `opencode-go` entry of its `auth.json`. Other entries in that file are ignored.
- On Windows, if no credential file sits in the Windows home directory, the app looks inside every installed WSL distribution over the `\\wsl.localhost` share, covering `/root` and each `/home` user. Reaching that share starts the distribution, so the logins are found without signing in again on Windows.
- The main process owns the five-minute polling schedule. The window receives token-free snapshot events and only asks the main process to refresh when the user presses Refresh.
- Network requests time out after 12 seconds. Refreshes do not overlap.
- For Codex the app tries WHAM usage first, then Codex usage, and fetches reset credits separately. Claude usage and banked resets come from `api.anthropic.com/api/oauth/usage?cedar_ember=1`, Opencode Go usage from `opencode.ai/zen/go/v1/usage`.
- The providers are fetched together and fail independently, so a missing Claude login leaves the Codex reading intact.
- A switched-off provider is skipped everywhere: the five-minute poll, the Refresh button, and the tray menu. Switching it off also drops the figures it last read.
- Tokens and account IDs remain in main process memory only. They are never sent to the window, written to disk, or logged.
- A credential file that exists but holds no key for that provider reads as not signed in rather than as a failed refresh. Opencode shares one `auth.json` across every provider it can log into, so the file is usually there before the Go key is.
- Failed refreshes retain the last successful reading and label it stale.
