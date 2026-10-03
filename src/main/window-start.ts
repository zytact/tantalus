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

/** Starts a polled provider's 5-hour window through its CLI once readings have shown it idle for `GRACE`.
 * A reading that is not idle starts the wait over, so a window is started at most once per idle spell.
 * With wake on, it also runs the Claude CLI when Claude's sign-in expires or is rejected, at most once an hour. */
export class WindowStarter {
  private settings: WindowStartSettings;
  private readonly idleSince = new Map<StartProviderId, number>();
  private readonly attempted = new Set<StartProviderId>();
  private readonly running = new Set<StartProviderId>();
  private readonly last = new Map<StartProviderId, StartAttempt>();
  private lastWake: StartAttempt | null = null;

  constructor(
    private readonly path: string,
    private readonly locate: (provider: StartProviderId, configured: string | null) => Promise<Cli | null>,
    private readonly run: (cli: Cli) => Promise<void>,
    private readonly started: () => void,
  ) {
    this.settings = loadWindowStartSettings(path);
  }

  async read(): Promise<WindowStart> {
    const [claude, codex] = await Promise.all([this.provider("claude"), this.provider("codex")]);
    const { enabled, wake } = this.settings;
    return { enabled, wake, lastWake: this.lastWake, providers: { claude, codex } };
  }

  /** Saves the choice before it takes effect, so a failed save changes nothing. */
  set(settings: WindowStartSettings): Promise<WindowStart> {
    saveSettings(this.path, settings);
    this.settings = settings;
    return this.read();
  }

  observe(snapshot: UsageSnapshot) {
    for (const id of startProviderIds) this.observeProvider(id, snapshot[id], snapshot.enabled[id]);
    this.observeSignIn(snapshot.claude);
  }

  private observeSignIn(usage: ProviderUsage) {
    if (!this.settings.wake || !signInLapsed(usage) || this.running.has("claude")) return;
    if (this.lastWake && nowEpoch() - this.lastWake.epoch < WAKE_INTERVAL) return;
    void this.wake();
  }

  private observeProvider(id: StartProviderId, usage: ProviderUsage, polled: boolean) {
    const epoch = usage.last_successful_update_epoch;
    if (!idleWindow(usage)) {
      this.idleSince.delete(id);
      this.attempted.delete(id);
      return;
    }
    if (!this.settings.enabled || !polled || epoch === null) {
      this.idleSince.delete(id);
      return;
    }
    const since = this.idleSince.get(id) ?? epoch;
    this.idleSince.set(id, since);
    if (epoch - since >= GRACE && !this.attempted.has(id) && !this.running.has(id)) void this.start(id);
  }

  private async provider(id: StartProviderId): Promise<WindowStart["providers"][StartProviderId]> {
    const settings = this.settings.providers[id];
    const cli = await this.locate(id, settings.path);
    return { ...settings, command: cli?.label ?? null, last: this.last.get(id) ?? null };
  }

  private async start(id: StartProviderId) {
    this.attempted.add(id);
    this.idleSince.delete(id);
    this.last.set(id, await this.runProvider(id));
  }

  private async wake() {
    this.lastWake = await this.runProvider("claude");
  }

  private async runProvider(id: StartProviderId): Promise<StartAttempt> {
    this.running.add(id);
    const epoch = nowEpoch();
    try {
      const cli = await this.locate(id, this.settings.providers[id].path);
      if (!cli) throw new Error(`Could not find the ${providerNames[id]} CLI. Set its path.`);
      await this.run(cli);
      this.started();
      return { epoch, error: null };
    } catch (error) {
      return { epoch, error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.running.delete(id);
    }
  }
}
