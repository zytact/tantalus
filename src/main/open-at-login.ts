import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import type { Identity } from "./identity";

/** The login registration launches with this flag so the app settles into the tray instead of pushing
 * a window at someone who has just signed in. */
const HIDDEN_FLAG = "--hidden";

/** macOS registers the app itself rather than a command line, so it reports the login launch
 * instead of passing the flag. */
export function launchedHidden(): boolean {
  return (
    process.argv.includes(HIDDEN_FLAG) || (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin)
  );
}

/** Linux has no login item API, so the registration is an XDG autostart entry. */
function autostartEntries(identity: Identity): string[] {
  const config = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return [
    ...new Set([
      join(config, "autostart", `${identity.productName}.desktop`),
      join(config, "autostart", `${identity.executableName}.desktop`),
      join(homedir(), ".config", "autostart", `${identity.productName}.desktop`),
    ]),
  ];
}

function legacyMacLoginItem(identity: Identity): string {
  return join(homedir(), "Library", "LaunchAgents", `${identity.productName}.plist`);
}

/** Read from the operating system on every call, since the registration can change from outside the app. */
export function openAtLogin(identity: Identity): boolean {
  if (process.platform === "linux") return autostartEntries(identity).some(existsSync);
  return systemOpenAtLogin(identity);
}

function systemOpenAtLogin(identity: Identity): boolean {
  const settings = app.getLoginItemSettings({ args: [HIDDEN_FLAG] });
  if (process.platform === "darwin") return settings.openAtLogin || existsSync(legacyMacLoginItem(identity));
  return (
    settings.openAtLogin || settings.launchItems.some((item) => item.name === identity.productName && item.enabled)
  );
}

export function setOpenAtLogin(identity: Identity, enabled: boolean) {
  if (process.platform === "linux") {
    setLinuxOpenAtLogin(identity, enabled);
    return;
  }
  setSystemOpenAtLogin(identity, enabled);
}

function setSystemOpenAtLogin(identity: Identity, enabled: boolean) {
  if (process.platform === "darwin") {
    app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_FLAG] });
    rmSync(legacyMacLoginItem(identity), { force: true });
    return;
  }
  if (process.platform === "win32") {
    app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_FLAG], name: identity.productName });
    if (!enabled) app.setLoginItemSettings({ openAtLogin: false, args: [HIDDEN_FLAG] });
  }
}

function setLinuxOpenAtLogin(identity: Identity, enabled: boolean) {
  const [entry, ...supersededEntries] = autostartEntries(identity);
  if (!enabled) {
    for (const path of [entry, ...supersededEntries]) rmSync(path, { force: true });
    return;
  }
  mkdirSync(join(entry, ".."), { recursive: true });
  writeFileSync(
    entry,
    [
      "[Desktop Entry]",
      "Type=Application",
      `Name=${identity.productName}`,
      `Exec="${process.execPath.replaceAll(/["`$\\]/g, "\\$&").replaceAll("%", "%%")}" ${HIDDEN_FLAG}`,
      "X-GNOME-Autostart-enabled=true",
      "",
    ].join("\n"),
  );
  for (const path of supersededEntries) rmSync(path, { force: true });
}
