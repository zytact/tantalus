# Provider switches

Settings has accessible switches for Codex, Claude, and Opencode. Defaults are Codex and Claude on, Opencode off. A missing settings file uses those defaults. A malformed or unreadable file disables all providers.

Rust saves the proposed choice before mutating live state. Turning a provider off clears its reading, removes its allowance block and tray rows, and prevents credential reads. Turning one on refreshes it immediately. A save failure preserves the previous setting and shows an alert.

## Preview proof

In Tantalus Preview, record one provider's state, switch it off, and capture Settings and Allowance. Confirm its block and tray rows disappear while other providers remain. Restart Preview to prove persistence, switch it on, confirm the immediate refresh, then restore the original state.
