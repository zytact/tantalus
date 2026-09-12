# Monthly window (30 days)

A ledger entry rendered for Opencode, which reports it alongside its other two
windows, and for Codex on a Go or free account, where it is the only window the
account has. Claude reports no monthly window, so its block skips the entry
entirely rather than showing a `Window unavailable` placeholder.

## Sub-features

- Rendered only when `monthly.limit_window_seconds` is 2592000
  (`windowEntries` and `ProviderSection` in `src/main.tsx`)
- Headline figure, progress rule
  `role=progressbar[name="Monthly window usage"]`, and the same Resets / At /
  Remaining facts as the other two windows
- Duration identity is 2592000 seconds: supplied by `parse_opencode_usage` for
  Opencode, matched against the reported `limit_window_seconds` by
  `parse_usage` for Codex (`src-tauri/src/usage.rs`)
- The tray gains a `30d` row. For Codex on a Go or free account it is the only
  row (`tray_rows` in `src-tauri/src/lib.rs`)

## How to get to it (user POV)

Turn Opencode on in Settings. Its block then shows three entries: Short window,
Long window, and Monthly window, in that order. A Codex block shows Monthly
window alone on a Go or free account, and Short window plus Long window on Plus.
The Claude block always shows two.

## Driving it with browser tab

Mock-driven (Drive step 3 in `SKILL.md`):

- Opencode starts off, matching Rust's default, so switch it on in Settings
  first. Its block then carries three progressbars, the third named
  `Monthly window usage` reading `1%`, with `Resets` in `Nd Nh` form.
- Codex starts on the weekly plan. `window.__TANTALUS_MOCK__.codexPlan("monthly")`
  followed by a Refresh click reshapes its reading into the Go and free account
  shape: one progressbar, `Monthly window usage` at `58%`, with no `Short
  window` or `Long window` heading and no `Window unavailable` placeholder.
  `codexPlan("weekly")` puts it back.

1. Launch on an isolated port. Static proof is `scripts/check-ui.sh <PORT>`,
   which asserts the `Monthly window` handle is in the bundle.
2. Parsing proof: `cargo test reads_all_three_opencode_windows` maps `rolling`,
   `weekly`, and `monthly` onto 18000, 604800, and 2592000, and
   `absent_opencode_windows_stay_unavailable` keeps a missing window null. For
   Codex, `cargo test a_monthly_window_is_the_only_one_a_go_or_free_account_reports`
   reads the Go and free shape.
3. Live proof: `live-opencode-usage.json` from `scripts/live-check.sh` carries
   the real `usage.monthly` object. Confirm its `percent` and `resetsAt` land
   in the figure and the `Resets` countdown. `live-usage.json` carries the
   Codex `plan_type` alongside the windows that account actually has, so it
   says which shape to expect.
4. Tray proof needs `vp run tauri dev` on a real desktop: the Opencode line
   reads `Opencode  5h N%  7d N%  30d N%`, a Go or free Codex line reads
   `Codex  30d N%`, and Claude keeps two columns.

## Gotchas

- 2592000 is an identity tag, not a claim about the billing period. Both
  providers renew a month after the plan started, so trust the reset stamp for
  the date and not the 30-day span in the heading.
- The entry is skipped, not blanked. A selector expecting the same number of
  progressbars in every provider block is wrong.
- A Codex Go or free account has no 5-hour window and no weekly one. Asserting
  a Short window entry inside every provider block is wrong.
