import type { PaceSettings } from "./pace";
import type { TrayUsageSettings } from "./tray-usage";
import type { ProviderId, ProxyHubSettings, SignInSource, UsageSnapshot } from "./usage";
import type { WindowStart, WindowStartSettings } from "./window-start";

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
export const remoteRouteNames: Record<RemoteRoute, string> = { localNetwork: "Local network", tailscale: "Tailscale" };
export type RemoteSettings = Record<RemoteRoute, boolean>;
/** Each route with the addresses it answers on. A route that is off, or whose address cannot be read,
 * has none. `error` says why the switched-on routes are not being served. */
export type RemoteAccess = Record<RemoteRoute, { enabled: boolean; urls: string[] }> & { error: string | null };
/** A device paired to read usage. `connected` says whether it is following usage right now. */
export type PairedDevice = {
  id: string;
  name: string;
  pairedAt: number;
  lastSeenAt: number | null;
  connected: boolean;
};
/** The one-time code a new device enters, while one is offered. */
export type PairingCode = { code: string; expiresAt: number };
export type RemoteDevices = { devices: PairedDevice[]; pairing: PairingCode | null };
/** The wire format a host serves to another Tantalus. It changes only when that format breaks, and a
 * client refuses a host on any other. */
export const PROTOCOL = 2;
/** What a host says about itself before a client pairs or follows it. `id` is random and saved on
 * the host, so a client can tell it from another Tantalus at the same address. A host from before
 * routes has none. */
export type HostHello = { protocol: number; name: string; id: string | null };

/** Where a client stands with the host it follows. */
export type HostLinkState = "connecting" | "connected" | "unreachable" | "removed" | "update-host" | "update-client";
/** An address a client can reach its host on. `found` marks one the host reported, as opposed to one
 * typed on this device. */
export type HostRoute = { url: string; kind: RemoteRoute; found: boolean };
/** The host a client follows. `host` is the host's machine name, and `since` is when the link last
 * stopped delivering usage. `routes` are in preference order, and `active` is the one delivering usage. */
export type HostLink = {
  host: string;
  state: HostLinkState;
  since: number | null;
  routes: HostRoute[];
  active: string | null;
};

export type ProxyHubInput = { label: string; url: string; managementKey: string };

/** Every request the window can make of the main process, keyed by channel. */
export type Commands = {
  refreshUsage: () => UsageSnapshot;
  setProviderEnabled: (provider: ProviderId, enabled: boolean) => UsageSnapshot;
  /** Only a Windows host has sign-in sources to choose. */
  setSignInSource: (source: SignInSource, enabled: boolean) => UsageSnapshot;
  setPaceSettings: (settings: PaceSettings) => UsageSnapshot;
  /** Forgets what every window has learned, so each one learns again from now. */
  resetPace: () => UsageSnapshot;
  proxyHubs: () => ProxyHubSettings[];
  addProxyHub: (input: ProxyHubInput) => ProxyHubSettings[];
  updateProxyHub: (id: string, input: ProxyHubInput) => ProxyHubSettings[];
  setProxyHubEnabled: (id: string, enabled: boolean) => ProxyHubSettings[];
  removeProxyHub: (id: string) => ProxyHubSettings[];
  openProxyHubManagement: (id: string) => void;
  checkForUpdate: () => AvailableUpdate | null;
  installUpdate: (acknowledgedNoticeIds: string[]) => void;
  openLatestRelease: () => void;
  /** The notes of every release after the running build, up to the available update, newest first. */
  releaseNotes: () => ReleaseNotes[];
  openAtLogin: () => boolean;
  setOpenAtLogin: (enabled: boolean) => void;
  windowStart: () => WindowStart;
  setWindowStart: (settings: WindowStartSettings) => WindowStart;
  trayUsage: () => TrayUsageSettings;
  setTrayUsage: (settings: TrayUsageSettings) => TrayUsageSettings;
  remoteAccess: () => RemoteAccess;
  setRemoteAccess: (route: RemoteRoute, enabled: boolean) => RemoteAccess;
  /** Offers a new pairing code, replacing any code already offered. */
  offerPairing: () => RemoteDevices;
  cancelPairing: () => RemoteDevices;
  renameDevice: (id: string, name: string) => RemoteDevices;
  /** Cuts the device off at once, including a stream it has open. */
  removeDevice: (id: string) => RemoteDevices;
  /** Pairs with the host at `url` and follows its usage instead of reading this machine's. */
  connectHost: (url: string, code: string) => HostLink;
  /** Adds an address the followed host answers on, once it reports the same host ID. */
  addHostRoute: (url: string) => HostLink;
  /** Forgets the host and reads this machine's usage again. */
  disconnectHost: () => void;
};

/** What the main process publishes to the window, keyed by channel. The window can also read the
 * latest value of each, which is null until there is one. */
export type Events = {
  /** Null while a followed host has published nothing yet. */
  usageSnapshot: UsageSnapshot | null;
  toast: string;
  updateAvailable: AvailableUpdate;
  /** Null once an install ends without relaunching. */
  installProgress: InstallProgress | null;
  serverEpoch: number;
  remoteDevices: RemoteDevices;
  /** Null while this machine reads its own usage. */
  hostLink: HostLink | null;
};

/** The channel that serves the latest value of an event. */
export const CURRENT = "current";

/** How long a toast shows. */
export const TOAST_MILLISECONDS = 10_000;

/** A command's result as it crosses the process boundary. Electron rewrites a thrown error's message,
 * so a failure travels as a value and the preload throws it again. */
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };

/** What the preload exposes to the window as `window.tantalus`. */
export type Bridge = {
  invoke<C extends keyof Commands>(command: C, ...args: Parameters<Commands[C]>): Promise<ReturnType<Commands[C]>>;
  on<E extends keyof Events>(event: E, listener: (payload: Events[E]) => void): () => void;
  current<E extends keyof Events>(event: E): Promise<Events[E] | null>;
};
