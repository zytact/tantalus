import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { emptyProviderUsage, emptyProxyHubSnapshot, fiveHourSeconds, providerIds } from "../shared/usage";
import type { ProviderId, ProxyHubProviderId, UsageSnapshot } from "../shared/usage";
import { defaultPaceSettings, paceKey } from "../shared/pace";
import { UsageApi } from "./api";
import { parseCredentials } from "./auth";
import { noActivity, PaceTracker } from "./pace-tracker";
import { loadPaceLogs, saveSettings } from "./settings";

const directories: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it("forgets what every window learned and starts each again from the current reading", async () => {
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

  await pace.reset();
  expect(pace.track(snapshot, noActivity, now).pace.windows["codex:604800"]).toMatchObject({ status: "learning" });
  await pace.saved();
  expect(Object.values(loadPaceLogs(log))).toEqual([
    {
      firstSeen: now - 60,
      last: { epoch: now - 60, used: 5, resetAt: null },
      stretch: null,
      readings: [],
    },
  ]);
});

it("does not let a refresh during a reset save what the reset forgot", async () => {
  const saved = tracker();
  seed(saved.path, "codex");
  const pace = saved.create();
  pace.track(snapshotFor("codex", "Pro"), noActivity, epoch);
  const reset = pace.reset();
  pace.track(snapshotFor("codex", "Pro"), noActivity, epoch + 300);
  await reset;
  await pace.saved();
  expect(loadPaceLogs(saved.path)).toEqual({});
});

it("keeps what it learned on disk and in memory when the reset cannot be saved", async () => {
  const saved = tracker();
  seed(saved.path, "codex");
  const pace = saved.create();
  const key = paceKey(fiveHourSeconds, "codex");
  chmodSync(dirname(saved.path), 0o500);
  try {
    const reset = pace.reset();
    pace.track(snapshotFor("codex", "Pro"), noActivity, epoch + 300);
    await expect(reset).rejects.toThrow();
  } finally {
    chmodSync(dirname(saved.path), 0o700);
  }
  expect(pace.annotate(snapshotFor("codex", "Pro"), epoch + 300).pace.windows[key]).toMatchObject({
    status: "learned",
    usual_rate: 3,
  });
  expect(Object.values(loadPaceLogs(saved.path)).some((log) => log.readings.length > 0)).toBe(true);
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
  async (provider) => {
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
    await pace.saved();
    const restarted = saved.create().annotate(reading, epoch + 1200);
    expect(restarted.pace.windows[first]).toMatchObject({ status: "learned", usual_rate: 4 });
    const repeat = pace.track(reading, noActivity, epoch + 1200);
    expect(repeat.pace.windows[first]).toEqual(reading.pace.windows[first]);
    await pace.reset();
    const reset = pace.track(reading, noActivity, epoch + 1200);
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

it("keeps current pace apart when a hub swaps the account behind an auth file", () => {
  const saved = tracker();
  seed(saved.path, "codex");
  const pace = saved.create();
  pace.track(snapshotFor("codex", "Pro"), noActivity, epoch);
  const signedIn = (email: string, used: number, at: number) => {
    const hub = withHub(snapshotFor("codex", "Pro"), "codex", ["Pro"], at, used);
    hub.proxy_hubs[0]!.accounts[0]!.email = email;
    return hub;
  };
  for (let tick = 0; tick <= 4; tick++)
    pace.track(signedIn("first@example.test", 10 + tick, epoch + tick * 300), noActivity, epoch + tick * 300);
  const swapped = pace.track(signedIn("second@example.test", 80, epoch + 1500), noActivity, epoch + 1500);
  expect(swapped.pace.windows[paceKey(fiveHourSeconds, "codex", { hubId: "hub", accountId: "0" })]).toMatchObject({
    status: "learned",
    current: { kind: "idle" },
  });
});

it.each(providerIds)("retains %s learning while absent and reuses it after restart", async (provider) => {
  const saved = tracker();
  seed(saved.path, provider);
  const pace = saved.create();
  const direct = snapshotFor(provider, "Pro");
  const key = paceKey(fiveHourSeconds, provider);
  pace.track(direct, noActivity, epoch);
  const later = epoch + 365 * 86_400;
  pace.track({ ...direct, enabled: { codex: false, claude: false, opencode: false } }, noActivity, later);
  await pace.saved();
  expect(Object.keys(loadPaceLogs(saved.path)).some((key) => key.startsWith('["current",'))).toBe(false);
  const returning = snapshotFor(provider, "Pro");
  returning[provider] = usage("Pro", 80, later);
  const resumed = saved.create().track(returning, noActivity, later);
  expect(resumed.pace.windows[key]).toMatchObject({ status: "learned", usual_rate: 3, current: { kind: "idle" } });
  expect(resumed[provider].five_hour.used_percent).toBe(80);
});

it.each(providerIds)(
  "adopts a previous %s log under the reported tier only once it is seen again",
  async (provider) => {
    const saved = tracker();
    seed(saved.path, provider);
    const pace = saved.create();
    const absent = snapshotFor(provider, "Pro");
    absent[provider] = emptyProviderUsage();
    pace.track(absent, noActivity, epoch);
    await pace.saved();
    expect(Object.keys(loadPaceLogs(saved.path))).toEqual([paceKey(fiveHourSeconds, provider)]);
    const seen = pace.track(snapshotFor(provider, "Pro"), noActivity, epoch);
    expect(seen.pace.windows[paceKey(fiveHourSeconds, provider)]).toMatchObject({
      status: "learned",
      usual_rate: 3,
    });
    await pace.saved();
    expect(Object.keys(loadPaceLogs(saved.path))).not.toContain(paceKey(fiveHourSeconds, provider));
  },
);

it.each(providerIds)("isolates %s sign-ins even without a unique email", async (provider) => {
  vi.useFakeTimers();
  let used = 10;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            rate_limit: {
              allowed: true,
              primary_window: { used_percent: used, limit_window_seconds: fiveHourSeconds },
            },
            credits: [],
            five_hour: { utilization: used, resets_at: null },
            usage: { rolling: { percent: used, resetsAt: null, status: "ok" } },
          }),
        ),
    ),
  );
  const token = `e30.${Buffer.from(JSON.stringify({ email: "same@example.test", "https://api.openai.com/auth": { chatgpt_plan_type: "pro" } })).toString("base64url")}.signature`;
  const credentialJson: Record<ProviderId, (account: string) => unknown> = {
    codex: (account) => ({ tokens: { access_token: "same-token", account_id: account, id_token: token } }),
    claude: (account) => ({ claudeAiOauth: { accessToken: account, subscriptionType: "pro" } }),
    opencode: (account) => ({ "opencode-go": { key: account } }),
  };
  const credentialsFor = (account: string) =>
    parseCredentials(provider, JSON.stringify(credentialJson[provider](account)));
  const api = new UsageApi();
  const saved = tracker();
  seed(saved.path, provider);
  const pace = saved.create();
  const snapshot = snapshotFor(provider, provider === "opencode" ? "Go" : "Pro");
  for (let tick = 0; tick <= 4; tick++) {
    vi.setSystemTime((epoch + tick * 300) * 1000);
    used = 10 + tick;
    snapshot[provider] = await api.fetch(provider, credentialsFor("first"));
    pace.track(snapshot, noActivity, epoch + tick * 300);
  }
  const firstKey = snapshot[provider].account_key;
  vi.setSystemTime((epoch + 1500) * 1000);
  used = 80;
  snapshot[provider] = await api.fetch(provider, credentialsFor("second"));
  const current = pace.track(snapshot, noActivity, epoch + 1500);
  expect(snapshot[provider].account_key).not.toBe(firstKey);
  expect(JSON.stringify(current)).not.toContain(JSON.stringify(credentialsFor("second").accessToken));
  expect(current[provider].five_hour.used_percent).toBe(80);
  expect(current.pace.windows[paceKey(fiveHourSeconds, provider)]).toMatchObject({
    status: "learned",
    usual_rate: 4,
    current: { kind: "idle" },
    creature: null,
  });
});
