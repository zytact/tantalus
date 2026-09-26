import { describe, expect, it } from "vite-plus/test";
import { claimActivity, creatureFor, recordSample, windowPace } from "./pace";
import type { PaceLog, PaceWindow } from "./pace";
import { fiveHourSeconds, sevenDaySeconds } from "./usage";

const start = 1_000_000;
const reset = start + 4 * 3600;

/** Polls every 5 minutes, one per entry, starting from `start`. */
function poll(percentages: number[], options: { log?: PaceLog; from?: number; active?: boolean } = {}): PaceLog {
  const from = options.from ?? start;
  return percentages.reduce<PaceLog | undefined>(
    (log, used, index) =>
      recordSample(log, { epoch: from + index * 300, used, resetAt: reset }, fiveHourSeconds, options.active ?? false),
    options.log,
  )!;
}

/** One percent every other poll, which is 6% an hour. */
const steady = (from: number, ticks: number) =>
  Array.from({ length: ticks * 2 + 1 }, (_, index) => from + Math.floor(index / 2));

describe("pace from ticks", () => {
  it("measures the newest ticks up to the last sign of work, so a pause is not slow", () => {
    const log = poll(steady(10, 4));
    const last = start + 8 * 300;
    expect(windowPace(log, fiveHourSeconds, last, "normal", false)).toMatchObject({ status: "learning" });

    const watched = { ...log, firstSeen: last - 5 * 3600 };
    expect(windowPace(watched, fiveHourSeconds, last, "normal", false)).toMatchObject({
      status: "learned",
      usual_rate: 6,
      current: { kind: "moving", rate: 6 },
    });
    const paused = windowPace(watched, fiveHourSeconds, last + 1800, "normal", false);
    expect(paused).toMatchObject({ current: { kind: "moving", rate: 6 }, creature: null });
  });

  it("is measuring while in use with too few rises for a rate", () => {
    const log = { ...poll(steady(10, 4)), firstSeen: start - 5 * 3600 };
    const resumed = poll([0, 1], { log, from: start + 9 * 300 });
    const now = start + 10 * 300;
    expect(windowPace(resumed, fiveHourSeconds, now, "normal", false)).toMatchObject({
      current: { kind: "measuring" },
    });
  });

  it("never measures across a reset", () => {
    const before = poll(steady(40, 2));
    const after = poll([0, 1, 2], { log: before, from: start + 5 * 300 + 300 });
    expect(after.stretch?.ticks).toEqual([
      { epoch: start + 7 * 300, used: 1 },
      { epoch: start + 8 * 300, used: 2 },
    ]);
    expect(after.readings).toEqual([]);
  });

  it("does not time a rise across a gap in polling", () => {
    const log = poll([10, 11]);
    const resumed = recordSample(log, { epoch: start + 3 * 3600, used: 30, resetAt: reset }, fiveHourSeconds, true);
    expect(resumed.stretch).toBeNull();
  });

  it("is idle once the window goes quiet, and slow when the provider works without rising", () => {
    const log = { ...poll(steady(10, 4)), firstSeen: start - 5 * 3600 };
    const quiet = start + 7200;
    expect(windowPace(log, fiveHourSeconds, quiet, "normal", false)).toMatchObject({ current: { kind: "idle" } });
    expect(windowPace(log, fiveHourSeconds, quiet, "normal", true)).toMatchObject({ current: { kind: "measuring" } });

    const busy = poll(
      Array.from({ length: 12 }, () => 14),
      { log, from: start + 9 * 300, active: true },
    );
    const slow = windowPace(busy, fiveHourSeconds, start + 20 * 300, "normal", true);
    expect(slow).toMatchObject({ creature: { kind: "tortoise", usual: 6 } });
    expect(slow?.status === "learned" && slow.creature?.rate).toBeCloseTo(2);
  });
});

describe("learning", () => {
  it("waits out the window's watching time, then its first reading", () => {
    const fresh = poll([5]);
    expect(windowPace(fresh, sevenDaySeconds, start + 3600, "normal", false)).toEqual({
      status: "learning",
      watched_seconds: 3600,
      learn_seconds: 84 * 3600,
      until: { kind: "time", epoch: start + 84 * 3600 },
    });
    expect(windowPace(fresh, sevenDaySeconds, start + 90 * 3600, "normal", false)).toMatchObject({
      status: "learning",
      until: { kind: "use", in_use: false },
    });
    const using = { ...poll([5, 6]), firstSeen: start - 90 * 3600 };
    expect(windowPace(using, sevenDaySeconds, start + 300, "normal", false)).toMatchObject({
      until: { kind: "use", in_use: true },
    });
  });
});

describe("creatures", () => {
  it.each([
    ["calm", 4, 0.25],
    ["normal", 2.5, 0.4],
    ["eager", 1.6, 1 / 1.6],
  ] as const)("uses the %s multiple for both thresholds", (preset, fast, slow) => {
    expect(creatureFor(fast * 10, 10, preset, true)).toBe("dragon");
    expect(creatureFor(fast * 10 - 0.01, 10, preset, true)).toBeNull();
    expect(creatureFor(slow * 10, 10, preset, true)).toBe("tortoise");
    expect(creatureFor(slow * 10 + 0.01, 10, preset, true)).toBeNull();
  });

  it("keeps the tortoise away when nobody is known to be working", () => {
    expect(creatureFor(1, 10, "normal", false)).toBeNull();
    expect(creatureFor(30, 10, "normal", false)).toBe("dragon");
  });
});

describe("local activity", () => {
  it("goes to the account that moved last, not to every account of the provider", () => {
    const window = (key: string): PaceWindow => ({
      key,
      provider: "codex",
      owner: key,
      duration: fiveHourSeconds,
      window: { used_percent: 0, limit_window_seconds: fiveHourSeconds, reset_at_epoch: null },
      epoch: null,
    });
    const logs = new Map([
      ["direct", poll(steady(10, 4))],
      ["hub", poll(steady(10, 4), { from: start + 3600 })],
    ]);
    const windows = [window("direct"), window("hub")];
    expect(claimActivity(windows, logs, { codex: true, claude: false, opencode: false })).toEqual(new Set(["hub"]));
    expect(claimActivity(windows, logs, { codex: false, claude: false, opencode: false })).toEqual(new Set());
  });
});
