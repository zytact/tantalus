import { networkInterfaces } from "node:os";
import type { RemoteAccess, RemoteRoute, RemoteSettings } from "../shared/ipc";
import type { Identity } from "./identity";
import { loadRemoteSettings, saveSettings } from "./settings";
import { serveTailscale, stopTailscale, tailscaleUrl } from "./tailscale";
import type { WebServer } from "./web-server";

/** Tailscale proxies to the loopback address, so the page only needs every interface when the local
 * network route is on. */
function hostFor(settings: RemoteSettings): string | null {
  if (settings.localNetwork) return "0.0.0.0";
  return settings.tailscale ? "127.0.0.1" : null;
}

/** Owns the two remote access switches. Each change is applied before it is saved, so a failed one
 * leaves both the server and the saved choice as they were. Changes run one at a time. */
export class RemoteAccessRoutes {
  private settings: RemoteSettings;
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
      await this.server.listen(hostFor(this.settings));
      if (this.settings.tailscale) await serveTailscale(this.ports.tailscale, this.ports.web).catch(() => {});
    });
  }

  set(route: RemoteRoute, enabled: boolean): Promise<RemoteAccess> {
    return this.serial(async () => {
      const next = { ...this.settings, [route]: enabled };
      await this.server.listen(hostFor(next));
      try {
        if (route === "tailscale") {
          await (enabled ? serveTailscale(this.ports.tailscale, this.ports.web) : stopTailscale(this.ports.tailscale));
        }
        saveSettings(this.settingsPath, next);
      } catch (error) {
        await this.server.listen(hostFor(this.settings));
        throw error;
      }
      this.settings = next;
      return this.read();
    });
  }

  async read(): Promise<RemoteAccess> {
    const { localNetwork, tailscale } = this.settings;
    return {
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
