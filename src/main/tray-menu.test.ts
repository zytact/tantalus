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
    proxy_hubs: [],
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

  it("lists every pooled account inline, after the direct providers", () => {
    const usage = snapshot({ codex: true, claude: false, opencode: false });
    usage.proxy_hubs = [
      {
        id: "home",
        label: "Home hub",
        last_successful_update_epoch: 940,
        status: "ready",
        error_message: null,
        accounts: [
          {
            id: "first.json",
            email: "first@example.com",
            plan: "Pro",
            provider: "codex",
            usage: provider({ seven_day: window(sevenDaySeconds, 20) }),
          },
          {
            id: "second.json",
            email: "second@example.com",
            plan: "Max 5x",
            provider: "claude",
            usage: provider({ five_hour: window(18_000, 70) }),
          },
        ],
      },
      {
        id: "work",
        label: "Work hub",
        last_successful_update_epoch: null,
        status: "error",
        error_message: "The hub could not list accounts.",
        accounts: [],
      },
    ];
    expect(trayItems(usage, null, 1000).slice(0, 12)).toEqual([
      { label: "Codex", action: "show" },
      { label: "   7d   ████▏░░░░░  41%", action: "show" },
      "separator",
      { label: "Home hub", action: "show" },
      { label: "Codex · first@example.com · Pro", action: "show" },
      { label: "   7d   ██░░░░░░░░  20%", action: "show" },
      { label: "Claude · second@example.com · Max 5x", action: "show" },
      { label: "   5h   ███████░░░  70%", action: "show" },
      "separator",
      { label: "Work hub", action: "show" },
      { label: "   The hub could not list accounts.", action: null },
      { label: "Refreshed 1 minute ago", action: null },
    ]);
  });

  it("does not lead with a separator when only hubs are shown", () => {
    const usage = snapshot({ codex: false, claude: false, opencode: false });
    usage.proxy_hubs = [
      {
        id: "home",
        label: "Home hub",
        last_successful_update_epoch: null,
        status: "loading",
        error_message: null,
        accounts: [],
      },
    ];
    expect(trayItems(usage, null, 1000).slice(0, 2)).toEqual([
      { label: "Home hub", action: "show" },
      { label: "   Loading", action: null },
    ]);
  });
});
