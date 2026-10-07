import { describe, expect, it } from "vite-plus/test";
import { defaultPaceSettings } from "./pace";
import { trayUsageOptions, trayUsageReading } from "./tray-usage";
import { emptyProviderUsage, fiveHourSeconds, monthlySeconds, sevenDaySeconds } from "./usage";
import type { ProviderUsage, ProxyHubAccount, UsageSnapshot } from "./usage";

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

const snapshot: UsageSnapshot = {
  codex: usage({ seven_day: window(sevenDaySeconds, 80), monthly: window(monthlySeconds, 30) }),
  claude: usage({ five_hour: window(fiveHourSeconds, 42), seven_day: window(sevenDaySeconds, 10) }),
  opencode: usage({ five_hour: window(fiveHourSeconds, 5) }),
  enabled: { codex: true, claude: true, opencode: false },
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
      ["codex", "Codex", null],
      ["claude", "Claude", null],
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
    const unread = { ...snapshot, claude: usage({ five_hour: window(fiveHourSeconds, null) }) };
    expect(trayUsageReading(unread, { enabled: true, source: "claude" }, now)).toBeNull();
  });
});
