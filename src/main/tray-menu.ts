import type { AvailableUpdate } from "../shared/ipc";
import { percent, providerIds, providerNames, refreshedAgo, refreshedEpoch, usagePace } from "../shared/usage";
import type { ProviderUsage, ProxyHubSnapshot, UsageSnapshot, WindowUsage } from "../shared/usage";

export type TrayAction = "show" | "refresh" | "quit";
export type TrayItem = { label: string; action: TrayAction | null } | "separator";

/** A heading and one row per window for every enabled provider, then a block per proxy hub listing
 * its accounts the same way, a dimmed row saying when they were refreshed, then a separator and the
 * actions, led by the pending update when there is one. Separators split the direct providers and
 * each hub. The readings stay enabled so the menu renders them at full contrast rather than dimming
 * the numbers the app exists to show; clicking one opens the window, like Open Tantalus. The window
 * carries the install button, so the update item opens it too. */
export function trayItems(snapshot: UsageSnapshot, update: AvailableUpdate | null, now: number): TrayItem[] {
  const direct = providerIds
    .filter((id) => snapshot.enabled[id])
    .flatMap((id) => readingItems(accountHeading(providerNames[id], snapshot[id].plan), snapshot[id], now));
  const readings = [direct, ...snapshot.proxy_hubs.map((hub) => hubItems(hub, now))]
    .filter((block) => block.length > 0)
    .flatMap((block, index): TrayItem[] => (index === 0 ? block : ["separator", ...block]));
  const refreshed: TrayItem[] =
    readings.length > 0 ? [{ label: refreshedAgo(refreshedEpoch(snapshot), now), action: null }, "separator"] : [];
  return [
    ...readings,
    ...refreshed,
    ...(update ? [{ label: `Update to v${update.version}`, action: "show" as const }] : []),
    { label: "Open Tantalus", action: "show" },
    { label: "Refresh now", action: "refresh" },
    { label: "Quit", action: "quit" },
  ];
}

function hubItems(hub: ProxyHubSnapshot, now: number): TrayItem[] {
  const accounts = hub.accounts.flatMap((account) =>
    readingItems(accountHeading(providerNames[account.provider], account.plan), account.usage, now),
  );
  const status = hub.error_message ?? (hub.status === "loading" ? "Loading" : "No supported accounts");
  return [
    { label: hub.label, action: "show" },
    ...(accounts.length > 0 ? accounts : [{ label: `${ROW_INDENT}${status}`, action: null }]),
  ];
}

function accountHeading(provider: string, detail: string | null): string {
  return detail ? `${provider} · ${detail}` : provider;
}

function readingItems(heading: string, usage: ProviderUsage, now: number): TrayItem[] {
  return [heading, ...trayRows(usage, now)].map((label) => ({ label, action: "show" }));
}

/** A row per window the reading actually carries. Which windows an account has depends on its plan,
 * so none of the three is assumed: a Codex Go or free account has only the monthly one, and OpenAI
 * has switched the 5-hour one off for a plan before. A reading with no window at all keeps the
 * provider on the menu with a bare `--`. */
export function trayRows(provider: ProviderUsage, now: number): string[] {
  const rows = (
    [
      ["5h", provider.five_hour],
      ["7d", provider.seven_day],
      ["30d", provider.monthly],
    ] as const
  )
    .filter(([, window]) => window.limit_window_seconds !== null)
    .map(([span, window]) => trayRow(span, window, now));
  return rows.length > 0 ? rows : [`${ROW_INDENT}--`];
}

function trayRow(span: string, window: WindowUsage, now: number): string {
  const head = `${ROW_INDENT}${span.padEnd(3)}  `;
  if (window.used_percent === null) return `${head}--`;
  const pace = usagePace(window, now);
  return `${head}${bar(window.used_percent)}  ${percent(window.used_percent)}${pace ? `  ${pace.label}` : ""}`;
}

const BAR_CELLS = 10;
const BAR_FULL = "█";
const BAR_EMPTY = "░";
/** Indexed by the eighths filling the partial cell, so index 0 is an empty cell. */
const BAR_PARTIALS = [BAR_EMPTY, "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
const ROW_INDENT = "   ";

/** Menu rows carry no icon or widget on Linux, so the bar is text. Eighth-blocks put the edge within
 * 1.25 percent of the reading, and a reading short of its limit keeps the last eighth empty, so a
 * solid bar always means the allowance is gone. */
export function bar(usedPercent: number): string {
  const clamped = Math.min(100, Math.max(0, usedPercent));
  const full = BAR_CELLS * 8;
  const rounded = Math.round((clamped / 100) * full);
  const eighths = rounded === full && clamped < 100 ? full - 1 : rounded;
  const filled = Math.floor(eighths / 8);
  if (filled === BAR_CELLS) return BAR_FULL.repeat(BAR_CELLS);
  return BAR_FULL.repeat(filled) + BAR_PARTIALS[eighths % 8] + BAR_EMPTY.repeat(BAR_CELLS - filled - 1);
}
