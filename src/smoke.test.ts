import { describe, expect, it } from "vite-plus/test";
import {
  countdown,
  creditExpiry,
  remainingPercent,
  statusLine,
  statusTone,
  usagePercent,
  usageTier,
} from "./presentation";
import type { ProviderUsage } from "./presentation";

const provider = (fields: Partial<ProviderUsage> = {}): ProviderUsage => ({
  five_hour: { used_percent: null, limit_window_seconds: null, reset_at_epoch: null },
  seven_day: { used_percent: null, limit_window_seconds: null, reset_at_epoch: null },
  monthly: { used_percent: null, limit_window_seconds: null, reset_at_epoch: null },
  allowed: null,
  limit_reached: null,
  reset_credits: [],
  reset_credit_count: null,
  extra_usage: null,
  last_successful_update_epoch: null,
  status: "ready",
  error_message: null,
  ...fields,
});

describe("display contract", () => {
  it("keeps unavailable usage distinct from zero", () => {
    expect(usagePercent(null)).toBe("Unavailable");
    expect(usagePercent(0)).toBe("0%");
    expect(remainingPercent(null)).toBe("Unavailable");
    expect(remainingPercent(100)).toBe("0%");
  });

  it("keeps an unknown reset distinct from an imminent one", () => {
    const now = 1_000_000;
    expect(countdown(null, now)).toBe("Unavailable");
    expect(countdown(now, now)).toBe("Resetting now");
    expect(countdown(now + 3600 * 3 + 60 * 29, now)).toBe("3h 29m");
    expect(countdown(now + 86_400 * 4 + 3600 * 20, now)).toBe("4d 20h");
  });

  it("names what the last reading was worth", () => {
    expect(statusLine(provider({ status: "ready" }))).toBe("Live");
    expect(statusLine(provider({ status: "error" }))).toBe("Could not refresh");
    expect(statusLine(provider({ status: "stale" }))).toBe("Cached");
    expect(statusLine(provider({ limit_reached: true }))).toBe("Blocked until reset");
  });

  it("dates a credit expiry that sits weeks out", () => {
    expect(creditExpiry(null)).toBe("No expiry reported");
    expect(creditExpiry(Date.UTC(2026, 9, 4, 12) / 1000)).toContain("Oct 4");
  });

  it("escalates the usage bar only at the thresholds", () => {
    expect(usageTier(null)).toBe("normal");
    expect(usageTier(74)).toBe("normal");
    expect(usageTier(75)).toBe("warn");
    expect(usageTier(89)).toBe("warn");
    expect(usageTier(90)).toBe("danger");
  });

  it("colors a status word by how bad it is", () => {
    expect(statusTone(provider({ status: "ready" }))).toBe("ok");
    expect(statusTone(provider({ status: "stale" }))).toBe("warn");
    expect(statusTone(provider({ status: "auth_missing" }))).toBe("danger");
    expect(statusTone(provider({ limit_reached: true }))).toBe("danger");
  });
});
