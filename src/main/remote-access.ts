import { networkInterfaces } from "node:os";
import type { RemoteAccess, RemoteRoute, RemoteSettings } from "../shared/ipc";
import type { Identity } from "./identity";
import { loadRemoteSettings, saveSettings } from "./settings";
import { serveTailscale, stopTailscale, tailscaleUrl } from "./tailscale";
import type { WebServer } from "./web-server";

/** Tailscale proxies to the loopback address, so the page only needs every interface when the local
 * network route is on. */
function hostFor(settings: RemoteSettings): "0.0.0.0" | "127.0.0.1" | null {
  if (settings.localNetwork) return "0.0.0.0";
  return settings.tailscale ? "127.0.0.1" : null;
}

/** Owns the two remote access switches. A failed change leaves the listener, the Tailscale route and the
 * saved choice as they were. Changes run one at a time. */
export class RemoteAccessRoutes {
  private settings: RemoteSettings;
  /** Why the saved routes are not being served, until a change succeeds. */
  private failure: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly settingsPath: string,
    private readonly ports: Identity["ports"],
    private readonly server: WebServer,
  ) {
    this.settings = loadRemoteSettings(settingsPath);
  }

  /** Listens for the saved routes. The Tailscale route outlives the app, so launch only reasserts it
   * in case it was removed from outside, and a Tailscale that is not up yet at login leaves it be. */
  start() {
    return this.serial(async () => {
      try {
        await this.server.listen(hostFor(this.settings));
      } catch (error) {
        this.fail(error);
        return;
      }
      if (this.settings.tailscale) await serveTailscale(this.ports.tailscale, this.ports.web).catch(() => {});
    });
  }

  /** Saves first, so a failed save changes nothing. Tailscale goes last, so a failure there leaves only
   * the listener and the file to restore. */
  set(route: RemoteRoute, enabled: boolean): Promise<RemoteAccess> {
    return this.serial(async () => {
      const previous = this.settings;
      const next = { ...previous, [route]: enabled };
      saveSettings(this.settingsPath, next);
      try {
        await this.server.listen(hostFor(next));
        if (route === "tailscale") {
          await (enabled ? serveTailscale(this.ports.tailscale, this.ports.web) : stopTailscale(this.ports.tailscale));
        }
      } catch (error) {
        saveSettings(this.settingsPath, previous);
        await this.server.listen(hostFor(previous)).catch((restore: unknown) => this.fail(restore));
        throw error;
      }
      this.settings = next;
      this.failure = null;
      return this.read();
    });
  }

  private fail(error: unknown) {
    this.failure = `Remote access is not being served. ${error instanceof Error ? error.message : String(error)}`;
  }

  async read(): Promise<RemoteAccess> {
    const { localNetwork, tailscale } = this.settings;
    return {
      error: this.failure,
      localNetwork: {
        enabled: localNetwork,
        urls: localNetwork ? networkAddresses().map((address) => `http://${address}:${this.ports.web}`) : [],
      },
      tailscale: {
        enabled: tailscale,
        urls: tailscale
          ? await tailscaleUrl(this.ports.tailscale).then(
              (url) => [url],
              () => [],
            )
          : [],
      },
    };
  }

  private serial<T>(change: () => Promise<T>): Promise<T> {
    const result = this.queue.then(change);
    this.queue = result.catch(() => {});
    return result;
  }
}

/** The IPv4 addresses other devices can reach this machine on. */
function networkAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => address.family === "IPv4" && !address.internal)
    .map((address) => address.address);
}
