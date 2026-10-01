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

/** A 5-hour window with nothing used and no clock running. Claude reports no reset for it, and Codex a
 * reset a full window after every reading. */
export function idleWindow(usage: ProviderUsage): boolean {
  const { used_percent: used, limit_window_seconds: duration, reset_at_epoch: reset } = usage.five_hour;
  const epoch = usage.last_successful_update_epoch;
  if (usage.status !== "ready" || usage.allowed === false || epoch === null || duration === null) return false;
  return (used ?? 0) === 0 && (reset === null || reset - epoch >= duration - SLACK);
}

/** Starts a provider's 5-hour window through its CLI once readings have shown it idle for `GRACE`.
 * A reading that is not idle starts the wait over, so a window is started at most once per idle spell. */
export class WindowStarter {
  private settings: WindowStartSettings;
  private readonly idleSince = new Map<StartProviderId, number>();
  private readonly running = new Set<StartProviderId>();
  private readonly last = new Map<StartProviderId, StartAttempt>();

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
    return { enabled: this.settings.enabled, providers: { claude, codex } };
  }

  /** Saves the choice before it takes effect, so a failed save changes nothing. */
  set(settings: WindowStartSettings): Promise<WindowStart> {
    saveSettings(this.path, settings);
    this.settings = settings;
    return this.read();
  }

  observe(snapshot: UsageSnapshot) {
    for (const id of startProviderIds) {
      const usage = snapshot[id];
      const epoch = usage.last_successful_update_epoch;
      if (!this.settings.enabled || !this.settings.providers[id].enabled || epoch === null || !idleWindow(usage)) {
        this.idleSince.delete(id);
        continue;
      }
      const since = this.idleSince.get(id) ?? epoch;
      this.idleSince.set(id, since);
      if (epoch - since >= GRACE && !this.running.has(id)) void this.start(id);
    }
  }

  private async provider(id: StartProviderId): Promise<WindowStart["providers"][StartProviderId]> {
    const settings = this.settings.providers[id];
    const cli = await this.locate(id, settings.path);
    return { ...settings, command: cli?.label ?? null, last: this.last.get(id) ?? null };
  }

  private async start(id: StartProviderId) {
    this.running.add(id);
    this.idleSince.delete(id);
    const epoch = nowEpoch();
    try {
      const cli = await this.locate(id, this.settings.providers[id].path);
      if (!cli) throw new Error(`Could not find the ${providerNames[id]} CLI. Set its path.`);
      await this.run(cli);
      this.last.set(id, { epoch, error: null });
      this.started();
    } catch (error) {
      this.last.set(id, { epoch, error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.running.delete(id);
    }
  }
}
