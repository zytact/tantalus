# Short window (5 hours)

The headline ledger entry, rendered once per provider. Shows percent of that
provider's 5-hour window consumed, when it resets, and what remains.

## Sub-features

- Headline figure from `usagePercent`: `Unavailable` when null, else `N%`
- Progress rule `role=progressbar[name="Short window usage"]` with
  `aria-valuenow` and `aria-valuetext`
- Facts row: Resets (`countdown`), At (`absoluteTime`), Remaining
  (`remainingPercent`)
- `Window unavailable` fallback when the backend reports no 18000-second
  window (`src/main.tsx` Entry). Codex matches the duration exactly in
  `parse_usage`; Claude keys off the `five_hour` field name and stamps the
  duration itself in `parse_claude_usage`.

## How to get to it (user POV)

Open the app window via tray **Show usage** or the dock icon on macOS. The
Short window is the first entry inside each provider block, below that
provider's switch row, and only renders while the switch is on. Under Tauri
it reads `Short window 5 hours`; headless in a plain browser it reads
`Window unavailable` because durations are null.

## Driving it with browser tab

1. Launch on an isolated port: `.agents/skills/verify-tantalus/scripts/launch.sh 1421`
2. Navigate a browser tab to `http://localhost:1421/` and snapshot
3. Assert: `role=region` for the first entry in the Codex block,
   `role=progressbar`, and the `Resets` / `At` / `Remaining` facts. Both
   providers render one, so disambiguate by provider block rather than by
   name alone.
4. Headless proof is the Loading shell: the header reads `no successful
   update yet`, each switch row reads `LOADING`, and there are four
   `Window unavailable` regions (two per provider)
5. Formatter proof without Tauri: `pnpm test` covers `usagePercent`,
   `remainingPercent`, and `countdown` buckets used by this entry
6. Live proof: `scripts/live-check.sh` records the real 18000-second Codex
   window in `live-usage.json` and the Claude `five_hour` object in
   `live-claude-usage.json`. Confirm `used_percent` (Codex) and
   `utilization` (Claude) parse into the figure and `Resets` countdown.
7. Ready-state proof needs `pnpm tauri dev` with credentials: figure shows
   `N%`, `Resets` shows `3h 29m` style coarse countdown, `aria-valuenow`
   matches the figure

## Gotchas

- Plain `pnpm vite` never delivers durations, so expecting `Short window`
  text there fails. That is the harness limit, not an app bug. Console shows
  `Uncaught (in promise)` from `invoke("cached_usage")`.
- Window mapping is exact for Codex: `limit_window_seconds` must equal 18000.
  Fractional `18000.9` and string `"604800.5"` stay unavailable by design
  (`cargo test` covers this).
- `reset_after_seconds` may arrive as string `"90"`; epoch and millisecond
  forms are normalized in `parse_window`.
