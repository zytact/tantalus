# Tray and auto-refresh

The main process owns the tray, destroys the window on close and recreates it, and refreshes usage in the background. Healthy polling waits five minutes. Until every enabled provider is Ready, retries wait 5, 10, and 20 seconds and keep doubling up to five minutes.

The menu skips disabled providers. Each enabled provider has a heading and one row per reported `5h`, `7d`, or `30d` window. Rows include a bar, percentage, and optional `Under pace`, `On pace`, or `Ahead of pace`. A disabled refreshed row is recomputed every five seconds, and the menu is rebuilt only when a label changed. Show usage and reading rows open the window, Refresh now refreshes, and Quit exits.

Preview uses the blue icon and `Tantalus Preview` tooltip. Its tray, settings, and single-instance lock are separate from release.

## Preview proof

Mock mode proves the cadence without a tray. Launch with `--mock`, which reads once at launch and then waits five minutes. Switch to `error`, wait for that scheduled poll, and read the gaps between repeated `/backend-api/wham/usage` lines in `fixture-requests.log`: 300, then 5, 10, and 20 seconds. Manual refreshes in between add their own lines, so avoid them during this proof.

Xvfb has no tray host, so the menu is proved on a real Linux desktop whose shell hosts StatusNotifierItems, such as GNOME with the AppIndicator extension. Launch the built preview there with `--hidden`, so no window opens, and with the mock environment from `launch.sh` so it reads fixtures. Electron publishes the menu over D-Bus, which lets you read it without a screenshot:

```sh
svc=org.freedesktop.StatusNotifierItem-<PREVIEW_PID>-1
gdbus call --session --dest "$svc" --object-path /org/chromium/DbusMenu \
  --method com.canonical.dbusmenu.GetLayout -- 0 -1 '["label","enabled"]'
```

Compare every provider row with the window, confirm the refreshed row counts up after a minute, and confirm `ToolTip` on `/StatusNotifierItem` reads `Tantalus Preview`. Trigger an item with `com.canonical.dbusmenu.Event -- <ID> clicked '<"">' 0`, using the item id from the layout: Refresh now adds fixture requests, and Quit ends the process. Left-click activation, the icon's look, and whether a label change closes an open menu need eyes on the desktop, so record those in the run notes.
