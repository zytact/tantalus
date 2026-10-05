import { numberedHubAccounts, providerIds, providerNames } from "./usage";
import type { ProviderId, ProviderUsage, UsageSnapshot, WindowUsage } from "./usage";

/** `source` is the key of the account the tray shows, or null for the first one available. */
export type TrayUsageSettings = { enabled: boolean; source: string | null };

export const noTrayUsage: TrayUsageSettings = { enabled: false, source: null };

/** The color each provider's number is drawn in, in the tray and in the Settings legend. */
export const trayUsageColors: Record<ProviderId, string> = {
  claude: "#D97757",
  codex: "#3B82F6",
  opencode: "#8B5CF6",
};

/** An account the tray can show. `window` is its 5-hour window, or the monthly one for an account
 * without a 5-hour window, such as Codex Go or free. It is null until either has been read. */
export type TrayUsageOption = {
  key: string;
  provider: ProviderId;
  label: string;
  window: { span: "5h" | "30d"; usage: WindowUsage } | null;
};

/** Every direct provider switched on, then every hub account, in the order the allowance view lists them. */
export function trayUsageOptions(snapshot: UsageSnapshot): TrayUsageOption[] {
  return [
    ...providerIds
      .filter((id) => snapshot.enabled[id])
      .map((id) => ({ key: id, provider: id, label: providerNames[id], window: shownWindow(snapshot[id]) })),
    ...snapshot.proxy_hubs.flatMap((hub) =>
      numberedHubAccounts(hub.accounts).map(({ id, provider, usage, number }) => ({
        key: `${hub.id}:${provider}:${id}`,
        provider,
        label: `${hub.label} · ${providerNames[provider]} ${number}`,
        window: shownWindow(usage),
      })),
    ),
  ];
}

function shownWindow(usage: ProviderUsage): TrayUsageOption["window"] {
  if (usage.five_hour.limit_window_seconds !== null) return { span: "5h", usage: usage.five_hour };
  if (usage.monthly.limit_window_seconds !== null) return { span: "30d", usage: usage.monthly };
  return null;
}

/** What the tray shows: the saved account's reading, or the first account's when none is saved. Null
 * when the setting is off, the saved account is gone or nothing has been read yet, so the tray keeps
 * its plain icon. */
export function trayUsageReading(
  snapshot: UsageSnapshot,
  settings: TrayUsageSettings,
): (Pick<TrayUsageOption, "provider" | "label"> & { span: "5h" | "30d"; used: number }) | null {
  if (!settings.enabled) return null;
  const options = trayUsageOptions(snapshot);
  const option = settings.source === null ? options[0] : options.find(({ key }) => key === settings.source);
  const used = option?.window?.usage.used_percent ?? null;
  return option?.window && used !== null
    ? { provider: option.provider, label: option.label, span: option.window.span, used }
    : null;
}
