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
    const own = accounts.filter((account) => account.provider === provider);
    const identify = identities(own);
    const members = new Map<string, PoolAccount>();
    for (const account of own) {
      const identity = identify(account);
      const seen = members.get(identity);
      if (!seen) members.set(identity, account);
      else members.set(identity, newest(seen, account));
    }
    return members.size > 0 ? [{ provider, accounts: [...members.values()] }] : [];
  });
}

const emailOf = ({ usage }: PoolAccount) => usage.email?.trim().toLowerCase() ?? null;

/** Names the account behind each reading. Members of one ChatGPT workspace share an account ID but not
 * an allowance, so under one `account_key` each email is an account of its own. A reading without an
 * email joins the others only while they all name one email. Among several it could be any of them, so
 * it stays apart, as does a reading without a key. */
function identities(accounts: PoolAccount[]): (account: PoolAccount) => string {
  const emails = new Map<string, Set<string>>();
  for (const account of accounts) {
    const key = account.usage.account_key;
    const email = emailOf(account);
    if (key !== null && email !== null) emails.set(key, (emails.get(key) ?? new Set()).add(email));
  }
  return (account) => {
    const key = account.usage.account_key;
    if (key === null) return JSON.stringify([account.key]);
    const known = emails.get(key);
    if (!known || known.size === 1) return JSON.stringify([key]);
    const email = emailOf(account);
    return email === null ? JSON.stringify([key, null, account.key]) : JSON.stringify([key, email]);
  };
}

/** The newer of two readings of one account, with the email and plan whichever of them knows. */
function newest(a: PoolAccount, b: PoolAccount): PoolAccount {
  const [winner, other] = readEpoch(b) > readEpoch(a) ? [b, a] : [a, b];
  const { email, plan } = winner.usage;
  return { ...winner, usage: { ...winner.usage, email: email ?? other.usage.email, plan: plan ?? other.usage.plan } };
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

/** A window as it stands now. One whose reset has passed since it was read is full again, and has no
 * reset until it is next used. */
const current = (window: WindowUsage, now: number): WindowUsage =>
  window.reset_at_epoch !== null && window.reset_at_epoch <= now
    ? { ...window, used_percent: 0, reset_at_epoch: null }
    : window;

/** The windows any of the pool's accounts reports, in the order they are shown, each as it stands now. */
export function poolWindows(pool: Pool, now: number): PoolWindow[] {
  return windowSlots.flatMap((slot) => {
    const duration = windowDurations[slot];
    const columns = pool.accounts.map(({ usage }) =>
      usage[slot].limit_window_seconds === duration ? current(usage[slot], now) : null,
    );
    if (columns.every((window) => window === null)) return [];
    const readings = columns.flatMap((window, index) => {
      if (window === null || window.used_percent === null) return [];
      const used = Math.min(100, Math.max(0, window.used_percent));
      return [{ index, used, reset: window.reset_at_epoch, pace: usagePace(window, now) }];
    });
    const paced = readings.flatMap(({ used, pace }) => (pace ? [{ used, expected: pace.expectedPercent }] : []));
    const pending = readings
      .flatMap(({ index, used, reset }) => (reset !== null && used > 0 ? [{ index, used, resetAt: reset }] : []))
      .sort((a, b) => a.resetAt - b.resetAt)[0];
    return [
      {
        slot,
        duration,
        columns,
        remaining: readings.length > 0 ? 100 - mean(readings.map(({ used }) => used)) : null,
        pace: paced.length > 0 ? paceAt(mean(paced.map(({ used }) => used)), mean(paced.map((p) => p.expected))) : null,
        next: pending
          ? { index: pending.index, resetAt: pending.resetAt, restores: pending.used / readings.length }
          : null,
      },
    ];
  });
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
