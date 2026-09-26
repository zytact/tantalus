---
name: verify-tantalus
description: Build and drive the isolated Tantalus Preview Electron app against real accounts or fixture usage, capture window screenshots, inspect the tray menu, and run the test suite. Use when verifying allowance windows, refresh, provider settings, remote access over the local network or Tailscale, updates, tray behavior, or usage parsing.
---

# Verify Tantalus

Tantalus is an Electron tray app. The main process in `src/main/` reads Codex, Claude, and Opencode credentials, polls their usage APIs, owns provider settings and the tray, then publishes token-free snapshots through the preload bridge to the React page in `src/renderer/`. With remote access on, it also serves a read-only copy of that page over HTTP to other devices.

Verification uses the built preview app. Electron ships its own Chromium, so the page renders the same on Linux, macOS, and Windows, and driving it over the Chrome DevTools Protocol exercises the runtime users get. Drive the preview's own window. Do not open `dist/index.html` or the Vite dev server in a separate browser, and do not stub `window.tantalus`: a plain tab has no preload bridge and no main process. The one exception is the remote access page, which is built for a plain browser. Load it from the running preview's own server with `drive.ts --web`.

## Isolation

`src/main/identity.ts` gives the verification build its own identity:

- product name `Tantalus Preview`
- app id `dev.arnab.tantalus.preview`
- executable name `tantalus-preview`
- blue app and tray icons
- remote access on port 4748 and Tailscale HTTPS port 8444, where the release uses 4747 and 8443

That identity keeps the preview's settings directory, open-at-login entry, single-instance lock, and remote access ports separate from the release app. Do not launch `release/tantalus/`, install a release bundle, or quit an existing release instance during verification.

## Launch

Run from the repo root. The launch needs Xvfb, `curl`, and `python3`.

```sh
EVIDENCE=/tmp/opencode/tantalus-verify/$(date +%Y%m%d-%H%M%S)
mkdir -p "$EVIDENCE"
.agents/skills/verify-tantalus/scripts/build-preview.sh 2>&1 | tee "$EVIDENCE/preview-build.log"
.agents/skills/verify-tantalus/scripts/launch.sh 2>&1 | tee "$EVIDENCE/launch.log"
.agents/skills/verify-tantalus/scripts/doctor.sh 2>&1 | tee "$EVIDENCE/doctor.log"
```

Pass `--mock [SCENARIO]` to `launch.sh` for fixture usage (see Usage modes). Without it the preview reads real accounts. Pass `--restart` to quit and relaunch only the preview, keeping the display, usage mode, fixture server, and saved settings, which is how a proof shows that something survives a restart. Run doctor again after it.

`build-preview.sh` refuses while a harness preview is running, since replacing the binary under it leaves a process the harness no longer recognizes. Run `cleanup.sh` before rebuilding, then launch again.

If `build-preview.sh` fails with `The specified electronDist does not exist`, the install skipped Electron's download, which happens in a fresh worktree. Run `node node_modules/electron/install.js` and build again.

`build-preview.sh` runs `vp build`, `vp pack`, and `node scripts/package.ts --preview --dir`, then checks for `release/tantalus-preview/linux-unpacked/tantalus-preview`. It does not install or package anything. `launch.sh` starts only that executable on an isolated Xvfb display with `--remote-debugging-port` on a free local port, and records the PIDs and the port under `/tmp/opencode/tantalus-verify/`. Set `TANTALUS_XVFB` when Xvfb is not on `PATH`.

Ready means `doctor.sh` confirms the preview identity, executable, recorded process, isolated display, DevTools port, and usage mode. Run doctor before the first drive and again after any failed or surprising interaction.

## Usage modes

**Real.** `launch.sh` reads the local credential files and calls the live usage APIs. It proves real credential paths, real response shapes, and the account's actual plan. Doctor fails if a harness fixture server is still running.

**Mock.** `launch.sh --mock` starts `fixture-server.py` on a free 127.0.0.1 port and launches the preview with `TANTALUS_USAGE_BASE_URL` pointing at it. Only preview builds honor that variable, so release builds always call the providers. The preview still runs its real main process, parsers, IPC, and window; only the network answers change. The launch also writes fixture credentials for all three providers under `/tmp/opencode/tantalus-verify/mock-home/` and points `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, and `HOME` there, so real credentials, saved provider settings, and the preview's autostart entry are never touched. On Linux both the settings directory and the autostart entry follow `XDG_CONFIG_HOME`. In real mode they land in your real config directory, so restore Open at login before teardown. Chromium rewrites its own process environment, so doctor proves mock mode from the fixture request log instead of the preview's environment.

The launch serves `ready` unless a scenario follows `--mock`. Switch scenarios while the preview runs, then Refresh:

```sh
.agents/skills/verify-tantalus/scripts/mock-scenario.sh ready
```

- `ready`: Codex 5h and 7d with two credits, Claude 5h and 7d with one banked reset and extra usage, Opencode 5h, 7d, and 30d. Windows sit below, at, and above the elapsed share, so every pace label the build has appears.
- `monthly-only`: Codex reports only a 30-day window and an empty credit list.
- `blocked`: Codex limit reached, Claude locked with no banked resets, Opencode rolling window at 100%.
- `no-windows`: every provider answers with no recognized window.
- `error`: every usage request returns 500. Before any success this reads `Could not refresh`; after one it reads `Cached`.

Every fixture request is logged with its timestamp, scenario, and path in `/tmp/opencode/tantalus-verify/fixture-requests.log`. Use it to prove which provider was read and the retry cadence. Copy it into the evidence directory before cleanup. A request without a fixture token gets 401, so a logged 200 path also proves the preview read the fixture credentials.

Use mock mode for states a real account cannot produce on demand and for every feature proof that depends on specific figures. Use real mode at least once per run to prove live credentials and response shapes still parse.

## Drive

Use one preview process per usage mode, and run cleanup before switching modes. `drive.ts` connects to the recorded DevTools port for each command and disconnects without closing the app:

```sh
node .agents/skills/verify-tantalus/scripts/drive.ts snapshot
node .agents/skills/verify-tantalus/scripts/drive.ts click button Settings
node .agents/skills/verify-tantalus/scripts/drive.ts click switch Opencode
node .agents/skills/verify-tantalus/scripts/drive.ts fill textbox "Hub URL" http://127.0.0.1:8317
node .agents/skills/verify-tantalus/scripts/drive.ts scroll button Reset
node .agents/skills/verify-tantalus/scripts/drive.ts press Control+R
node .agents/skills/verify-tantalus/scripts/drive.ts screenshot "$EVIDENCE" settings
```

`snapshot` prints the accessibility tree, which is the fastest way to read figures, status words, and alerts. Click, fill, and scroll by ARIA role and accessible name, as the snapshot shows them. `screenshot` captures only what the window shows, so scroll the element you want into view first.

Prefix a command with `--web <url>` to run it against the remote access page instead. It launches a fresh headless Chrome at phone size (`/usr/bin/google-chrome`, or `TANTALUS_CHROME`), waits for the first snapshot to arrive, runs the command, and closes that Chrome. The preview is untouched:

```sh
node .agents/skills/verify-tantalus/scripts/drive.ts --web http://127.0.0.1:4748/ snapshot
node .agents/skills/verify-tantalus/scripts/drive.ts --web https://<machine>.<tailnet>.ts.net:8444/ screenshot "$EVIDENCE" web
```

1. Run the offline suite:

```sh
vp test 2>&1 | tee "$EVIDENCE/vitest.log"
```

2. Capture the initial window with `drive.ts screenshot "$EVIDENCE" allowance`.

3. Exercise the mapped window and refresh features in the preview:

- Enable the provider needed for the account in Settings.
- Return to Allowance and activate Refresh.
- Capture the busy state when practical, then the completed state.
- Confirm every reported Short, Long, and Monthly window, Reset credits or Extra usage, status word, refresh timestamp, and remaining figure against the account response.
- Accounts expose different windows. An absent plan-specific window is valid; do not invent an unavailable row when another recognized window exists.

4. Exercise Settings:

- Switch one provider off, confirm its allowance block and tray rows disappear, then switch it back on and confirm the immediate refresh.
- Confirm Codex and Claude default on and Opencode defaults off only when the preview has no saved settings.
- Confirm the version and the Open at login switch. Restore the original value before teardown.
- Click Check for updates. Preview must report `Dev and preview builds do not check for updates.`
- Exercise Local network and Tailscale (see `features/remote-access.md`). Switch both off before teardown.

5. Exercise the tray (see `features/tray-and-autorefresh.md`).

6. Capture screenshots after each materially different state.

In real mode the preview reads local credential files and calls the live usage APIs. Never print tokens or pass them on a command line. To prove auth-missing behavior without touching real credentials, launch with empty `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `XDG_DATA_HOME` directories under `/tmp/opencode/tantalus-verify/coverage-home/`. Restore a normal preview launch before proving live readings.

## Evidence

Keep each run under `/tmp/opencode/tantalus-verify/<timestamp>/`:

- `preview-build.log`, `launch.log`, and `doctor.log`
- `vitest.log`
- one PNG per meaningful window state
- concise `notes.md` listing features covered, inaccessible prerequisites, and observed drift

A screenshot proves the rendered page. Pair it with the relevant interaction and suite result. Closing the window destroys its page, so `drive.ts` reports no window until the tray or a second launch opens it again.

## Cleanup

```sh
.agents/skills/verify-tantalus/scripts/cleanup.sh
```

The helper kills only the preview, fixture server, and Xvfb PIDs started by `launch.sh`, removes the `coverage-home` and `mock-home` scaffolding, and preserves evidence. Tailscale keeps the preview's route in its own config after the app quits, so cleanup also runs `tailscale serve --https=8444 off`, but only while that route still points at `127.0.0.1:4748`. Never use `pkill`, `killall`, or release-app process names. After cleanup, confirm the evidence directory still exists.

## Helpers

All helpers in `scripts/` are executable or run with `node`:

- `build-preview.sh` builds the separately identified preview app without installing it, and refuses while a harness preview runs
- `launch.sh [--mock [SCENARIO] | --restart]` starts the built preview on an isolated Xvfb display with its DevTools port open, with a fixture server in mock mode, or relaunches only the preview
- `drive.ts [--web URL] <snapshot | click ROLE NAME | fill ROLE NAME TEXT | scroll ROLE NAME | press KEY | screenshot DIR [NAME]>` drives the preview window, or the remote access page in headless Chrome
- `fixture-server.py <PORT_FILE> <REQUEST_LOG> <SCENARIO>` serves scenario responses on the providers' paths; `launch.sh --mock` starts it
- `mock-scenario.sh <NAME>` switches the running fixture scenario
- `seed-pace.sh` writes a learned pace log into the mock settings directory, and refuses outside mock mode; run `launch.sh --restart` after it
- `doctor.sh` checks the preview identity, processes, display, DevTools port, and usage mode without changing state
- `cleanup.sh` stops only the harness-owned preview, fixture server, and display, removes the preview's Tailscale route, and preserves evidence

The feature map is in `features/`. Read the relevant file before driving that feature.
