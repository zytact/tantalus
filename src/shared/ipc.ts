import type { PaceSettings } from "./pace";
import type { ProviderId, ProxyHubSettings, UsageSnapshot } from "./usage";

export type ReleaseNotice = {
  id: string;
  message: string;
  fromVersion: string;
  throughVersion: string;
  platforms?: ("linux" | "darwin" | "win32")[];
};

/** A signed release newer than the running build, as the window and tray show it. */
export type AvailableUpdate = { version: string; manualInstall: boolean; notices: ReleaseNotice[] };

/** How far an update install has come. `total` is null when the download does not state its size. */
export type DownloadProgress = { received: number; total: number | null };
export type InstallProgress = ({ stage: "download" } & DownloadProgress) | { stage: "install" };

export type ReleaseChange = { kind: "new" | "fixed" | "changed"; scope: string | null; summary: string };
export type ReleaseNotes = { version: string; publishedAt: string | null; changes: ReleaseChange[] };

/** The ways another device can open the allowance page, and whether each is switched on. */
export const remoteRoutes = ["localNetwork", "tailscale"] as const;
export type RemoteRoute = (typeof remoteRoutes)[number];
export type RemoteSettings = Record<RemoteRoute, boolean>;
/** Each route with the addresses it answers on. A route that is off, or whose address cannot be read,
 * has none. `error` says why the switched-on routes are not being served. */
export type RemoteAccess = Record<RemoteRoute, { enabled: boolean; urls: string[] }> & { error: string | null };
export type ProxyHubInput = { label: string; url: string; managementKey: string };

/** Every request the window can make of the main process, keyed by channel. */
export type Commands = {
  refreshUsage: () => UsageSnapshot;
  setProviderEnabled: (provider: ProviderId, enabled: boolean) => UsageSnapshot;
  setPaceSettings: (settings: PaceSettings) => UsageSnapshot;
  /** Forgets what every window has learned, so each one learns again from now. */
  resetPace: () => UsageSnapshot;
  proxyHubs: () => ProxyHubSettings[];
  addProxyHub: (input: ProxyHubInput) => ProxyHubSettings[];
  updateProxyHub: (id: string, input: ProxyHubInput) => ProxyHubSettings[];
  setProxyHubEnabled: (id: string, enabled: boolean) => ProxyHubSettings[];
  removeProxyHub: (id: string) => ProxyHubSettings[];
  checkForUpdate: () => AvailableUpdate | null;
  installUpdate: (acknowledgedNoticeIds: string[]) => void;
  openLatestRelease: () => void;
  /** The notes of every release after the running build, up to the available update, newest first. */
  releaseNotes: () => ReleaseNotes[];
  openAtLogin: () => boolean;
  setOpenAtLogin: (enabled: boolean) => void;
  remoteAccess: () => RemoteAccess;
  setRemoteAccess: (route: RemoteRoute, enabled: boolean) => RemoteAccess;
};

/** What the main process publishes to the window, keyed by channel. The window can also read the
 * latest value of each, which is null until there is one. */
export type Events = {
  usageSnapshot: UsageSnapshot;
  updateAvailable: AvailableUpdate;
  /** Null once an install ends without relaunching. */
  installProgress: InstallProgress | null;
  serverEpoch: number;
};

/** The channel that serves the latest value of an event. */
export const CURRENT = "current";

/** A command's result as it crosses the process boundary. Electron rewrites a thrown error's message,
 * so a failure travels as a value and the preload throws it again. */
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };

/** What the preload exposes to the window as `window.tantalus`. */
export type Bridge = {
  invoke<C extends keyof Commands>(command: C, ...args: Parameters<Commands[C]>): Promise<ReturnType<Commands[C]>>;
  on<E extends keyof Events>(event: E, listener: (payload: Events[E]) => void): () => void;
  current<E extends keyof Events>(event: E): Promise<Events[E] | null>;
};
