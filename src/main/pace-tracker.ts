import { claimActivity, paceWindows, recordSample, windowPace } from "../shared/pace";
import type { Activity, PaceLog, PaceSettings, WindowPace } from "../shared/pace";
import { nowEpoch } from "../shared/usage";
import type { UsageSnapshot } from "../shared/usage";
import { loadPaceLogs, loadPaceSettings, saveSettings } from "./settings";

export const noActivity: Activity = { codex: null, claude: null, opencode: null };

/** A log with no sample for this long belongs to an account that is gone. */
const FORGET_AFTER = 60 * 86_400;

/** Learns each window's usual pace from the readings the poll takes, and adds what it learned to the
 * snapshot. It owns the log, just as `UsageState` owns the snapshot. */
export class PaceTracker {
  settings: PaceSettings;
  private readonly logs: Map<string, PaceLog>;
  /** The windows the latest local activity belongs to, and when each was last worked on. */
  private active = new Map<string, number>();

  constructor(
    private readonly logPath: string,
    private readonly settingsPath: string,
    readonly readActivity: () => Promise<Activity>,
  ) {
    this.settings = loadPaceSettings(settingsPath);
    this.logs = new Map(Object.entries(loadPaceLogs(logPath)));
  }

  /** Records every fresh reading the snapshot holds, then adds the pace of each window to it. */
  track(snapshot: UsageSnapshot, activity: Activity, now = nowEpoch()): UsageSnapshot {
    const windows = paceWindows(snapshot);
    this.active = claimActivity(windows, this.logs, activity);
    for (const { key, duration, window, epoch } of windows) {
      if (epoch === null || window.used_percent === null) continue;
      const sample = { epoch, used: window.used_percent, resetAt: window.reset_at_epoch };
      this.logs.set(key, recordSample(this.logs.get(key), sample, duration, this.active.get(key) ?? null));
    }
    for (const [key, log] of this.logs) {
      if (now - log.last.epoch > FORGET_AFTER) this.logs.delete(key);
    }
    // The log only speeds up learning, so a failed write should not fail the reading that led to it.
    try {
      saveSettings(this.logPath, Object.fromEntries(this.logs));
    } catch (error) {
      console.error("Failed to save the pace log:", error);
    }
    return this.annotate(snapshot, now);
  }

  annotate(snapshot: UsageSnapshot, now = nowEpoch()): UsageSnapshot {
    const windows = this.settings.enabled
      ? paceWindows(snapshot).flatMap(({ key, duration }): [string, WindowPace][] => {
          const log = this.logs.get(key);
          const pace = log && windowPace(log, duration, now, this.settings.preset, this.active.has(key));
          return pace ? [[key, pace]] : [];
        })
      : [];
    return { ...snapshot, pace: { settings: this.settings, windows: Object.fromEntries(windows) } };
  }

  /** Forgets every window's log and starts each one again from the reading the snapshot holds. The
   * empty log is saved first, so a failed save changes nothing. */
  reset(snapshot: UsageSnapshot, now = nowEpoch()): UsageSnapshot {
    saveSettings(this.logPath, {});
    this.logs.clear();
    return this.track(snapshot, noActivity, now);
  }

  /** Saves the choice before it takes effect, so a failed save changes nothing. */
  setSettings(settings: PaceSettings) {
    saveSettings(this.settingsPath, settings);
    this.settings = settings;
  }
}
