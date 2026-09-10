# Short window (5 hours)

The headline ledger entry for a provider that has a 5-hour window. Shows percent
of that window consumed, when it resets, and what remains. Not every account has
one: a Codex Go or free account has only the monthly window, and OpenAI switches
the 5-hour window off for a plan from time to time, so the entry stands down
rather than showing a placeholder whenever the reading carries another window
instead.

## Sub-features

- Headline figure from `usagePercent`: `Unavailable` when null, else `N%`
- Progress rule `role=progressbar[name="Short window usage"]` with
  `aria-valuenow` and `aria-valuetext`
- Facts row: Resets (`countdown`), At (`absoluteTime`), Remaining
  (`remainingPercent`)
- `Window unavailable` fallback when the reading carries no recognized window
  at all, in which case it is the block's single placeholder entry
  (`windowEntries` and `ProviderSection` in `src/main.tsx`). Codex matches the
  duration exactly in `parse_usage`; Claude keys off the `five_hour` field name
  and Opencode off `usage.rolling`, both stamping the duration themselves.

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
Claude reads `65%` and Opencode `4%` the same way, once Opencode is switched
on. Click each provider switch off and back
on to confirm the entry vanishes and returns with its figure.
`Window unavailable` plus an `Unavailable` figure is the
`auth_missing`-scenario rendering for this entry, and it is then the only
window entry in each block, since that reading carries no window at all.
`window.__TANTALUS_MOCK__.codexPlan("monthly")` plus a Refresh click drops the
entry from the Codex block entirely, which is the Go and free account shape.

1. Launch on an isolated port: `.agents/skills/verify-tantalus/scripts/launch.sh 1421`
2. Install the mock and remount (see `SKILL.md` Drive step 3), then snapshot
3. Without the mock, `cached_usage` rejects and the app shows
   `Could not load provider settings`. Do not assert a provider block,
   region, progressbar, or facts there.
4. Static proof is `scripts/check-ui.sh 1421`; it checks the served shell,
   not a rendered window entry.
5. Formatter proof without Tauri: `vp test` covers `usagePercent`,
   `remainingPercent`, and `countdown` buckets used by this entry
6. Live proof: `.agents/skills/verify-tantalus/scripts/live-check.sh` records the real 18000-second Codex
   window in `live-usage.json` and the Claude `five_hour` object in
   `live-claude-usage.json`. Confirm `used_percent` (Codex) and
   `utilization` (Claude) parse into the figure and `Resets` countdown.
7. Ready-state proof needs `vp run tauri dev` with credentials: figure shows
   `N%`, `Resets` shows `3h 29m` style coarse countdown, `aria-valuenow`
   matches the figure

## Gotchas

- Plain `vp dev` never delivers a snapshot. After `cached_usage` rejects,
  it shows `Could not load provider settings` rather than any window entry.
- Window mapping is exact for Codex: `limit_window_seconds` must equal 18000.
  Fractional `18000.9` and string `"604800.5"` stay unavailable by design
  (`cargo test` covers this).
- A missing Short window entry is not a bug on its own. Check whether the block
  carries another window entry first; only a block with no window entry at all
  shows the `Window unavailable` placeholder.
- `reset_after_seconds` may arrive as string `"90"`; epoch and millisecond
  forms are normalized in `parse_window`.
