import { directPaceKey, paceKey } from "./pace";
import type { WindowId } from "./pace";
import {
  directAccountKey,
  namedDirectAccounts,
  namedHubAccounts,
  paceAt,
  providerIds,
  usagePace,
  windowDurations,
  windowSlots,
} from "./usage";
import type {
  AccountName,
  ProviderId,
  ProviderUsage,
  UsagePace,
  UsageSnapshot,
  WindowSlot,
  WindowUsage,
} from "./usage";
import { windowStartKey } from "./window-start";

/** One account of a provider's pool, read directly or through a hub. `hub` is the label of the hub it
 * came through. A hub keeps an account's email and plan beside its usage, so they are folded in. */
export type PoolAccount = {
  key: string;
  provider: ProviderId;
  name: AccountName;
  hub: string | null;
  usage: ProviderUsage;
  startKey: string;
  paceKey: (id: WindowId) => string;
};

export type Pool = { provider: ProviderId; accounts: PoolAccount[] };

/** Every account the snapshot reads, direct sign-ins first, then each hub's. */
export function poolAccounts(snapshot: UsageSnapshot): PoolAccount[] {
  return [
    ...namedDirectAccounts(snapshot.accounts).map((account) => ({
      key: `${account.provider}:${account.id}`,
      provider: account.provider,
      name: account.name,
      hub: null,
      usage: account.usage,
      startKey: directAccountKey(account),
      paceKey: (id: WindowId) => directPaceKey(id, account),
    })),
    ...snapshot.proxy_hubs.flatMap((hub) =>
      namedHubAccounts(hub).map(({ id: accountId, provider, name, email, plan, usage }) => ({
        key: `${hub.id}:${provider}:${accountId}`,
        provider,
        name,
        hub: hub.label,
        usage: { ...usage, email: usage.email ?? email, plan: usage.plan ?? plan },
        startKey: windowStartKey(provider, { hubId: hub.id, accountId }),
        paceKey: (id: WindowId) => paceKey(id, provider, { hubId: hub.id, accountId }),
      })),
    ),
  ];
}

/** One pool per provider that has an account, in provider order. An account read twice, such as through
 * two hubs or from two sign-ins, has one allowance, so it counts once, by its newest reading. */
export function providerPools(snapshot: UsageSnapshot): Pool[] {
  const accounts = poolAccounts(snapshot);
  return providerIds.flatMap((provider) => {
    const members = new Map<string, PoolAccount>();
    for (const account of accounts) {
      if (account.provider !== provider) continue;
      const key = account.usage.account_key ?? account.key;
      const seen = members.get(key);
      if (!seen || readEpoch(account) > readEpoch(seen)) members.set(key, account);
    }
    return members.size > 0 ? [{ provider, accounts: [...members.values()] }] : [];
  });
}

const readEpoch = ({ usage }: PoolAccount) => usage.last_successful_update_epoch ?? 0;

/** One window across a pool. `columns` lines up with the pool's accounts and holds null for an account
 * that does not report the window. `remaining` is the mean of what each account has left, and null when
 * none has a percentage. `next` is the reset that lands first, the index of the account it belongs to, and
 * the share of the pool it hands back. */
export type PoolWindow = {
  slot: WindowSlot;
  duration: number;
  columns: (WindowUsage | null)[];
  remaining: number | null;
  pace: UsagePace | null;
  next: { index: number; resetAt: number; restores: number } | null;
};

/** The windows any of the pool's accounts reports, in the order they are shown. A window whose reset
 * has passed since it was read counts as full. */
export function poolWindows(pool: Pool, now: number): PoolWindow[] {
  return windowSlots.flatMap((slot) => {
    const duration = windowDurations[slot];
    const columns = pool.accounts.map(({ usage }) =>
      usage[slot].limit_window_seconds === duration ? usage[slot] : null,
    );
    if (columns.every((window) => window === null)) return [];
    const read = columns.flatMap((window, index) => {
      if (window === null || window.used_percent === null) return [];
      const reset = window.reset_at_epoch;
      const used = reset !== null && reset <= now ? 0 : Math.min(100, Math.max(0, window.used_percent));
      return [{ index, used, reset, pace: usagePace(window, now) }];
    });
    const paced = read.flatMap(({ used, pace }) => (pace ? [{ used, expected: pace.expectedPercent }] : []));
    const pending = read
      .flatMap(({ index, used, reset }) => (reset !== null && used > 0 ? [{ index, used, resetAt: reset }] : []))
      .sort((a, b) => a.resetAt - b.resetAt)[0];
    return [
      {
        slot,
        duration,
        columns,
        remaining: read.length > 0 ? 100 - mean(read.map(({ used }) => used)) : null,
        pace: paced.length > 0 ? paceAt(mean(paced.map(({ used }) => used)), mean(paced.map((p) => p.expected))) : null,
        next: pending ? { index: pending.index, resetAt: pending.resetAt, restores: pending.used / read.length } : null,
      },
    ];
  });
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
