# Short window (5 hours)

The headline ledger entry. Shows percent of the 5-hour Codex window consumed,
when it resets, and what remains.

## Sub-features

- Headline figure from `usagePercent`: `Unavailable` when null, else `N%`
- Progress rule `role=progressbar[name="Short window usage"]` with
  `aria-valuenow` and `aria-valuetext`
- Facts row: Resets (`countdown`), At (`absoluteTime`), Remaining
  (`remainingPercent`)
- `Window unavailable` fallback when the backend reports no 18000-second
  window (`src/main.tsx` Entry, `src-tauri/src/usage.rs` `parse_usage`)

## How to get to it (user POV)

Open the app window via tray **Show usage** or the dock icon on macOS. The
Short window is the first entry under the `Allowance` header. Under Tauri it
reads `Short window 5 hours`; headless in a plain browser it reads
`Window unavailable` because durations are null.

## Driving it with browser tab

1. Launch on an isolated port: `.agents/skills/verify-tantalus/scripts/launch.sh 1421`
2. Navigate a browser tab to `http://localhost:1421/` and snapshot
3. Assert: `role=region` for the first entry, `role=progressbar`, and the
   `Resets` / `At` / `Remaining` facts
4. Headless proof is the Loading shell: visible text contains `Loading - no
   successful update yet` and two `Window unavailable` regions
5. Formatter proof without Tauri: `pnpm test` covers `usagePercent`,
   `remainingPercent`, and `countdown` buckets used by this entry
6. Live proof: `scripts/live-check.sh` records the real 18000-second window
   in `live-usage.json`. Confirm its `used_percent` and
   `reset_after_seconds` parse into the figure and `Resets` countdown.
7. Ready-state proof needs `pnpm tauri dev` with credentials: figure shows
   `N%`, `Resets` shows `3h 29m` style coarse countdown, `aria-valuenow`
   matches the figure

## Gotchas

- Plain `pnpm vite` never delivers durations, so expecting `Short window`
  text there fails. That is the harness limit, not an app bug. Console shows
  `Uncaught (in promise)` from `invoke("cached_usage")`.
- Window mapping is exact: `limit_window_seconds` must equal 18000.
  Fractional `18000.9` and string `"604800.5"` stay unavailable by design
  (`cargo test` covers this).
- `reset_after_seconds` may arrive as string `"90"`; epoch and millisecond
  forms are normalized in `parse_window`.
