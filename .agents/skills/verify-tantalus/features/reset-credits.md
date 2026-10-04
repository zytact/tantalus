# Reset credits

Direct Codex fetches usage, reset credits, and its subscription before publishing a new Ready reading. Claude reads its banked resets from the same usage response. Direct and hub Codex and Claude show Reset credits after their windows, so it is not a fixed numbered entry: a monthly-only Codex account places it second. It is the last Codex section, while Claude's Extra usage follows it. Opencode has no reset-credit field or section. Codex also shows `Subscription period ends <date>` under its heading when the reported end is in the future.

The section is named `Reset credits`, shows the banked count, and lists `Credit N` rows with localized expiry text. A successful response with no detail rows shows `No credit details available.` Direct Codex accepts credit arrays under `credits`, `data`, or `items`, and prefers `available_count` for the headline. Hub Codex counts only available, unexpired `codex_rate_limits` credits with date-string expiries. A hub credit-read failure leaves usage Ready with credits unavailable.

## Preview proof

In Tantalus Preview on `--mock` `ready`, enable Opencode and add the fixture hub per `proxy-hubs.md`. Refresh: direct and hub Codex each read 2 with two expiry rows, both Claude accounts read 1 before Extra usage, and Opencode has no Reset credits. Codex shows its subscription end. Switch to `monthly-only` and Refresh to see zero credits and `No credit details available.` in both Codex accounts. In real mode, enable Codex and Refresh. Capture the window after completion. Confirm Reset credits is last, its count matches the response, and each detail has an expiry or `No expiry reported`. Disable direct Codex and confirm its block disappears while hub Codex remains.
