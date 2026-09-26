# Reset credits

Codex fetches usage, reset credits, and its subscription before publishing a new Ready reading. Claude reads its banked resets from the same usage response. Reset credits follows the provider's windows, so it is not a fixed numbered entry: a monthly-only Codex account places it second. It is the last Codex section, while Claude's Extra usage follows it. Codex also shows `Subscription period ends <date>` under its heading when the subscription reports an end.

The section is named `Reset credits`, shows the banked count, and lists `Credit N` rows with localized expiry text. A successful response with no detail rows shows `No credit details available.` The parser accepts credit arrays under `credits`, `data`, or `items`, and prefers `available_count` for the headline.

## Preview proof

In Tantalus Preview on `--mock` `ready`, Refresh: Codex Reset credits reads 2 with two expiry rows, Claude's reads 1 before Extra usage, and Codex shows its subscription end. Switch to `monthly-only` and Refresh to see `No credit details available.` In real mode, enable Codex and Refresh. Capture the window after completion. Confirm Reset credits is last, its count matches the response, and each detail has an expiry or `No expiry reported`. Disable Codex and confirm the whole block disappears.
