import { namedHubAccounts, providerIds, providerNames } from "./usage";
import type { AccountName, ProviderId, ProviderUsage, ProxyHubSnapshot, UsageSnapshot } from "./usage";

/** `source` is the key of the account the tray shows, or null for the first one available. */
export type TrayUsageSettings = { enabled: boolean; source: string | null };

export const noTrayUsage: TrayUsageSettings = { enabled: false, source: null };

/** The color each provider's number is drawn in, in the tray and in the Settings legend. */
export const trayUsageColors: Record<ProviderId, string> = {
  claude: "#D97757",
  codex: "#3B82F6",
  opencode: "#8B5CF6",
};

/** An account the tray can show, or a hub's accounts of one provider pooled together. `window` is its
 * 5-hour window, or the monthly one for an account without a 5-hour window, such as Codex Go or free.
 * It is null until either has been read. `limit` is 100, or 100 per pooled account. */
export type TrayUsageOption = {
  key: string;
  provider: ProviderId;
  name: AccountName;
  window: { span: "5h" | "30d"; used: number; limit: number } | null;
};

/** Every direct provider switched on, then each hub's accounts in the order the allowance view lists
 * them, led by a pooled option for every provider the hub has more than one account of. */
export function trayUsageOptions(snapshot: UsageSnapshot, now: number): TrayUsageOption[] {
  return [
    ...providerIds
      .filter((id) => snapshot.enabled[id])
      .map((id) => ({
        key: id,
        provider: id,
        name: { title: providerNames[id], email: null },
        window: shownWindow(snapshot[id]),
      })),
    ...snapshot.proxy_hubs.flatMap((hub) => [
      ...pooledOptions(hub, now),
      ...namedHubAccounts(hub).map(({ id, provider, usage, name }) => ({
        key: `${hub.id}:${provider}:${id}`,
        provider,
        name,
        window: shownWindow(usage),
      })),
    ]),
  ];
}

function shownWindow(usage: ProviderUsage): TrayUsageOption["window"] {
  const window = usage.five_hour.limit_window_seconds !== null ? usage.five_hour : usage.monthly;
  if (window.limit_window_seconds === null || window.used_percent === null) return null;
  return { span: window === usage.five_hour ? "5h" : "30d", used: window.used_percent, limit: 100 };
}

/** The summed 5-hour usage of a hub's accounts of one provider, so three accounts at 80%, 20% and 50%
 * read 150% of 300%. A window whose reset has passed since it was read counts as empty, and an account
 * without a 5-hour reading is left out. */
function pooledOptions(hub: ProxyHubSnapshot, now: number): TrayUsageOption[] {
  const providers = [...new Set(hub.accounts.map(({ provider }) => provider))];
  return providers.flatMap((provider) => {
    const accounts = hub.accounts.filter((account) => account.provider === provider);
    if (accounts.length < 2) return [];
    const used = accounts.flatMap(({ usage: { five_hour: window } }) => {
      if (window.limit_window_seconds === null || window.used_percent === null) return [];
      return [window.reset_at_epoch !== null && window.reset_at_epoch <= now ? 0 : window.used_percent];
    });
    const title = `${hub.label} · ${providerNames[provider]} · All ${accounts.length} accounts`;
    return [
      {
        key: `${hub.id}:${provider}:all`,
        provider,
        name: { title, email: null },
        window:
          used.length > 0
            ? { span: "5h", used: used.reduce((sum, value) => sum + value), limit: used.length * 100 }
            : null,
      },
    ];
  });
}

/** What the tray shows: the saved account's reading, or the first account's when none is saved. Null
 * when the setting is off, the saved account is gone or nothing has been read yet, so the tray keeps
 * its plain icon. */
export function trayUsageReading(
  snapshot: UsageSnapshot,
  settings: TrayUsageSettings,
  now: number,
): (Pick<TrayUsageOption, "provider" | "name"> & NonNullable<TrayUsageOption["window"]>) | null {
  if (!settings.enabled) return null;
  const options = trayUsageOptions(snapshot, now);
  const option = settings.source === null ? options[0] : options.find(({ key }) => key === settings.source);
  return option?.window ? { provider: option.provider, name: option.name, ...option.window } : null;
}
