import { describe, expect, it } from "vitest";
import { countdown, creditExpiry, remainingPercent, usagePercent } from "./presentation";

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

  it("dates a credit expiry that sits weeks out", () => {
    expect(creditExpiry(null)).toBe("No expiry reported");
    expect(creditExpiry(Date.UTC(2026, 9, 4, 12) / 1000)).toContain("Oct 4");
  });
});
