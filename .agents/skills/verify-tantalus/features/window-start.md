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

`WindowStarter` also runs the Claude CLI when a Claude reading fails with `The usage service returned an unexpected response`, at most once an hour.

1. Launch with `--mock error`, open Settings, and switch on Wake Claude sign-in. Its row carries a Beta label.
2. Enter `/usr/bin/true` as the Claude path (switch on Start 5-hour windows to show the field), then press Refresh.
3. Reopen Settings. The wake row should read `Woke Claude <time>.`
4. Press Refresh again and reopen Settings. The time should not change, since the next wake waits an hour.

Never point a real-mode preview at an idle real account with the feature on unless you mean to start that account's window.
