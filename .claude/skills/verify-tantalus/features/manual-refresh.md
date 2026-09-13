# Manual refresh

Refresh invokes `refresh_usage` for every enabled provider. The button becomes disabled, reads `Refreshing`, and sets `aria-busy=true`. Ctrl+R and Cmd+R use the same action, including from Settings, though the busy button is then out of view. Refresh now in the tray calls the same Rust path.

Rust reads enabled providers concurrently. Disabled providers stop before credential reads. Overlapping requests collapse into one pending follow-up. A failure after prior success keeps figures and shows Cached. Missing credentials before any success show Not signed in. Other first failures show Could not refresh.

## Preview proof

In Tantalus Preview, activate Refresh and capture the busy state when practical, then capture the completed native window. Confirm the timestamp and each provider status. Repeat through the keyboard shortcut and tray Refresh now. For isolated auth-missing proof, relaunch with empty `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `XDG_DATA_HOME` directories so none of the three providers can reach real credentials.
