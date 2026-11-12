import { poolAccounts, poolWindows, providerPools } from "./pool";
import type { Pool } from "./pool";
import { providerIds, providerNames } from "./usage";
import type { AccountName, ProviderId, UsageSnapshot } from "./usage";

/** `source` is the key of the account the tray shows, or null for the first one available. */
export type TrayUsageSettings = { enabled: boolean; source: string | null };

export const noTrayUsage: TrayUsageSettings = { enabled: false, source: null };

/** The color each provider's number is drawn in, in the tray and in the Settings legend. */
export const trayUsageColors: Record<ProviderId, string> = {
  claude: "#D97757",
  codex: "#3B82F6",
  opencode: "#8B5CF6",
};

/** An account the tray can show, or a provider's accounts pooled together. `window` is its 5-hour
 * window, or the monthly one where no account has a 5-hour window, such as Codex Go or free. It is null
 * until either has been read. */
export type TrayUsageOption = {
  key: string;
  provider: ProviderId;
  name: AccountName;
  window: { span: "5h" | "30d"; remaining: number } | null;
};

/** A pool for every provider with more than one account, then every account: direct sign-ins first,
 * then each hub's, in the order the allowance view lists them. A pool is keyed by the bare provider id. */
export function trayUsageOptions(snapshot: UsageSnapshot, now: number): TrayUsageOption[] {
  const pooled = providerPools(snapshot)
    .filter(({ accounts }) => accounts.length > 1)
    .map((pool) => {
      const title = `${providerNames[pool.provider]} · All ${pool.accounts.length} accounts`;
      return {
        key: pool.provider,
        provider: pool.provider,
        name: { title, email: null, label: title },
        window: shownWindow(pool, now),
      };
    });
  const accounts = poolAccounts(snapshot).map((account) => ({
    key: account.key,
    provider: account.provider,
    name: account.name,
    window: shownWindow({ provider: account.provider, accounts: [account] }, now),
  }));
  return [...pooled, ...accounts];
}

/** A pool shows the mean of what its accounts have left, so the number reads like one account's. */
function shownWindow(pool: Pool, now: number): TrayUsageOption["window"] {
  const windows = poolWindows(pool, now);
  const window = windows.find(({ slot }) => slot === "five_hour") ?? windows.find(({ slot }) => slot === "monthly");
  if (!window || window.remaining === null) return null;
  return { span: window.slot === "five_hour" ? "5h" : "30d", remaining: window.remaining };
}

/** The option a saved source names. A bare provider id names that provider's pool, or its first account
 * when there is no pool. So does the `<hub>:<provider>` a hub's own pool was saved as before pools
 * spanned hubs. Null for the first option. */
export function traySource(options: TrayUsageOption[], source: string | null): TrayUsageOption | undefined {
  if (source === null) return options[0];
  const exact = options.find(({ key }) => key === source);
  if (exact) return exact;
  const parts = source.split(":");
  const provider = parts.length <= 2 ? providerIds.find((id) => id === parts.at(-1)) : undefined;
  return provider && options.find((option) => option.provider === provider);
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
