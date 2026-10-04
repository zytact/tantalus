# Provider switches

Settings has accessible switches for direct Codex, Claude, and Opencode. Defaults are Codex and Claude on, Opencode off. A missing settings file uses those defaults. A malformed or unreadable file disables direct providers. Separately configured hubs are unaffected.

The main process saves the proposed choice before changing live state. Turning a direct provider off clears its reading, removes its allowance block and tray rows, and prevents credential reads. Turning one on refreshes it immediately. A save failure preserves the previous setting and shows an alert. Each hub has its own switch for all its Codex and Claude accounts, independent of the direct switches. Opencode has no hub support.

## Preview proof

On `--mock ready`, enable Opencode and add the fixture hub per `proxy-hubs.md`. For each direct provider, record its state, switch it off, and confirm its allowance block and tray rows disappear while other accounts remain. Refresh and check that its direct usage request stops. Hub Codex and Claude must remain when their direct switches are off. Run `launch.sh --restart`, then doctor, to prove persistence; switch the providers on and confirm the immediate refresh. Switch the hub off and confirm both pooled accounts disappear without affecting direct accounts, then back on. Restore the original choices before teardown.
