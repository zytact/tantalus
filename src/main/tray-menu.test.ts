import { describe, expect, it } from "vite-plus/test";
import { emptyProviderUsage, fiveHourSeconds, monthlySeconds, sevenDaySeconds } from "../shared/usage";
import type { ProviderUsage, UsageSnapshot } from "../shared/usage";
import { bar, trayItems, trayRows } from "./tray-menu";

const window = (seconds: number, used: number | null, reset: number | null = null) => ({
  used_percent: used,
  limit_window_seconds: seconds,
  reset_at_epoch: reset,
});
const provider = (fields: Partial<ProviderUsage>): ProviderUsage => ({ ...emptyProviderUsage(), ...fields });

describe("tray rows", () => {
  it("keeps a fractional percentage", () => {
    expect(
      trayRows(provider({ five_hour: window(fiveHourSeconds, 12.74), seven_day: window(sevenDaySeconds, 3) }), 0),
    ).toEqual(["   5h   █▎░░░░░░░░  12.7%", "   7d   ▎░░░░░░░░░  3%"]);
  });

  it("carries only the windows the account has", () => {
    expect(trayRows(provider({ monthly: window(monthlySeconds, 50) }), 0)).toEqual(["   30d  █████░░░░░  50%"]);
    expect(trayRows(provider({ seven_day: window(sevenDaySeconds, 41) }), 0)).toEqual(["   7d   ████▏░░░░░  41%"]);
  });

  it("says nothing was read rather than inventing a bar", () => {
    expect(trayRows(emptyProviderUsage(), 0)).toEqual(["   --"]);
    expect(trayRows(provider({ five_hour: window(fiveHourSeconds, null) }), 0)).toEqual(["   5h   --"]);
  });

  it("compares usage with elapsed time", () => {
    const now = 1_000_000;
    const reset = now + (sevenDaySeconds * 6) / 7;
    const row = (used: number) => trayRows(provider({ seven_day: window(sevenDaySeconds, used, reset) }), now)[0];
    expect(row(12)).toMatch(/12%  Under pace$/);
    expect(row(12.5)).toMatch(/On pace$/);
    expect(row(16)).toMatch(/On pace$/);
    expect(row(16.5)).toMatch(/Ahead of pace$/);
  });
});

describe("tray bar", () => {
  it("is the same width whatever the reading", () => {
    for (const percent of [0, 0.4, 12.74, 50, 99.9, 100, 140]) expect(Array.from(bar(percent))).toHaveLength(10);
  });

  it("fills only at the limit and clamps to its ends", () => {
    expect(bar(99.9)).not.toBe(bar(100));
    expect(bar(100)).toBe("██████████");
    expect(bar(140)).toBe(bar(100));
    expect(bar(-5)).toBe(bar(0));
  });
});

describe("tray menu", () => {
  const snapshot = (enabled: UsageSnapshot["enabled"]): UsageSnapshot => ({
    codex: provider({ seven_day: window(sevenDaySeconds, 41), last_successful_update_epoch: 940 }),
    claude: emptyProviderUsage(),
    opencode: emptyProviderUsage(),
    enabled,
  });

  it("lists enabled providers, when they were read, then the actions led by an update", () => {
    const items = trayItems(snapshot({ codex: true, claude: false, opencode: false }), { version: "0.1.0" }, 1000);
    expect(items).toEqual([
      { label: "Codex", action: "show" },
      { label: "   7d   ████▏░░░░░  41%", action: "show" },
      { label: "Refreshed 1 minute ago", action: null },
      "separator",
      { label: "Update to v0.1.0", action: "show" },
      { label: "Open Tantalus", action: "show" },
      { label: "Refresh now", action: "refresh" },
      { label: "Quit", action: "quit" },
    ]);
  });

  it("drops the refreshed row when no provider is on", () => {
    const items = trayItems(snapshot({ codex: false, claude: false, opencode: false }), null, 1000);
    expect(items.map((item) => (item === "separator" ? item : item.label))).toEqual([
      "Open Tantalus",
      "Refresh now",
      "Quit",
    ]);
  });
});
