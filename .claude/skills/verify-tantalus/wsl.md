# Verifying on WSL

On WSL (`WSL_DISTRO_NAME` is set) the scripts build and drive the Windows preview with the same commands. Read this when a WSL launch, sign-in or cleanup fails, when a step needs a visible window, or when a feature step names something only Linux has.

Proven on WSL2 Ubuntu on Windows 11 with NAT networking.

## What runs where

The build, the fixture server and the drive scripts stay in WSL. `build-preview.sh` cross-builds `release/tantalus-preview/win-unpacked/tantalus-preview.exe` with `node scripts/package.ts --preview --windows --dir`, which downloads Windows Electron, and copies it to `%LOCALAPPDATA%\tantalus-verify\<run>\app`. It then swaps the copy's exe for the stock Electron exe from that download, which loads the same `resources\app.asar` (see Smart App Control below). `launch.sh` starts that copy through `scripts/hidden-desktop.ps1` on a hidden Windows desktop named `tantalus-verify-<run>`. Its window renders for screenshots but never shows or takes focus, and its tray icon never reaches the taskbar.

Windows ignores the environment for the settings directory, so the preview's settings and single-instance lock go under `TANTALUS_APP_DATA`, which only preview builds honor. Everything Windows reads lives under `%LOCALAPPDATA%\tantalus-verify\<run>\`, the scripts' `$STATE_DIR`, because Electron cannot keep a profile on `\\wsl.localhost`:

- `real-config\dev.arnab.tantalus.preview\`: real-mode settings, kept between launches
- `mock-home\`: fixture credentials, with settings in `mock-home\config\dev.arnab.tantalus.preview\`, removed by cleanup
- `web-profile\`: the `--web` browser's profile, removed by cleanup

Find it with `source .agents/skills/verify-tantalus/scripts/run-dir.sh && echo "$STATE_DIR"`. Feature files that name `mock-home/config/...` in the run directory mean this folder on WSL. The run directory itself, with the PIDs, logs and evidence, stays in WSL.

## Ports

WSL in NAT mode cannot reach Windows `127.0.0.1`, so `launch.sh` starts two `scripts/windows-relay.mjs` relays. The preview opens DevTools on a free Windows port, written to `DevToolsActivePort` in its settings directory, and `run.cdp` holds the relay's local port, so `drive.ts` works unchanged. `run.web` holds a local port relayed to the preview's web port 4748, for curl from WSL: `curl http://127.0.0.1:$(cat "$RUN_DIR/run.web")/`. Each relayed connection costs about a second.

The Windows preview reaches the fixture server in WSL at `127.0.0.1` through WSL's localhost forwarding.

`drive.ts --web` loads the page in a headless Edge on Windows, so pass the address as Windows sees it, such as `http://127.0.0.1:4748/`. `TANTALUS_CHROME` overrides the Edge path.

## Usage modes

Mock mode writes fixture credentials for the Windows sign-in and saves the WSL sign-in source off, so the fixture accounts are the only ones. Real mode reads the Windows home folder and every WSL distribution, which is the live proof for `features/sign-in-sources.md`.

## What the hidden desktop cannot do

- The tray has no taskbar to live in. Prove tray features on Linux, or on WSL with `TANTALUS_VERIFY_LINUX=1` exported for every command, which keeps the old route: the Linux preview under Xvfb in WSL.
- Native popups such as a `<select>` list draw outside the page, and there is no root window to capture.
- The color scheme follows Windows, not a light Xvfb display. Use `--scheme` as usual.

## What reaches the person's desktop

Ask before any of these, since they show on the person's screen or change their Windows setup:

- Switching Local network on listens on `0.0.0.0`, and Windows Defender Firewall prompts for the new executable. Tailscale alone listens on `127.0.0.1` and does not prompt. Cleanup removes the preview's route with `tailscale.exe`.
- Open at login writes a `Tantalus Preview` entry under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, which an installed preview shares. Restore it before teardown.
- A hub's dashboard button opens the default browser.

`build-preview.sh --package` writes the NSIS setup exe beside the unpacked app. Give the person its path rather than running it.

## Smart App Control

With Smart App Control on, Windows refuses to start an exe it has never seen. `launch.sh` then prints `An Application Control policy has blocked this file` and `The preview did not open its DevTools port`, and the block shows as event 3077 in the `Microsoft-Windows-CodeIntegrity/Operational` log. electron-builder writes the app bundle's hash into the exe it builds, so every code change makes a new, unknown exe. That is why `build-preview.sh` runs the copy from the stock Electron exe, which is the same for every build of one Electron version and which Windows knows. If a launch is still blocked, such as right after an Electron upgrade, say so and stop. Do not look for another way to start the app.

Never start `tantalus-preview.exe` yourself, with any arguments. Only `launch.sh` puts it on the hidden desktop with the harness's settings directory. Started directly it opens a window on the person's screen, ignores `--version` and every other probe, and reads the installed preview's settings and real accounts.

## Failures seen

- The first launch of a fresh copy took about 35 seconds while Windows scanned it. Later launches take about 5.
- The Electron download in the cross-build once aborted with `ReadError: The server aborted pending request`. Running the build again worked.
- `cleanup.sh` stops the preview with `taskkill.exe /T /F` on the recorded PID, only while that PID runs the harness's copy.
