import { randomUUID } from "node:crypto";
import type { ProxyHubInput } from "../shared/ipc";
import { emptyProviderUsage, emptyProxyHubSnapshot, nowEpoch, providerIds } from "../shared/usage";
import type {
  ProviderId,
  ProviderSettings,
  ProviderUsage,
  ProxyHubAccount,
  ProxyHubConfig,
  ProxyHubSettings,
  ProxyHubSnapshot,
  ProxyHubStatus,
  UsageSnapshot,
} from "../shared/usage";
import { ReadFailure } from "./failure";
import { ProxyHubError } from "./proxy-hub-api";
import { httpUrl, loadProxyHubSettings, loadSettings, saveSettings } from "./settings";

export const REFRESH_INTERVAL = 300_000;
const RETRY_BACKOFF_START = 5000;

/** Owns the snapshot the tray and window show. Every change goes out through `publish`, and a read
 * runs only for a provider that is switched on when the read starts. */
export class UsageState {
  snapshot: UsageSnapshot;
  private running: Promise<UsageSnapshot> | null = null;
  private again = false;
  private hubConfigs: ProxyHubConfig[];
  private hubGeneration = 0;

  constructor(
    private readonly providerSettingsPath: string,
    private readonly proxyHubSettingsPath: string,
    private readonly readProvider: (provider: ProviderId) => Promise<ProviderUsage>,
    private readonly readHub: (config: ProxyHubConfig) => Promise<ProxyHubAccount[]>,
    private readonly publish: (snapshot: UsageSnapshot) => void,
  ) {
    this.hubConfigs = loadProxyHubSettings(proxyHubSettingsPath);
    this.snapshot = {
      codex: emptyProviderUsage(),
      claude: emptyProviderUsage(),
      opencode: emptyProviderUsage(),
      enabled: loadSettings(providerSettingsPath),
      proxy_hubs: this.hubConfigs
        .filter(({ enabled }) => enabled)
        .map((config) => emptyProxyHubSnapshot(redact(config))),
    };
  }

  /** Reads every enabled provider together. A refresh asked for while one runs does not overlap it:
   * the running one reads again once it finishes, and both callers get that result. */
  refresh(): Promise<UsageSnapshot> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run();
    return this.running;
  }

  private async run(): Promise<UsageSnapshot> {
    for (;;) {
      this.again = false;
      const hubGeneration = this.hubGeneration;
      const hubConfigs = this.hubConfigs.filter(({ enabled }) => enabled);
      const [providerReadings, hubReadings] = await Promise.all([
        Promise.all(
          providerIds.map(async (id) => {
            if (!this.snapshot.enabled[id]) return null;
            const reading = await this.readProvider(id).catch((error: unknown) =>
              error instanceof Error ? error : new Error(String(error)),
            );
            return { id, reading };
          }),
        ),
        Promise.all(
          hubConfigs.map(async (config) => ({
            config,
            reading:
              this.snapshot.proxy_hubs.find((hub) => hub.id === config.id)?.status === "rejected"
                ? null
                : await this.readHub(config).catch((error: unknown) =>
                    error instanceof Error ? error : new Error(String(error)),
                  ),
          })),
        ),
      ]);
      const next = { ...this.snapshot };
      for (const result of providerReadings) {
        // A provider switched off while its read was in flight keeps the reading it was cleared to.
        if (result && next.enabled[result.id]) next[result.id] = applyReading(next[result.id], result.reading);
      }
      if (hubGeneration === this.hubGeneration) {
        next.proxy_hubs = hubReadings.map(({ config, reading }) => {
          const previous = next.proxy_hubs.find((hub) => hub.id === config.id) ?? emptyProxyHubSnapshot(redact(config));
          return reading === null ? previous : applyHubReading(previous, redact(config), reading);
        });
      }
      this.snapshot = next;
      if (!this.again) {
        this.running = null;
        this.publish(next);
        return next;
      }
    }
  }

  /** Saves the choice before it takes effect, so a failed save changes nothing. Switching a provider
   * off drops its reading; switching one on reads it straight away. */
  setProviderEnabled(provider: ProviderId, enabled: boolean): Promise<UsageSnapshot> {
    const settings: ProviderSettings = { ...this.snapshot.enabled, [provider]: enabled };
    saveSettings(this.providerSettingsPath, settings);
    const next = { ...this.snapshot, enabled: settings };
    if (!enabled) next[provider] = emptyProviderUsage();
    this.snapshot = next;
    this.publish(next);
    return enabled ? this.refresh() : Promise.resolve(next);
  }

  proxyHubs(): ProxyHubSettings[] {
    return this.hubConfigs.map(redact);
  }

  /** Reads the hub before saving it, so a hub the key does not open is never saved. */
  async addProxyHub(input: ProxyHubInput): Promise<ProxyHubSettings[]> {
    const url = input.url.trim();
    const managementKey = input.managementKey.trim();
    if (!httpUrl(url)) throw new Error("Enter an HTTP or HTTPS hub URL.");
    if (managementKey.length === 0) throw new Error("Enter the hub management key.");
    const label = input.label.trim() || new URL(url).host;
    const config: ProxyHubConfig = { id: randomUUID(), label, url, managementKey, enabled: true };
    const accounts = await this.readHub(config).catch((error: unknown): never => {
      throw new Error(hubErrorMessage(error));
    });
    return this.saveProxyHubs([...this.hubConfigs, config], false, [
      ...this.snapshot.proxy_hubs,
      applyHubReading(emptyProxyHubSnapshot(redact(config)), redact(config), accounts),
    ]);
  }

  setProxyHubEnabled(id: string, enabled: boolean): ProxyHubSettings[] {
    if (!this.hubConfigs.some((hub) => hub.id === id)) throw new Error("Unknown proxy hub.");
    return this.saveProxyHubs(
      this.hubConfigs.map((hub) => (hub.id === id ? { ...hub, enabled } : hub)),
      enabled,
    );
  }

  removeProxyHub(id: string): ProxyHubSettings[] {
    if (!this.hubConfigs.some((hub) => hub.id === id)) throw new Error("Unknown proxy hub.");
    return this.saveProxyHubs(
      this.hubConfigs.filter((hub) => hub.id !== id),
      false,
    );
  }

  private saveProxyHubs(
    configs: ProxyHubConfig[],
    refresh: boolean,
    snapshots = this.snapshot.proxy_hubs,
  ): ProxyHubSettings[] {
    saveSettings(this.proxyHubSettingsPath, configs);
    this.hubConfigs = configs;
    this.hubGeneration += 1;
    const current = new Map(snapshots.map((hub) => [hub.id, hub]));
    this.snapshot = {
      ...this.snapshot,
      proxy_hubs: configs
        .filter(({ enabled }) => enabled)
        .map((config) => current.get(config.id) ?? emptyProxyHubSnapshot(redact(config))),
    };
    this.publish(this.snapshot);
    if (refresh) void this.refresh();
    return this.proxyHubs();
  }
}

export function applyReading(previous: ProviderUsage, reading: ProviderUsage | Error): ProviderUsage {
  if (!(reading instanceof Error)) return reading;
  // Opencode shares one auth.json across every provider it can log into, so the file exists without
  // a Go key. That is not signed in, not a failed refresh.
  const signedOut =
    reading instanceof ReadFailure && (reading.reason === "missingFile" || reading.reason === "missingToken");
  return {
    ...previous,
    status: previous.last_successful_update_epoch !== null ? "stale" : signedOut ? "auth_missing" : "error",
    error_message: reading.message,
  };
}

export function applyHubReading(
  previous: ProxyHubSnapshot,
  settings: ProxyHubSettings,
  reading: ProxyHubAccount[] | Error,
): ProxyHubSnapshot {
  if (reading instanceof Error) {
    const error = new Error(hubErrorMessage(reading));
    let status: ProxyHubStatus = previous.last_successful_update_epoch === null ? "error" : "stale";
    if (reading instanceof ProxyHubError && reading.rejected) status = "rejected";
    return {
      ...previous,
      label: settings.label,
      accounts: previous.accounts.map((account) => ({
        ...account,
        usage: applyReading(account.usage, error),
      })),
      status,
      error_message: error.message,
    };
  }
  const previousAccounts = new Map(previous.accounts.map((account) => [`${account.provider}:${account.id}`, account]));
  const accounts = reading.map((account) => {
    const prior = previousAccounts.get(`${account.provider}:${account.id}`);
    return account.usage.status === "error" && prior
      ? { ...account, usage: applyReading(prior.usage, new Error(account.usage.error_message ?? "Could not refresh.")) }
      : account;
  });
  return {
    id: settings.id,
    label: settings.label,
    accounts,
    last_successful_update_epoch: nowEpoch(),
    status: "ready",
    error_message: null,
  };
}

/** Only a `ProxyHubError` carries a message written to be shown. */
function hubErrorMessage(error: unknown): string {
  return error instanceof ProxyHubError ? error.message : "The hub could not list accounts.";
}

const redact = ({ id, label, url, enabled }: ProxyHubConfig): ProxyHubSettings => ({ id, label, url, enabled });

/** Every enabled provider holds a reading, or refused the key and will not be read again. A launch at
 * login usually beats the network up, so the first pass fails and the tray would otherwise sit on
 * "Not refreshed yet" for a full interval. */
export function settled(snapshot: UsageSnapshot): boolean {
  return (
    providerIds.every((id) => !snapshot.enabled[id] || snapshot[id].status === "ready") &&
    snapshot.proxy_hubs.every(
      (hub) =>
        hub.status === "rejected" ||
        (hub.status === "ready" && hub.accounts.every((account) => account.usage.status === "ready")),
    )
  );
}

/** The wait before the next attempt when it is not the normal interval. A failure backs off from
 * `start`, doubling up to `interval` and holding there, so something that stays unreachable settles
 * back to the normal rate instead of being hammered. */
export function nextBackoff(
  succeeded: boolean,
  current: number | null,
  start: number,
  interval: number,
): number | null {
  if (succeeded) return null;
  return current === null ? start : Math.min(current * 2, interval);
}

export async function pollUsage(state: UsageState, sleep: (milliseconds: number) => Promise<unknown>) {
  let backoff: number | null = null;
  for (;;) {
    const snapshot = await state.refresh();
    backoff = nextBackoff(settled(snapshot), backoff, RETRY_BACKOFF_START, REFRESH_INTERVAL);
    await sleep(backoff ?? REFRESH_INTERVAL);
  }
}
