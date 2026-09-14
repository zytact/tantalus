---
name: verify-tantalus
description: Build and drive the isolated native Tantalus Preview app, capture window screenshots, and run the frontend and Rust suites. Use when verifying allowance windows, refresh, provider settings, updates, tray behavior, or usage parsing.
---

# Verify Tantalus

Tantalus is a Tauri 2 tray app. Rust reads Codex, Claude, and Opencode credentials, polls their usage APIs, owns provider settings and the tray, then publishes token-free snapshots to the React webview.

Verification uses the native preview build. Never use a browser to judge this UI. Linux and macOS use WebKit, while Windows uses WebView2, so a Chromium tab is not a faithful runtime.

## Isolation

The preview config gives the verification build its own identity:

- product name `Tantalus Preview`
- bundle identifier `dev.arnab.tantalus.preview`
- binary name `tantalus-preview`
- blue app and tray icons

That identity keeps the preview's app data, autostart entry, installation, and single-instance lock separate from the release app. Do not launch `src-tauri/target/release/tantalus`, install a release bundle, or quit an existing release instance during verification.

## Launch

Run from the repo root. The screenshot path needs Xvfb, ImageMagick, and X11 tools (`xprop`).

```sh
EVIDENCE=/tmp/opencode/tantalus-verify/$(date +%Y%m%d-%H%M%S)
mkdir -p "$EVIDENCE"
.agents/skills/verify-tantalus/scripts/build-preview.sh 2>&1 | tee "$EVIDENCE/preview-build.log"
.agents/skills/verify-tantalus/scripts/launch.sh 2>&1 | tee "$EVIDENCE/launch.log"
.agents/skills/verify-tantalus/scripts/doctor.sh 2>&1 | tee "$EVIDENCE/doctor.log"
```

`build-preview.sh` runs `vp run tauri build --config src-tauri/tauri.preview.conf.json --no-bundle` and checks for `src-tauri/target/release/tantalus-preview`. It does not install or package anything. `launch.sh` starts only that binary on an isolated Xvfb display and records both owned PIDs under `/tmp/opencode/tantalus-verify/`. Set `TANTALUS_XVFB` when Xvfb is not on `PATH`.

Ready means `doctor.sh` confirms the preview config, binary, recorded process executable, and isolated display. Run doctor before the first drive and again after any failed or surprising interaction.

## Drive

Use one preview process for the whole pass. Drive the native window with X11 input tooling when interaction is required. Do not use browser automation, inject JavaScript, mock Tauri IPC, or inspect the page through Chromium tooling.

1. Run the offline suites:

```sh
vp test 2>&1 | tee "$EVIDENCE/vitest.log"
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tee "$EVIDENCE/cargo-test.log"
```

2. Capture the initial native window:

```sh
.agents/skills/verify-tantalus/scripts/screenshot.sh "$EVIDENCE" allowance
```

3. Exercise the mapped window and refresh features in the preview:

- Enable the provider needed for the account in Settings.
- Return to Allowance and activate Refresh.
- Capture the busy state when practical, then the completed state.
- Confirm every reported Short, Long, and Monthly window, Reset credits or Extra usage, status word, refresh timestamp, and remaining figure against the account response.
- Accounts expose different windows. An absent plan-specific window is valid; do not invent an unavailable row when another recognized window exists.

4. Exercise Settings:

- Switch one provider off, confirm its allowance block and tray rows disappear, then switch it back on and confirm the immediate refresh.
- Confirm Codex and Claude default on and Opencode defaults off only when the preview has no saved settings.
- Confirm the version and the Open at login switch. Restore the original autostart value before teardown.
- Click Check for updates. Preview must report `Dev and preview builds do not check for updates.`

5. Exercise the tray:

- Confirm the blue icon and `Tantalus Preview` tooltip.
- Compare each enabled provider's separate 5h, 7d, and 30d rows with the window. Rows may include `Under pace`, `On pace`, or `Ahead of pace`.
- Use Refresh now, close and reopen the window through Show usage or left-click, then leave Quit for final teardown.
- A full polling proof takes at least five minutes. Confirm the refreshed label resets after the next poll.

6. Capture screenshots after each materially different state:

```sh
.agents/skills/verify-tantalus/scripts/screenshot.sh "$EVIDENCE" settings
.agents/skills/verify-tantalus/scripts/screenshot.sh "$EVIDENCE" refreshed
```

The screenshot helper captures the isolated display, trims its black border to the native preview window, and rejects an image smaller than the configured minimum window size.

The real preview may read local credential files and call the live usage APIs. Never print tokens or pass them on a command line. To prove auth-missing behavior without touching real credentials, launch with empty `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `XDG_DATA_HOME` directories under `/tmp/opencode/tantalus-verify/coverage-home/`. Restore a normal preview launch before proving live readings.

## Evidence

Keep each run under `/tmp/opencode/tantalus-verify/<timestamp>/`:

- `preview-build.log`, `launch.log`, and `doctor.log`
- `vitest.log` and `cargo-test.log`
- one PNG per meaningful native window state
- concise `notes.md` listing features covered, inaccessible prerequisites, and observed drift

A screenshot proves visible native webview state. Pair it with the relevant interaction and suite result. Xvfb has no desktop tray host, so tray menus require a separate preview launch on a real desktop.

## Cleanup

```sh
.agents/skills/verify-tantalus/scripts/cleanup.sh
```

The helper kills only the PID started by `launch.sh`, removes temporary credential scaffolding, and preserves evidence. Never use `pkill`, `killall`, or release-app process names. After cleanup, confirm the evidence directory still exists.

## Helpers

All shell helpers in `scripts/` are executable:

- `build-preview.sh` builds the separately identified preview app without installing it
- `launch.sh` starts the built preview binary on an isolated Xvfb display
- `doctor.sh` checks the preview identity, processes, and display without changing state
- `screenshot.sh <EVIDENCE_DIR> [NAME]` captures the native preview window
- `cleanup.sh` stops only the harness-owned preview and preserves evidence

The feature map is in `features/`. Read the relevant file before driving that feature.
