import {
  claimActivity,
  currentPaceOnly,
  maxPaceReadings,
  paceHistoryKeys,
  paceWindows,
  recordSample,
  windowPace,
} from "../shared/pace";
import type { Activity, PaceLog, PaceSettings, PaceWindow, WindowPace } from "../shared/pace";
import { nowEpoch } from "../shared/usage";
import type { UsageSnapshot } from "../shared/usage";
import { loadPaceLogs, loadPaceSettings, saveSettings, saveSettingsInBackground } from "./settings";

export const noActivity: Activity = { codex: null, claude: null, opencode: null };

/** A current-pace log with no sample for this long belongs to a sign-in that is gone. */
const FORGET_AFTER = 60 * 86_400;

/** Learns usual pace by provider, tier and window length, while tracking each account's current
 * pace separately. It owns the log, just as `UsageState` owns the snapshot. */
export class PaceTracker {
  settings: PaceSettings;
  private readonly logs: Map<string, PaceLog>;
  /** The windows the latest local activity belongs to, and when each was last worked on. */
  private active = new Map<string, number>();
  /** The queued log writes. Each waits for the one before, so the file ends up with the latest log. */
  private writes = Promise.resolve();

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
    const current = new Map(
      windows.flatMap((window): [string, PaceLog][] => {
        const log = this.windowLog(window);
        return log ? [[window.key, log]] : [];
      }),
    );
    this.active = claimActivity(windows, current, activity);
    for (const window of windows) this.recordWindow(window);
    for (const [key, log] of this.logs) {
      if (currentPaceOnly(key) && now - log.last.epoch > FORGET_AFTER) this.logs.delete(key);
    }
    // The log only speeds up learning, so a failed write should not fail the reading that led to it.
    this.save(Object.fromEntries(this.logs)).catch((error: unknown) => {
      console.error("Failed to save the pace log:", error);
    });
    return this.annotate(snapshot, now);
  }

  annotate(snapshot: UsageSnapshot, now = nowEpoch()): UsageSnapshot {
    const windows = this.settings.enabled
      ? paceWindows(snapshot).flatMap((window): [string, WindowPace][] => {
          const { key, duration } = window;
          const log = this.windowLog(window);
          const usual = this.logs.get(paceHistoryKeys(window).usual) ?? log;
          const pace = log && windowPace(log, duration, now, this.settings.preset, this.active.has(key), usual);
          return pace ? [[key, pace]] : [];
        })
      : [];
    return { ...snapshot, pace: { settings: this.settings, windows: Object.fromEntries(windows) } };
  }

  private windowLog(window: PaceWindow): PaceLog | undefined {
    return this.logs.get(paceHistoryKeys(window).account) ?? this.logs.get(window.key) ?? initialLog(window);
  }

  private recordWindow(window: PaceWindow) {
    const { key, duration, epoch } = window;
    if (epoch === null || window.window.used_percent === null) return;
    const keys = paceHistoryKeys(window);
    const stored = this.logs.get(keys.account);
    const previous = stored ?? this.logs.get(key);
    const sample = { epoch, used: window.window.used_percent, resetAt: window.window.reset_at_epoch };
    const next = recordSample(previous, sample, duration, this.active.get(key) ?? null);
    this.logs.set(keys.account, next);
    this.logs.delete(key);
    if (keys.usual === keys.account) return;
    const readings = !stored ? next.readings : next.readings !== previous?.readings ? next.readings.slice(-1) : [];
    this.logs.set(keys.usual, recordUsual(this.logs.get(keys.usual), next, readings));
  }

  /** Forgets every window's log. The empty log is saved first, so a failed save changes nothing. */
  async reset() {
    await this.save({});
    this.logs.clear();
  }

  /** Saves the choice before it takes effect, so a failed save changes nothing. */
  setSettings(settings: PaceSettings) {
    saveSettings(this.settingsPath, settings);
    this.settings = settings;
  }

  /** Resolves once every queued log write has settled. */
  saved(): Promise<void> {
    return this.writes;
  }

  private save(logs: Record<string, PaceLog>): Promise<void> {
    const write = this.writes.then(() => saveSettingsInBackground(this.logPath, logs));
    this.writes = write.catch(() => {});
    return write;
  }
}

function initialLog({ window, epoch }: PaceWindow): PaceLog | undefined {
  if (epoch === null || window.used_percent === null) return;
  return {
    firstSeen: epoch,
    last: { epoch, used: window.used_percent, resetAt: window.reset_at_epoch },
    stretch: null,
    readings: [],
  };
}

function recordUsual(previous: PaceLog | undefined, log: PaceLog, readings: number[]): PaceLog {
  if (!previous) return { ...log, stretch: null };
  return {
    firstSeen: Math.min(previous.firstSeen, log.firstSeen),
    last: log.last.epoch > previous.last.epoch ? log.last : previous.last,
    stretch: null,
    readings: [...previous.readings, ...readings].slice(-maxPaceReadings),
  };
}
