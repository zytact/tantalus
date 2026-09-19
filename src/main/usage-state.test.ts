import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { emptyProviderUsage, emptyProxyHubSnapshot } from "../shared/usage";
import type {
  ProviderId,
  ProviderUsage,
  ProxyHubAccount,
  ProxyHubConfig,
  ProxyHubSnapshot,
  UsageSnapshot,
} from "../shared/usage";
import { ReadFailure } from "./failure";
import { ProxyHubRejected } from "./proxy-hub-api";
import { saveSettings } from "./settings";
import { applyHubReading, applyReading, nextBackoff, settled, UsageState } from "./usage-state";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function settingsPath() {
  const directory = mkdtempSync(join(tmpdir(), "tantalus-state-"));
  directories.push(directory);
  return join(directory, "providers.json");
}

function createState(
  readProvider: (id: ProviderId) => Promise<ProviderUsage>,
  publish: (snapshot: UsageSnapshot) => void = () => {},
  readHub: (config: ProxyHubConfig) => Promise<ProxyHubAccount[]> = async () => [],
) {
  const providers = settingsPath();
  return new UsageState(providers, join(providers, "..", "proxy-hubs.json"), readProvider, readHub, publish);
}

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
    expect((await refreshed).codex.status).toBe("loading");
    expect((await refreshed).claude.status).toBe("ready");
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
    expect((await first).codex.seven_day.used_percent).toBe(2);
    expect(published).toHaveLength(1);
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
    expect((await enabled).opencode.status).toBe("ready");
    expect(await refreshed).toBe(await enabled);
  });

  it("keeps the current snapshot when the choice cannot be saved", async () => {
    const path = settingsPath();
    const state = new UsageState(
      path,
      join(path, "..", "proxy-hubs.json"),
      async () => ready(42),
      async () => [],
      () => {},
    );
    await state.refresh();
    const directory = join(path, "..");
    rmSync(directory, { recursive: true });
    writeFileSync(directory, "not a directory");
    expect(() => state.setProviderEnabled("codex", false)).toThrow();
    expect(state.snapshot.enabled.codex).toBe(true);
    expect(state.snapshot.codex.seven_day.used_percent).toBe(42);
  });

  it("reads a hub before saving it and returns only redacted settings", async () => {
    const providers = settingsPath();
    const hubs = join(providers, "..", "proxy-hubs.json");
    let reads = 0;
    const state = new UsageState(
      providers,
      hubs,
      async () => ready(1),
      async () => {
        reads += 1;
        return [hubAccount(42)];
      },
      () => {},
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
      async () => ready(1),
      async () => {
        throw new ProxyHubRejected("The hub rejected the management key.");
      },
      () => {},
    );
    await expect(
      state.addProxyHub({ label: "Home hub", url: "http://hub.test:8317", managementKey: "wrong" }),
    ).rejects.toThrow("The hub rejected the management key.");
    expect(() => readFileSync(hubs)).toThrow();
    expect(state.proxyHubs()).toEqual([]);
    expect(state.snapshot.proxy_hubs).toEqual([]);
  });

  it("stops reading a hub that rejected its key until it is switched back on", async () => {
    const providers = settingsPath();
    const hubs = join(providers, "..", "proxy-hubs.json");
    saveSettings(hubs, [hubConfig]);
    let reads = 0;
    const state = new UsageState(
      providers,
      hubs,
      async () => ready(1),
      async () => {
        reads += 1;
        throw new ProxyHubRejected("The hub rejected the management key.");
      },
      () => {},
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
      async () => ready(1),
      async () => {
        reads += 1;
        return [hubAccount(42)];
      },
      () => {},
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
      async () => ready(1),
      (config) =>
        config.id === "hub"
          ? new Promise<ProxyHubAccount[]>((_resolve, reject) => {
              refuse = () => reject(new ProxyHubRejected("The hub rejected the management key."));
            })
          : Promise.resolve([hubAccount(42)]),
      () => {},
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
      async () => ready(1),
      () => new Promise<ProxyHubAccount[]>((resolve) => (release = resolve)),
      () => {},
    );
    const refresh = state.refresh();
    state.removeProxyHub("hub");
    release([hubAccount(42)]);
    expect((await refresh).proxy_hubs).toEqual([]);
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

  it("does not hold back for a disabled provider", () => {
    const snapshot: UsageSnapshot = {
      codex: ready(1),
      claude: { ...emptyProviderUsage(), status: "error" },
      opencode: emptyProviderUsage(),
      enabled: { codex: true, claude: true, opencode: false },
      proxy_hubs: [],
    };
    expect(settled(snapshot)).toBe(false);
    expect(settled({ ...snapshot, enabled: { codex: true, claude: false, opencode: false } })).toBe(true);
  });

  it("retries failed hub accounts but accepts a successful empty hub", () => {
    const snapshot: UsageSnapshot = {
      codex: ready(1),
      claude: ready(1),
      opencode: emptyProviderUsage(),
      enabled: { codex: true, claude: true, opencode: false },
      proxy_hubs: [
        {
          ...emptyProxyHubSnapshot(hubConfig),
          status: "ready",
          accounts: [{ ...hubAccount(1), usage: { ...emptyProviderUsage(), status: "error" } }],
        },
      ],
    };
    expect(settled(snapshot)).toBe(false);
    expect(settled({ ...snapshot, proxy_hubs: [{ ...snapshot.proxy_hubs[0]!, accounts: [] }] })).toBe(true);
  });
});
