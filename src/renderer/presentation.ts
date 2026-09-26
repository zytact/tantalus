import type { InstallProgress } from "../shared/ipc";
import type { Creature, Rider } from "../shared/pace";
import { fiveHourSeconds, monthlySeconds, percent, sevenDaySeconds } from "../shared/usage";
import type { UsagePace, ExtraUsage, ProviderId, ProviderUsage } from "../shared/usage";

/** What a provider banks beyond its windows, in the order shown. Opencode reports neither. */
export const providerExtras = {
  codex: ["credits"],
  claude: ["credits", "spend"],
  opencode: [],
} as const satisfies Record<ProviderId, readonly ("credits" | "spend")[]>;

/** Every window a provider can report, in the order they are shown. Which of them a reading
 * actually carries depends on the plan: a Codex Go or free account has only the monthly window,
 * and OpenAI has switched the 5-hour one off for a plan before, so none of the three is assumed. */
export function windowEntries(provider: ProviderUsage) {
  return windowSlots.map(({ slot, ...entry }) => ({ ...entry, window: provider[slot] }));
}

const windowSlots = [
  { label: "Short window", span: "5 hours", duration: fiveHourSeconds, slot: "five_hour" },
  { label: "Long window", span: "7 days", duration: sevenDaySeconds, slot: "seven_day" },
  { label: "Monthly window", span: "30 days", duration: monthlySeconds, slot: "monthly" },
] as const;

export const windowLabel = (duration: number) =>
  windowSlots.find((slot) => slot.duration === duration)?.label ?? "Window";

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

/** A learning time or a runway, coarse on purpose: "40m", "40h", "3d 12h". */
export function span(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  return hours % 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours / 24}d`;
}

export function perHour(rate: number): string {
  return `${rate.toFixed(rate < 1 ? 2 : rate < 10 ? 1 : 0)}%/h`;
}

const paceDirection = { dragon: "Faster", tortoise: "Slower" } satisfies Record<Creature, string>;

/** How the current rate compares with the usual one: a multiple for a dragon, a share for a tortoise. */
function paceComparison({ kind, rate, usual }: Rider): string {
  const ratio = rate / usual;
  return kind === "dragon" ? `${ratio.toFixed(1)}× your usual pace` : `${Math.round(ratio * 100)}% of your usual pace`;
}

/** What the creature's tooltip says: the current rate next to the usual one, and where the current
 * rate leaves the window by the reset. */
export function creatureTip(rider: Rider, used: number, resetAt: number | null, now: number): string {
  const { kind, rate, usual } = rider;
  const lead = `${paceDirection[kind]} than usual. ${perHour(rate)} now, against your usual ${perHour(usual)}.`;
  if (resetAt === null) return lead;
  const hoursLeft = Math.max(0, resetAt - now) / 3600;
  if (kind === "tortoise") {
    const atReset = Math.min(100, used + rate * hoursLeft);
    return `${lead} At this rate you'd be at about ${percent(Math.round(atReset))} when it resets.`;
  }
  const runway = Math.max(0, 100 - used) / rate;
  return runway < hoursLeft
    ? `${lead} At this rate it runs out in ${span(runway * 3600)}, before it resets.`
    : `${lead} At this rate it lasts until the reset.`;
}

/** What a screen reader hears for a window's bar: how much is used, the pace, and how fast it moves. */
export function usageValueText(used: number | null, pace: UsagePace | null, rider: Rider | null): string {
  const comparison = rider && paceComparison(rider);
  return [`${usagePercent(used)} used`, pace?.label.toLowerCase(), comparison].filter(Boolean).join(", ");
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
