import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import { emptyProviderUsage, emptyProxyHubSnapshot, fiveHourSeconds, providerIds } from "../shared/usage";
import type { ProviderId, ProxyHubProviderId, UsageSnapshot } from "../shared/usage";
import { defaultPaceSettings, paceKey } from "../shared/pace";
import { noActivity, PaceTracker } from "./pace-tracker";
import { loadPaceLogs, saveSettings } from "./settings";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it("forgets what every window learned and starts each again from the current reading", () => {
  const directory = mkdtempSync(join(tmpdir(), "tantalus-pace-"));
  directories.push(directory);
  const log = join(directory, "pace-log.json");
  const now = 1_800_000_000;
  const learned = { firstSeen: now - 30 * 86_400, stretch: null, readings: [2, 3] };
  saveSettings(log, {
    "codex:604800": { ...learned, last: { epoch: now - 600, used: 4, resetAt: null } },
    "claude:18000": { ...learned, last: { epoch: now - 600, used: 9, resetAt: null } },
  });
  const pace = new PaceTracker(log, join(directory, "pace.json"), async () => noActivity);
  const snapshot: UsageSnapshot = {
    codex: {
      ...emptyProviderUsage(),
      seven_day: { used_percent: 5, limit_window_seconds: 604_800, reset_at_epoch: null },
      last_successful_update_epoch: now - 60,
      status: "ready",
    },
    claude: emptyProviderUsage(),
    opencode: emptyProviderUsage(),
    enabled: { codex: true, claude: true, opencode: false },
    proxy_hubs: [],
    pace: { settings: defaultPaceSettings, windows: {} },
  };
  expect(pace.annotate(snapshot, now).pace.windows["codex:604800"]?.status).toBe("learned");

  expect(pace.reset(snapshot, now).pace.windows["codex:604800"]).toMatchObject({ status: "learning" });
  expect(Object.values(loadPaceLogs(log))).toEqual([
    {
      firstSeen: now - 60,
      last: { epoch: now - 60, used: 5, resetAt: null },
      stretch: null,
      readings: [],
    },
  ]);
});

function tracker() {
  const directory = mkdtempSync(join(tmpdir(), "tantalus-tier-pace-"));
  directories.push(directory);
  const path = join(directory, "pace-log.json");
  const settings = join(directory, "pace.json");
  return { path, create: () => new PaceTracker(path, settings, async () => noActivity) };
}

const epoch = 1_800_000_000;
function usage(plan: string | null, used: number, at = epoch) {
  return {
    ...emptyProviderUsage(),
    plan,
    five_hour: { used_percent: used, limit_window_seconds: fiveHourSeconds, reset_at_epoch: null },
    last_successful_update_epoch: at,
    status: "ready" as const,
  };
}
function snapshotFor(provider: ProviderId, plan: string | null): UsageSnapshot {
  return {
    codex: emptyProviderUsage(),
    claude: emptyProviderUsage(),
    opencode: emptyProviderUsage(),
    [provider]: usage(plan, 10),
    enabled: { codex: false, claude: false, opencode: false, [provider]: true },
    proxy_hubs: [],
    pace: { settings: defaultPaceSettings, windows: {} },
  };
}
function withHub(
  snapshot: UsageSnapshot,
  provider: ProxyHubProviderId,
  plans: (string | null)[],
  at = epoch,
  used = 70,
): UsageSnapshot {
  return {
    ...snapshot,
    enabled: { ...snapshot.enabled, [provider]: false },
    proxy_hubs: [
      {
        ...emptyProxyHubSnapshot({ id: "hub", label: "Hub", url: "http://hub.test", enabled: true }),
        status: "ready",
        accounts: plans.map((plan, index) => ({
          id: String(index),
          provider,
          plan,
          email: null,
          usage: usage(null, used + index, at),
        })),
      },
    ],
  };
}
function seed(path: string, provider: ProviderId) {
  saveSettings(path, {
    [paceKey(fiveHourSeconds, provider)]: {
      firstSeen: epoch - 30 * 86_400,
      last: { epoch: epoch - 300, used: 10, resetAt: null },
      stretch: null,
      readings: [2, 4],
    },
  });
}

it.each(["codex", "claude"] as const)(
  "shares %s learning across direct and hub accounts without sharing quotas or current pace",
  (provider) => {
    const saved = tracker();
    seed(saved.path, provider);
    const pace = saved.create();
    const direct = snapshotFor(provider, "Pro");
    pace.track(direct, noActivity, epoch);
    const hub = withHub(direct, provider, [" pro ", "Pro", "Other tier"]);
    const immediate = pace.annotate(hub, epoch);
    const first = paceKey(fiveHourSeconds, provider, { hubId: "hub", accountId: "0" });
    const second = paceKey(fiveHourSeconds, provider, { hubId: "hub", accountId: "1" });
    const other = paceKey(fiveHourSeconds, provider, { hubId: "hub", accountId: "2" });
    expect(immediate.pace.windows[first]).toMatchObject({
      status: "learned",
      usual_rate: 3,
      current: { kind: "idle" },
    });
    expect(immediate.pace.windows[second]).toMatchObject({ status: "learned", usual_rate: 3 });
    expect(immediate.pace.windows[other]?.status).toBe("learning");
    let reading = pace.track(hub, noActivity, epoch);
    for (let tick = 1; tick <= 4; tick++) {
      const at = epoch + tick * 300;
      const next = withHub(direct, provider, ["Pro", "Pro", "Other tier"], at);
      next.proxy_hubs[0].accounts[0].usage = usage(null, 70 + tick, at);
      reading = pace.track(next, noActivity, at);
    }
    expect(reading.proxy_hubs[0].accounts.map((account) => account.usage.five_hour.used_percent)).toEqual([74, 71, 72]);
    expect(reading.pace.windows[first]).toMatchObject({
      status: "learned",
      usual_rate: 4,
      current: { kind: "moving", rate: 12 },
      creature: { kind: "dragon" },
    });
    expect(reading.pace.windows[second]).toMatchObject({
      status: "learned",
      usual_rate: 4,
      current: { kind: "idle" },
      creature: null,
    });
    const restarted = saved.create().annotate(reading, epoch + 1200);
    expect(restarted.pace.windows[first]).toMatchObject({ status: "learned", usual_rate: 4 });
    const repeat = pace.track(reading, noActivity, epoch + 1200);
    expect(repeat.pace.windows[first]).toEqual(reading.pace.windows[first]);
    const reset = pace.reset(reading, epoch + 1200);
    expect(Object.values(reset.pace.windows).every((window) => window?.status === "learning")).toBe(true);
  },
);

it.each(providerIds)("keeps %s tiers separate and recovers a previous tier's usual pace", (provider) => {
  const saved = tracker();
  seed(saved.path, provider);
  const pace = saved.create();
  const first = snapshotFor(provider, "First tier");
  const key = paceKey(fiveHourSeconds, provider);
  expect(pace.track(first, noActivity, epoch).pace.windows[key]).toMatchObject({ status: "learned", usual_rate: 3 });
  expect(pace.track(snapshotFor(provider, "Second tier"), noActivity, epoch).pace.windows[key]?.status).toBe(
    "learning",
  );
  expect(pace.track(first, noActivity, epoch).pace.windows[key]).toMatchObject({ status: "learned", usual_rate: 3 });
});

it("keeps providers, window lengths, and unknown tiers separate", () => {
  const saved = tracker();
  seed(saved.path, "codex");
  const pace = saved.create();
  pace.track(snapshotFor("codex", "Pro"), noActivity, epoch);
  const claude = pace.track(snapshotFor("claude", "Pro"), noActivity, epoch);
  expect(claude.pace.windows[paceKey(fiveHourSeconds, "claude")]?.status).toBe("learning");
  const codex = snapshotFor("codex", "Pro");
  codex.codex.seven_day = { used_percent: 50, limit_window_seconds: 604800, reset_at_epoch: null };
  expect(pace.track(codex, noActivity, epoch).pace.windows[paceKey(604800, "codex")]?.status).toBe("learning");
  const unknown = tracker();
  seed(unknown.path, "codex");
  const unknownPace = unknown.create();
  const direct = snapshotFor("codex", null);
  unknownPace.track(direct, noActivity, epoch);
  const hub = unknownPace.track(withHub(direct, "codex", [null]), noActivity, epoch);
  expect(hub.pace.windows[paceKey(fiveHourSeconds, "codex", { hubId: "hub", accountId: "0" })]?.status).toBe(
    "learning",
  );
  expect(
    unknownPace.track(snapshotFor("codex", "Pro"), noActivity, epoch).pace.windows[paceKey(fiveHourSeconds, "codex")]
      ?.status,
  ).toBe("learning");
});

it("shares the usual baseline when direct sign-ins change without reusing their current stretch", () => {
  const saved = tracker();
  seed(saved.path, "codex");
  const pace = saved.create();
  const first = snapshotFor("codex", "Pro");
  first.codex.email = "first@example.test";
  pace.track(first, noActivity, epoch);
  for (let tick = 1; tick <= 4; tick++) {
    first.codex = { ...usage("Pro", 10 + tick, epoch + tick * 300), email: first.codex.email };
    pace.track(first, noActivity, epoch + tick * 300);
  }
  const second = snapshotFor("codex", "Pro");
  second.codex = { ...usage("Pro", 80, epoch + 1500), email: "second@example.test" };
  const current = pace.track(second, noActivity, epoch + 1500);
  expect(current.codex.five_hour.used_percent).toBe(80);
  expect(current.pace.windows[paceKey(fiveHourSeconds, "codex")]).toMatchObject({
    status: "learned",
    usual_rate: 4,
    current: { kind: "idle" },
    creature: null,
  });
});

it.each(providerIds)("retains %s learning while absent and reuses it after restart", (provider) => {
  const saved = tracker();
  seed(saved.path, provider);
  const pace = saved.create();
  const direct = snapshotFor(provider, "Pro");
  const key = paceKey(fiveHourSeconds, provider);
  pace.track(direct, noActivity, epoch);
  const later = epoch + 365 * 86_400;
  pace.track({ ...direct, enabled: { codex: false, claude: false, opencode: false } }, noActivity, later);
  const returning = snapshotFor(provider, "Pro");
  returning[provider] = usage("Pro", 80, later);
  const resumed = saved.create().track(returning, noActivity, later);
  expect(resumed.pace.windows[key]).toMatchObject({ status: "learned", usual_rate: 3, current: { kind: "idle" } });
  expect(resumed[provider].five_hour.used_percent).toBe(80);
});
