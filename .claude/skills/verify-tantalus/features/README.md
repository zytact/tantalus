# Tantalus feature map

One file covers each user-facing feature backed by `src/` and the README.

- [short-window](short-window.md) - 5-hour remaining allowance
- [long-window](long-window.md) - 7-day remaining allowance
- [monthly-window](monthly-window.md) - 30-day remaining allowance
- [reset-credits](reset-credits.md) - Codex and Claude banked reset credits
- [extra-usage](extra-usage.md) - Claude remaining monthly overflow budget
- [manual-refresh](manual-refresh.md) - button, shortcut, tray refresh, and failure states
- [pace](pace.md) - dragon and tortoise, learning, presets, and reset
- [proxy-hubs](proxy-hubs.md) - CLIProxyAPI hubs and their pooled accounts
- [window-start](window-start.md) - starting idle Claude and Codex 5-hour windows through their CLIs
- [tray-usage](tray-usage.md) - one account or pool's remaining allowance beside the tray icon, and its account picker
- [provider-switch](provider-switch.md) - provider enablement and persistence
- [settings](settings.md) - every Settings row, version, and updates
- [remote-access](remote-access.md) - read-only page over the local network and Tailscale, and device pairing
- [host-link](host-link.md) - following another Tantalus's usage instead of reading this machine's
- [tray-and-autorefresh](tray-and-autorefresh.md) - tray menu, polling, and token privacy
- [updates](updates.md) - release update checks and installation

All UI proof uses the built Tantalus Preview app, driven through `drive.ts`, and its window screenshots. Do not load the page in a separate browser or stub the preload bridge. The remote access page is the exception: it is meant for a browser, so load it from the running preview's server using the collaborative browser when available, otherwise `drive.ts --web`. Fixture usage from `launch.sh --mock` is allowed because only the network answers change. The preview's product name, app id, executable, settings, autostart entry, and single-instance lock are separate from the installed release.

Fixture suites prove parsing and formatting edges. The preview proves the real React page, main-process commands, tray, and settings persistence. Real mode proves live credential paths and the windows the account actually reports. Mock mode proves specific figures and states on demand, so each proof below names a scenario.
