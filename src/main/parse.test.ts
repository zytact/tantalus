import { describe, expect, it } from "vite-plus/test";
import { monthlySeconds } from "../shared/usage";
import { parseClaudeUsage, parseCodexUsage, parseCredits, parseOpencodeUsage } from "./parse";

describe("codex usage", () => {
  it("maps windows by duration and parses a millisecond reset", () => {
    const usage = parseCodexUsage(
      {
        rate_limit: {
          primary_window: { used_percent: 44, reset_at: 1_700_003_600_000, window_seconds: 604_800 },
          secondary_window: { used_percent: 12.5, reset_after_seconds: 90, limit_window_seconds: 18_000 },
          allowed: false,
          limit_reached: true,
        },
      },
      1_700_000_000,
    );
    expect(usage.five_hour).toEqual({
      used_percent: 12.5,
      limit_window_seconds: 18_000,
      reset_at_epoch: 1_700_000_090,
    });
    expect(usage.seven_day).toEqual({ used_percent: 44, limit_window_seconds: 604_800, reset_at_epoch: 1_700_003_600 });
    expect(usage.allowed).toBe(false);
    expect(usage.limit_reached).toBe(true);
  });

  it("keeps the monthly window a Go or free account reports alone", () => {
    const usage = parseCodexUsage(
      {
        rate_limit: { primary_window: { used_percent: 58, limit_window_seconds: 2_592_000, reset_at: 1_700_003_600 } },
      },
      1_700_000_000,
    );
    expect(usage.monthly).toEqual({
      used_percent: 58,
      limit_window_seconds: monthlySeconds,
      reset_at_epoch: 1_700_003_600,
    });
    expect(usage.five_hour.limit_window_seconds).toBeNull();
    expect(usage.seven_day.limit_window_seconds).toBeNull();
  });

  it("accepts string durations and resets but not fractional or unfamiliar durations", () => {
    const usage = parseCodexUsage(
      {
        rate_limit: {
          primary_window: { used_percent: 9, limit_window_seconds: "18000", reset_after_seconds: "90" },
          secondary_window: { used_percent: 18, window_seconds: "604800.5" },
        },
      },
      1_700_000_000,
    );
    expect(usage.five_hour.used_percent).toBe(9);
    expect(usage.five_hour.reset_at_epoch).toBe(1_700_000_090);
    expect(usage.seven_day.used_percent).toBeNull();

    const unfamiliar = parseCodexUsage(
      {
        rate_limit: {
          primary_window: { used_percent: 9, limit_window_seconds: 18_000.9 },
          secondary_window: { used_percent: 18, limit_window_seconds: 3600 },
        },
      },
      1,
    );
    expect(unfamiliar.five_hour.used_percent).toBeNull();
    expect(unfamiliar.seven_day.used_percent).toBeNull();
  });
});

describe("reset credits", () => {
  it("reads every container and expiry field alternative", () => {
    const expiries = [
      { credits: [{ expires_at: 1 }, { expiresAt: 2 }] },
      { data: [{ expiry: 3 }, { expires: 4 }] },
      { items: [{ expiration: 5 }, { expiration_at: 6000 }] },
    ].flatMap((response) => parseCredits(response).reset_credits.map((credit) => credit.expires_at_epoch));
    expect(expiries).toEqual([1, 2, 3, 4, 5, 6000]);
  });

  it("reads RFC 3339 and numeric string expiries and rejects junk", () => {
    const expiries = (values: unknown[]) =>
      parseCredits({ credits: values.map((expires_at) => ({ expires_at })) }).reset_credits.map(
        (credit) => credit.expires_at_epoch,
      );
    expect(expiries(["2026-10-04T01:14:37.945219Z", "2026-10-04T02:00:00+01:00"])).toEqual([
      1_791_076_477, 1_791_075_600,
    ]);
    expect(expiries(["1791076477", "1791076477945", "1791076477.945219"])).toEqual(Array(3).fill(1_791_076_477));
    expect(expiries(["whenever", "NaN", "inf", "-1e9", "", "2026-10-04"])).toEqual(Array(6).fill(null));
  });

  it("prefers available_count over the list length", () => {
    expect(parseCredits({ credits: [{}], available_count: 3 }).reset_credit_count).toBe(3);
    expect(parseCredits({ credits: [{}] }).reset_credit_count).toBe(1);
    expect(parseCredits({}).reset_credit_count).toBeNull();
  });
});

describe("claude usage", () => {
  it("reads both windows and extra usage", () => {
    const usage = parseClaudeUsage({
      five_hour: { utilization: 65, resets_at: "2026-09-07T00:39:59.850576+00:00", locked_reason: null },
      seven_day: { utilization: 74, resets_at: "2026-09-07T05:39:59+05:30" },
      seven_day_opus: null,
      extra_usage: { is_enabled: true, used_credits: 12.5, monthly_limit: 50, currency: "USD" },
    });
    expect(usage.five_hour).toEqual({ used_percent: 65, limit_window_seconds: 18_000, reset_at_epoch: 1_788_741_599 });
    expect(usage.seven_day.reset_at_epoch).toBe(1_788_739_799);
    expect(usage.limit_reached).toBe(false);
    expect(usage.extra_usage).toEqual({ enabled: true, used_credits: 12.5, monthly_limit: 50, currency: "USD" });
  });

  it("keeps absent windows unavailable", () => {
    const usage = parseClaudeUsage({ five_hour: null, extra_usage: null });
    expect(usage.five_hour.limit_window_seconds).toBeNull();
    expect(usage.seven_day.used_percent).toBeNull();
    expect(usage.extra_usage).toBeNull();
  });

  it("reports a locked window as the limit reached", () => {
    const usage = parseClaudeUsage({ seven_day: { utilization: 100, locked_reason: "usage_limit" } });
    expect(usage.limit_reached).toBe(true);
    expect(usage.allowed).toBe(false);
  });
});

describe("opencode usage", () => {
  it("reads all three windows", () => {
    const usage = parseOpencodeUsage({
      usage: {
        rolling: { status: "ok", percent: 4, resetsAt: "2026-08-13T16:27:38.287Z" },
        weekly: { status: "ok", percent: 3, resetsAt: "2026-08-17T00:00:00.287Z" },
        monthly: { status: "ok", percent: 1, resetsAt: "2026-09-13T06:06:01.287Z" },
      },
    });
    expect(usage.five_hour).toEqual({ used_percent: 4, limit_window_seconds: 18_000, reset_at_epoch: 1_786_638_458 });
    expect(usage.seven_day.limit_window_seconds).toBe(604_800);
    expect(usage.monthly).toEqual({
      used_percent: 1,
      limit_window_seconds: monthlySeconds,
      reset_at_epoch: 1_789_279_561,
    });
    expect(usage.limit_reached).toBe(false);
  });

  it("counts a window as spent only when its percentage says so", () => {
    const spent = (weekly: unknown) => parseOpencodeUsage({ usage: { weekly } }).limit_reached;
    expect(spent({ status: "exceeded", percent: 100 })).toBe(true);
    expect(spent({ status: "warning", percent: 80 })).toBe(false);
  });
});
