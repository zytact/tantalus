# Long window (7 days)

The second ledger entry inside each provider block. Same shape as the short
window. It is available only when Codex reports the recognized 604800-second
window or Claude supplies `seven_day`.

## Sub-features

- Headline figure, progress rule, and Resets / At / Remaining facts
- `Window unavailable` plus `unrecognized duration` when the backend reports
  no 7-day window
- `aria-label="Long window usage"` on the progressbar once durations arrive

## How to get to it (user POV)

Second entry inside a provider block, under that provider's Short window,
and only while the provider's switch is on. Under Tauri it reads
`Long window 7 days` when Codex reports the recognized 604800-second window
or Claude supplies `seven_day`. Otherwise it reads `Window unavailable`. A
plain browser never receives the snapshot that renders this entry.

## Driving it with browser tab

1. Launch on an isolated port. Static proof is `scripts/check-ui.sh <PORT>`.
2. A plain-browser snapshot must not assert a provider block, region, or
   progressbar. It only shows the provider-settings load error after
   `cached_usage` rejects.
3. Formatter proof: `pnpm test` countdown case `4d 20h` is the long-window
   bucket shape
4. Live proof: `live-usage.json` carries the Codex 604800-second window and
   `live-claude-usage.json` carries the Claude `seven_day` object. Confirm
   the used figures and reset fields alongside the short window.
5. Ready-state proof needs `pnpm tauri dev`: the second region inside each
   enabled provider has `role=progressbar[name="Long window usage"]`, figure `N%`, `Resets` in
   `Nd Nh` form, `Remaining` at `100 - used`

## Gotchas

- For Codex, primary and secondary windows are assigned by duration, not
  position. `parse_usage` searches both for 18000 and 604800, so a swapped
  payload still lands correctly (`cargo test maps_windows_by_duration...`).
  Claude reads the literal `seven_day` field and supplies the duration
  itself, so that rule does not govern the Claude entry.
- Unknown durations (missing, 3600, fractional) leave both Codex entries
  unavailable rather than guessing. Do not assert a zero in that case.
