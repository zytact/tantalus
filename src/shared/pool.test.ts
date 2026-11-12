import { describe, expect, it } from "vite-plus/test";
import { defaultPaceSettings } from "./pace";
import { poolWindows, providerPools } from "./pool";
import { emptyProviderUsage, fiveHourSeconds, homeSignIn, monthlySeconds, sevenDaySeconds } from "./usage";
import type { DirectAccount, ProviderUsage, ProxyHubAccount, UsageSnapshot } from "./usage";

const now = 100_000;
const window = (seconds: number, used: number | null, reset: number | null = null) => ({
  used_percent: used,
  limit_window_seconds: seconds,
  reset_at_epoch: reset,
});
const usage = (fields: Partial<ProviderUsage>): ProviderUsage => ({ ...emptyProviderUsage(), ...fields });
const direct = (fields: Partial<ProviderUsage>, id = homeSignIn): DirectAccount => ({
  id,
  provider: "claude",
  distribution: null,
  usage: usage(fields),
});
const hubAccount = (id: string, fields: Partial<ProviderUsage>): ProxyHubAccount => ({
  id,
  email: `${id}@example.com`,
  plan: "Max 5x",
  provider: "claude",
  usage: usage(fields),
});
const snapshot = (accounts: DirectAccount[], hubs: ProxyHubAccount[][] = []): UsageSnapshot => ({
  enabled: { codex: true, claude: true, opencode: true },
  sign_ins: null,
  accounts,
  proxy_hubs: hubs.map((hubAccounts, index) => ({
    id: `hub${index}`,
    url: "http://hub.test",
    label: `Hub ${index}`,
    accounts: hubAccounts,
    last_successful_update_epoch: null,
    status: "ready",
    error_message: null,
  })),
  pace: { settings: defaultPaceSettings, windows: {} },
});
const pooled = (accounts: DirectAccount[], hubs: ProxyHubAccount[][] = []) => {
  const [pool] = providerPools(snapshot(accounts, hubs));
  if (!pool) throw new Error("No pool.");
  return { pool, windows: poolWindows(pool, now) };
};

describe("provider pools", () => {
  it("pools a provider's direct sign-ins and hub accounts, lending a hub account its email and plan", () => {
    const { pool } = pooled([direct({})], [[hubAccount("a", {})], [hubAccount("b", {})]]);
    expect(pool.accounts.map(({ key, hub, usage }) => [key, hub, usage.email, usage.plan])).toEqual([
      ["claude:home", null, null, null],
      ["hub0:claude:a", "Hub 0", "a@example.com", "Max 5x"],
      ["hub1:claude:b", "Hub 1", "b@example.com", "Max 5x"],
    ]);
  });

  it("counts an account read twice once, by its newest reading, keeping the email and plan either knows", () => {
    const { pool } = pooled(
      [direct({ account_key: "same", last_successful_update_epoch: 30 })],
      [[hubAccount("a", { account_key: "same", last_successful_update_epoch: 20 })], [hubAccount("c", {})]],
    );
    expect(pool.accounts.map(({ key, usage }) => [key, usage.email, usage.plan])).toEqual([
      ["claude:home", "a@example.com", "Max 5x"],
      ["hub1:claude:c", "c@example.com", "Max 5x"],
    ]);
  });

  it("keeps workspace members sharing an account ID apart, however old each reading is", () => {
    const members = (epoch: number) =>
      pooled(
        [direct({ account_key: "same", last_successful_update_epoch: epoch })],
        [
          [
            hubAccount("a", { account_key: "same", last_successful_update_epoch: 20 }),
            hubAccount("b", { account_key: "same", last_successful_update_epoch: 10 }),
          ],
          [hubAccount("a", { account_key: "same", last_successful_update_epoch: 30 })],
        ],
      ).pool.accounts.map(({ key }) => key);
    // The direct sign-in names no email, so it could be either member and stays apart.
    const expected = ["claude:home", "hub1:claude:a", "hub0:claude:b"];
    expect([members(5), members(25), members(40)]).toEqual([expected, expected, expected]);
  });
});

describe("pool windows", () => {
  it("means what each account has left, over the accounts that report the window", () => {
    const { windows } = pooled([
      direct({ five_hour: window(fiveHourSeconds, 80), seven_day: window(sevenDaySeconds, 10) }),
      direct({ five_hour: window(fiveHourSeconds, 20) }, "b"),
      direct({ five_hour: window(fiveHourSeconds, null), monthly: window(monthlySeconds, 30) }, "c"),
    ]);
    expect(windows.map(({ slot, remaining }) => [slot, remaining])).toEqual([
      ["five_hour", 50],
      ["seven_day", 90],
      ["monthly", 70],
    ]);
    expect(windows[1]?.columns.map((column) => column !== null)).toEqual([true, false, false]);
  });

  it("shows a window that has reset since it was read as full and unstarted, and has no figure before a reading", () => {
    const { windows } = pooled([
      direct({ five_hour: window(fiveHourSeconds, 80, now - 1), seven_day: window(sevenDaySeconds, null) }),
      direct({ five_hour: window(fiveHourSeconds, 140, now + 60) }, "b"),
    ]);
    expect(windows.map(({ remaining }) => remaining)).toEqual([50, null]);
    expect(windows[0]?.columns[0]).toEqual(window(fiveHourSeconds, 0));
  });

  it("leaves a window that has reset out of the pool's pace", () => {
    const half = now + fiveHourSeconds / 2;
    const { windows } = pooled([
      direct({ five_hour: window(fiveHourSeconds, 80, now - 1) }),
      direct({ five_hour: window(fiveHourSeconds, 50, half) }, "b"),
    ]);
    expect(windows[0]?.pace).toMatchObject({ status: "on", expectedPercent: 50 });
  });

  it("names the reset that lands first and the share of the pool it hands back", () => {
    const { windows } = pooled([
      direct({ five_hour: window(fiveHourSeconds, 60, now + 900) }),
      direct({ five_hour: window(fiveHourSeconds, 30, now + 300) }, "b"),
      direct({ five_hour: window(fiveHourSeconds, 0, now + 60) }, "c"),
    ]);
    expect(windows[0]?.next).toEqual({ index: 1, resetAt: now + 300, restores: 10 });
  });

  it("judges the pool's pace over the accounts with a reset time", () => {
    const half = now + fiveHourSeconds / 2;
    const { windows } = pooled([
      direct({ five_hour: window(fiveHourSeconds, 90, half) }),
      direct({ five_hour: window(fiveHourSeconds, 20, half) }, "b"),
      direct({ five_hour: window(fiveHourSeconds, 0) }, "c"),
    ]);
    expect(windows[0]?.pace).toMatchObject({ status: "ahead", expectedPercent: 50 });
  });
});
