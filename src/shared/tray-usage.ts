import { namedDirectAccounts, namedHubAccounts, providerIds, providerNames, remainingUsage } from "./usage";
import type { AccountName, DirectAccount, ProviderId, ProviderUsage, UsageSnapshot } from "./usage";

/** `source` is the key of the account the tray shows, or null for the first one available. */
export type TrayUsageSettings = { enabled: boolean; source: string | null };

export const noTrayUsage: TrayUsageSettings = { enabled: false, source: null };

/** The color each provider's number is drawn in, in the tray and in the Settings legend. */
export const trayUsageColors: Record<ProviderId, string> = {
  claude: "#D97757",
  codex: "#3B82F6",
  opencode: "#8B5CF6",
};

/** An account the tray can show, or a group's accounts of one provider pooled together. `window` is its
 * 5-hour window, or the monthly one for an account without a 5-hour window, such as Codex Go or free.
 * It is null until either has been read. `limit` is 100, or 100 per pooled account. */
export type TrayUsageOption = {
  key: string;
  provider: ProviderId;
  name: AccountName;
  window: { span: "5h" | "30d"; remaining: number; limit: number } | null;
};

/** Every direct sign-in, then each hub's accounts, in the order the allowance view lists them. Each
 * group is led by a pooled option for every provider it has more than one account of. A direct pool is
 * keyed by the bare provider id, which is what a single direct sign-in was saved as before WSL sign-ins
 * became accounts of their own. */
export function trayUsageOptions(snapshot: UsageSnapshot, now: number): TrayUsageOption[] {
  return [
    ...pooledOptions(snapshot.accounts, "", (provider) => provider, now),
    ...namedDirectAccounts(snapshot.accounts).map(({ id, provider, usage, name }) => ({
      key: `${provider}:${id}`,
      provider,
      name,
      window: shownWindow(usage),
    })),
    ...snapshot.proxy_hubs.flatMap((hub) => [
      // One part shorter than an account's key, so no account id can collide with it.
      ...pooledOptions(hub.accounts, `${hub.label} · `, (provider) => `${hub.id}:${provider}`, now),
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
  return {
    span: window === usage.five_hour ? "5h" : "30d",
    remaining: remainingUsage(window.used_percent),
    limit: 100,
  };
}

/** The summed remaining 5-hour allowance of a group's accounts of one provider, so three accounts at 80%, 20% and 50%
 * used have 150% of 300% remaining. A window whose reset has passed since it was read counts as full, and an account
 * without a 5-hour reading is left out. */
function pooledOptions(
  accounts: Pick<DirectAccount, "provider" | "usage">[],
  prefix: string,
  keyOf: (provider: ProviderId) => string,
  now: number,
): TrayUsageOption[] {
  const providers = [...new Set(accounts.map(({ provider }) => provider))];
  return providers.flatMap((provider) => {
    const pooled = accounts.filter((account) => account.provider === provider);
    if (pooled.length < 2) return [];
    const remaining = pooled.flatMap(({ usage: { five_hour: window } }) => {
      if (window.limit_window_seconds === null || window.used_percent === null) return [];
      return [
        window.reset_at_epoch !== null && window.reset_at_epoch <= now ? 100 : remainingUsage(window.used_percent),
      ];
    });
    const title = `${prefix}${providerNames[provider]} · All ${pooled.length} accounts`;
    return [
      {
        key: keyOf(provider),
        provider,
        name: { title, email: null, label: title },
        window:
          remaining.length > 0
            ? { span: "5h", remaining: remaining.reduce((sum, value) => sum + value), limit: remaining.length * 100 }
            : null,
      },
    ];
  });
}

/** The option a saved source names. A bare provider id names that provider's direct pool, or its only
 * direct sign-in when there is no pool. Null for the first option. */
export function traySource(options: TrayUsageOption[], source: string | null): TrayUsageOption | undefined {
  if (source === null) return options[0];
  return (
    options.find(({ key }) => key === source) ??
    (providerIds.some((id) => id === source) ? options.find(({ key }) => key.startsWith(`${source}:`)) : undefined)
  );
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
  const option = traySource(trayUsageOptions(snapshot, now), settings.source);
  return option?.window ? { provider: option.provider, name: option.name, ...option.window } : null;
}
