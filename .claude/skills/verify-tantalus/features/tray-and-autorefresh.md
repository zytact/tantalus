# Tray and autorefresh

The app lives in the system tray. Closing the window hides it; the tray owns
the menu, the tooltip, and the 5-minute polling schedule.

## Sub-features

- Tray menu ids from `src-tauri/src/lib.rs`: `summary` (`5h: N% used` or
  `5h: unavailable`), `secondary` (`7d: ...`), `show` (Show usage),
  `refresh` (Refresh now), `quit` (Quit)
- Tooltip `Tantalus`; left-click Up shows the window (right button belongs to
  the menu); macOS dock Reopen shows it; template icon on macOS
- Closing the window hides it in the tray; **Quit** exits and stops polling
- Rust owns polling: initial refresh at startup, then every 300 seconds via
  `tokio::time::sleep`, emitting `usage-snapshot` to the webview
- Credential sources: `CODEX_HOME/auth.json`, else
  `~/.codex/auth.json` (`$HOME` on Linux/macOS, `%USERPROFILE%` on Windows),
  else every WSL distribution home over `\\wsl.localhost` on Windows only
- Privacy: tokens and account IDs never reach the webview, disk, or logs

## How to get to it (user POV)

Run `pnpm tauri dev`. Look for the hollow-square tray icon. Right-click
shows the summary lines plus Show usage, Refresh now, Quit. Left-click shows
the window. The footer `Auto-refreshes every 5 minutes` names the schedule.

## Driving it with harness

Headless cannot drive the tray: there is no menu, tooltip, or polling
outside the Tauri runtime. Headless proof is limited to asserting the window
footer text and the `Auto-refreshes every 5 minutes` string in a browser
snapshot.

Real proof is manual on a desktop OS:

1. `pnpm tauri dev`, wait for the first refresh
2. Read the tray menu: summary and secondary lines match the window figures
3. Click **Show usage**, close the window, confirm the tray icon persists,
   then **Quit** and confirm the process exits
4. Leave it 5+ minutes and confirm the `updated` time advances without input
5. Open webview devtools and search for the token: it must be absent

## Gotchas

- Reaching the WSL share starts the distribution, so the Windows lookup only
  scans WSL after the native home turns up nothing.
- The tray app is a singleton. Never start a second `tauri dev` to verify;
  drive the running one or ask the user to quit it first.
- `pnpm tauri info` on this Fedora box reports `rsvg2: not installed`.
  Install system deps through the OS package manager when that blocks a
  desktop run, not through this project.
- Display needed: no Xvfb in this container, so tray verification stays
  manual on a machine with a real display server.
