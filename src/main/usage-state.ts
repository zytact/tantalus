import { emptyProviderUsage, providerIds } from "../shared/usage";
import type { ProviderId, ProviderSettings, ProviderUsage, UsageSnapshot } from "../shared/usage";
import { ReadFailure } from "./failure";
import { loadSettings, saveSettings } from "./settings";

export const REFRESH_INTERVAL = 300_000;
const RETRY_BACKOFF_START = 5000;

/** Owns the snapshot the tray and window show. Every change goes out through `publish`, and a read
 * runs only for a provider that is switched on when the read starts. */
export class UsageState {
  snapshot: UsageSnapshot;
  private running: Promise<UsageSnapshot> | null = null;
  private again = false;

  constructor(
    private readonly settingsPath: string,
    private readonly read: (provider: ProviderId) => Promise<ProviderUsage>,
    private readonly publish: (snapshot: UsageSnapshot) => void,
  ) {
    this.snapshot = {
      codex: emptyProviderUsage(),
      claude: emptyProviderUsage(),
      opencode: emptyProviderUsage(),
      enabled: loadSettings(settingsPath),
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
      const readings = await Promise.all(
        providerIds.map(async (id) => {
          if (!this.snapshot.enabled[id]) return null;
          const reading = await this.read(id).catch((error: unknown) =>
            error instanceof Error ? error : new Error(String(error)),
          );
          return { id, reading };
        }),
      );
      const next = { ...this.snapshot };
      for (const result of readings) {
        // A provider switched off while its read was in flight keeps the reading it was cleared to.
        if (result && next.enabled[result.id]) next[result.id] = applyReading(next[result.id], result.reading);
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
    saveSettings(this.settingsPath, settings);
    const next = { ...this.snapshot, enabled: settings };
    if (!enabled) next[provider] = emptyProviderUsage();
    this.snapshot = next;
    this.publish(next);
    return enabled ? this.refresh() : Promise.resolve(next);
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

/** Every enabled provider holds a reading. A launch at login usually beats the network up, so the
 * first pass fails and the tray would otherwise sit on "Not refreshed yet" for a full interval. */
export function settled(snapshot: UsageSnapshot): boolean {
  return providerIds.every((id) => !snapshot.enabled[id] || snapshot[id].status === "ready");
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
