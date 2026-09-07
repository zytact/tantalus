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

The window opens on launch. After closing it, open a new one via tray
**Show usage**, the dock icon on macOS, or by launching the app again. The
Short window is the first entry inside each provider block, below that
provider's switch row, and only renders while the switch is on. Under Tauri
or the mock it reads `Short window 5 hours`. A bare browser tab never
receives the snapshot that renders this entry.

## Driving it with browser tab

Mock-driven (Drive step 3 in `SKILL.md`): after the remount, the first
entry inside each provider block is the Short window. Codex reads
`42%` with `role=progressbar[name="Short window usage"]`,
`aria-valuenow="42"`, `Resets` near `3h 29m`, and `Remaining 58%`;
Claude reads `65%` the same way. Click each provider switch off and back
on to confirm the entry vanishes and returns with its figure.
`Window unavailable` plus an `Unavailable` figure is the
`auth_missing`-scenario rendering for this entry.

1. Launch on an isolated port: `.agents/skills/verify-tantalus/scripts/launch.sh 1421`
2. Install the mock and remount (see `SKILL.md` Drive step 3), then snapshot
3. Without the mock, `cached_usage` rejects and the app shows
   `Could not load provider settings`. Do not assert a provider block,
   region, progressbar, or facts there.
4. Static proof is `scripts/check-ui.sh 1421`; it checks the served shell,
   not a rendered window entry.
5. Formatter proof without Tauri: `pnpm test` covers `usagePercent`,
   `remainingPercent`, and `countdown` buckets used by this entry
6. Live proof: `.agents/skills/verify-tantalus/scripts/live-check.sh` records the real 18000-second Codex
   window in `live-usage.json` and the Claude `five_hour` object in
   `live-claude-usage.json`. Confirm `used_percent` (Codex) and
   `utilization` (Claude) parse into the figure and `Resets` countdown.
7. Ready-state proof needs `pnpm tauri dev` with credentials: figure shows
   `N%`, `Resets` shows `3h 29m` style coarse countdown, `aria-valuenow`
   matches the figure

## Gotchas

- Plain `pnpm vite` never delivers a snapshot. After `cached_usage` rejects,
  it shows `Could not load provider settings` rather than any window entry.
- Window mapping is exact for Codex: `limit_window_seconds` must equal 18000.
  Fractional `18000.9` and string `"604800.5"` stay unavailable by design
  (`cargo test` covers this).
- `reset_after_seconds` may arrive as string `"90"`; epoch and millisecond
  forms are normalized in `parse_window`.
