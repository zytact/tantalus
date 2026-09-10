# Monthly window (30 days)

A third ledger entry, rendered only for Opencode. Codex and Claude report no
monthly window, so their blocks skip the entry entirely rather than showing a
`Window unavailable` placeholder.

## Sub-features

- Rendered only when `monthly.limit_window_seconds` is non-null
  (`src/main.tsx` `ProviderSection`)
- Headline figure, progress rule
  `role=progressbar[name="Monthly window usage"]`, and the same Resets / At /
  Remaining facts as the other two windows
- Duration identity is 2592000 seconds, supplied by
  `parse_opencode_usage` rather than reported by the API
  (`src-tauri/src/usage.rs`)
- Tray line gains a `30d N%` column for Opencode only (`tray_line` in
  `src-tauri/src/lib.rs`)

## How to get to it (user POV)

Turn Opencode on in Settings. Its block then shows three entries: Short
window, Long window, and Monthly window, in that order. The Codex and Claude
blocks still show two.

## Driving it with browser tab

Mock-driven (Drive step 3 in `SKILL.md`): Opencode starts off, matching Rust's
default, so switch it on in Settings first. Its block then carries three
progressbars, the third named `Monthly window usage` reading `1%`, with
`Resets` in `Nd Nh` form. Confirm the Codex and Claude blocks still carry two
progressbars each and no `Monthly window` text.

1. Launch on an isolated port. Static proof is `scripts/check-ui.sh <PORT>`,
   which asserts the `Monthly window` handle is in the bundle.
2. Parsing proof: `cargo test reads_all_three_opencode_windows` maps
   `rolling`, `weekly`, and `monthly` onto 18000, 604800, and 2592000, and
   `absent_opencode_windows_stay_unavailable` keeps a missing window null.
3. Live proof: `live-opencode-usage.json` from `scripts/live-check.sh` carries
   the real `usage.monthly` object. Confirm its `percent` and `resetsAt` land
   in the figure and the `Resets` countdown.
4. Tray proof needs `vp run tauri dev` on a real desktop: the Opencode line
   reads `Opencode  5h N%  7d N%  30d N%` while Codex and Claude keep two
   columns.

## Gotchas

- 2592000 is an identity tag, not a claim about the billing period. Opencode
  renews a month after the plan started, so trust `resetsAt` for the date and
  not the 30-day span in the heading.
- The entry is skipped, not blanked. A selector expecting three progressbars
  in every provider block is wrong; only Opencode has three.
