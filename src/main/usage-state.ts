import { randomUUID } from "node:crypto";
import type { ProxyHubInput } from "../shared/ipc";
import type { PaceSettings } from "../shared/pace";
import { emptyProviderUsage, emptyProxyHubSnapshot, nowEpoch, providerIds, providerNames } from "../shared/usage";
import type {
  ProviderId,
  ProviderSettings,
  ProviderUsage,
  ProxyHubAccount,
  ProxyHubConfig,
  ProxyHubProviderId,
  ProxyHubSettings,
  ProxyHubSnapshot,
  UsageSnapshot,
} from "../shared/usage";
import { ReadFailure } from "./failure";
import { noActivity } from "./pace-tracker";
import type { PaceTracker } from "./pace-tracker";
import { ProxyHubError, ProxyHubRejected } from "./proxy-hub-api";
import { httpUrl, loadProxyHubSettings, loadSettings, saveSettings } from "./settings";

export const REFRESH_INTERVAL = 300_000;
const RETRY_BACKOFF_START = 5000;

type RefreshScope = "all" | "unsettled";

/** Owns the snapshot the tray and window show. Every change goes out through `publish`, and a read
 * runs only for a provider that is switched on when the read starts. */
export class UsageState {
  snapshot: UsageSnapshot;
  private running: Promise<UsageSnapshot> | null = null;
  private again: RefreshScope | null = null;
  private hubConfigs: ProxyHubConfig[];

  constructor(
    private readonly providerSettingsPath: string,
    private readonly proxyHubSettingsPath: string,
    private readonly readProvider: (provider: ProviderId) => Promise<ProviderUsage>,
    private readonly readHub: (config: ProxyHubConfig) => Promise<ProxyHubAccount[]>,
    private readonly publish: (snapshot: UsageSnapshot) => void,
    private readonly pace: PaceTracker,
    private readonly notify: (message: string) => void = () => {},
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
      pace: { settings: pace.settings, windows: {} },
    };
    this.snapshot = this.enforceHubProviders(this.snapshot);
  }

  /** Reads every enabled provider and hub at once, publishing each as it lands. `unsettled` reads only
   * those without a current reading, for a retry that should leave healthy ones alone. A refresh
   * asked for while one runs does not overlap it: the running one reads again once it finishes, as
   * widely as any caller asked, and every caller gets that result. */
  refresh(scope: RefreshScope = "all"): Promise<UsageSnapshot> {
    if (this.running) {
      this.again = this.again === "all" ? "all" : scope;
      return this.running;
    }
    this.running = this.run(scope).catch((error: unknown) => {
      this.running = null;
      throw error;
    });
    return this.running;
  }

  private async run(scope: RefreshScope): Promise<UsageSnapshot> {
    for (;;) {
      this.again = null;
      const activity = this.pace.readActivity().catch(() => noActivity);
      const hubs = this.snapshot.proxy_hubs.flatMap((hub) => {
        const config = this.hubConfigs.find(({ id }) => id === hub.id);
        return config && hub.status !== "rejected" && (scope === "all" || !hubSettled(hub))
          ? [{ config, read: this.refreshHub(hub, config) }]
          : [];
      });
      // A hub whose roster is not known yet may own a direct provider, so direct reads wait for it.
      const discovering = hubs.flatMap(({ config, read }) => (config.providers ? [] : [read]));
      if (discovering.length > 0) await Promise.all(discovering);
      const providers = providerIds.filter(
        (id) => this.snapshot.enabled[id] && (scope === "all" || !providerSettled(this.snapshot, id)),
      );
      await Promise.all([...hubs.map(({ read }) => read), ...providers.map((id) => this.refreshProvider(id))]);
      const worked = await activity;
      this.snapshot = this.pace.track(this.snapshot, worked);
      if (!this.again) {
        this.running = null;
        this.publish(this.snapshot);
        return this.snapshot;
      }
      scope = this.again;
    }
  }

  private async refreshProvider(id: ProviderId) {
    const reading = await this.readProvider(id).catch((error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
    );
    if (!this.snapshot.enabled[id]) return;
    this.snapshot = this.pace.annotate({ ...this.snapshot, [id]: applyReading(this.snapshot[id], reading) });
    this.publish(this.snapshot);
  }

  /** Drops the reading when the hub was edited, switched off, or removed while it was read. */
  private async refreshHub(hub: ProxyHubSnapshot, config: ProxyHubConfig) {
    const reading = await this.readHub(config).catch((error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
    );
    if (!this.snapshot.proxy_hubs.includes(hub)) return;
    const snapshots = this.snapshot.proxy_hubs.map((current) =>
      current === hub ? applyHubReading(hub, redact(config), reading) : current,
    );
    this.rememberHubProviders(snapshots);
    this.snapshot = this.pace.annotate(this.enforceHubProviders({ ...this.snapshot, proxy_hubs: snapshots }));
    this.publish(this.snapshot);
  }

  private rememberHubProviders(hubs: ProxyHubSnapshot[]) {
    const configs = this.hubConfigs.map((config) => {
      const hub = hubs.find((hub) => hub.id === config.id && hub.status === "ready");
      if (!hub) return config;
      const providers = pooledProviders(hub.accounts);
      return JSON.stringify(providers) === JSON.stringify(config.providers) ? config : { ...config, providers };
    });
    if (configs.every((config, index) => config === this.hubConfigs[index])) return;
    saveSettings(this.proxyHubSettingsPath, configs);
    this.hubConfigs = configs;
  }

  private providerHub(provider: ProviderId) {
    return this.hubConfigs.find((hub) => hub.providers?.some((id) => id === provider));
  }

  private enforceHubProviders(snapshot: UsageSnapshot): UsageSnapshot {
    const conflicts = providerIds.filter((id) => snapshot.enabled[id] && this.providerHub(id));
    if (conflicts.length === 0) return snapshot;
    const enabled = { ...snapshot.enabled };
    const next = { ...snapshot, enabled };
    for (const id of conflicts) {
      enabled[id] = false;
    }
    saveSettings(this.providerSettingsPath, enabled);
    const names = conflicts.map((id) => providerNames[id]).join(" and ");
    this.notify(
      `Direct ${names} ${conflicts.length === 1 ? "was" : "were"} switched off because saved proxy hubs have these providers. Tantalus will use the hub accounts.`,
    );
    return next;
  }

  /** Saves the choice before it takes effect, so a failed save changes nothing. Switching a provider
   * off keeps its last reading; switching one on reads it straight away. A hub whose roster is not
   * known yet corrects a conflicting choice on the read that enabling triggers. */
  async setProviderEnabled(provider: ProviderId, enabled: boolean): Promise<UsageSnapshot> {
    const hub = enabled ? this.providerHub(provider) : undefined;
    if (hub) {
      this.notify(
        `Remove ${hub.label} or remove ${providerNames[provider]} from it first, then turn on direct ${providerNames[provider]}.`,
      );
      return this.snapshot;
    }
    const settings: ProviderSettings = { ...this.snapshot.enabled, [provider]: enabled };
    saveSettings(this.providerSettingsPath, settings);
    const next = { ...this.snapshot, enabled: settings };
    this.snapshot = this.pace.annotate(next);
    this.publish(this.snapshot);
    return enabled ? this.refresh() : Promise.resolve(this.snapshot);
  }

  /** Saves the choice before it takes effect, and shows it straight away without a read. */
  setPaceSettings(settings: PaceSettings): UsageSnapshot {
    this.pace.setSettings(settings);
    this.snapshot = this.pace.annotate(this.snapshot);
    this.publish(this.snapshot);
    return this.snapshot;
  }

  async resetPace(): Promise<UsageSnapshot> {
    await this.pace.reset();
    this.snapshot = this.pace.track(this.snapshot, noActivity);
    this.publish(this.snapshot);
    return this.snapshot;
  }

  proxyHubs(): ProxyHubSettings[] {
    return this.hubConfigs.map(redact);
  }

  /** Reads the hub before saving it, so a hub the key does not open is never saved. */
  async addProxyHub(input: ProxyHubInput): Promise<ProxyHubSettings[]> {
    const config: ProxyHubConfig = { id: randomUUID(), ...hubFields(input, null), enabled: true };
    const snapshot = await this.readHubSnapshot(config);
    return this.saveProxyHubs(
      [...this.hubConfigs, { ...config, providers: pooledProviders(snapshot.accounts) }],
      false,
      [...this.snapshot.proxy_hubs, snapshot],
    );
  }

  /** A new URL or key is read before it is saved, like a new hub. A new label alone is saved without
   * a read, so renaming a hub that refused its key does not spend another attempt on it. */
  async updateProxyHub(id: string, input: ProxyHubInput): Promise<ProxyHubSettings[]> {
    const saved = this.hubConfig(id);
    const fields = hubFields(input, saved);
    const reconnected =
      new URL(fields.url).href !== new URL(saved.url).href || fields.managementKey !== saved.managementKey;
    const snapshot = reconnected ? await this.readHubSnapshot({ ...saved, ...fields }) : null;
    // Merges onto the current config, since the hub may have been switched off or on during the read.
    const config = {
      ...this.hubConfig(id),
      ...fields,
      ...(snapshot && { providers: pooledProviders(snapshot.accounts) }),
    };
    return this.saveProxyHubs(
      this.hubConfigs.map((hub) => (hub.id === id ? config : hub)),
      false,
      this.snapshot.proxy_hubs.map((hub) => (hub.id === id ? (snapshot ?? { ...hub, label: config.label }) : hub)),
    );
  }

  setProxyHubEnabled(id: string, enabled: boolean): ProxyHubSettings[] {
    this.hubConfig(id);
    return this.saveProxyHubs(
      this.hubConfigs.map((hub) => (hub.id === id ? { ...hub, enabled } : hub)),
      enabled,
    );
  }

  removeProxyHub(id: string): ProxyHubSettings[] {
    this.hubConfig(id);
    return this.saveProxyHubs(
      this.hubConfigs.filter((hub) => hub.id !== id),
      false,
    );
  }

  async withProxyHub(
    id: string,
    run: (config: ProxyHubConfig, ensureAvailable: () => void) => Promise<void>,
  ): Promise<void> {
    const config = this.hubConfig(id);
    const connected = () => {
      const current = this.hubConfigs.find((hub) => hub.id === id);
      return current?.url === config.url && current.managementKey === config.managementKey;
    };
    const ensureAvailable = () => {
      const hub = this.snapshot.proxy_hubs.find((hub) => hub.id === id);
      if (!connected() || hub?.status !== "ready") throw new ProxyHubError("The hub is not available.");
    };
    ensureAvailable();
    try {
      await run(config, ensureAvailable);
    } catch (error) {
      if (error instanceof ProxyHubRejected && connected()) {
        this.snapshot = {
          ...this.snapshot,
          proxy_hubs: this.snapshot.proxy_hubs.map((hub) =>
            hub.id === id ? applyHubReading(hub, redact(config), error) : hub,
          ),
        };
        this.publish(this.snapshot);
      }
      throw error;
    }
  }

  private hubConfig(id: string): ProxyHubConfig {
    const config = this.hubConfigs.find((hub) => hub.id === id);
    if (!config) throw new Error("Unknown proxy hub.");
    return config;
  }

  private async readHubSnapshot(config: ProxyHubConfig): Promise<ProxyHubSnapshot> {
    const accounts = await this.readHub(config).catch((error: unknown): never => {
      throw new Error(hubErrorMessage(error));
    });
    return applyHubReading(emptyProxyHubSnapshot(redact(config)), redact(config), accounts);
  }

  private saveProxyHubs(
    configs: ProxyHubConfig[],
    refresh: boolean,
    snapshots = this.snapshot.proxy_hubs,
  ): ProxyHubSettings[] {
    saveSettings(this.proxyHubSettingsPath, configs);
    this.hubConfigs = configs;
    const current = new Map(snapshots.map((hub) => [hub.id, hub]));
    this.snapshot = this.pace.annotate(
      this.enforceHubProviders({
        ...this.snapshot,
        proxy_hubs: configs
          .filter(({ enabled }) => enabled)
          .map((config) => current.get(config.id) ?? emptyProxyHubSnapshot(redact(config))),
      }),
    );
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
    error_reason: reading instanceof ReadFailure ? reading.reason : null,
  };
}

export function applyHubReading(
  previous: ProxyHubSnapshot,
  settings: ProxyHubSettings,
  reading: ProxyHubAccount[] | Error,
): ProxyHubSnapshot {
  // Accounts from a hub that will not be read again would only go on showing old numbers.
  if (reading instanceof ProxyHubRejected) {
    return { ...previous, label: settings.label, accounts: [], status: "rejected", error_message: reading.message };
  }
  if (reading instanceof Error) {
    const error = new Error(hubErrorMessage(reading));
    return {
      ...previous,
      label: settings.label,
      accounts: previous.accounts.map((account) => ({
        ...account,
        usage: applyReading(account.usage, error),
      })),
      status: previous.last_successful_update_epoch === null ? "error" : "stale",
      error_message: error.message,
    };
  }
  const previousAccounts = new Map(previous.accounts.map((account) => [`${account.provider}:${account.id}`, account]));
  const accounts = reading.map((account) => {
    const prior = previousAccounts.get(`${account.provider}:${account.id}`);
    return account.usage.status === "error" && prior
      ? {
          ...account,
          usage: applyReading(
            prior.usage,
            account.usage.error_reason
              ? new ReadFailure(account.usage.error_reason)
              : new Error(account.usage.error_message ?? "Could not refresh."),
          ),
        }
      : account;
  });
  return {
    id: settings.id,
    url: settings.url,
    label: settings.label,
    accounts,
    last_successful_update_epoch: nowEpoch(),
    status: "ready",
    error_message: null,
  };
}

/** Trims what the form sent. A blank label falls back to the host. A blank key falls back to the
 * saved one only while the hub stays on the same origin, so a saved key never goes to another server. */
function hubFields(
  input: ProxyHubInput,
  saved: ProxyHubConfig | null,
): Pick<ProxyHubConfig, "label" | "url" | "managementKey"> {
  const url = input.url.trim();
  if (!httpUrl(url)) throw new Error("Enter an HTTP or HTTPS hub URL.");
  const sameOrigin = saved !== null && new URL(url).origin === new URL(saved.url).origin;
  const managementKey = input.managementKey.trim() || (sameOrigin ? saved.managementKey : "");
  if (managementKey.length === 0) {
    throw new Error(
      saved ? "Enter the management key again for the new hub address." : "Enter the hub management key.",
    );
  }
  return { label: input.label.trim() || new URL(url).host, url, managementKey };
}

/** Only a `ProxyHubError` carries a message written to be shown. */
function hubErrorMessage(error: unknown): string {
  return error instanceof ProxyHubError ? error.message : "The hub could not list accounts.";
}

/** The providers a hub pools, for ownership checks. */
function pooledProviders(accounts: Pick<ProxyHubAccount, "provider">[]): ProxyHubProviderId[] {
  return [...new Set(accounts.map((account) => account.provider))].sort();
}

const redact = ({ id, label, url, enabled }: ProxyHubConfig): ProxyHubSettings => ({ id, label, url, enabled });

/** Every enabled provider holds a reading, or refused the key and will not be read again. A launch at
 * login usually beats the network up, so the first pass fails and the tray would otherwise sit on
 * "Not refreshed yet" for a full interval. */
export function settled(snapshot: UsageSnapshot): boolean {
  return providerIds.every((id) => providerSettled(snapshot, id)) && snapshot.proxy_hubs.every(hubSettled);
}

function providerSettled(snapshot: UsageSnapshot, id: ProviderId): boolean {
  return !snapshot.enabled[id] || snapshot[id].status === "ready";
}

function hubSettled(hub: ProxyHubSnapshot): boolean {
  return (
    hub.status === "rejected" ||
    (hub.status === "ready" && hub.accounts.every((account) => account.usage.status === "ready"))
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

/** Retries read only what has not settled, and never sleep past the time everything is due again. */
export async function pollUsage(
  state: UsageState,
  sleep: (milliseconds: number) => Promise<unknown>,
  now: () => number = Date.now,
) {
  let backoff: number | null = null;
  let due = -Infinity;
  for (;;) {
    const scope = now() >= due ? "all" : "unsettled";
    if (scope === "all") due = now() + REFRESH_INTERVAL;
    const snapshot = await state.refresh(scope);
    backoff = nextBackoff(settled(snapshot), backoff, RETRY_BACKOFF_START, REFRESH_INTERVAL);
    await sleep(backoff === null ? REFRESH_INTERVAL : Math.min(backoff, Math.max(0, due - now())));
  }
}
