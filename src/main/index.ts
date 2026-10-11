import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, shell, Tray } from "electron";
import type { MenuItemConstructorOptions, NativeImage } from "electron";
import appIcon from "../../build/icons/icon.png";
import previewAppIcon from "../../build/icons/preview/icon.png";
import previewTrayIcon from "../../build/icons/preview/tray.png";
import trayIcon from "../../build/icons/tray.png";
import { CURRENT, TOAST_MILLISECONDS, remoteRoutes } from "../shared/ipc";
import type { Commands, Events, ProxyHubInput, Reply } from "../shared/ipc";
import { defaultPaceSettings } from "../shared/pace";
import { trayUsageColors, trayUsageReading } from "../shared/tray-usage";
import { nowEpoch, percent, providerIds, proxyHubManagementUrl, signInSources } from "../shared/usage";
import type { UsageSnapshot } from "../shared/usage";
import { readActivity } from "./activity";
import { UsageApi } from "./api";
import { findSignIns, readCredentials } from "./auth";
import { asError } from "./failure";
import { runCli, startCli } from "./cli";
import { HostLinkClient } from "./host-link";
import type { TokenVault } from "./host-link";
import { identities } from "./identity";
import { launchedHidden, openAtLogin, setOpenAtLogin } from "./open-at-login";
import { PaceTracker } from "./pace-tracker";
import { Pairing } from "./pairing";
import {
  loadHostId,
  loadTrayUsageSettings,
  noProviders,
  paceSettings,
  saveSettings,
  trayUsageSettings,
  windowStartSettings,
} from "./settings";
import { ProxyHubApi } from "./proxy-hub-api";
import { RemoteAccessRoutes } from "./remote-access";
import { trayPercent, usageBitmap } from "./tray-icon";
import { trayItems } from "./tray-menu";
import type { TrayAction, TrayItem } from "./tray-menu";
import { Updater } from "./update";
import { pollUsage, UsageState } from "./usage-state";
import { WebServer } from "./web-server";
import { WindowStarter } from "./window-start";

const identity = app.getName() === identities.preview.productName ? identities.preview : identities.release;
const preview = identity === identities.preview;

// Settings and the single-instance lock live under the user data directory, so keying it by the
// identifier keeps a preview's apart from the release's.
app.setPath("userData", join(app.getPath("appData"), identity.appId));

/** The window shell paints before the page does, so it carries the same canvas color the stylesheet
 * uses. Without it a dark desktop gets a cream flash on every open. */
const canvas = () => (nativeTheme.shouldUseDarkColors ? "#0b0b0b" : "#fff");

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
  configureApplicationMenu();

  const pairing = new Pairing(
    join(app.getPath("userData"), "paired-devices.json"),
    () => publish("remoteDevices", remoteDevices()),
    (message) => notify(message),
  );
  const web = new WebServer({
    root: page,
    port: identity.ports.web,
    id: loadHostId(join(app.getPath("userData"), "host-id.json")),
    snapshot: () => state.snapshot,
    refresh: () => state.refresh(),
    routes: () => remote.served(),
    updates: {
      available: () => updater.available(),
      progress: () => updater.installProgress(),
      check: () => checkForUpdate(),
      install: (acknowledgedNoticeIds) => updater.install(acknowledgedNoticeIds),
      notes: () => updater.releaseNotes(),
    },
    pairing,
    onConnections: () => publish("remoteDevices", remoteDevices()),
  });
  const remoteDevices = () => pairing.read(web.connected());
  // Ends every stream first, so each device's last visit is recorded.
  app.on("before-quit", () => void web.listen(null));
  const api = new UsageApi((preview && process.env.TANTALUS_USAGE_BASE_URL) || null);
  const proxyHubs = new ProxyHubApi();
  // A window opened while a toast still shows picks it up; an expired one is not replayed.
  let toast: string | null = null;
  const notify = (message: string) => {
    toast = message;
    publish("toast", message);
    setTimeout(() => {
      if (toast === message) toast = null;
    }, TOAST_MILLISECONDS);
  };
  const state = new UsageState(
    join(app.getPath("userData"), "providers.json"),
    join(app.getPath("userData"), "proxy-hubs.json"),
    signInSettingsPath(),
    async (provider, sources) =>
      Promise.all(
        (await findSignIns(provider, sources)).map(async ({ id, distribution, path }) => ({
          id,
          distribution,
          usage: await readCredentials(provider, path).then((credentials) => api.fetch(provider, credentials), asError),
        })),
      ),
    (config) => proxyHubs.read(config),
    (snapshot) => {
      // A read that was running when this machine started following a host is not shown.
      if (link.active) return;
      starter.observe(snapshot);
      snapshot.window_starts = starter.results();
      renderTray();
      publish("usageSnapshot", snapshot);
      web.publish("usageSnapshot", snapshot);
    },
    new PaceTracker(
      join(app.getPath("userData"), "pace-log.json"),
      join(app.getPath("userData"), "pace-creatures.json"),
      (sources) => readActivity(sources),
    ),
    notify,
  );
  const starter = new WindowStarter(
    join(app.getPath("userData"), "window-start.json"),
    startCli,
    runCli,
    () => void state.refresh(),
    (hubId, accountId, provider, ensureEnabled) =>
      state.withProxyHub(hubId, (config, ensureAvailable) =>
        proxyHubs.runAccount(config, accountId, provider, () => {
          ensureEnabled();
          ensureAvailable();
        }),
      ),
    notify,
  );
  const remote = new RemoteAccessRoutes(join(app.getPath("userData"), "remote-access.json"), identity.ports, web);
  const link = new HostLinkClient({
    path: join(app.getPath("userData"), "host-link.json"),
    vault: tokenVault(),
    onSnapshot: (snapshot) => {
      renderTray();
      publish("usageSnapshot", snapshot);
    },
    onHostUpdate: ({ hostUpdate, hostInstallProgress }) => {
      publish("hostUpdate", hostUpdate);
      publish("hostInstallProgress", hostInstallProgress);
    },
    onChange: (hostLink) => {
      renderTray();
      publish("hostLink", hostLink);
    },
  });
  const { usage, tray: trayUsage, refresh, sameSource } = usageSource(link, state);
  const polling = localPolling(state, starter);
  const updater = new Updater(
    (update) => {
      renderTray();
      if (update) publish("updateAvailable", update);
      web.publish("hostUpdate", update);
    },
    (progress) => {
      publish("installProgress", progress);
      web.publish("hostInstallProgress", progress);
    },
  );
  // A dev build has no bundle to replace, and a preview installs under its own name, so a release
  // would land beside it rather than update it.
  const updatesEnabled = app.isPackaged && !preview;
  /** The manual check, from this window or a paired device. */
  const checkForUpdate = async () => {
    if (!updatesEnabled) throw new Error("Dev and preview builds do not check for updates.");
    return updater.check().catch((error: unknown) => {
      throw new Error(`Could not check for updates: ${message(error)}`);
    });
  };

  const tray = new Tray(trayImage());
  bindTrayClick(tray);
  const renderTrayIcon = trayUsageIcon(tray, trayUsage, () => link.problem());
  const trayActions: Record<TrayAction, () => void> = {
    show: showWindow,
    refresh: () => void refresh().catch(() => {}),
    quit: () => app.quit(),
  };
  let shownTray = "";
  function renderTray() {
    renderTrayIcon();
    const items = trayItems(trayUsage(), updater.available(), nowEpoch());
    const shown = JSON.stringify(items);
    if (shown === shownTray) return;
    shownTray = shown;
    tray.setContextMenu(Menu.buildFromTemplate(menuTemplate(items, trayActions)));
  }
  renderTray();
  setInterval(renderTray, TRAY_TICK);

  const current: { [E in keyof Events]: () => Events[E] | null } = {
    usageSnapshot: usage,
    toast: () => toast,
    updateAvailable: () => updater.available(),
    installProgress: () => updater.installProgress(),
    serverEpoch: nowEpoch,
    remoteDevices,
    hostLink: () => link.read(),
    hostUpdate: () => link.updates.hostUpdate,
    hostInstallProgress: () => link.updates.hostInstallProgress,
  };
  ipcMain.handle(CURRENT, (_event, event: keyof Events) => current[event]?.() ?? null);
  registerUsageHandlers(state, refresh, sameSource);
  handle("checkForUpdate", checkForUpdate);
  handle("installUpdate", (acknowledgedNoticeIds) => updater.install(acknowledgedNoticeIds));
  handle("openLatestRelease", () => shell.openExternal("https://github.com/zytact/tantalus/releases/latest"));
  handle("releaseNotes", () => updater.releaseNotes());
  handle("openAtLogin", () => openAtLogin(identity));
  handle("setOpenAtLogin", (enabled) => setOpenAtLogin(identity, enabled === true));
  handle("windowStart", () => starter.read());
  handle("setWindowStart", (settings) => {
    const parsed = windowStartSettings(settings);
    if (!parsed) throw new Error("Unknown window start setting.");
    return starter.set(parsed);
  });
  handle("remoteAccess", () => remote.read());
  handle("setRemoteAccess", (route, enabled) => {
    if (!remoteRoutes.includes(route) || typeof enabled !== "boolean") {
      throw new Error("Unknown remote access setting.");
    }
    return remote.set(route, enabled);
  });
  handle("offerPairing", () => {
    pairing.offer();
    return remoteDevices();
  });
  handle("cancelPairing", () => {
    pairing.cancel();
    return remoteDevices();
  });
  handle("renameDevice", (id, name) => {
    if (typeof id !== "string" || typeof name !== "string") throw new Error("Unknown device setting.");
    pairing.rename(id, name);
    return remoteDevices();
  });
  handle("removeDevice", (id) => {
    if (typeof id !== "string") throw new Error("Unknown device setting.");
    pairing.remove(id);
    web.disconnect(id);
    return remoteDevices();
  });

  // Each side's usage replaces the other's at once, so neither shows under the other's name.
  const showUsage = () => {
    publish("usageSnapshot", usage());
    renderTray();
  };
  registerHostLinkHandlers(link, polling, remote, showUsage, showUsage);

  // Clicking the dock icon on macOS reopens the window.
  app.on("activate", showWindow);
  startBackgroundServices(link, polling, remote, updater, updatesEnabled);
}

/** `onFollow` and `onLocal` show the usage of whichever side now reads it. */
function registerHostLinkHandlers(
  link: HostLinkClient,
  polling: ReturnType<typeof localPolling>,
  remote: RemoteAccessRoutes,
  onFollow: () => void,
  onLocal: () => void,
) {
  handle("connectHost", async (url, code) => {
    if (typeof url !== "string" || typeof code !== "string") throw new Error("Unknown host setting.");
    const hostLink = await link.connect(url, code);
    polling.stop();
    onFollow();
    await remote.stop();
    return hostLink;
  });
  handle("addHostRoute", (url) => {
    if (typeof url !== "string") throw new Error("Unknown host setting.");
    return link.addRoute(url);
  });
  handle("checkForHostUpdate", () => link.checkUpdate());
  handle("installHostUpdate", (acknowledgedNoticeIds) => link.installUpdate(acknowledgedNoticeIds));
  handle("hostReleaseNotes", () => link.releaseNotes());
  handle("disconnectHost", () => {
    link.disconnect();
    onLocal();
    polling.start();
    void remote.start();
  });
}

/** A machine following a host reads nothing itself and serves nothing to other devices. */
function startBackgroundServices(
  link: HostLinkClient,
  polling: ReturnType<typeof localPolling>,
  remote: RemoteAccessRoutes,
  updater: Updater,
  updatesEnabled: boolean,
) {
  if (!launchedHidden()) showWindow();
  if (updatesEnabled) void updater.watch();
  if (link.active) return link.start();
  polling.start();
  void remote.start();
}

/** Polls this machine's own usage until stopped, and again once started. Stopping also pauses reads
 * and window starts already under way, so none continues while this machine follows a host. */
function localPolling(state: UsageState, starter: WindowStarter) {
  let running: AbortController | null = null;
  return {
    start() {
      if (running) return;
      state.paused = false;
      starter.paused = false;
      const { signal } = (running = new AbortController());
      void pollUsage(state, (milliseconds, wake) =>
        sleep(milliseconds, undefined, { signal: AbortSignal.any([signal, wake]) }).catch(() =>
          signal.throwIfAborted(),
        ),
      ).catch(() => {});
    },
    stop() {
      state.paused = true;
      starter.paused = true;
      running?.abort();
      running = null;
    },
  };
}

/** Only Windows has WSL sign-ins to choose. */
function signInSettingsPath(): string | null {
  return process.platform === "win32" ? join(app.getPath("userData"), "sign-ins.json") : null;
}

/** Seals a host's token with the operating system's keychain, where there is one. */
function tokenVault(): TokenVault {
  return {
    seal: (token) =>
      safeStorage.isEncryptionAvailable()
        ? { sealed: safeStorage.encryptString(token).toString("base64") }
        : { plain: token },
    open: (token) => ("sealed" in token ? safeStorage.decryptString(Buffer.from(token.sealed, "base64")) : token.plain),
  };
}

/** What the tray and window show: the followed host's usage, or this machine's own. `usage` is null
 * until a followed host publishes, and `tray` stands in an empty reading for the tray. */
function usageSource(link: HostLinkClient, state: UsageState) {
  const usage = () => (link.active ? link.snapshot : state.snapshot);
  /** Refuses a reply from the side that stopped reading while it ran, so it cannot replace the
   * other side's usage in the window. */
  const sameSource = async <T>(run: () => T | Promise<T>): Promise<T> => {
    const following = link.active;
    const result = await run();
    if (link.active !== following) throw new Error("Usage now comes from elsewhere.");
    return result;
  };
  return {
    usage,
    tray: () => usage() ?? noUsage(),
    refresh: () => sameSource(() => (link.active ? link.refresh() : state.refresh())),
    sameSource,
  };
}

const noUsage = (): UsageSnapshot => ({
  enabled: noProviders,
  sign_ins: null,
  accounts: [],
  proxy_hubs: [],
  pace: { settings: defaultPaceSettings, windows: {} },
});

function menuTemplate(items: TrayItem[], actions: Record<TrayAction, () => void>): MenuItemConstructorOptions[] {
  return items.map((item) => {
    if (item === "separator") return { type: "separator" };
    return {
      label: item.label,
      enabled: item.action !== null,
      click: item.action ? actions[item.action] : undefined,
    };
  });
}

function configureApplicationMenu() {
  // The default menu binds Ctrl+R to reload, and that chord belongs to the app's refresh. macOS keeps
  // a menu without it, so Cmd+Q and the edit shortcuts still work.
  Menu.setApplicationMenu(
    process.platform === "darwin"
      ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }])
      : null,
  );
}

function bindTrayClick(tray: Tray) {
  // macOS opens the menu on a left click; elsewhere the click opens the window and the menu keeps its
  // own button.
  if (process.platform !== "darwin") tray.on("click", showWindow);
}

/** A followed host that is not delivering usage leaves the number gray, and says why in the tooltip. */
const STALE_TRAY_COLOR = "#8e8e93";

/** Keeps the tray icon and tooltip on the chosen account's usage while the setting is on, and serves
 * the setting to the window. Returns the render, which skips the redraw when nothing shown changed. */
function trayUsageIcon(tray: Tray, snapshot: () => UsageSnapshot, problem: () => string | null): () => void {
  const path = join(app.getPath("userData"), "tray-usage.json");
  let settings = loadTrayUsageSettings(path);
  let shown: string | null = null;
  const show = (tooltip: string, text: string | null, image: () => NativeImage) => {
    const key = `${tooltip}:${text}`;
    if (key === shown) return;
    shown = key;
    tray.setToolTip(tooltip);
    tray.setImage(image());
  };
  const render = () => {
    const reading = trayUsageReading(snapshot(), settings, nowEpoch());
    const stale = problem();
    const title = stale ? `${identity.productName}\n${stale}` : identity.productName;
    if (!reading) return show(title, null, trayImage);
    const text = trayPercent(reading.remaining, reading.limit);
    const of = reading.limit > 100 ? ` of ${reading.limit}%` : "";
    show(
      `${title}\n${reading.name.label} ${reading.span} ${percent(reading.remaining)}${of} remaining`,
      `${text}:${stale !== null}`,
      () => usageTrayImage(text, stale ? STALE_TRAY_COLOR : trayUsageColors[reading.provider]),
    );
  };
  handle("trayUsage", () => settings);
  handle("setTrayUsage", (next) => {
    const parsed = trayUsageSettings(next);
    if (!parsed) throw new Error("Unknown tray usage setting.");
    saveSettings(path, parsed);
    settings = parsed;
    render();
    return parsed;
  });
  return render;
}

/** Every command that answers with a snapshot runs through `sameSource`. */
function registerUsageHandlers(
  state: UsageState,
  refresh: () => Promise<UsageSnapshot>,
  sameSource: <T>(run: () => T | Promise<T>) => Promise<T>,
) {
  handle("refreshUsage", refresh);
  handle("setProviderEnabled", (provider, enabled) =>
    sameSource(() => {
      if (!providerIds.includes(provider) || typeof enabled !== "boolean") {
        throw new Error("Unknown provider setting.");
      }
      try {
        return state.setProviderEnabled(provider, enabled);
      } catch (error) {
        throw new Error(`Could not save provider setting: ${message(error)}`);
      }
    }),
  );
  handle("setSignInSource", (source, enabled) =>
    sameSource(() => {
      if (!signInSources.includes(source) || typeof enabled !== "boolean") {
        throw new Error("Unknown sign-in setting.");
      }
      try {
        return state.setSignInSource(source, enabled);
      } catch (error) {
        throw new Error(`Could not save sign-in setting: ${message(error)}`);
      }
    }),
  );
  handle("setPaceSettings", (settings) =>
    sameSource(() => {
      const parsed = paceSettings(settings);
      if (!parsed) throw new Error("Unknown pace setting.");
      try {
        return state.setPaceSettings(parsed);
      } catch (error) {
        throw new Error(`Could not save pace setting: ${message(error)}`);
      }
    }),
  );
  handle("resetPace", () =>
    sameSource(() => {
      try {
        return state.resetPace();
      } catch (error) {
        throw new Error(`Could not reset pace learning: ${message(error)}`);
      }
    }),
  );
  handle("proxyHubs", () => state.proxyHubs());
  handle("addProxyHub", (input) => {
    assertProxyHubInput(input);
    return state.addProxyHub(input);
  });
  handle("updateProxyHub", (id, input) => {
    if (typeof id !== "string") throw new Error("Unknown proxy hub setting.");
    assertProxyHubInput(input);
    return state.updateProxyHub(id, input);
  });
  handle("setProxyHubEnabled", (id, enabled) => {
    if (typeof id !== "string" || typeof enabled !== "boolean") throw new Error("Unknown proxy hub setting.");
    return state.setProxyHubEnabled(id, enabled);
  });
  handle("openProxyHubManagement", async (id) => {
    const hub = state.proxyHubs().find((hub) => hub.id === id);
    if (!hub) throw new Error("Unknown proxy hub.");
    await shell.openExternal(proxyHubManagementUrl(hub.url));
  });
  handle("removeProxyHub", (id) => {
    if (typeof id !== "string") throw new Error("Unknown proxy hub setting.");
    return state.removeProxyHub(id);
  });
}

function assertProxyHubInput(input: ProxyHubInput): void {
  if (typeof input !== "object" || input === null) throw new Error("Invalid proxy hub settings.");
  const valid = [input.label, input.url, input.managementKey].every((value) => typeof value === "string");
  if (!valid) throw new Error("Invalid proxy hub settings.");
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

/** The tray icon with a usage number beside the mark. The mark keeps its color, even on macOS, since
 * a template image would recolor the number too and the app cannot read the menu bar's ink. Windows
 * fits every tray icon into a fixed square, so there the number replaces the mark. Linux gets no 2x
 * representation, since Chromium hands the panel its largest one and GNOME's AppIndicator reserves a
 * wide icon's full pixel width while drawing it at panel height. */
function usageTrayImage(text: string, color: string) {
  const height = process.platform === "darwin" ? 18 : 16;
  const [single, double] = (process.platform === "linux" ? [1] : [1, 2]).map((scale) => {
    const mark = process.platform === "win32" ? null : trayMark(height * scale);
    const bitmap = usageBitmap({ text, color, height: height * scale, mark });
    return nativeImage.createFromBitmap(bitmap.data, { width: bitmap.width, height: bitmap.height });
  });
  const image = nativeImage.createFromBuffer(single.toPNG());
  if (double) image.addRepresentation({ scaleFactor: 2, buffer: double.toPNG() });
  return image;
}

function trayMark(height: number) {
  const image = nativeImage.createFromDataURL(preview ? previewTrayIcon : trayIcon).resize({ height, quality: "best" });
  return { ...image.getSize(), data: image.toBitmap() };
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
