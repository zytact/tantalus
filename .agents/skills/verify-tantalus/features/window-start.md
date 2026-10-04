# Window start

Settings has a Start 5-hour windows switch. It starts off. Switching it on shows one row and CLI path field per provider available through an enabled direct sign-in or hub. Starts cover those providers when switched on at the top of Settings, with no switch per provider. Hub accounts use account-specific upstream prompts through CLIProxyAPI. Their results appear in the provider row, with no extra account rows. Opencode cannot start windows. Each row says what would run, the last start, or why it failed. A provider absent from both routes has no row. Hub-only providers retain their CLI paths for direct sign-ins. The choice and CLI paths are saved to `window-start.json` in the preview's settings directory. Attempt results and the wake cooldown reset when the process restarts.

`WindowStarter` in `src/main/window-start.ts` watches every published snapshot. Two ready readings at least 5 minutes apart that both show the 5-hour window idle make it send a prompt once through the CLI or hub. A reading that is not idle starts the wait over. `src/main/cli.ts` finds the CLI and runs it in the temporary directory.

## Preview proof

Launch with `--mock idle`. Set the Claude path to `/usr/bin/true` and Codex to `/usr/bin/false` for deterministic command success and failure without spending usage. These commands do not create a provider window; an end-to-end start needs the real CLI and an idle signed-in account.

1. Open Settings, switch on Start 5-hour windows, and capture the Claude and Codex rows. Each should name the CLI it found, or say none was found.
2. Fill `Claude CLI Leave blank to look it up` with `/usr/bin/true` and click `Save Claude CLI`. Fill the equivalent Codex field with `/usr/bin/false` and click `Save Codex CLI`.
3. Press Refresh, wait at least 5 minutes, then press Refresh again. Reopen Settings.
4. Claude should read `Started a window <time>.`, and Codex should read `Could not start a window <time>.` with an exit-code error. Hub-only provider rows show their start results and retain CLI path fields. Opencode has no start control.
5. Run `launch.sh --restart`, then doctor, and confirm the switch and both paths survive while attempt results clear.

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

## Hub proof

On `--mock idle`, add the fixture hub as described in `proxy-hubs.md`. Switch direct Codex and Claude off and enable Start 5-hour windows. Refresh, wait at least 5 minutes, then refresh again. Reopen Settings and confirm the Claude and Codex provider rows report a successful start. For multiple accounts, use `--mock hub-multiple-idle`. The fixture request log must contain one start for each of `hub-codex`, `hub-codex-two`, `hub-claude`, and `hub-claude-two`. Each dashboard account must have its own last-start status. Refresh again and confirm those counts remain one.

Wake Claude only uses the direct CLI. A hub Claude account switches wake off, and an attempt to enable it leaves it off. Management-key refusals stop hub reads and starts until the hub is re-enabled or repaired.
