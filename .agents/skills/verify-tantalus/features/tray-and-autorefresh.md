# Tray and auto-refresh

Rust owns the tray, closes and recreates the main window, and refreshes usage in the background. Healthy polling waits five minutes. Failures retry after 5, 10, 20 minutes and continue doubling up to five minutes.

The menu skips disabled providers. Each enabled provider has a heading and one row per reported `5h`, `7d`, or `30d` window. Rows include a bar, percentage, and optional `Under pace`, `On pace`, or `Ahead of pace`. A disabled refreshed row updates every five seconds. Show usage and reading rows open the window, Refresh now refreshes, and Quit exits.

Preview uses the blue icon and `Tantalus Preview` tooltip. Its tray, settings, and singleton identity are separate from release.

## Preview proof

Inspect the Tantalus Preview tray directly. Compare every provider row with the window, use Refresh now, close and reopen the window through Show usage or left-click, and wait through one five-minute poll. Confirm the refreshed label resets, then Quit. Screenshots cover the window only, so record tray observations in the run notes.
