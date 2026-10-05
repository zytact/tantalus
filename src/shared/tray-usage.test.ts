import { describe, expect, it } from "vite-plus/test";
import { defaultPaceSettings } from "./pace";
import { trayUsageOptions, trayUsageReading } from "./tray-usage";
import { emptyProviderUsage, fiveHourSeconds, monthlySeconds, sevenDaySeconds } from "./usage";
import type { ProviderUsage, ProxyHubAccount, UsageSnapshot } from "./usage";

const window = (seconds: number, used: number | null) => ({
  used_percent: used,
  limit_window_seconds: seconds,
  reset_at_epoch: null,
});
const usage = (fields: Partial<ProviderUsage>): ProviderUsage => ({ ...emptyProviderUsage(), ...fields });
const account = (id: string, provider: ProxyHubAccount["provider"], used: number): ProxyHubAccount => ({
  id,
  email: null,
  plan: null,
  provider,
  usage: usage({ five_hour: window(fiveHourSeconds, used) }),
});

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
      accounts: [account("a", "claude", 61), account("b", "claude", 7)],
      last_successful_update_epoch: null,
      status: "ready",
      error_message: null,
    },
  ],
  pace: { settings: defaultPaceSettings, windows: {} },
};

describe("tray usage", () => {
  it("offers every provider switched on and every hub account", () => {
    expect(trayUsageOptions(snapshot).map(({ key, label }) => [key, label])).toEqual([
      ["codex", "Codex"],
      ["claude", "Claude"],
      ["hub:claude:a", "Work · Claude 1"],
      ["hub:claude:b", "Work · Claude 2"],
    ]);
  });

  it("shows the monthly window for an account without a 5-hour one", () => {
    expect(trayUsageReading(snapshot, { enabled: true, source: "codex" })).toMatchObject({ span: "30d", used: 30 });
    expect(trayUsageReading(snapshot, { enabled: true, source: "claude" })).toMatchObject({ span: "5h", used: 42 });
  });

  it("shows the saved hub account, or the first account when none is saved", () => {
    expect(trayUsageReading(snapshot, { enabled: true, source: "hub:claude:b" })).toMatchObject({ used: 7 });
    expect(trayUsageReading(snapshot, { enabled: true, source: null })).toMatchObject({ provider: "codex" });
  });

  it("keeps the plain icon when off, when the account is gone or before a reading", () => {
    expect(trayUsageReading(snapshot, { enabled: false, source: "claude" })).toBeNull();
    expect(trayUsageReading(snapshot, { enabled: true, source: "opencode" })).toBeNull();
    const unread = { ...snapshot, claude: usage({ five_hour: window(fiveHourSeconds, null) }) };
    expect(trayUsageReading(unread, { enabled: true, source: "claude" })).toBeNull();
  });
});
