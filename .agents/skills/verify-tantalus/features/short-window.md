# Short window (5 hours)

The main process maps Codex's exact 18,000-second window, Claude's `five_hour`, and Opencode's `usage.rolling` into the Short window. Codex and Claude hub accounts use the same mapping. Opencode is direct-only. The allowance view renders Short before other reported windows for each enabled account.

It shows the used percentage, a progressbar named `Short window usage`, optional pace, Resets in, At, and Remaining. Percentages may have one decimal. The visual bar clamps outside values, while the accessible value preserves the report.

## Preview proof

Launch Tantalus Preview with `--mock` on `ready`, enable Opencode in Settings, and add the fixture hub per `proxy-hubs.md`. Refresh and capture all five accounts. Codex reports 40% with 3 of 5 hours left, Claude 91% with 1 hour left, and Opencode 5% with 4 hours left. Hub Codex and Claude match their direct counterparts. In real mode, use a provider with a 5-hour reading. Confirm `Short window`, `5 hours`, the percentage, reset facts, and Remaining. If the account reports another recognized window but no 5-hour window, Short is absent. If it reports no recognized windows, it gets one generic `Window unavailable` entry; prove that with the `no-windows` scenario.
