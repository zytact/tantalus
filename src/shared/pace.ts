import { fiveHourSeconds, monthlySeconds, providerIds, providerNames, sevenDaySeconds } from "./usage";
import type { ProviderId, ProviderUsage, UsageSnapshot, WindowUsage } from "./usage";

/** How far from the usual pace a window has to move before a creature shows. The same multiple sets
 * both thresholds: a dragon at `multiple` times the usual pace, a tortoise at one `multiple`th of it. */
export const pacePresets = { calm: 4, normal: 2.5, eager: 1.6 } as const;
export type PacePreset = keyof typeof pacePresets;
export const isPacePreset = (value: unknown): value is PacePreset =>
  typeof value === "string" && Object.hasOwn(pacePresets, value);
export type PaceSettings = { enabled: boolean; preset: PacePreset; explained: boolean };
export const defaultPaceSettings: PaceSettings = { enabled: true, preset: "normal", explained: false };

export type Creature = "dragon" | "tortoise";
/** A creature riding a window's bar, with the rate that put it there. `ratio` is the rate over the usual one. */
export type Rider = { kind: Creature; rate: number; ratio: number };

/** What the window shows for one window's pace. Rates are in percent of the window per hour. A window
 * that saw no use while it was watched has no start time, since it starts after its first reading. */
export type WindowPace =
  | { status: "learning"; watched_seconds: number; learn_seconds: number; starts_at_epoch: number | null }
  | {
      status: "learned";
      usual_rate: number;
      current_rate: number | null;
      creature: Rider | null;
      readings: number[];
    };

/** Every tracked window's pace, keyed by `paceKey`. Empty while the creatures are switched off. */
export type PaceSnapshot = { settings: PaceSettings; windows: Partial<Record<string, WindowPace>> };

/** The first poll that saw a window's percentage rise, and the percentage it rose to. */
export type PaceTick = { epoch: number; used: number };
export type PaceSample = PaceTick & { resetAt: number | null };

/** A run of ticks without a quiet gap. It keeps the newest ticks for the current rate, and counts
 * how many came since the last reading was taken. */
type Stretch = { ticks: PaceTick[]; pending: number; activeAt: number | null };

/** The history one window's pace is learned from. */
export type PaceLog = { firstSeen: number; last: PaceSample; stretch: Stretch | null; readings: number[] };

/** How many ticks a rate is measured across. */
const RATE_TICKS = 3;
/** The recent readings the usual pace is the median of, so it follows changes in habit. */
const MAX_READINGS = 60;
/** Two samples further apart than this cannot time a rise between them, for example after a sleep. */
const MAX_SAMPLE_GAP = 15 * 60;
/** Codex reports its reset as a countdown, so the reset time drifts a little between readings. */
const RESET_DRIFT = 10 * 60;

/** How long each window is watched before it starts, and how long it can go without a tick before its
 * stretch ends. Local activity keeps a slow stretch open past the gap, so the gap only has to cover the
 * pauses of someone who is working. */
const windowTuning = new Map([
  [fiveHourSeconds, { learnSeconds: 5 * 3600, quietGap: 30 * 60 }],
  [sevenDaySeconds, { learnSeconds: 84 * 3600, quietGap: 2 * 3600 }],
  [monthlySeconds, { learnSeconds: 5 * 86_400, quietGap: 6 * 3600 }],
]);

/** Which log a window belongs to. A proxy hub account is kept apart from the direct provider, even
 * when both are the same account. */
export function paceKey(duration: number, provider: ProviderId, hub?: { hubId: string; accountId: string }): string {
  return hub ? `${hub.hubId}:${provider}:${hub.accountId}:${duration}` : `${provider}:${duration}`;
}

/** A window the allowance view shows with a percentage and a pace. `owner` names its provider, or its
 * hub account, for Settings. */
export type PaceWindow = {
  key: string;
  provider: ProviderId;
  owner: string;
  duration: number;
  window: WindowUsage;
  epoch: number | null;
};

/** Every window with a pace, for the direct providers switched on and then every hub account. */
export function paceWindows(snapshot: UsageSnapshot): PaceWindow[] {
  const windows = (usage: ProviderUsage, provider: ProviderId, owner: string, keyOf: (duration: number) => string) =>
    [usage.five_hour, usage.seven_day, usage.monthly].flatMap((window) => {
      const duration = window.limit_window_seconds;
      if (duration === null || window.used_percent === null || !windowTuning.has(duration)) return [];
      const epoch = usage.last_successful_update_epoch;
      return [{ key: keyOf(duration), provider, owner, duration, window, epoch }];
    });
  return [
    ...providerIds
      .filter((id) => snapshot.enabled[id])
      .flatMap((id) => windows(snapshot[id], id, providerNames[id], (duration) => paceKey(duration, id))),
    ...snapshot.proxy_hubs.flatMap((hub) =>
      hub.accounts.flatMap(({ id, provider, usage }, index) =>
        windows(usage, provider, `${hub.label} · ${providerNames[provider]} ${index + 1}`, (duration) =>
          paceKey(duration, provider, { hubId: hub.id, accountId: id }),
        ),
      ),
    ),
  ];
}

/** Local activity cannot say which account a session used, so it goes to the windows of that provider
 * and duration that ticked last. An account nobody is using stays idle while another one is busy. */
export function claimActivity(
  windows: PaceWindow[],
  logs: ReadonlyMap<string, PaceLog>,
  activity: Record<ProviderId, boolean>,
): Set<string> {
  const lastTick = (key: string) => {
    const stretch = logs.get(key)?.stretch;
    return stretch ? newest(stretch).epoch : 0;
  };
  const latest = new Map<string, number>();
  for (const { key, provider, duration } of windows) {
    const group = `${provider}:${duration}`;
    latest.set(group, Math.max(latest.get(group) ?? 0, lastTick(key)));
  }
  return new Set(
    windows
      .filter(
        ({ key, provider, duration }) => activity[provider] && lastTick(key) === latest.get(`${provider}:${duration}`),
      )
      .map(({ key }) => key),
  );
}

/** Folds one successful reading into a window's log. `active` says whether a local session of the
 * window's provider changed recently, which keeps a stretch going through a slow patch. */
export function recordSample(log: PaceLog | undefined, sample: PaceSample, duration: number, active: boolean): PaceLog {
  if (!log) return { firstSeen: sample.epoch, last: sample, stretch: null, readings: [] };
  if (sample.epoch <= log.last.epoch) return log;
  const next = { ...log, last: sample };
  const reset =
    sample.used < log.last.used ||
    (sample.resetAt !== null && log.last.resetAt !== null && Math.abs(sample.resetAt - log.last.resetAt) > RESET_DRIFT);
  const stretch = log.stretch && sample.epoch - lastSeen(log.stretch) <= quietGap(duration) ? log.stretch : null;
  if (reset || sample.epoch - log.last.epoch > MAX_SAMPLE_GAP) return { ...next, stretch: null };
  if (sample.used === log.last.used) {
    return { ...next, stretch: stretch && active ? { ...stretch, activeAt: sample.epoch } : stretch };
  }
  const tick = { epoch: sample.epoch, used: sample.used };
  if (!stretch) return { ...next, stretch: { ticks: [tick], pending: 0, activeAt: null } };
  const ticks = [...stretch.ticks, tick].slice(-(RATE_TICKS + 1));
  // Readings are taken over separate runs of ticks, the same length the current rate is measured over.
  if (stretch.pending + 1 < RATE_TICKS)
    return { ...next, stretch: { ...stretch, ticks, pending: stretch.pending + 1 } };
  return {
    ...next,
    stretch: { ...stretch, ticks, pending: 0 },
    readings: [...log.readings, rate(ticks[0], tick, tick.epoch)].slice(-MAX_READINGS),
  };
}

/** A window watched for its full time and used at least once has a usual pace, and a creature when
 * the current rate is far enough from it. A tortoise also needs the provider to be in use, since a
 * window that is not moving because nobody is working is idle, not slow. */
export function windowPace(
  log: PaceLog,
  duration: number,
  now: number,
  preset: PacePreset,
  active: boolean,
): WindowPace | null {
  const tuning = windowTuning.get(duration);
  if (!tuning) return null;
  const watched = now - log.firstSeen;
  if (watched < tuning.learnSeconds || log.readings.length === 0) {
    return {
      status: "learning",
      watched_seconds: Math.min(watched, tuning.learnSeconds),
      learn_seconds: tuning.learnSeconds,
      starts_at_epoch: watched < tuning.learnSeconds ? log.firstSeen + tuning.learnSeconds : null,
    };
  }
  const usual = median(log.readings);
  const current = currentRate(log, duration, now);
  const kind = current === null ? null : creatureFor(current, usual, preset, active);
  return {
    status: "learned",
    usual_rate: usual,
    current_rate: current,
    creature: current === null || kind === null ? null : { kind, rate: current, ratio: current / usual },
    readings: log.readings,
  };
}

export const riderOf = (pace: WindowPace | undefined): Rider | null =>
  pace?.status === "learned" ? pace.creature : null;

/** The first creature riding any window, which the one-time explainer introduces. */
export function firstRider(windows: PaceSnapshot["windows"]): Rider | null {
  return (
    Object.values(windows)
      .map(riderOf)
      .find((rider) => rider !== null) ?? null
  );
}

export function creatureFor(rate: number, usual: number, preset: PacePreset, active: boolean): Creature | null {
  const multiple = pacePresets[preset];
  if (rate >= usual * multiple) return "dragon";
  return active && rate <= usual / multiple ? "tortoise" : null;
}

/** The rate across the newest ticks, timed up to now so it falls on its own once ticks stop coming.
 * A stretch that has gone quiet has no current rate. */
function currentRate(log: PaceLog, duration: number, now: number): number | null {
  const stretch = log.stretch;
  if (!stretch || stretch.ticks.length <= RATE_TICKS) return null;
  if (now - lastSeen(stretch) > quietGap(duration)) return null;
  return rate(stretch.ticks[0], newest(stretch), now);
}

const rate = (from: PaceTick, to: PaceTick, until: number) => (to.used - from.used) / ((until - from.epoch) / 3600);

const newest = (stretch: Stretch) => stretch.ticks[stretch.ticks.length - 1];
const lastSeen = (stretch: Stretch) => Math.max(newest(stretch).epoch, stretch.activeAt ?? 0);

const quietGap = (duration: number) => windowTuning.get(duration)?.quietGap ?? 0;

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
