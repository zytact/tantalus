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
  it("offers a pool for every provider with several accounts, then every account", () => {
    expect(trayUsageOptions(snapshot, now).map(({ key, name }) => [key, name.title, name.email])).toEqual([
      ["codex", "Codex · All 2 accounts", null],
      ["claude", "Claude · All 3 accounts", null],
      ["codex:home", "Codex", null],
      ["claude:home", "Claude", null],
      ["hub:claude:a", "Work · Claude", "a@example.com"],
      ["hub:claude:b", "Work · Claude 2", null],
      ["hub:codex:c", "Work · Codex 1", null],
    ]);
  });

  it("shows the mean of what a pool's accounts have left, across direct sign-ins and hubs", () => {
    expect(trayUsageReading(snapshot, { enabled: true, source: "claude" }, now)).toMatchObject({
      span: "5h",
      remaining: (58 + 39 + 93) / 3,
    });
    // The direct Codex account has no 5-hour window, so the pool's 5-hour figure is the hub account's.
    expect(trayUsageReading(snapshot, { enabled: true, source: "codex" }, now)).toMatchObject({
      span: "5h",
      remaining: 50,
    });
  });

  it("reads a hub's own pool, saved before pools spanned hubs, as the provider's pool", () => {
    expect(trayUsageReading(snapshot, { enabled: true, source: "hub:claude" }, now)).toMatchObject({
      name: { title: "Claude · All 3 accounts" },
    });
  });

  it("shows the monthly window for an account without a 5-hour one", () => {
    expect(trayUsageReading(snapshot, { enabled: true, source: "codex:home" }, now)).toMatchObject({
      span: "30d",
      remaining: 70,
    });
    expect(trayUsageReading(snapshot, { enabled: true, source: "claude:home" }, now)).toMatchObject({
      span: "5h",
      remaining: 58,
    });
  });

  it("shows the saved hub account, or the first option when none is saved", () => {
    expect(trayUsageReading(snapshot, { enabled: true, source: "hub:claude:b" }, now)).toMatchObject({ remaining: 93 });
    expect(trayUsageReading(snapshot, { enabled: true, source: null }, now)).toMatchObject({ provider: "codex" });
  });

  it("keeps the plain icon when off, when the account is gone or before a reading", () => {
    expect(trayUsageReading(snapshot, { enabled: false, source: "claude" }, now)).toBeNull();
    expect(trayUsageReading(snapshot, { enabled: true, source: "opencode" }, now)).toBeNull();
    expect(trayUsageReading(snapshot, { enabled: true, source: "claude:gone" }, now)).toBeNull();
    const unread = { ...snapshot, accounts: [direct("claude", { five_hour: window(fiveHourSeconds, null) })] };
    expect(trayUsageReading({ ...unread, proxy_hubs: [] }, { enabled: true, source: "claude" }, now)).toBeNull();
  });

  it("reads a saved bare provider id as the only account when there is no pool", () => {
    const single = { ...snapshot, proxy_hubs: [] };
    expect(trayUsageOptions(single, now).map(({ key }) => key)).toEqual(["codex:home", "claude:home"]);
    expect(trayUsageReading(single, { enabled: true, source: "claude" }, now)).toMatchObject({ remaining: 58 });
  });
});
