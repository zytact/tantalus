# Window start

Settings has a Start 5-hour windows switch. It starts off. Switching it on shows a row each for Claude and Codex, with a switch and a CLI path field. Each row says what would run, the last start, or why it failed. The choice is saved to `window-start.json` in the preview's settings directory.

`WindowStarter` in `src/main/window-start.ts` watches every published snapshot. Two ready readings at least 5 minutes apart that both show the 5-hour window idle make it run the CLI once. A reading that is not idle starts the wait over. `src/main/cli.ts` finds the CLI and runs it in the temporary directory.

## Preview proof

Launch with `--mock idle`. Real CLIs would fail against the fixture credentials, so their failure proves the error path. Set a Claude path of `/usr/bin/true` to prove the success path without spending usage.

1. Open Settings, switch on Start 5-hour windows, and capture the Claude and Codex rows. Each should name the CLI it found, or say none was found.
2. Switch on Claude and Codex, enter `/usr/bin/true` as the Claude path, and Save.
3. Press Refresh, wait at least 5 minutes, then press Refresh again. Reopen Settings.
4. Claude should read `Started a window <time>.`, and Codex should read `Could not start a window <time>.` with the CLI's last stderr line.
5. Run `launch.sh --restart` and confirm both switches and the Claude path survive.

Never point a real-mode preview at an idle real account with the feature on unless you mean to start that account's window.
