import { describe, expect, it } from "vite-plus/test";
import { defaultPaceSettings } from "./pace";
import { trayUsageOptions, trayUsageReading } from "./tray-usage";
import { emptyProviderUsage, fiveHourSeconds, homeSignIn, monthlySeconds, sevenDaySeconds } from "./usage";
import type { DirectAccount, ProviderId, ProviderUsage, ProxyHubAccount, UsageSnapshot } from "./usage";

const now = 1_000;
const window = (seconds: number, used: number | null, reset: number | null = null) => ({
  used_percent: used,
  limit_window_seconds: seconds,
  reset_at_epoch: reset,
});
const usage = (fields: Partial<ProviderUsage>): ProviderUsage => ({ ...emptyProviderUsage(), ...fields });
const account = (
  id: string,
  provider: ProxyHubAccount["provider"],
  five_hour = window(fiveHourSeconds, null),
  email: string | null = null,
): ProxyHubAccount => ({ id, email, plan: null, provider, usage: usage({ five_hour }) });

const direct = (provider: ProviderId, fields: Partial<ProviderUsage>, id = homeSignIn): DirectAccount => ({
  id,
  provider,
  distribution: id === homeSignIn ? null : "Ubuntu",
  usage: usage(fields),
});

const snapshot: UsageSnapshot = {
  enabled: { codex: true, claude: true, opencode: false },
  sign_ins: null,
  accounts: [
    direct("codex", { seven_day: window(sevenDaySeconds, 80), monthly: window(monthlySeconds, 30) }),
    direct("claude", { five_hour: window(fiveHourSeconds, 42), seven_day: window(sevenDaySeconds, 10) }),
  ],
  proxy_hubs: [
    {
      id: "hub",
      url: "http://hub",
      label: "Work",
      accounts: [
        account("a", "claude", window(fiveHourSeconds, 61), "a@example.com"),
        account("b", "claude", window(fiveHourSeconds, 7)),
        account("c", "codex", window(fiveHourSeconds, 50)),
      ],
      last_successful_update_epoch: null,
      status: "ready",
      error_message: null,
    },
  ],
  pace: { settings: defaultPaceSettings, windows: {} },
};

describe("tray usage", () => {
  it("offers every provider switched on, then each hub's pools and accounts", () => {
    expect(trayUsageOptions(snapshot, now).map(({ key, name }) => [key, name.title, name.email])).toEqual([
      ["codex:home", "Codex", null],
      ["claude:home", "Claude", null],
      ["hub:claude", "Work · Claude · All 2 accounts", null],
      ["hub:claude:a", "Work · Claude", "a@example.com"],
      ["hub:claude:b", "Work · Claude 2", null],
      ["hub:codex:c", "Work · Codex 1", null],
    ]);
  });

  it("sums a pool's remaining allowance, counting a window that has since reset as full", () => {
    const pool = (accounts: ProxyHubAccount[]) =>
      trayUsageReading(
        { ...snapshot, proxy_hubs: [{ ...snapshot.proxy_hubs[0], accounts }] },
        { enabled: true, source: "hub:codex" },
        now,
      );
    const codex = (id: string, used: number | null, reset: number | null = null) =>
      account(id, "codex", window(fiveHourSeconds, used, reset));
    expect(pool([codex("a", 80), codex("b", 20), codex("c", 50)])).toMatchObject({ remaining: 150, limit: 300 });
    expect(pool([codex("a", 80, now), codex("b", 20, now + 60)])).toMatchObject({ remaining: 180, limit: 200 });
    expect(pool([codex("a", 80), codex("b", null)])).toMatchObject({ remaining: 20, limit: 100 });
    expect(pool([codex("a", 140), codex("b", 20)])).toMatchObject({ remaining: 80, limit: 200 });
    expect(pool([codex("a", null), codex("b", null)])).toBeNull();
  });

  it("shows the monthly window for an account without a 5-hour one", () => {
    expect(trayUsageReading(snapshot, { enabled: true, source: "codex" }, now)).toMatchObject({
      span: "30d",
      remaining: 70,
    });
    expect(trayUsageReading(snapshot, { enabled: true, source: "claude" }, now)).toMatchObject({
      span: "5h",
      remaining: 58,
    });
  });

  it("shows the saved hub account, or the first account when none is saved", () => {
    expect(trayUsageReading(snapshot, { enabled: true, source: "hub:claude:b" }, now)).toMatchObject({ remaining: 93 });
    expect(trayUsageReading(snapshot, { enabled: true, source: null }, now)).toMatchObject({ provider: "codex" });
  });

  it("keeps the plain icon when off, when the account is gone or before a reading", () => {
    expect(trayUsageReading(snapshot, { enabled: false, source: "claude" }, now)).toBeNull();
    expect(trayUsageReading(snapshot, { enabled: true, source: "opencode" }, now)).toBeNull();
    const unread = { ...snapshot, accounts: [direct("claude", { five_hour: window(fiveHourSeconds, null) })] };
    expect(trayUsageReading(unread, { enabled: true, source: "claude" }, now)).toBeNull();
  });

  describe("with several direct sign-ins", () => {
    const signedIn: UsageSnapshot = {
      ...snapshot,
      proxy_hubs: [],
      accounts: [
        direct("claude", { email: "win@example.com", five_hour: window(fiveHourSeconds, 80) }),
        direct("claude", { five_hour: window(fiveHourSeconds, 20) }, "wsl:Ubuntu:/home/a"),
        direct("claude", { five_hour: window(fiveHourSeconds, 50, now - 1) }, "wsl:Debian:/root"),
      ],
    };

    it("leads with the provider's pool, then names each sign-in by provider and email", () => {
      expect(trayUsageOptions(signedIn, now).map(({ key, name }) => [key, name.title, name.email, name.label])).toEqual(
        [
          ["claude", "Claude · All 3 accounts", null, "Claude · All 3 accounts"],
          ["claude:home", "Claude", "win@example.com", "Claude 1"],
          ["claude:wsl:Ubuntu:/home/a", "Claude 2", null, "Claude 2"],
          ["claude:wsl:Debian:/root", "Claude 3", null, "Claude 3"],
        ],
      );
    });

    it("pools them like a hub, and reads a saved bare provider id as the pool", () => {
      expect(trayUsageReading(signedIn, { enabled: true, source: "claude" }, now)).toMatchObject({
        remaining: 20 + 80 + 100,
        limit: 300,
      });
    });

    it("reads a saved bare provider id as the only sign-in when there is no pool", () => {
      const single = { ...signedIn, accounts: signedIn.accounts.slice(1, 2) };
      expect(trayUsageReading(single, { enabled: true, source: "claude" }, now)).toMatchObject({ remaining: 80 });
    });
  });
});
