import { nowEpoch, providerNames } from "../shared/usage";
import type { ProviderUsage, UsageSnapshot } from "../shared/usage";
import { startProviderIds } from "../shared/window-start";
import type { StartAttempt, StartProviderId, WindowStart, WindowStartSettings } from "../shared/window-start";
import type { Cli } from "./cli";
import { loadWindowStartSettings, saveSettings } from "./settings";

/** How long a window sits idle before Tantalus starts it, which leaves time to start it yourself. */
const GRACE = 5 * 60;
/** How far short of a full window an idle Codex reset may fall, since it is counted from each reading. */
const SLACK = 60;
const WAKE_INTERVAL = 60 * 60;

/** A 5-hour window with nothing used and no clock running. Claude reports no reset for it, and Codex a
 * reset a full window after every reading. */
export function idleWindow(usage: ProviderUsage): boolean {
  const { used_percent: used, limit_window_seconds: duration, reset_at_epoch: reset } = usage.five_hour;
  const epoch = usage.last_successful_update_epoch;
  if (usage.status !== "ready" || usage.allowed === false || epoch === null || duration === null) return false;
  return used === 0 && (reset === null || reset - epoch >= duration - SLACK);
}

export function signInLapsed(usage: ProviderUsage): boolean {
  return (
    (usage.status === "error" || usage.status === "stale") &&
    (usage.error_reason === "expired" || usage.error_reason === "rejected")
  );
}

/** Starts a polled provider or hub account's 5-hour window through its CLI or hub once readings have shown it idle for `GRACE`.
 * A reading that is not idle starts the wait over, so a window is started at most once per idle spell.
 * With wake on, it also renews a Claude sign-in through the local CLI, at most once an hour. */
export class WindowStarter {
  private settings: WindowStartSettings;
  private readonly idleSince = new Map<string, number>();
  private readonly attempted = new Set<string>();
  private readonly running = new Set<string>();
  private readonly last = new Map<string, StartAttempt>();
  private readonly wakes = new Map<string, StartAttempt>();
  private hubs: WindowStart["hubs"] = [];
  private hubClaude = false;

  constructor(
    private readonly path: string,
    private readonly locate: (provider: StartProviderId, configured: string | null) => Promise<Cli | null>,
    private readonly run: (cli: Cli) => Promise<void>,
    private readonly started: () => void,
    private readonly runHub?: (
      hubId: string,
      accountId: string,
      provider: StartProviderId,
      ensureEnabled: () => void,
    ) => Promise<void>,
    private readonly notify: (message: string) => void = () => {},
  ) {
    this.settings = loadWindowStartSettings(path);
  }

  async read(): Promise<WindowStart> {
    const [claude, codex] = await Promise.all([this.provider("claude"), this.provider("codex")]);
    const { enabled, wake } = this.settings;
    return {
      enabled,
      wake,
      lastWake: this.wakes.get("claude") ?? null,
      providers: { claude, codex },
      hubs: this.hubs.map((hub) => ({
        ...hub,
        last: this.last.get(hub.key) ?? null,
      })),
    };
  }

  /** Saves the choice before it takes effect, so a failed save changes nothing. */
  set(settings: WindowStartSettings): Promise<WindowStart> {
    if (settings.wake && this.hubClaude) {
      this.notify("Wake Claude only works with direct sign-ins. Claude is currently provided by a hub.");
      return this.read();
    }
    saveSettings(this.path, settings);
    this.settings = settings;
    return this.read();
  }

  observe(snapshot: UsageSnapshot) {
    this.observeWakeAvailability(snapshot);
    const targets: StartTarget[] = startProviderIds.map((provider) => ({
      key: provider,
      provider,
      usage: snapshot[provider],
      polled: snapshot.enabled[provider],
      hub: null,
    }));
    this.hubs = snapshot.proxy_hubs.flatMap((hub) =>
      hub.accounts.map((account) => ({
        key: JSON.stringify([hub.id, account.provider, account.id]),
        hubId: hub.id,
        accountId: account.id,
        label: `${hub.label} · ${providerNames[account.provider]} · ${account.email ?? account.id}`,
        provider: account.provider,
        last: null,
      })),
    );
    for (const hub of snapshot.proxy_hubs) {
      for (const account of hub.accounts)
        targets.push({
          key: JSON.stringify([hub.id, account.provider, account.id]),
          provider: account.provider,
          usage: account.usage,
          polled: hub.status === "ready",
          hub: { id: hub.id, accountId: account.id },
        });
    }
    const keys = new Set(targets.map(({ key }) => key));
    for (const collection of [this.idleSince, this.attempted, this.last, this.wakes]) {
      for (const key of collection.keys()) if (!keys.has(key)) collection.delete(key);
    }
    for (const target of targets) {
      this.observeProvider(target);
      if (target.provider === "claude" && !target.hub) this.observeSignIn(target);
    }
  }

  private observeWakeAvailability(snapshot: UsageSnapshot) {
    this.hubClaude = snapshot.proxy_hubs.some((hub) => hub.accounts.some((account) => account.provider === "claude"));
    if (this.hubClaude && this.settings.wake) {
      const settings = { ...this.settings, wake: false };
      saveSettings(this.path, settings);
      this.settings = settings;
      this.notify(
        "Wake Claude was switched off because Claude is provided by a hub. It only works with direct sign-ins.",
      );
    }
  }

  private observeSignIn(target: StartTarget) {
    if (!target.polled || !this.settings.wake || !signInLapsed(target.usage) || this.running.has(target.key)) return;
    const lastWake = this.wakes.get(target.key);
    if (lastWake && nowEpoch() - lastWake.epoch < WAKE_INTERVAL) return;
    void this.wake(target);
  }

  private observeProvider(target: StartTarget) {
    const { key, usage, polled } = target;
    const epoch = usage.last_successful_update_epoch;
    if (!idleWindow(usage)) {
      this.idleSince.delete(key);
      this.attempted.delete(key);
      return;
    }
    if (!this.settings.enabled || !polled || epoch === null) {
      this.idleSince.delete(key);
      return;
    }
    const since = this.idleSince.get(key) ?? epoch;
    this.idleSince.set(key, since);
    if (epoch - since >= GRACE && !this.attempted.has(key) && !this.running.has(key)) void this.start(target);
  }

  private async provider(id: StartProviderId): Promise<WindowStart["providers"][StartProviderId]> {
    const settings = this.settings.providers[id];
    const cli = await this.locate(id, settings.path);
    return { ...settings, command: cli?.label ?? null, last: this.last.get(id) ?? null };
  }

  private async start(target: StartTarget) {
    this.attempted.add(target.key);
    this.idleSince.delete(target.key);
    this.last.set(target.key, await this.runProvider(target, false));
  }

  private async wake(target: StartTarget) {
    this.wakes.set(target.key, await this.runProvider(target, true));
  }

  private async runProvider(target: StartTarget, wake: boolean): Promise<StartAttempt> {
    const { key, provider, hub } = target;
    this.running.add(key);
    const epoch = nowEpoch();
    try {
      if (hub) {
        if (!this.runHub) throw new Error("Hub automation is unavailable.");
        await this.runHub(hub.id, hub.accountId, provider, () => {
          if (!this.settings.enabled) throw new Error("Automation was switched off.");
        });
      } else {
        const cli = await this.locate(provider, this.settings.providers[provider].path);
        if (!cli) throw new Error(`Could not find the ${providerNames[provider]} CLI. Set its path.`);
        if (wake && this.hubClaude) throw new Error("Wake Claude only works with direct sign-ins.");
        await this.run(cli);
      }
      this.started();
      return { epoch, error: null };
    } catch (error) {
      return { epoch, error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.running.delete(key);
    }
  }
}

type StartTarget = {
  key: string;
  provider: StartProviderId;
  usage: ProviderUsage;
  polled: boolean;
  hub: { id: string; accountId: string } | null;
};
