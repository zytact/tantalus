# Manual refresh

Refresh invokes the `refreshUsage` command for every enabled provider. Once a refresh has run for 200 ms, the button becomes disabled, reads `Refreshing`, and sets `aria-busy=true`, so a fast answer never flashes the busy state. Ctrl+R and Cmd+R use the same action, including from Settings and the remote access page, though the busy button is out of view in Settings. Refresh now in the tray calls the same main-process path.

The main process reads enabled providers concurrently. Disabled providers stop before credential reads. A refresh asked for mid-read folds into one more pass, and both callers get its result. A failure after prior success keeps figures and shows Cached. Missing credentials before any success show Not signed in. Other first failures show Could not refresh.

## Preview proof

In Tantalus Preview, activate Refresh and capture the busy state when practical, then capture the completed window. Confirm the timestamp and each provider status. Repeat through the keyboard shortcut and tray Refresh now. On `--mock`, switch to `error` and Refresh: providers keep their figures and read `Cached`. `launch.sh --mock error` fails the very first read, so it shows `Could not refresh`. For isolated auth-missing proof, relaunch with empty `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `XDG_DATA_HOME` directories so none of the three providers can reach real credentials.
