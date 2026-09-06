/** Formatters for the usage view. Every one keeps "unavailable" distinct from a real zero. */

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

export function creditExpiry(epoch: number | null): string {
  return epoch === null ? "No expiry reported" : `Expires ${absoluteTime(epoch)}`;
}

export function lastUpdate(epoch: number | null): string {
  return epoch === null
    ? "no successful update yet"
    : `updated ${new Date(epoch * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}
