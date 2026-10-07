# Short window (5 hours)

The main process maps Codex's exact 18,000-second window, Claude's `five_hour`, and Opencode's `usage.rolling` into the Short window. Codex and Claude hub accounts use the same mapping. Opencode is direct-only. The allowance view renders Short before other reported windows for each enabled account.

The headline shows remaining allowance, with the consumed percentage under Used. The progressbar is named `Short window remaining`, and its fill and accessible value count down from 100 to 0. Both clamp outside readings to that range. Percentages may have one decimal. Pace still compares consumption with elapsed time. Resets in and At keep their reset times.

## Preview proof

Launch Tantalus Preview with `--mock` on `ready`, enable Opencode in Settings, then Refresh and capture the three direct accounts. Codex shows 60% remaining and 40% Used with 3 of 5 hours left, Claude 9% remaining and 91% Used with 1 hour left, and Opencode 95% remaining and 5% Used with 4 hours left. Then add the fixture hub per `proxy-hubs.md`, which switches direct Codex and Claude off, and capture Opencode beside the hub's Codex and Claude, which read the same as the direct ones. In real mode, use a provider with a 5-hour reading. Confirm `Short window`, `5 hours`, the remaining headline, reset facts, and Used. If the account reports another recognized window but no 5-hour window, Short is absent. If it reports no recognized windows, it gets one generic `Window unavailable` entry; prove that with the `no-windows` scenario.
