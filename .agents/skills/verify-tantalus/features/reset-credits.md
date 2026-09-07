# Reset credits

Banked credits that reset a limit, with per-credit expiry dates. Codex only:
Claude has no reset credits and renders an `Extra usage` section in the same
slot.

## Sub-features

- Headline count: number or `Unavailable` when `reset_credit_count` is null
- Credit list `Credit N` plus `Expires Oct 4, ...` via `creditExpiry`
- Empty state `No credit details available.`
- Region `aria-label="Reset credits"`
- Claude alternative in the same slot: region `aria-label="Extra usage"`,
  headline from `creditAmount` (`12.50 USD`), a `Monthly limit` row, and an
  `enabled` / `off` marker (`src/main.tsx` `Extras`,
  `src-tauri/src/usage.rs` `parse_extra_usage`)

## How to get to it (user POV)

Third entry inside the Codex block, headed `Reset credits BANKED`, and only
while the Codex switch is on. Empty until the Rust side fetches
`rate-limit-reset-credits` separately from usage. The Claude block shows
`Extra usage` there instead, once its payload carries `extra_usage`.

## Driving it with browser tab

1. Launch on an isolated port, navigate, snapshot
2. Headless expectation: two `Reset credits` regions, one per provider,
   since the loading shell has no `extra_usage` for either. Each shows the
   figure `Unavailable` and the text `No credit details available.`
3. Formatter proof: `pnpm test` asserts `creditExpiry(null)` is
   `No expiry reported` and a 2026 October epoch contains `Oct 4`
4. Parsing proof: `cargo test parses_credit_container...`,
   `parses_rfc_3339_string_expiry`, and `numeric_string_expiry_is_read...`
   cover the `credits` / `data` / `items` containers, the six expiry key
   spellings, RFC 3339 strings, and epoch strings with millis and fractions
5. Live proof: `live-credits.json` from
   `.agents/skills/verify-tantalus/scripts/live-check.sh` is the real
   credits payload. Confirm its container, `available_count`, and per-credit
   expiries match the headline count and rows.
6. Ready-state proof needs `pnpm tauri dev`: count headline plus one row per
   credit, each expiry naming month and day (weekday alone is not enough
   weeks out, per `presentation.ts`). In the Claude block, expect
   `Extra usage` with a `Monthly limit` row instead, matching
   `extra_usage` in `live-claude-usage.json`.

## Gotchas

- `available_count` wins over array length for the headline count.
- Unparseable expiries (`whenever`, `NaN`, `inf`, `-1e9`, empty) stay
  unavailable instead of rendering epoch zero.
- Credits come from a different endpoint than usage, so usage can be Ready
  while credits are still empty.
