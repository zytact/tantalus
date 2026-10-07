# Tray and auto-refresh

The main process owns the tray, destroys the window on close and recreates it, and refreshes usage in the background. Healthy polling waits five minutes after a refresh finishes, so request gaps also include its duration. Until every enabled direct provider, hub, and hub account is Ready, retries wait 5, 10, and 20 seconds and keep doubling up to five minutes. A retry reads only the direct providers and whole hubs that are not Ready. Everything is read again once five minutes have passed since the last full read began, and a retry never sleeps past that point. Rejected hubs count as settled and are not read again.

The menu skips disabled direct providers and hubs. Each account has a provider-and-plan heading and one row per reported `5h`, `7d`, or `30d` window. Rows include a remaining-allowance bar, a percentage labeled `remaining`, and optional `Under pace`, `On pace`, or `Ahead of pace`. An account with no windows has a `--` row; empty or failed hubs show a disabled status row. Each switched-on proxy hub adds its own block of Codex and Claude account rows, headed `<Provider> <n> · <plan>` with `<n>` counting that provider's accounts in the hub, since the menu cannot blur emails; Opencode is direct-only. The dragon and tortoise never appear in the tray. A disabled refreshed row is recomputed every five seconds, and the menu is rebuilt only when a label changed. Its time is the newest successful provider, hub-listing, or hub-account read, not proof that all accounts succeeded. Open Tantalus and reading rows open the window, Refresh now refreshes, and Quit exits.

Preview uses the blue icon and `Tantalus Preview` tooltip. Its tray, settings, and single-instance lock are separate from release.

## Preview proof

Mock mode proves the cadence without a tray. Launch with `--mock ready`, enable Opencode, and add the fixture hub per `proxy-hubs.md`. Restart and run doctor to establish a clean polling baseline. Switch to `error`, wait for that scheduled poll, and read the gaps between repeated direct usage GETs and hub management bursts in `fixture-requests.log`: approximately 300, then 5, 10, and 20 seconds. Manual refreshes in between add their own lines, so avoid them during this proof. Restore `ready` and confirm a scheduled success returns polling to five minutes. To prove retries leave healthy sources alone, switch to `hub-error` and run `launch.sh --restart` so the startup read fails only the hub. For about five minutes, `auth-files` and `HUB` lines repeat at the 5, 10, 20, 40, and 80 second gaps while `/zen/go/v1/usage` appears only at startup, then both appear together at the five-minute mark.

Xvfb provides no tray host itself. When its session D-Bus has a StatusNotifierWatcher, the harness preview still exports its menu there, so use the recorded PID without launching another instance. Otherwise menu proof needs a Linux desktop whose shell hosts StatusNotifierItems, such as GNOME with the AppIndicator extension. Launch the built preview there with `--hidden` and the isolated mock environment. Electron publishes the menu over D-Bus, which lets you read it without a screenshot:

```sh
svc=org.freedesktop.StatusNotifierItem-<PREVIEW_PID>-1
gdbus call --session --dest "$svc" --object-path /org/chromium/DbusMenu \
  --method com.canonical.dbusmenu.GetLayout -- 0 -1 '["label","enabled"]'
```

Compare every direct and hub account row with the window, confirm the refreshed row counts up after a minute, and confirm `ToolTip` on `/StatusNotifierItem` reads `Tantalus Preview` while Usage in tray is off (see `tray-usage.md` for the tooltip with it on, including how to export the icon image with `scripts/tray-icon.sh`). Trigger an item with `com.canonical.dbusmenu.Event -- <ID> clicked '<"">' 0`, using the current layout's item id: Refresh now adds fixture requests, and Quit ends the process. Capture evidence before Quit. Left-click activation and whether a label change closes an open menu need eyes on the desktop, so record those prerequisites in the run notes. Left click opens the window on Linux and Windows, and the menu on macOS.
