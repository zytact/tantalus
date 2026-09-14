---
name: verify-tantalus
description: Build and drive the isolated Tantalus Preview Electron app against real accounts or fixture usage, capture window screenshots, inspect the tray menu, and run the test suite. Use when verifying allowance windows, refresh, provider settings, updates, tray behavior, or usage parsing.
---

# Verify Tantalus

Tantalus is an Electron tray app. The main process in `src/main/` reads Codex, Claude, and Opencode credentials, polls their usage APIs, owns provider settings and the tray, then publishes token-free snapshots through the preload bridge to the React page in `src/renderer/`.

Verification uses the built preview app. Electron ships its own Chromium, so the page renders the same on Linux, macOS, and Windows, and driving it over the Chrome DevTools Protocol exercises the runtime users get. Drive the preview's own window. Do not open `dist/index.html` or the Vite dev server in a separate browser, and do not stub `window.tantalus`: a plain tab has no preload bridge and no main process.

## Isolation

`src/main/identity.ts` gives the verification build its own identity:

- product name `Tantalus Preview`
- app id `dev.arnab.tantalus.preview`
- executable name `tantalus-preview`
- blue app and tray icons

That identity keeps the preview's settings directory, open-at-login entry, and single-instance lock separate from the release app. Do not launch `release/tantalus/`, install a release bundle, or quit an existing release instance during verification.

## Launch

Run from the repo root. The launch needs Xvfb, `curl`, and `python3`.

```sh
EVIDENCE=/tmp/opencode/tantalus-verify/$(date +%Y%m%d-%H%M%S)
mkdir -p "$EVIDENCE"
.agents/skills/verify-tantalus/scripts/build-preview.sh 2>&1 | tee "$EVIDENCE/preview-build.log"
.agents/skills/verify-tantalus/scripts/launch.sh 2>&1 | tee "$EVIDENCE/launch.log"
.agents/skills/verify-tantalus/scripts/doctor.sh 2>&1 | tee "$EVIDENCE/doctor.log"
```

Pass `--mock [SCENARIO]` to `launch.sh` for fixture usage (see Usage modes). Without it the preview reads real accounts.

`build-preview.sh` runs `vp build`, `vp pack`, and `node scripts/package.ts --preview --dir`, then checks for `release/tantalus-preview/linux-unpacked/tantalus-preview`. It does not install or package anything. `launch.sh` starts only that executable on an isolated Xvfb display with `--remote-debugging-port` on a free local port, and records the PIDs and the port under `/tmp/opencode/tantalus-verify/`. Set `TANTALUS_XVFB` when Xvfb is not on `PATH`.

Ready means `doctor.sh` confirms the preview identity, executable, recorded process, isolated display, DevTools port, and usage mode. Run doctor before the first drive and again after any failed or surprising interaction.

## Usage modes

**Real.** `launch.sh` reads the local credential files and calls the live usage APIs. It proves real credential paths, real response shapes, and the account's actual plan. Doctor fails if a harness fixture server is still running.

**Mock.** `launch.sh --mock` starts `fixture-server.py` on a free 127.0.0.1 port and launches the preview with `TANTALUS_USAGE_BASE_URL` pointing at it. Only preview builds honor that variable, so release builds always call the providers. The preview still runs its real main process, parsers, IPC, and window; only the network answers change. The launch also writes fixture credentials for all three providers under `/tmp/opencode/tantalus-verify/mock-home/` and points `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, and `HOME` there, so real credentials, saved provider settings, and the preview's autostart entry are never touched. On Linux both the settings directory and the autostart entry follow `XDG_CONFIG_HOME`. In real mode they land in your real config directory, so restore Open at login before teardown. Chromium rewrites its own process environment, so doctor proves mock mode from the fixture request log instead of the preview's environment.

The launch serves `ready` unless a scenario follows `--mock`. Switch scenarios while the preview runs, then Refresh:

```sh
.agents/skills/verify-tantalus/scripts/mock-scenario.sh ready
```

- `ready`: Codex 5h and 7d with two credits, Claude 5h and 7d with extra usage, Opencode 5h, 7d, and 30d. Windows sit below, at, and above the elapsed share, so every pace label the build has appears.
- `monthly-only`: Codex reports only a 30-day window and an empty credit list.
- `blocked`: Codex limit reached, Claude locked, Opencode rolling window at 100%.
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
node .agents/skills/verify-tantalus/scripts/drive.ts press Control+R
node .agents/skills/verify-tantalus/scripts/drive.ts screenshot "$EVIDENCE" settings
```

`snapshot` prints the accessibility tree, which is the fastest way to read figures, status words, and alerts. Click by ARIA role and accessible name, as the snapshot shows them.

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

The helper kills only the preview, fixture server, and Xvfb PIDs started by `launch.sh`, removes the `coverage-home` and `mock-home` scaffolding, and preserves evidence. Never use `pkill`, `killall`, or release-app process names. After cleanup, confirm the evidence directory still exists.

## Helpers

All helpers in `scripts/` are executable or run with `node`:

- `build-preview.sh` builds the separately identified preview app without installing it
- `launch.sh [--mock [SCENARIO]]` starts the built preview on an isolated Xvfb display with its DevTools port open, with a fixture server in mock mode
- `drive.ts <snapshot | click ROLE NAME | press KEY | screenshot DIR [NAME]>` drives the preview window
- `fixture-server.py <PORT_FILE> <REQUEST_LOG> <SCENARIO>` serves scenario responses on the providers' paths; `launch.sh --mock` starts it
- `mock-scenario.sh <NAME>` switches the running fixture scenario
- `doctor.sh` checks the preview identity, processes, display, DevTools port, and usage mode without changing state
- `cleanup.sh` stops only the harness-owned preview, fixture server, and display, and preserves evidence

The feature map is in `features/`. Read the relevant file before driving that feature.
