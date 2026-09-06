// PROTOTYPE: formatting helpers shared by every variant.
export function pct(value: number | null): string {
  return value === null ? "--" : `${Math.round(value)}%`;
}

export function countdown(epoch: number | null): string {
  if (epoch === null) return "unknown";
  const seconds = Math.max(0, epoch - Date.now() / 1000);
  if (seconds < 60) return "now";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function clockTime(epoch: number | null): string {
  return epoch === null
    ? "--"
    : new Date(epoch * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function updatedAt(epoch: number | null): string {
  return epoch === null
    ? "never"
    : new Date(epoch * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function statusLabel(status: string): string {
  switch (status) {
    case "auth_missing": return "Sign in needed";
    case "error": return "Refresh failed";
    case "stale": return "Cached";
    case "loading": return "Loading";
    default: return "Live";
  }
}
