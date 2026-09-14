# Reset credits

Codex fetches usage and reset credits before publishing a new Ready reading. Reset credits is the final Codex section, not a fixed numbered entry. Monthly-only accounts place it second, while accounts with three windows place it fourth.

The section is named `Reset credits`, shows the banked count, and lists `Credit N` rows with localized expiry text. A successful response with no detail rows shows `No credit details available.` The parser accepts credit arrays under `credits`, `data`, or `items`, and prefers `available_count` for the headline.

## Preview proof

In Tantalus Preview on `--mock` `ready`, Refresh: Reset credits reads 2 with two expiry rows. Switch to `monthly-only` and Refresh to see `No credit details available.` In real mode, enable Codex and Refresh. Capture the native window after completion. Confirm Reset credits is last, its count matches the response, and each detail has an expiry or `No expiry reported`. Disable Codex and confirm the whole block disappears.
