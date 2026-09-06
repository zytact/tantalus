# Long window (7 days)

The second ledger entry. Same shape as the short window but bound to the
604800-second window.

## Sub-features

- Headline figure, progress rule, and Resets / At / Remaining facts
- `Window unavailable` plus `unrecognized duration` when the backend reports
  no 7-day window
- `aria-label="Long window usage"` on the progressbar once durations arrive

## How to get to it (user POV)

Second entry in the app window, under the Short window. Under Tauri it reads
`Long window 7 days`; headless it reads `Window unavailable` like the first
entry.

## Driving it with browser tab

1. Launch on an isolated port and navigate a browser tab to it
2. Snapshot and assert the second `role=region` plus its
   `role=progressbar[name="Long window usage"]` (Tauri) or second
   `role=progressbar[name="Window unavailable usage"]` (headless)
3. Formatter proof: `pnpm test` countdown case `4d 20h` is the long-window
   bucket shape
4. Live proof: the same `live-usage.json` carries the 604800-second window.
   Confirm its `used_percent` and reset fields alongside the short window.
5. Ready-state proof needs `pnpm tauri dev`: figure `N%`, `Resets` in
   `Nd Nh` form, `Remaining` at `100 - used`

## Gotchas

- Primary and secondary windows are assigned by duration, not position.
  `parse_usage` searches both for 18000 and 604800, so a swapped payload
  still lands correctly (`cargo test maps_windows_by_duration...`).
- Unknown durations (missing, 3600, fractional) leave both entries
  unavailable rather than guessing. Do not assert a zero in that case.
