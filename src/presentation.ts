export type WindowUsage = { used_percent: number | null; limit_window_seconds: number | null; reset_at_epoch: number | null };
export type ResetCredit = { expires_at_epoch: number | null };
export type ExtraUsage = { enabled: boolean; used_credits: number | null; monthly_limit: number | null; currency: string | null };
export type ProviderUsage = {
  five_hour: WindowUsage;
  seven_day: WindowUsage;
  allowed: boolean | null;
  limit_reached: boolean | null;
  reset_credits: ResetCredit[];
  reset_credit_count: number | null;
  extra_usage: ExtraUsage | null;
  last_successful_update_epoch: number | null;
  status: "ready" | "loading" | "stale" | "auth_missing" | "error";
  error_message: string | null;
};
export type ProviderId = "codex" | "claude";
export type UsageSnapshot = { codex: ProviderUsage; claude: ProviderUsage; enabled: Record<ProviderId, boolean> };

export function statusLine(provider: ProviderUsage, enabled: boolean): string {
  if (!enabled) return "Off";
  switch (provider.status) {
    case "auth_missing": return "Not signed in";
    case "error": return "Could not refresh";
    case "stale": return "Cached";
    case "loading": return "Loading";
    default: return provider.allowed === false || provider.limit_reached ? "Blocked until reset" : "Live";
  }
}

export function usagePercent(value: number | null): string {
  return value === null ? "Unavailable" : `${Math.round(value)}%`;
}

export function remainingPercent(value: number | null): string {
  return value === null ? "Unavailable" : `${Math.round(100 - value)}%`;
}

/** Time left until an epoch, coarse on purpose: "3h 29m", "4d 20h". */
export function countdown(epoch: number | null, now = Date.now() / 1000): string {
  if (epoch === null) return "Unavailable";
  const seconds = Math.max(0, epoch - now);
  if (seconds < 60) return "Resetting now";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function absoluteTime(epoch: number | null): string {
  return epoch === null
    ? "Unavailable"
    : new Date(epoch * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** Credits expire weeks out, so a weekday alone would not say which week. */
export function creditExpiry(epoch: number | null): string {
  if (epoch === null) return "No expiry reported";
  const date = new Date(epoch * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  return `Expires ${date}`;
}

export function lastUpdate(epoch: number | null): string {
  return epoch === null
    ? "no successful update yet"
    : `updated ${new Date(epoch * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function creditAmount(value: number | null, currency: string | null): string {
  if (value === null) return "Unavailable";
  const amount = value.toFixed(2);
  return currency ? `${amount} ${currency}` : amount;
}
