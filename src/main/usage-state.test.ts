import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPaceSettings } from "../shared/pace";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { emptyProviderUsage, emptyProxyHubSnapshot, homeSignIn } from "../shared/usage";
import type {
  DirectAccount,
  ProviderId,
  ProviderUsage,
  ProxyHubAccount,
  ProxyHubConfig,
  ProxyHubSnapshot,
  SignInSettings,
  UsageSnapshot,
} from "../shared/usage";
import { ReadFailure } from "./failure";
import { noActivity, PaceTracker } from "./pace-tracker";
import { ProxyHubRejected } from "./proxy-hub-api";
import { saveSettings } from "./settings";
import { applyHubReading, applyReading, nextBackoff, pollUsage, settled, UsageState } from "./usage-state";
import type { DirectReading } from "./usage-state";

const directories: string[] = [];
const trackers: PaceTracker[] = [];
afterEach(async () => {
  await Promise.all(trackers.splice(0).map((pace) => pace.saved()));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function settingsPath() {
  const directory = mkdtempSync(join(tmpdir(), "tantalus-state-"));
  directories.push(directory);
  return join(directory, "providers.json");
}

function paceTracker(directory = join(settingsPath(), "..")) {
  const pace = new PaceTracker(join(directory, "pace-log.json"), join(directory, "pace.json"), async () => noActivity);
  trackers.push(pace);
  return pace;
}

/** Every provider signed in once, in its home folder. */
function createState(
  readProvider: (id: ProviderId) => Promise<ProviderUsage>,
  publish: (snapshot: UsageSnapshot) => void = () => {},
  readHub: (config: ProxyHubConfig) => Promise<ProxyHubAccount[]> = async () => [],
) {
  const providers = settingsPath();
  const pace = paceTracker(join(providers, ".."));
  return new UsageState(
    providers,
    join(providers, "..", "proxy-hubs.json"),
    null,
    async (id) => homeReading(await readProvider(id).catch((error: Error) => error)),
    readHub,
    publish,
    pace,
  );
}

const homeReading = (usage: ProviderUsage | Error): DirectReading[] => [{ id: homeSignIn, distribution: null, usage }];

const account = (provider: ProviderId, usage: ProviderUsage, id = homeSignIn): DirectAccount => ({
  id,
  provider,
  distribution: null,
  usage,
});

/** The reading of a provider's home sign-in. */
const home = (snapshot: UsageSnapshot | undefined, provider: ProviderId) =>
  snapshot?.accounts.find((account) => account.provider === provider && account.id === homeSignIn)?.usage;

const ready = (used: number): ProviderUsage => ({
  ...emptyProviderUsage(),
  seven_day: { used_percent: used, limit_window_seconds: 604_800, reset_at_epoch: null },
  last_successful_update_epoch: 1,
  status: "ready",
});

const hubConfig: ProxyHubConfig = {
  id: "hub",
  label: "Home hub",
  url: "http://hub.test:8317",
  managementKey: "management-secret",
  enabled: true,
};

const hubAccount = (used: number): ProxyHubAccount => ({
  id: "codex.json",
  email: "codex@example.com",
  plan: "pro",
  provider: "codex",
  usage: ready(used),
});

/** A provider read that finishes only when the test releases it. */
function heldReads() {
  const reads: { id: ProviderId; release: (usage: ProviderUsage) => void }[] = [];
  const read = (id: ProviderId) => new Promise<ProviderUsage>((release) => reads.push({ id, release }));
  return { reads, read };
}

describe("usage state", () => {
  it("never reads a disabled provider", async () => {
    const read: ProviderId[] = [];
    const state = createState(async (id) => {
      read.push(id);
      return ready(1);
    });
    await state.refresh();
    expect(read).toEqual(["codex", "claude"]);
  });

  it("drops a reading for a provider switched off while it was read", async () => {
    const { reads, read } = heldReads();
    const state = createState(read);
    const refreshed = state.refresh();
    await state.setProviderEnabled("codex", false);
    for (const { release } of reads) release(ready(42));
    expect(home(await refreshed, "codex")).toBeUndefined();
    expect(home(await refreshed, "claude")?.status).toBe("ready");
  });

  it("drops a provider's accounts when it is switched off or moved to a hub", async () => {
    const state = createState(
      async () => ready(42),
      () => {},
      async () => [hubAccount(17)],
    );
    await state.refresh();
    await state.setProviderEnabled("codex", false);
    expect(home(state.snapshot, "codex")).toBeUndefined();
    await state.setProviderEnabled("codex", true);
    expect(home(state.snapshot, "codex")?.seven_day.used_percent).toBe(42);
    await state.addProxyHub({ label: hubConfig.label, url: hubConfig.url, managementKey: hubConfig.managementKey });
    expect(state.snapshot.enabled.codex).toBe(false);
    expect(home(state.snapshot, "codex")).toBeUndefined();
    expect(state.snapshot.proxy_hubs[0].accounts[0].usage.seven_day.used_percent).toBe(17);
  });

  it("folds a refresh asked for mid-read into one more pass that both callers get", async () => {
    const { reads, read } = heldReads();
    const published: UsageSnapshot[] = [];
    const state = createState(read, (snapshot) => published.push(snapshot));
    const first = state.refresh();
    const second = state.refresh();
    expect(second).toBe(first);
    for (const { release } of reads.splice(0)) release(ready(1));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve));
    expect(reads).toHaveLength(2);
    for (const { release } of reads) release(ready(2));
    expect(home(await first, "codex")?.seven_day.used_percent).toBe(2);
    expect(published.at(-1)).toBe(await first);
  });

  it("keeps nothing read while paused and starts no read", async () => {
    const { reads, read } = heldReads();
    const published: UsageSnapshot[] = [];
    const state = createState(read, (snapshot) => published.push(snapshot));
    const refreshed = state.refresh();
    state.paused = true;
    for (const { release } of reads) release(ready(42));
    expect(home(await refreshed, "codex")?.status).toBe("loading");
    await state.refresh();
    expect(reads).toHaveLength(2);
  });

  it("reads a provider switched on during a refresh", async () => {
    const { reads, read } = heldReads();
    const state = createState(read);
    const refreshed = state.refresh();
    const enabled = state.setProviderEnabled("opencode", true);
    for (const { release } of reads.splice(0)) release(ready(1));
    await new Promise((resolve) => setTimeout(resolve));
    expect(reads.map(({ id }) => id)).toEqual(["codex", "claude", "opencode"]);
    for (const { release } of reads) release(ready(3));
    expect(home(await enabled, "opencode")?.status).toBe("ready");
    expect(await refreshed).toBe(await enabled);
  });

  it("keeps the current snapshot when the choice cannot be saved", async () => {
    const path = settingsPath();
    const state = new UsageState(
      path,
      join(path, "..", "proxy-hubs.json"),
      null,
      async () => homeReading(ready(42)),
      async () => [],
      () => {},
      paceTracker(),
    );
    await state.refresh();
    const directory = join(path, "..");
    rmSync(directory, { recursive: true });
    writeFileSync(directory, "not a directory");
    await expect(state.setProviderEnabled("codex", false)).rejects.toThrow();
    expect(state.snapshot.enabled.codex).toBe(true);
    expect(home(state.snapshot, "codex")?.seven_day.used_percent).toBe(42);
  });

  it("reads a hub before saving it and returns only redacted settings", async () => {
    const providers = settingsPath();
    const hubs = join(providers, "..", "proxy-hubs.json");
    let reads = 0;
    const state = new UsageState(
      providers,
      hubs,
      null,
      async () => homeReading(ready(1)),
      async () => {
        reads += 1;
        return [hubAccount(42)];
      },
      () => {},
      paceTracker(),
    );
    const settings = await state.addProxyHub({
      label: "Home hub",
      url: "http://hub.test:8317",
      managementKey: "secret",
    });
    expect(JSON.stringify(settings)).not.toContain("secret");
    expect(readFileSync(hubs, "utf8")).toContain("secret");
    expect(reads).toBe(1);
    expect(state.snapshot.proxy_hubs[0]?.accounts[0]?.usage.seven_day.used_percent).toBe(42);
  });

  it("does not save a hub that rejects the management key", async () => {
    const providers = settingsPath();
    const hubs = join(providers, "..", "proxy-hubs.json");
    const state = new UsageState(
      providers,
      hubs,
      null,
      async () => homeReading(ready(1)),
      async () => {
        throw new ProxyHubRejected("The hub rejected the management key.");
      },
      () => {},
      paceTracker(),
    );
    await expect(
      state.addProxyHub({ label: "Home hub", url: "http://hub.test:8317", managementKey: "wrong" }),
    ).rejects.toThrow("The hub rejected the management key.");
    expect(() => readFileSync(hubs)).toThrow();
    expect(state.proxyHubs()).toEqual([]);
    expect(state.snapshot.proxy_hubs).toEqual([]);
  });

  it("edits a hub, reading it only when the URL or key changes and keeping the key on its own server", async () => {
    const providers = settingsPath();
    const hubs = join(providers, "..", "proxy-hubs.json");
    saveSettings(hubs, [hubConfig]);
    const keys: string[] = [];
    const state = new UsageState(
      providers,
      hubs,
      null,
      async () => homeReading(ready(1)),
      async (config) => {
        keys.push(config.managementKey);
        if (config.managementKey === "wrong") throw new ProxyHubRejected("The hub rejected the management key.");
        return [hubAccount(42)];
      },
      () => {},
      paceTracker(),
    );
    await state.refresh();

    const renamed = await state.updateProxyHub("hub", { label: "Work hub", url: hubConfig.url, managementKey: "" });
    expect(renamed).toEqual([{ id: "hub", label: "Work hub", url: hubConfig.url, enabled: true }]);
    expect(state.snapshot.proxy_hubs[0]?.label).toBe("Work hub");
    expect(keys).toEqual(["management-secret"]);

    await state.updateProxyHub("hub", { label: "Work hub", url: `${hubConfig.url}/`, managementKey: "" });
    expect(keys).toEqual(["management-secret"]);

    await expect(
      state.updateProxyHub("hub", { label: "Work hub", url: "http://elsewhere.test:8317", managementKey: "" }),
    ).rejects.toThrow("Enter the management key again for the new hub address.");

    await expect(
      state.updateProxyHub("hub", { label: "Work hub", url: hubConfig.url, managementKey: "wrong" }),
    ).rejects.toThrow("The hub rejected the management key.");
    expect(readFileSync(hubs, "utf8")).toContain("management-secret");

    await state.updateProxyHub("hub", { label: "Work hub", url: hubConfig.url, managementKey: "rotated" });
    expect(keys).toEqual(["management-secret", "wrong", "rotated"]);
    expect(readFileSync(hubs, "utf8")).toContain("rotated");
    expect(state.snapshot.proxy_hubs[0]?.status).toBe("ready");
  });

  it("keeps a hub run going through a rename but stops it when the key changes", async () => {
    const providers = settingsPath();
    const hubs = join(providers, "..", "proxy-hubs.json");
    saveSettings(hubs, [hubConfig]);
    const state = new UsageState(
      providers,
      hubs,
      null,
      async () => homeReading(ready(1)),
      async () => [hubAccount(42)],
      () => {},
      paceTracker(),
    );
    await state.refresh();
    const checks: string[] = [];
    await state.withProxyHub("hub", async (_config, ensureAvailable) => {
      await state.updateProxyHub("hub", { label: "Work hub", url: hubConfig.url, managementKey: "" });
      ensureAvailable();
      checks.push("renamed");
      await state.updateProxyHub("hub", { label: "Work hub", url: hubConfig.url, managementKey: "rotated" });
      expect(ensureAvailable).toThrow("The hub is not available.");
      checks.push("rotated");
    });
    expect(checks).toEqual(["renamed", "rotated"]);
  });

  it("stops reading a hub that rejected its key until it is switched back on", async () => {
    const providers = settingsPath();
    const hubs = join(providers, "..", "proxy-hubs.json");
    saveSettings(hubs, [hubConfig]);
    let reads = 0;
    const state = new UsageState(
      providers,
      hubs,
      null,
      async () => homeReading(ready(1)),
      async () => {
        reads += 1;
        throw new ProxyHubRejected("The hub rejected the management key.");
      },
      () => {},
      paceTracker(),
    );
    await state.refresh();
    const snapshot = await state.refresh();
    expect(reads).toBe(1);
    expect(snapshot.proxy_hubs[0]?.status).toBe("rejected");
    expect(snapshot.proxy_hubs[0]?.error_message).toBe("The hub rejected the management key.");
    expect(settled(snapshot)).toBe(true);
    state.setProxyHubEnabled("hub", false);
    state.setProxyHubEnabled("hub", true);
    await state.refresh();
    expect(reads).toBe(2);
  });

  it("enables and disables the whole hub without individual provider settings", async () => {
    const providers = settingsPath();
    const hubs = join(providers, "..", "proxy-hubs.json");
    saveSettings(hubs, [hubConfig]);
    let reads = 0;
    const state = new UsageState(
      providers,
      hubs,
      null,
      async () => homeReading(ready(1)),
      async () => {
        reads += 1;
        return [hubAccount(42)];
      },
      () => {},
      paceTracker(),
    );
    await state.refresh();
    expect(state.setProxyHubEnabled("hub", false)[0]?.enabled).toBe(false);
    expect(state.snapshot.proxy_hubs).toEqual([]);
    await state.refresh();
    expect(reads).toBe(1);
    expect(state.setProxyHubEnabled("hub", true)[0]?.enabled).toBe(true);
    await state.refresh();
    expect(state.snapshot.proxy_hubs[0]?.accounts).toHaveLength(1);
  });

  it("keeps a refusal that lands while another hub changes", async () => {
    const providers = settingsPath();
    const hubs = join(providers, "..", "proxy-hubs.json");
    saveSettings(hubs, [hubConfig, { ...hubConfig, id: "work", enabled: false }]);
    let refuse = () => {};
    const state = new UsageState(
      providers,
      hubs,
      null,
      async () => homeReading(ready(1)),
      (config) =>
        config.id === "hub"
          ? new Promise<ProxyHubAccount[]>((_resolve, reject) => {
              refuse = () => reject(new ProxyHubRejected("The hub rejected the management key."));
            })
          : Promise.resolve([hubAccount(42)]),
      () => {},
      paceTracker(),
    );
    const refresh = state.refresh();
    state.setProxyHubEnabled("work", true);
    refuse();
    await refresh;
    expect(state.snapshot.proxy_hubs.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "hub", status: "rejected" },
      { id: "work", status: "ready" },
    ]);
  });

  it("does not restore a hub removed while its read is in flight", async () => {
    const providers = settingsPath();
    const hubs = join(providers, "..", "proxy-hubs.json");
    saveSettings(hubs, [hubConfig]);
    let release = (_accounts: ProxyHubAccount[]) => {};
    const state = new UsageState(
      providers,
      hubs,
      null,
      async () => homeReading(ready(1)),
      () => new Promise<ProxyHubAccount[]>((resolve) => (release = resolve)),
      () => {},
      paceTracker(),
    );
    const refresh = state.refresh();
    state.removeProxyHub("hub");
    release([hubAccount(42)]);
    expect((await refresh).proxy_hubs).toEqual([]);
  });
});

describe("sign-in sources", () => {
  const wsl = (usage: ProviderUsage | Error): DirectReading => ({
    id: "wsl:Ubuntu:/home/a",
    distribution: "Ubuntu",
    usage,
  });

  /** A Windows host whose reads finish only when the test releases them. */
  function windowsState() {
    const reads: { sources: SignInSettings; release: (readings: DirectReading[]) => void }[] = [];
    const providers = settingsPath();
    const signIns = join(providers, "..", "sign-ins.json");
    const state = new UsageState(
      providers,
      join(providers, "..", "proxy-hubs.json"),
      signIns,
      (_provider, sources) => new Promise((release) => reads.push({ sources, release })),
      async () => [],
      () => {},
      paceTracker(join(providers, "..")),
    );
    return { state, reads, signIns };
  }

  it("shows every sign-in found as its own account, and a provider with none as signed out", async () => {
    const { state, reads } = windowsState();
    const refreshed = state.refresh();
    expect(state.snapshot.sign_ins).toEqual({ windows: true, wsl: true });
    reads[0]?.release([...homeReading(ready(10)), wsl(ready(20))]);
    reads[1]?.release([]);
    const snapshot = await refreshed;
    expect(
      snapshot.accounts.map(({ provider, distribution, usage }) => [provider, distribution, usage.status]),
    ).toEqual([
      ["codex", null, "ready"],
      ["codex", "Ubuntu", "ready"],
      ["claude", null, "auth_missing"],
    ]);
  });

  it("drops a source's accounts at once and reads again with the new choice", async () => {
    const { state, reads, signIns } = windowsState();
    const first = state.refresh();
    for (const { release } of reads.splice(0)) release([...homeReading(ready(10)), wsl(ready(20))]);
    await first;
    const switched = state.setSignInSource("wsl", false);
    expect(state.snapshot.accounts.every(({ distribution }) => distribution === null)).toBe(true);
    expect(JSON.parse(readFileSync(signIns, "utf8"))).toEqual({ windows: true, wsl: false });
    expect(reads.map(({ sources }) => sources)).toEqual([
      { windows: true, wsl: false },
      { windows: true, wsl: false },
    ]);
    for (const { release } of reads.splice(0)) release(homeReading(ready(11)));
    expect((await switched).accounts).toHaveLength(2);
  });

  it("drops a read that started before a source was switched", async () => {
    const { state, reads } = windowsState();
    const refreshed = state.refresh();
    const stale = reads.splice(0);
    const switched = state.setSignInSource("windows", false);
    for (const { release } of stale) release([...homeReading(ready(10)), wsl(ready(20))]);
    await new Promise((resolve) => setTimeout(resolve));
    expect(state.snapshot.accounts).toEqual([]);
    expect(reads.map(({ sources }) => sources.windows)).toEqual([false, false]);
    for (const { release } of reads.splice(0)) release([wsl(ready(30))]);
    expect(await switched).toBe(await refreshed);
    expect(state.snapshot.accounts.map(({ distribution }) => distribution)).toEqual(["Ubuntu", "Ubuntu"]);
  });
});

describe("failed readings", () => {
  it("keep a previous reading as stale and tell a missing login from a failure", () => {
    expect(applyReading(ready(5), new ReadFailure("timeout")).status).toBe("stale");
    expect(applyReading(ready(5), new ReadFailure("timeout")).seven_day.used_percent).toBe(5);
    expect(applyReading(emptyProviderUsage(), new ReadFailure("missingToken")).status).toBe("auth_missing");
    const failed = applyReading(emptyProviderUsage(), new ReadFailure("response"));
    expect(failed.status).toBe("error");
    expect(failed.error_message).toBe("The usage service returned an unexpected response");
  });

  it("keeps prior account usage stale while distinguishing an empty hub from a failed listing", () => {
    const previous: ProxyHubSnapshot = {
      ...emptyProxyHubSnapshot(hubConfig),
      accounts: [hubAccount(23)],
      last_successful_update_epoch: 1,
      status: "ready",
    };
    const failedAccount = hubAccount(0);
    failedAccount.usage = { ...emptyProviderUsage(), status: "error", error_message: "Account failed." };
    const partial = applyHubReading(previous, hubConfig, [failedAccount]);
    expect(partial.accounts[0]?.usage.status).toBe("stale");
    expect(partial.accounts[0]?.usage.seven_day.used_percent).toBe(23);

    const failed = applyHubReading(previous, hubConfig, new Error("secret response"));
    expect(failed.status).toBe("stale");
    expect(failed.accounts).toHaveLength(1);
    expect(failed.accounts[0]?.usage.status).toBe("stale");
    expect(failed.accounts[0]?.usage.seven_day.used_percent).toBe(23);
    expect(failed.error_message).not.toContain("secret response");

    const empty = applyHubReading(previous, hubConfig, []);
    expect(empty.status).toBe("ready");
    expect(empty.accounts).toEqual([]);
  });
});

describe("polling", () => {
  it("retries a failure sooner and climbs back to the normal interval", () => {
    const waits: number[] = [];
    let backoff: number | null = null;
    for (let attempt = 0; attempt < 9; attempt++) {
      backoff = nextBackoff(false, backoff, 5000, 300_000);
      if (backoff !== null) waits.push(backoff);
    }
    expect(waits.slice(0, 3)).toEqual([5000, 10_000, 20_000]);
    expect(waits.at(-1)).toBe(300_000);
    expect(nextBackoff(true, backoff, 5000, 300_000)).toBeNull();
  });

  it("retries only what failed until a full interval has passed", async () => {
    const reads: ProviderId[][] = [[]];
    const state = createState(async (id) => {
      reads.at(-1)!.push(id);
      if (id === "codex") throw new Error("Down");
      return ready(1);
    });
    const waits: number[] = [];
    let clock = 0;
    await pollUsage(
      state,
      async (milliseconds) => {
        waits.push(milliseconds);
        if (waits.length === 7) throw new Error("stop");
        // Each retry takes a second, which counts toward the interval too.
        clock += milliseconds + 1000;
        reads.push([]);
      },
      () => clock,
    ).catch(() => {});
    expect(waits).toEqual([5000, 10_000, 20_000, 40_000, 80_000, 140_000, 300_000]);
    expect(reads).toEqual([
      ["codex", "claude"],
      ["codex"],
      ["codex"],
      ["codex"],
      ["codex"],
      ["codex"],
      ["codex", "claude"],
    ]);
  });

  it("waits a full interval after a refresh asked for in between", async () => {
    const readAt: number[] = [];
    let clock = 0;
    const state = createState(async (id) => {
      if (id === "codex") readAt.push(clock);
      return ready(1);
    });
    const waits: number[] = [];
    await pollUsage(
      state,
      async (milliseconds, wake) => {
        waits.push(milliseconds);
        if (waits.length === 3) throw new Error("stop");
        if (waits.length > 1) return void (clock += milliseconds);
        clock += 120_000;
        await state.refresh();
        if (!wake.aborted) clock += milliseconds - 120_000;
      },
      () => clock,
    ).catch(() => {});
    expect(waits).toEqual([300_000, 300_000, 300_000]);
    expect(readAt).toEqual([0, 120_000, 420_000]);
  });

  it("starts the retry backoff over after a refresh asked for in between", async () => {
    const state = createState(async (id) => {
      if (id === "codex") throw new Error("Down");
      return ready(1);
    });
    const waits: number[] = [];
    let clock = 0;
    await pollUsage(
      state,
      async (milliseconds) => {
        waits.push(milliseconds);
        if (waits.length === 5) throw new Error("stop");
        if (waits.length === 3) await state.refresh();
        else clock += milliseconds;
      },
      () => clock,
    ).catch(() => {});
    expect(waits).toEqual([5000, 10_000, 20_000, 5000, 10_000]);
  });

  it("holds back while any direct sign-in has no current reading", () => {
    const snapshot: UsageSnapshot = {
      enabled: { codex: true, claude: true, opencode: false },
      sign_ins: null,
      accounts: [account("codex", ready(1)), account("claude", { ...emptyProviderUsage(), status: "error" })],
      proxy_hubs: [],
      pace: { settings: defaultPaceSettings, windows: {} },
    };
    expect(settled(snapshot)).toBe(false);
    expect(settled({ ...snapshot, accounts: snapshot.accounts.slice(0, 1) })).toBe(true);
  });

  it("retries failed hub accounts but accepts a successful empty hub", () => {
    const snapshot: UsageSnapshot = {
      enabled: { codex: true, claude: true, opencode: false },
      sign_ins: null,
      accounts: [account("codex", ready(1)), account("claude", ready(1))],
      proxy_hubs: [
        {
          ...emptyProxyHubSnapshot(hubConfig),
          status: "ready",
          accounts: [{ ...hubAccount(1), usage: { ...emptyProviderUsage(), status: "error" } }],
        },
      ],
      pace: { settings: defaultPaceSettings, windows: {} },
    };
    expect(settled(snapshot)).toBe(false);
    expect(settled({ ...snapshot, proxy_hubs: [{ ...snapshot.proxy_hubs[0]!, accounts: [] }] })).toBe(true);
  });
});

it("preserves a hub account's typed sign-in failure across cached readings", () => {
  const previous = { ...emptyProxyHubSnapshot(hubConfig), accounts: [hubAccount(23)] };
  const failed = hubAccount(0);
  failed.usage = { ...emptyProviderUsage(), status: "error", error_reason: "rejected", error_message: "rejected" };
  const result = applyHubReading(previous, hubConfig, [failed]);
  expect(result.accounts[0]?.usage).toMatchObject({ status: "stale", error_reason: "rejected" });
});

it("uses hub providers exclusively and explains automatic and blocked switches", async () => {
  const notices: string[] = [];
  const providers = settingsPath();
  const hubs = join(providers, "..", "proxy-hubs.json");
  const accounts = [hubAccount(42), { ...hubAccount(16), id: "claude.json", provider: "claude" as const }];
  const state = new UsageState(
    providers,
    hubs,
    null,
    async () => homeReading(ready(1)),
    async () => accounts,
    () => {},
    paceTracker(),
    (message) => notices.push(message),
  );
  await state.addProxyHub({ label: "Hub", url: hubConfig.url, managementKey: hubConfig.managementKey });
  expect(state.snapshot.enabled).toEqual({ codex: false, claude: false, opencode: false });
  expect(JSON.parse(readFileSync(providers, "utf8"))).toEqual(state.snapshot.enabled);
  expect(notices).toHaveLength(1);
  expect(notices[0]).toContain("Codex and Claude");
  await state.setProviderEnabled("claude", true);
  expect(state.snapshot.enabled.claude).toBe(false);
  expect(notices.at(-1)).toContain("Remove Hub or remove Claude from it first");
  state.setProxyHubEnabled(state.proxyHubs()[0].id, false);
  await state.setProviderEnabled("claude", true);
  expect(state.snapshot.enabled.claude).toBe(false);
  state.setProxyHubEnabled(state.proxyHubs()[0].id, true);
  expect(state.snapshot.enabled.claude).toBe(false);
  await state.refresh();
  state.removeProxyHub(state.proxyHubs()[0].id);
  await state.setProviderEnabled("claude", true);
  expect(state.snapshot.enabled.claude).toBe(true);
});

it("discovers hub providers before polling direct and releases a removed provider", async () => {
  const providers = settingsPath();
  const hubs = join(providers, "..", "proxy-hubs.json");
  saveSettings(hubs, [hubConfig]);
  const read: ProviderId[] = [];
  let accounts = [hubAccount(42)];
  const state = new UsageState(
    providers,
    hubs,
    null,
    async (id) => {
      read.push(id);
      return homeReading(ready(1));
    },
    async () => accounts,
    () => {},
    paceTracker(),
  );
  await state.refresh();
  expect(read).toEqual(["claude"]);
  expect(state.snapshot.enabled.codex).toBe(false);
  expect(state.snapshot.enabled.claude).toBe(true);
  accounts = [];
  await state.refresh();
  await state.setProviderEnabled("codex", true);
  expect(state.snapshot.enabled.codex).toBe(true);
});

it("publishes direct readings without waiting for a hub whose roster is known", async () => {
  const providers = settingsPath();
  const hubs = join(providers, "..", "proxy-hubs.json");
  saveSettings(hubs, [{ ...hubConfig, providers: ["codex"] }]);
  let releaseHub = (_accounts: ProxyHubAccount[]) => {};
  const published: UsageSnapshot[] = [];
  const state = new UsageState(
    providers,
    hubs,
    null,
    async () => homeReading(ready(7)),
    () => new Promise((release) => (releaseHub = release)),
    (snapshot) => published.push(snapshot),
    paceTracker(),
  );
  const refreshed = state.refresh();
  await new Promise((resolve) => setTimeout(resolve));
  expect(home(published.at(-1), "claude")?.status).toBe("ready");
  expect(published.at(-1)?.proxy_hubs[0]?.status).toBe("loading");
  releaseHub([hubAccount(42)]);
  expect((await refreshed).proxy_hubs[0]?.status).toBe("ready");
});

it("corrects a conflicting choice on the enabling read when the hub roster is unknown", async () => {
  const notices: string[] = [];
  const providers = settingsPath();
  const hubs = join(providers, "..", "proxy-hubs.json");
  saveSettings(hubs, [hubConfig]);
  const hubReads: ProxyHubAccount[][] = [];
  const state = new UsageState(
    providers,
    hubs,
    null,
    async () => homeReading(ready(1)),
    async () => {
      const accounts = [hubAccount(42)];
      hubReads.push(accounts);
      return accounts;
    },
    () => {},
    paceTracker(),
    (message) => notices.push(message),
  );
  await state.setProviderEnabled("codex", true);
  expect(hubReads).toHaveLength(1);
  expect(state.snapshot.enabled.codex).toBe(false);
  expect(notices.at(-1)).toContain("switched off because");
});

it("keeps known hub ownership across rejection and restart", async () => {
  const providers = settingsPath();
  const hubs = join(providers, "..", "proxy-hubs.json");
  saveSettings(hubs, [{ ...hubConfig, providers: ["codex"] }]);
  const state = new UsageState(
    providers,
    hubs,
    null,
    async () => homeReading(ready(1)),
    async () => {
      throw new ProxyHubRejected("Refused");
    },
    () => {},
    paceTracker(),
  );
  expect(state.snapshot.enabled.codex).toBe(false);
  await state.refresh();
  await state.setProviderEnabled("codex", true);
  expect(state.snapshot.enabled.codex).toBe(false);
  state.removeProxyHub("hub");
  await state.setProviderEnabled("codex", true);
  expect(state.snapshot.enabled.codex).toBe(true);
});
