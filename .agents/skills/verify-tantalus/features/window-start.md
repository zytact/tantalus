# Window start

Settings has a Start 5-hour windows switch. It starts off. Switching it on shows a row each for Claude and Codex, with a CLI path field. Starts cover every provider switched on at the top of Settings, with no switch per provider. Each row says what would run, the last start, or why it failed. A provider switched off at the top reads `Switch on <name> above so Tantalus can see its window.` The choice is saved to `window-start.json` in the preview's settings directory.

`WindowStarter` in `src/main/window-start.ts` watches every published snapshot. Two ready readings at least 5 minutes apart that both show the 5-hour window idle make it run the CLI once. A reading that is not idle starts the wait over. `src/main/cli.ts` finds the CLI and runs it in the temporary directory.

## Preview proof

Launch with `--mock idle`. Real CLIs would fail against the fixture credentials, so their failure proves the error path. Set a Claude path of `/usr/bin/true` to prove the success path without spending usage.

1. Open Settings, switch on Start 5-hour windows, and capture the Claude and Codex rows. Each should name the CLI it found, or say none was found.
2. Enter `/usr/bin/true` as the Claude path, and Save.
3. Press Refresh, wait at least 5 minutes, then press Refresh again. Reopen Settings.
4. Claude should read `Started a window <time>.`, and Codex should read `Could not start a window <time>.` with the CLI's last stderr line.
5. Run `launch.sh --restart` and confirm the switch and the Claude path survive.

## Sign-in wake proof

`WindowStarter` runs the Claude CLI only when a Claude reading carries the typed `expired` or `rejected` failure, at most once an hour. The credential file's `claudeAiOauth.expiresAt` is in milliseconds. An expired token fails before an API request; HTTP 401 produces `rejected`. HTTP 403, 429, server errors, invalid JSON, and display text alone never trigger a wake.

1. Launch a fresh Preview process with `--mock error`, open Settings, and switch on Wake Claude sign-in. Its row carries a Beta label.
2. Enter `/usr/bin/true` as the Claude path (switch on Start 5-hour windows to show the field), then switch window starts off again.
3. Press Refresh. HTTP 500 should show an unexpected-response failure, with no wake time or CLI invocation. Check this before any successful wake, so the hourly cooldown cannot mask a false wake.
4. Switch the fixture to `ready` with `mock-scenario.sh ready`, set `claudeAiOauth.expiresAt` to a past timestamp in the mock home's `.credentials.json`, then press Refresh. Claude should show `The sign-in has expired`; its usage endpoint should not appear in the fixture request log for that refresh. The wake row should read `Woke Claude <time>`. `/usr/bin/true` does not renew credentials, so usage stays expired.
5. Press Refresh again. The wake time should not change, since the next wake waits an hour.
6. Restore the mock expiry to a future timestamp and refresh. Usage should be ready again.

A real renewal proof needs an actually expired token. After the real CLI runs, confirm the credential file's expiry advances and usage returns HTTP 200. A fake CLI or edited expiry on an unexpired real token does not prove provider renewal.

Never point a real-mode preview at an idle real account with the feature on unless you mean to start that account's window.
