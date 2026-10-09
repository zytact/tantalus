import { directAccountKey, nowEpoch, providerNames } from "../shared/usage";
import type { ProviderId, ProviderUsage, UsageSnapshot } from "../shared/usage";
import { startProviderIds, windowStartKey } from "../shared/window-start";
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
 * With wake on, it also renews a Claude sign-in through the local CLI, at most once an hour. Every
 * attempt, failed or not, is followed by a refresh so its result shows straight away. */
export class WindowStarter {
  private settings: WindowStartSettings;
  private readonly idleSince = new Map<string, number>();
  private readonly unpolledEpochs = new Map<string, number>();
  private readonly attempted = new Set<string>();
  private readonly running = new Set<string>();
  private readonly last = new Map<string, StartAttempt>();
  private readonly wakes = new Map<string, StartAttempt>();
  /** What the latest snapshot can start, so a start runs only while its account is still read. */
  private targets: StartTarget[] = [];
  private hubClaude = false;

  /** While this machine follows another Tantalus, a queued or pending start runs nothing. */
  paused = false;

  constructor(
    private readonly path: string,
    private readonly locate: (
      provider: StartProviderId,
      configured: string | null,
      distribution: string | null,
    ) => Cli | null,
    private readonly run: (cli: Cli) => Promise<void>,
    private readonly afterAttempt: () => void,
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

  results(): NonNullable<UsageSnapshot["window_starts"]> {
    return Object.fromEntries(this.last);
  }

  read(): WindowStart {
    const { enabled, wake } = this.settings;
    const lastWake = [...this.wakes.values()].reduce<StartAttempt | null>(
      (latest, attempt) => (latest === null || attempt.epoch > latest.epoch ? attempt : latest),
      null,
    );
    return { enabled, wake, lastWake, providers: { claude: this.provider("claude"), codex: this.provider("codex") } };
  }

  /** Saves the choice before it takes effect, so a failed save changes nothing. */
  set(settings: WindowStartSettings): WindowStart {
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
    const targets: StartTarget[] = snapshot.accounts.flatMap(({ id, provider, distribution, usage }) =>
      isStartProvider(provider)
        ? [{ key: directAccountKey({ provider, id }), provider, usage, polled: true, distribution, hub: null }]
        : [],
    );
    for (const hub of snapshot.proxy_hubs) {
      for (const account of hub.accounts)
        targets.push({
          key: windowStartKey(account.provider, { hubId: hub.id, accountId: account.id }),
          provider: account.provider,
          usage: account.usage,
          polled: hub.status === "ready",
          distribution: null,
          hub: { id: hub.id, accountId: account.id },
        });
    }
    const keys = new Set(targets.map(({ key }) => key));
    this.targets = targets;
    for (const collection of [this.idleSince, this.unpolledEpochs, this.attempted, this.last, this.wakes]) {
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

  /** When the target's reading was taken, if it was taken while the target was polled. A hub that stops
   * answering keeps its accounts' last readings, and once it answers again those say nothing about the time since. */
  private polledEpoch({ key, usage, polled }: StartTarget): number | null {
    const epoch = usage.last_successful_update_epoch;
    if (epoch === null) return null;
    if (!polled) {
      this.unpolledEpochs.set(key, epoch);
      return null;
    }
    return epoch > (this.unpolledEpochs.get(key) ?? -Infinity) ? epoch : null;
  }

  private observeProvider(target: StartTarget) {
    const { key, usage } = target;
    if (!idleWindow(usage)) {
      this.idleSince.delete(key);
      this.attempted.delete(key);
      return;
    }
    const epoch = this.polledEpoch(target);
    if (!this.settings.enabled || epoch === null) {
      this.idleSince.delete(key);
      return;
    }
    const since = this.idleSince.get(key) ?? epoch;
    this.idleSince.set(key, since);
    if (epoch - since >= GRACE && !this.attempted.has(key) && !this.running.has(key)) void this.start(target);
  }

  /** What runs for the provider's first direct sign-in, which is its home one when that is read. */
  private provider(id: StartProviderId): WindowStart["providers"][StartProviderId] {
    const settings = this.settings.providers[id];
    const first = this.targets.find(({ provider, hub }) => provider === id && hub === null);
    const cli = this.locate(id, settings.path, first?.distribution ?? null);
    return { ...settings, command: cli?.label ?? null, last: first ? (this.last.get(first.key) ?? null) : null };
  }

  private async start(target: StartTarget) {
    this.attempted.add(target.key);
    this.idleSince.delete(target.key);
    const attempt = await this.runProvider(target, false);
    this.last.set(target.key, attempt);
    this.afterAttempt();
  }

  private async wake(target: StartTarget) {
    const attempt = await this.runProvider(target, true);
    this.wakes.set(target.key, attempt);
    this.afterAttempt();
  }

  private async runProvider(target: StartTarget, wake: boolean): Promise<StartAttempt> {
    const { key, provider, hub } = target;
    this.running.add(key);
    const epoch = nowEpoch();
    try {
      if (this.paused) throw new Error("This machine now follows another Tantalus.");
      if (hub) {
        if (!this.runHub) throw new Error("Hub automation is unavailable.");
        await this.runHub(hub.id, hub.accountId, provider, () => {
          if (this.paused || !this.settings.enabled || !this.observed(key))
            throw new Error("Automation is no longer enabled for this account.");
        });
      } else await this.runDirect(target, wake);
      return { epoch, error: null };
    } catch (error) {
      return { epoch, error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.running.delete(key);
    }
  }

  private observed(key: string): boolean {
    return this.targets.some((target) => target.key === key);
  }

  private async runDirect({ key, provider, distribution }: StartTarget, wake: boolean) {
    const cli = this.locate(provider, this.settings.providers[provider].path, distribution);
    if (!cli) throw new Error(`Could not find the ${providerNames[provider]} CLI. Set its path.`);
    if (wake && this.hubClaude) throw new Error("Wake Claude only works with direct sign-ins.");
    if (this.paused || !this.observed(key) || !(wake ? this.settings.wake : this.settings.enabled))
      throw new Error("Automation was switched off.");
    await this.run(cli);
  }
}

const isStartProvider = (provider: ProviderId): provider is StartProviderId =>
  startProviderIds.some((id) => id === provider);

/** `distribution` is the WSL distribution a direct sign-in lives in, and null for a hub account. */
type StartTarget = {
  key: string;
  provider: StartProviderId;
  usage: ProviderUsage;
  polled: boolean;
  distribution: string | null;
  hub: { id: string; accountId: string } | null;
};
