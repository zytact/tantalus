# Long window (7 days)

Rust maps Codex's exact 604,800-second window, Claude's `seven_day`, and Opencode's `usage.weekly` into the Long window. Reported windows stay in Short, Long, Monthly order, but Long is not always second because absent windows are omitted.

It shows the used percentage, a progressbar named `Long window usage`, optional pace, Resets, At, and Remaining. A missing Long window does not own an unavailable placeholder. The single generic placeholder appears only when the provider has no recognized windows.

## Preview proof

In Tantalus Preview on `--mock` `ready`, refresh and use Codex 7d (12% with 5 of 7 days left) or Claude 7d. In real mode, use a provider with a weekly reading. Capture the native window and confirm `Long window`, `7 days`, the percentage, reset facts, and Remaining. A monthly-only Codex account must omit Long; the `monthly-only` scenario proves it. The tray has a separate `7d` row when Long exists.
