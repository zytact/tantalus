# Short window (5 hours)

Rust maps Codex's exact 18,000-second window, Claude's `five_hour`, and Opencode's `usage.rolling` into the Short window. The allowance view renders it before other reported windows for each enabled provider.

It shows the used percentage, a progressbar named `Short window usage`, optional pace, Resets, At, and Remaining. Percentages may have one decimal. The visual bar clamps outside values, while the accessible value preserves the report.

## Preview proof

Launch Tantalus Preview with `--mock` on `ready`, enable Opencode in Settings, Refresh, and capture the native window. Codex (40% with 3 of 5 hours left) and Claude (91% with 1 hour left) give known figures. In real mode, use a provider with a 5-hour reading. Confirm `Short window`, `5 hours`, the percentage, reset facts, and Remaining. If the provider reports another recognized window but no 5-hour window, Short is absent. If it reports no recognized windows, the provider gets one generic `Window unavailable` entry; prove that with the `no-windows` scenario.
