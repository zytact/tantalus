# Short window (5 hours)

The main process maps Codex's exact 18,000-second window, Claude's `five_hour`, and Opencode's `usage.rolling` into the Short window. Codex and Claude hub accounts use the same mapping. Opencode is direct-only. The allowance view renders Short before other reported windows in each provider's section (see `pooled-allowance.md`).

The headline shows the pool's remaining allowance. Each account's progressbar is named `<account label> short window remaining`, such as `Codex short window remaining`, and its fill and accessible value count down from 100 to 0. Both clamp outside readings to that range. Percentages may have one decimal. Pace still compares consumption with elapsed time. The caption under the bar shows the account's remaining percentage and `↻ <countdown>`, with the absolute reset time in its tooltip.

## Preview proof

Launch Tantalus Preview with `--mock` on `ready`, enable Opencode in Settings, then Refresh and capture the three direct accounts. Codex shows 60% remaining with 3 of 5 hours left, Claude 9% remaining with 1 hour left, and Opencode 95% remaining with 4 hours left. Then add the fixture hub per `proxy-hubs.md`, which switches direct Codex and Claude off, and capture Opencode beside the hub's Codex and Claude, which read the same as the direct ones. In real mode, use a provider with a 5-hour reading. Confirm `Short window`, `5 hours`, the remaining headline, and the reset countdown. If no account of the provider reports a 5-hour window, Short is absent. If its accounts report no recognized windows, the section gets one generic `Window unavailable` entry; prove that with the `no-windows` scenario.
