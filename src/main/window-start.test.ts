import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { defaultPaceSettings } from "../shared/pace";
import { emptyProviderUsage, fiveHourSeconds } from "../shared/usage";
import type { ProviderUsage, UsageSnapshot } from "../shared/usage";
import type { WindowStartSettings } from "../shared/window-start";
import type { Cli } from "./cli";
import { failureMessages } from "../shared/failure";
import { UsageApi } from "./api";
import { parseCredentials } from "./auth";
import { ReadFailure } from "./failure";
import { saveSettings } from "./settings";
import { applyReading } from "./usage-state";
import { idleWindow, WindowStarter } from "./window-start";

const directories: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function reading(epoch: number, used: number | null, reset: number | null): ProviderUsage {
  return {
    ...emptyProviderUsage(),
    five_hour: { used_percent: used, limit_window_seconds: fiveHourSeconds, reset_at_epoch: reset },
    last_successful_update_epoch: epoch,
    status: "ready",
  };
}

const idle = (epoch: number) => reading(epoch, 0, null);
const running = (epoch: number) => reading(epoch, 4, epoch + 3600);

function snapshot(claude: ProviderUsage, polled = true): UsageSnapshot {
  return {
    codex: emptyProviderUsage(),
    claude,
    opencode: emptyProviderUsage(),
    enabled: { codex: false, claude: polled, opencode: false },
    proxy_hubs: [],
    pace: { settings: defaultPaceSettings, windows: {} },
  };
}

const startOn: WindowStartSettings = {
  enabled: true,
  wake: false,
  providers: { claude: { path: null }, codex: { path: null } },
};

function starter(
  settings: WindowStartSettings,
  run: (cli: Cli) => Promise<void> = async () => {},
  runHub?: ConstructorParameters<typeof WindowStarter>[4],
  locate?: () => Promise<Cli | null>,
  notify?: ConstructorParameters<typeof WindowStarter>[5],
) {
  const directory = mkdtempSync(join(tmpdir(), "tantalus-start-"));
  directories.push(directory);
  const path = join(directory, "window-start.json");
  saveSettings(path, settings);
  const cli: Cli = { file: "claude", args: [], shell: false, label: "claude" };
  const runs: Cli[] = [];
  let started = 0;
  const instance = new WindowStarter(
    path,
    locate ?? (async () => cli),
    (command) => {
      runs.push(command);
      return run(command);
    },
    () => started++,
    runHub,
    notify,
  );
  return { instance, runs, started: () => started };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("idle windows", () => {
  it("reads a window with nothing used and no reset running as idle", () => {
    expect(idleWindow(idle(1000))).toBe(true);
    expect(idleWindow(reading(1000, 0, 1000 + fiveHourSeconds - 5))).toBe(true);
  });

  it("reads a started, used, stale or blocked window as busy", () => {
    expect(idleWindow(reading(1000, 0, 1000 + fiveHourSeconds - 600))).toBe(false);
    expect(idleWindow(reading(1000, 1, null))).toBe(false);
    expect(idleWindow(reading(1000, null, null))).toBe(false);
    expect(idleWindow(reading(1000, null, 1000 + fiveHourSeconds))).toBe(false);
    expect(idleWindow({ ...idle(1000), status: "stale" })).toBe(false);
    expect(idleWindow({ ...idle(1000), allowed: false })).toBe(false);
  });
});

describe("window starter", () => {
  it("starts a window once it has sat idle for 5 minutes, and only once", async () => {
    const { instance, runs, started } = starter(startOn);
    instance.observe(snapshot(idle(1000)));
    instance.observe(snapshot(idle(1200)));
    expect(runs).toHaveLength(0);
    instance.observe(snapshot(idle(1300)));
    instance.observe(snapshot(idle(1310)));
    await settle();
    expect(runs).toHaveLength(1);
    expect(started()).toBe(1);
    expect((await instance.read()).providers.claude.last).toMatchObject({ error: null });
    for (const epoch of [1600, 1900, 2200]) {
      instance.observe(snapshot(idle(epoch)));
      await settle();
    }
    expect(runs).toHaveLength(1);

    instance.observe(snapshot(running(2300)));
    instance.observe(snapshot(idle(2400)));
    instance.observe(snapshot(idle(2600)));
    await settle();
    expect(runs).toHaveLength(1);
    instance.observe(snapshot(idle(2700)));
    await settle();
    expect(runs).toHaveLength(2);
    expect(started()).toBe(2);
  });

  it("waits again after a reading that is not idle", async () => {
    const { instance, runs } = starter(startOn);
    instance.observe(snapshot(idle(1000)));
    instance.observe(snapshot(running(1200)));
    instance.observe(snapshot(idle(1300)));
    await settle();
    expect(runs).toHaveLength(0);
  });

  it("runs nothing while switched off", async () => {
    const { instance, runs } = starter({ ...startOn, enabled: false });
    instance.observe(snapshot(idle(1000)));
    instance.observe(snapshot(idle(1300)));
    await settle();
    expect(runs).toHaveLength(0);
  });

  it("runs nothing for a provider that is not polled", async () => {
    const { instance, runs } = starter(startOn);
    instance.observe(snapshot(idle(1000), false));
    instance.observe(snapshot(idle(1300), false));
    await settle();
    expect(runs).toHaveLength(0);
  });

  it("keeps an attempted idle spell consumed when the switch is toggled", async () => {
    const { instance, runs } = starter(startOn);
    instance.observe(snapshot(idle(1000)));
    instance.observe(snapshot(idle(1300)));
    await settle();
    await instance.set({ ...startOn, enabled: false });
    instance.observe(snapshot(idle(1600)));
    await instance.set(startOn);
    instance.observe(snapshot(idle(1900)));
    instance.observe(snapshot(idle(2200)));
    await settle();
    expect(runs).toHaveLength(1);
  });

  it("keeps the reason a start failed", async () => {
    const { instance, runs, started } = starter(startOn, async () => {
      throw new Error("claude exited with code 1: not logged in");
    });
    instance.observe(snapshot(idle(1000)));
    instance.observe(snapshot(idle(1300)));
    await settle();
    expect(started()).toBe(1);
    expect((await instance.read()).providers.claude.last?.error).toBe("claude exited with code 1: not logged in");
    instance.observe(snapshot(idle(1600)));
    instance.observe(snapshot(idle(1900)));
    await settle();
    expect(runs).toHaveLength(1);
  });
});

describe("sign-in wake", () => {
  const rejected = {
    ...applyReading(emptyProviderUsage(), new ReadFailure("rejected")),
    error_message: "Sign in again to continue.",
  };
  const wakeOnly: WindowStartSettings = { ...startOn, enabled: false, wake: true };

  it("wakes a rejected Claude sign-in at most once an hour", async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
    const { instance, runs, started } = starter(wakeOnly);
    instance.observe(snapshot(rejected));
    await settle();
    expect(runs).toHaveLength(1);
    expect(started()).toBe(1);
    vi.setSystemTime(1_000_000 + 59 * 60_000);
    instance.observe(snapshot({ ...rejected, status: "stale" }));
    await settle();
    expect(runs).toHaveLength(1);
    vi.setSystemTime(1_000_000 + 60 * 60_000);
    instance.observe(snapshot(rejected));
    await settle();
    expect(runs).toHaveLength(2);
  });

  it("leaves other failures and a switched off wake alone", async () => {
    const { instance, runs } = starter(wakeOnly);
    instance.observe(snapshot(applyReading(emptyProviderUsage(), new ReadFailure("timeout"))));
    await settle();
    expect(runs).toHaveLength(0);
    await instance.set({ ...wakeOnly, wake: false });
    instance.observe(snapshot(rejected));
    await settle();
    expect(runs).toHaveLength(0);
  });

  it.each([
    [401, "{}", 1],
    [403, "{}", 0],
    [429, "{}", 0],
    [500, "{}", 0],
    [503, "{}", 0],
    [200, "not JSON", 0],
  ])("checks HTTP %i with body %s before running the CLI", async (status, body, expectedRuns) => {
    const fetch = vi.fn(async () => new Response(body, { status }));
    vi.stubGlobal("fetch", fetch);
    const credentials = parseCredentials("claude", '{"claudeAiOauth":{"accessToken":"fixture"}}');
    const usage = await new UsageApi().fetch("claude", credentials).catch((error: unknown) => {
      if (!(error instanceof Error)) throw error;
      return applyReading(running(1000), error);
    });
    const { instance, runs } = starter(wakeOnly);
    instance.observe(snapshot(usage));
    await settle();
    expect(runs).toHaveLength(expectedRuns);
  });

  it("renews an expired sign-in before reading usage and clears its failure after renewal", async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const api = new UsageApi();
    let credentials = parseCredentials("claude", '{"claudeAiOauth":{"accessToken":"old","expiresAt":1000000}}');
    const usage = await api.fetch("claude", credentials).catch((error: unknown) => {
      if (!(error instanceof Error)) throw error;
      return applyReading(running(900), error);
    });
    expect(usage).toMatchObject({ status: "stale", error_reason: "expired" });
    expect(fetch).not.toHaveBeenCalled();
    const { instance, runs } = starter(wakeOnly, async () => {
      credentials = parseCredentials("claude", '{"claudeAiOauth":{"accessToken":"new","expiresAt":2000000}}');
    });
    instance.observe(snapshot(usage));
    await settle();
    expect(runs).toHaveLength(1);
    const renewed = await api.fetch("claude", credentials);
    expect(renewed).toMatchObject({ status: "ready", error_reason: null, error_message: null });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["codex", "opencode"] as const)("keeps %s HTTP 401 failures generic", async (provider) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    const credentials = parseCredentials(provider, '{"access_token":"fixture"}');
    await expect(new UsageApi().fetch(provider, credentials)).rejects.toMatchObject({
      reason: "response",
      message: failureMessages.response,
    });
  });

  it("does not infer a sign-in rejection from display text", async () => {
    const { instance, runs } = starter(wakeOnly);
    instance.observe(snapshot(applyReading(running(1000), new Error(failureMessages.response))));
    await settle();
    expect(runs).toHaveLength(0);
  });
});

function hubSnapshot(epoch: number, rejected = false): UsageSnapshot {
  const usage = rejected ? applyReading(idle(epoch), new ReadFailure("rejected")) : idle(epoch);
  return {
    ...snapshot(emptyProviderUsage(), false),
    proxy_hubs: [
      {
        id: "hub",
        label: "Hub",
        status: "ready",
        error_message: null,
        last_successful_update_epoch: epoch,
        accounts: (["claude", "codex"] as const).map((provider) => ({
          id: `${provider}.json`,
          email: null,
          plan: null,
          provider,
          usage,
        })),
      },
    ],
  };
}

describe("hub automation", () => {
  it("starts each hub account independently of direct switches and stops when removed", async () => {
    const runHub = vi.fn(async () => {});
    const { instance, runs } = starter(startOn, undefined, runHub);
    instance.observe(hubSnapshot(1000));
    instance.observe(hubSnapshot(1300));
    await settle();
    expect(runs).toHaveLength(0);
    expect(runHub.mock.calls.map((call) => [...call].slice(0, 3))).toEqual([
      ["hub", "claude.json", "claude"],
      ["hub", "codex.json", "codex"],
    ]);
    expect((await instance.read()).hubs.every((hub) => hub.last?.error === null)).toBe(true);
    instance.observe(hubSnapshot(1600));
    await settle();
    expect(runHub).toHaveBeenCalledTimes(2);
    instance.observe(snapshot(emptyProviderUsage(), false));
    expect((await instance.read()).hubs).toEqual([]);
    instance.observe(hubSnapshot(1900));
    instance.observe(hubSnapshot(2200));
    await settle();
    expect(runHub).toHaveBeenCalledTimes(4);
  });

  it.each(["codex", "claude"] as const)("keeps pooled %s timers and results separate", async (provider) => {
    const runHub = vi.fn(async (hub: string) => {
      if (hub === "other") throw new Error("Account unavailable");
    });
    const { instance } = starter(startOn, undefined, runHub);
    const pooled = (at: number, secondIdle: boolean): UsageSnapshot => {
      const source = hubSnapshot(at);
      const hub = source.proxy_hubs[0];
      const account = hub.accounts.find((account) => account.provider === provider)!;
      return {
        ...source,
        proxy_hubs: [
          {
            ...hub,
            accounts: [
              { ...account, id: "first" },
              { ...account, id: "second", usage: secondIdle ? idle(at) : running(at) },
            ],
          },
          { ...hub, id: "other", accounts: [{ ...account, id: "first" }] },
        ],
      };
    };
    instance.observe(pooled(1000, false));
    instance.observe(pooled(1300, true));
    await settle();
    expect(runHub.mock.calls).toEqual([
      ["hub", "first", provider, expect.any(Function)],
      ["other", "first", provider, expect.any(Function)],
    ]);
    expect(instance.results()).toEqual({
      [JSON.stringify(["hub", provider, "first"])]: { epoch: expect.any(Number), error: null },
      [JSON.stringify(["other", provider, "first"])]: { epoch: expect.any(Number), error: "Account unavailable" },
    });
    instance.observe(pooled(1600, true));
    await settle();
    expect(runHub).toHaveBeenCalledTimes(3);
    expect(runHub.mock.calls[2]).toEqual(["hub", "second", provider, expect.any(Function)]);
    expect(Object.keys(instance.results())).toHaveLength(3);
    expect((await instance.read()).hubs.find((account) => account.accountId === "second")?.last?.error).toBeNull();
  });

  it("switches wake off for hub Claude and rejects attempts to enable it", async () => {
    const notices: string[] = [];
    const runHub = vi.fn(async () => {});
    const { instance, runs } = starter({ ...startOn, enabled: false, wake: true }, undefined, runHub, undefined, (message) =>
      notices.push(message),
    );
    instance.observe(hubSnapshot(1000, true));
    await settle();
    expect((await instance.read()).wake).toBe(false);
    expect((await instance.set({ ...startOn, enabled: false, wake: true })).wake).toBe(false);
    expect(notices).toHaveLength(2);
    expect(notices.at(-1)).toContain("direct sign-ins");
    expect(runHub).not.toHaveBeenCalled();
    expect(runs).toHaveLength(0);
  });
});

it("rechecks the automation switch before queued hub work runs", async () => {
  const checks: (() => void)[] = [];
  const { instance } = starter(startOn, undefined, async (_hub, _account, _provider, check) => {
    checks.push(check);
  });
  instance.observe(hubSnapshot(1000));
  instance.observe(hubSnapshot(1300));
  await settle();
  await instance.set({ ...startOn, enabled: false });
  expect(checks[0]).toThrow("no longer enabled");
});

it("cancels a direct start when its provider is disabled during CLI lookup", async () => {
  let release!: (cli: Cli) => void;
  const { instance, runs } = starter(
    startOn,
    undefined,
    undefined,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  instance.observe(snapshot(idle(1000)));
  instance.observe(snapshot(idle(1300)));
  instance.observe(snapshot(idle(1600), false));
  release({ file: "claude", args: [], shell: false, label: "claude" });
  await settle();
  expect(runs).toHaveLength(0);
});
