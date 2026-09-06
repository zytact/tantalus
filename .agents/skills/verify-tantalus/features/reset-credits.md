# Reset credits

Banked credits that reset a limit, with per-credit expiry dates.

## Sub-features

- Headline count: number or `Unavailable` when `reset_credit_count` is null
- Credit list `Credit N` plus `Expires Oct 4, ...` via `creditExpiry`
- Empty state `No credit details available.`
- Region `aria-label="Reset credits"`

## How to get to it (user POV)

Third entry in the app window, headed `Reset credits BANKED`. Empty until the
Rust side fetches `rate-limit-reset-credits` separately from usage.

## Driving it with browser tab

1. Launch on an isolated port, navigate, snapshot
2. Headless expectation: figure `Unavailable`, text
   `No credit details available.`
3. Formatter proof: `pnpm test` asserts `creditExpiry(null)` is
   `No expiry reported` and a 2026 October epoch contains `Oct 4`
4. Parsing proof: `cargo test parses_credit_container...`,
   `parses_rfc_3339_string_expiry`, and `numeric_string_expiry_is_read...`
   cover the `credits` / `data` / `items` containers, the six expiry key
   spellings, RFC 3339 strings, and epoch strings with millis and fractions
5. Live proof: `live-credits.json` from `scripts/live-check.sh` is the real
   credits payload. Confirm its container, `available_count`, and per-credit
   expiries match the headline count and rows.
6. Ready-state proof needs `pnpm tauri dev`: count headline plus one row per
   credit, each expiry naming month and day (weekday alone is not enough
   weeks out, per `presentation.ts`)

## Gotchas

- `available_count` wins over array length for the headline count.
- Unparseable expiries (`whenever`, `NaN`, `inf`, `-1e9`, empty) stay
  unavailable instead of rendering epoch zero.
- Credits come from a different endpoint than usage, so usage can be Ready
  while credits are still empty.
