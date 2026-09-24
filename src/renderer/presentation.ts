import type { InstallProgress } from "../shared/ipc";
import { percent } from "../shared/usage";
import type { ExtraUsage, ProviderId, ProviderUsage } from "../shared/usage";

/** What a provider banks beyond its windows, in the order shown. Opencode reports neither. */
export const providerExtras = {
  codex: ["credits"],
  claude: ["credits", "spend"],
  opencode: [],
} as const satisfies Record<ProviderId, readonly ("credits" | "spend")[]>;

/** The update strip's wording while an install runs. `percent` is null when the stage cannot be measured. */
export function installStatus(version: string, progress: InstallProgress) {
  if (progress.stage === "install") return { label: "Installing", detail: `v${version}`, percent: null };
  const { received, total } = progress;
  return {
    label: "Downloading",
    detail: `v${version} · ${total ? `${megabytes(received)} of ${megabytes(total)}` : megabytes(received)} MB`,
    percent: total ? Math.min(100, Math.floor((received / total) * 100)) : null,
  };
}

const megabytes = (bytes: number) => (bytes / 1e6).toFixed(1);

export function statusLine(provider: ProviderUsage): string {
  switch (provider.status) {
    case "auth_missing":
      return "Not signed in";
    case "error":
      return "Could not refresh";
    case "stale":
      return "Cached";
    case "loading":
      return "Loading";
    default:
      return provider.allowed === false || provider.limit_reached ? "Blocked until reset" : "Live";
  }
}

export function usagePercent(value: number | null): string {
  return value === null ? "Unavailable" : percent(value);
}

export function remainingPercent(value: number | null): string {
  return value === null ? "Unavailable" : percent(100 - value);
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
    minute: "2-digit",
  });
  return `Expires ${date}`;
}

export function subscriptionDate(epoch: number): string {
  return new Date(epoch * 1000).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function creditAmount(
  value: number | null,
  { currency, decimal_places }: Pick<ExtraUsage, "currency" | "decimal_places">,
): string {
  if (value === null) return "Unavailable";
  const amount = value.toFixed(decimal_places);
  return currency ? `${amount} ${currency}` : amount;
}

/** Bar tone thresholds: amber from 75% of the window spent, red from 90%. */
export function usageTier(value: number | null): "normal" | "warn" | "danger" {
  if (value === null) return "normal";
  if (value >= 90) return "danger";
  return value >= 75 ? "warn" : "normal";
}

export function statusTone(provider: ProviderUsage): "ok" | "warn" | "danger" {
  switch (provider.status) {
    case "auth_missing":
    case "error":
      return "danger";
    case "stale":
    case "loading":
      return "warn";
    default:
      return provider.allowed === false || provider.limit_reached ? "danger" : "ok";
  }
}

/** The chord fields the refresh shortcut reads, so the check stays testable without a DOM event. */
export type Chord = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Ctrl+R and Cmd+R both mean refresh. Adding Alt or Shift makes it a different chord. */
export function isRefreshShortcut(event: Chord): boolean {
  return event.key.toLowerCase() === "r" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
}
