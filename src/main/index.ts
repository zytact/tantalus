import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, Tray } from "electron";
import appIcon from "../../build/icons/icon.png";
import previewAppIcon from "../../build/icons/preview/icon.png";
import previewTrayIcon from "../../build/icons/preview/tray.png";
import trayIcon from "../../build/icons/tray.png";
import { CURRENT, remoteRoutes } from "../shared/ipc";
import type { Commands, Events, Reply } from "../shared/ipc";
import { nowEpoch, providerIds } from "../shared/usage";
import { UsageApi } from "./api";
import { readCredentials } from "./auth";
import { identities } from "./identity";
import { launchedHidden, openAtLogin, setOpenAtLogin } from "./open-at-login";
import { RemoteAccessRoutes } from "./remote-access";
import { trayItems } from "./tray-menu";
import type { TrayAction } from "./tray-menu";
import { Updater } from "./update";
import { pollUsage, UsageState } from "./usage-state";
import { WebServer } from "./web-server";

const identity = app.getName() === identities.preview.productName ? identities.preview : identities.release;
const preview = identity === identities.preview;

// Settings and the single-instance lock live under the user data directory, so keying it by the
// identifier keeps a preview's apart from the release's.
app.setPath("userData", join(app.getPath("appData"), identity.appId));

/** The window shell paints before the page does, so it carries the same canvas color the stylesheet
 * uses. Without it a dark desktop gets a cream flash on every open. */
const canvas = () => (nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#fbf8f1");

/** Refreshes the time-derived tray labels without rebuilding, and so closing, an open menu when
 * nothing on it changed. */
const TRAY_TICK = 5000;

/** The built page, which the window loads from disk and the web server serves to other devices. */
const page = join(import.meta.dirname, "..", "dist");

let mainWindow: BrowserWindow | null = null;

/** A second launch belongs to the instance already in the tray, so it raises that window instead of
 * starting a rival process with its own tray icon. */
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on("second-instance", showWindow);
  // Closing the window leaves the app in the tray. Only Quit ends the process.
  app.on("window-all-closed", () => {});
  void app.whenReady().then(start);
}

function start() {
  // The default menu binds Ctrl+R to reload, and that chord belongs to the app's refresh. macOS keeps
  // a menu without it, so Cmd+Q and the edit shortcuts still work.
  Menu.setApplicationMenu(
    process.platform === "darwin"
      ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }])
      : null,
  );

  const web = new WebServer(page, identity.ports.web, () => state.snapshot);
  const api = new UsageApi((preview && process.env.TANTALUS_USAGE_BASE_URL) || null);
  const state = new UsageState(
    join(app.getPath("userData"), "providers.json"),
    async (provider) => api.fetch(provider, await readCredentials(provider)),
    (snapshot) => {
      renderTray();
      publish("usageSnapshot", snapshot);
      web.publish(snapshot);
    },
  );
  const remote = new RemoteAccessRoutes(join(app.getPath("userData"), "remote-access.json"), identity.ports, web);
  const updater = new Updater((update) => {
    renderTray();
    publish("updateAvailable", update);
  });
  // A dev build has no bundle to replace, and a preview installs under its own name, so a release
  // would land beside it rather than update it.
  const updatesEnabled = app.isPackaged && !preview;

  const tray = new Tray(trayImage());
  tray.setToolTip(identity.productName);
  // macOS opens the menu on a left click; elsewhere the click opens the window and the menu keeps its
  // own button.
  if (process.platform !== "darwin") tray.on("click", showWindow);
  const trayActions: Record<TrayAction, () => void> = {
    show: showWindow,
    refresh: () => void state.refresh(),
    quit: () => app.quit(),
  };
  let shownTray = "";
  function renderTray() {
    const items = trayItems(state.snapshot, updater.available(), nowEpoch());
    const shown = JSON.stringify(items);
    if (shown === shownTray) return;
    shownTray = shown;
    tray.setContextMenu(
      Menu.buildFromTemplate(
        items.map((item) =>
          item === "separator"
            ? { type: "separator" }
            : {
                label: item.label,
                enabled: item.action !== null,
                click: item.action ? trayActions[item.action] : undefined,
              },
        ),
      ),
    );
  }
  renderTray();
  setInterval(renderTray, TRAY_TICK);

  const current: { [E in keyof Events]: () => Events[E] | null } = {
    usageSnapshot: () => state.snapshot,
    updateAvailable: () => updater.available(),
  };
  ipcMain.handle(CURRENT, (_event, event: keyof Events) => current[event]?.() ?? null);
  handle("refreshUsage", () => state.refresh());
  handle("setProviderEnabled", (provider, enabled) => {
    if (!providerIds.includes(provider) || typeof enabled !== "boolean") throw new Error("Unknown provider setting.");
    try {
      return state.setProviderEnabled(provider, enabled);
    } catch (error) {
      throw new Error(`Could not save provider setting: ${message(error)}`);
    }
  });
  handle("checkForUpdate", async () => {
    if (!updatesEnabled) throw new Error("Dev and preview builds do not check for updates.");
    return updater.check().catch((error: unknown) => {
      throw new Error(`Could not check for updates: ${message(error)}`);
    });
  });
  handle("installUpdate", () => updater.install());
  handle("openAtLogin", () => openAtLogin(identity));
  handle("setOpenAtLogin", (enabled) => setOpenAtLogin(identity, enabled === true));
  handle("remoteAccess", () => remote.read());
  handle("setRemoteAccess", (route, enabled) => {
    if (!remoteRoutes.includes(route) || typeof enabled !== "boolean") {
      throw new Error("Unknown remote access setting.");
    }
    return remote.set(route, enabled);
  });

  // Clicking the dock icon on macOS reopens the window.
  app.on("activate", showWindow);
  if (!launchedHidden()) showWindow();
  void pollUsage(state, sleep);
  remote.start().catch((error: unknown) => console.error("Failed to start remote access:", error));
  if (updatesEnabled) void updater.watch();
}

/** Closing the window destroys it, so the tray and a normal launch build it afresh. A closed window
 * holds no renderer process while the app sits in the tray. */
function showWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  const window = new BrowserWindow({
    title: identity.productName,
    icon: nativeImage.createFromDataURL(preview ? previewAppIcon : appIcon),
    width: 480,
    height: 590,
    minWidth: 360,
    minHeight: 500,
    backgroundColor: canvas(),
    webPreferences: { preload: join(import.meta.dirname, "preload.cjs"), sandbox: true, contextIsolation: true },
  });
  mainWindow = window;
  const paint = () => window.setBackgroundColor(canvas());
  nativeTheme.on("updated", paint);
  window.on("closed", () => {
    nativeTheme.off("updated", paint);
    mainWindow = null;
  });
  // The title names the build, so a preview is told apart from the release, whatever the page says.
  window.on("page-title-updated", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  const devServer = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL;
  void (devServer ? window.loadURL(devServer) : window.loadFile(join(page, "index.html")));
}

/** The app mark without its base arc, which stays legible at tray sizes. macOS draws the release mark
 * from its alpha channel as a template image, and the preview mark in color, since both share one
 * silhouette. */
function trayImage() {
  const image = nativeImage.createFromDataURL(preview ? previewTrayIcon : trayIcon);
  if (process.platform !== "darwin") return image;
  const sized = image.resize({ height: 18, quality: "best" });
  sized.addRepresentation({ scaleFactor: 2, buffer: image.resize({ height: 36, quality: "best" }).toPNG() });
  sized.setTemplateImage(!preview);
  return sized;
}

function publish<E extends keyof Events>(event: E, payload: Events[E]) {
  mainWindow?.webContents.send(event, payload);
}

function handle<C extends keyof Commands>(
  command: C,
  run: (...args: Parameters<Commands[C]>) => ReturnType<Commands[C]> | Promise<ReturnType<Commands[C]>>,
) {
  ipcMain.handle(command, async (_event, ...args: Parameters<Commands[C]>): Promise<Reply<ReturnType<Commands[C]>>> => {
    try {
      return { ok: true, value: await run(...args) };
    } catch (error) {
      return { ok: false, error: message(error) };
    }
  });
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
