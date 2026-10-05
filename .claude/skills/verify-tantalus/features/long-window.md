# Long window (7 days)

The main process maps Codex's exact 604,800-second window, Claude's `seven_day`, and Opencode's `usage.weekly` into the Long window. Codex and Claude hub accounts use the same mapping; Opencode is direct-only. Reported windows stay in Short, Long, Monthly order, but Long is not always second because absent windows are omitted.

It shows the used percentage, a progressbar named `Long window usage`, optional pace, Resets in, At, and Remaining. A missing Long window does not own an unavailable placeholder. The single generic placeholder appears only when the account has no recognized windows.

## Preview proof

In Tantalus Preview on `--mock` `ready`, enable Opencode, Refresh, and confirm Codex 12% with 5 of 7 days left, Claude 55% with 3 days left, and Opencode 70% with 6 days left. Then add the fixture hub per `proxy-hubs.md`, which switches direct Codex and Claude off, and confirm both hub accounts read the same as the direct ones. In real mode, use a provider with a weekly reading. Capture the window and confirm `Long window`, `7 days`, the percentage, reset facts, and Remaining. Switch to `monthly-only` and confirm hub Codex omits Long. Remove the hub, switch direct Codex back on, Refresh, and confirm direct Codex omits it too. The tray has a separate `7d` row when Long exists.
