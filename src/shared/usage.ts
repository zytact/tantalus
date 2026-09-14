export type WindowUsage = {
  used_percent: number | null;
  limit_window_seconds: number | null;
  reset_at_epoch: number | null;
};
export type ResetCredit = { expires_at_epoch: number | null };
/** Claude's paid overflow allowance. Codex has no equivalent and leaves this empty. */
export type ExtraUsage = {
  enabled: boolean;
  used_credits: number | null;
  monthly_limit: number | null;
  currency: string | null;
};
export type SnapshotStatus = "ready" | "loading" | "stale" | "auth_missing" | "error";
/** One provider's reading. Each provider succeeds or fails on its own, so status and freshness live
 * here rather than on the snapshot. */
export type ProviderUsage = {
  five_hour: WindowUsage;
  seven_day: WindowUsage;
  /** Opencode reports this alongside the other two, and it is the only window a Codex Go or free
   * account has. Claude leaves it unreported and the view skips it. */
  monthly: WindowUsage;
  allowed: boolean | null;
  limit_reached: boolean | null;
  reset_credits: ResetCredit[];
  reset_credit_count: number | null;
  extra_usage: ExtraUsage | null;
  last_successful_update_epoch: number | null;
  status: SnapshotStatus;
  error_message: string | null;
};
export type ProviderId = "codex" | "claude" | "opencode";
export type ProviderSettings = Record<ProviderId, boolean>;
export type UsageSnapshot = Record<ProviderId, ProviderUsage> & { enabled: ProviderSettings };

export const providerIds = ["codex", "claude", "opencode"] as const satisfies readonly ProviderId[];
export const providerNames: Record<ProviderId, string> = {
  codex: "Codex",
  claude: "Claude",
  opencode: "Opencode",
};

/** The durations that identify each window. A window reporting another duration is not shown. */
export const fiveHourSeconds = 18_000;
export const sevenDaySeconds = 604_800;
/** The monthly window Opencode reports, and the only window a Codex Go or free account has. It
 * renews a month after the plan started rather than on a calendar boundary, so 30 days is the
 * duration that identifies it. */
export const monthlySeconds = 2_592_000;

export const unreportedWindow = (): WindowUsage => ({
  used_percent: null,
  limit_window_seconds: null,
  reset_at_epoch: null,
});

/** A provider nothing has been read for yet. */
export const emptyProviderUsage = (): ProviderUsage => ({
  five_hour: unreportedWindow(),
  seven_day: unreportedWindow(),
  monthly: unreportedWindow(),
  allowed: null,
  limit_reached: null,
  reset_credits: [],
  reset_credit_count: null,
  extra_usage: null,
  last_successful_update_epoch: null,
  status: "loading",
  error_message: null,
});

export const nowEpoch = () => Math.floor(Date.now() / 1000);

/** Advances a server-supplied epoch by monotonic elapsed time. */
export function clockEpoch(serverEpoch: number, elapsedMilliseconds: number): number {
  return serverEpoch + elapsedMilliseconds / 1000;
}

/** Opencode reports fractional percentages, so one decimal is kept when the reading has one. The
 * providers that report whole numbers never grow a hollow ".0". */
export function percent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

const PACE_TOLERANCE = 2;

const paceLabels = {
  under: "Under pace",
  on: "On pace",
  ahead: "Ahead of pace",
} as const;

export type UsagePace = {
  expectedPercent: number;
  status: keyof typeof paceLabels;
  label: (typeof paceLabels)[keyof typeof paceLabels];
};

export function usagePace(window: WindowUsage, now: number): UsagePace | null {
  const { used_percent: used, limit_window_seconds: duration, reset_at_epoch: reset } = window;
  if (used === null || duration === null || reset === null || duration <= 0) return null;
  const expectedPercent = Math.min(100, Math.max(0, ((now - (reset - duration)) / duration) * 100));
  const status = paceStatus(used, expectedPercent);
  return { expectedPercent, status, label: paceLabels[status] };
}

function paceStatus(used: number, expectedPercent: number): UsagePace["status"] {
  if (Math.abs(used - expectedPercent) <= PACE_TOLERANCE) return "on";
  return used < expectedPercent ? "under" : "ahead";
}

/** The newest successful reading among the enabled providers. */
export function refreshedEpoch(snapshot: UsageSnapshot): number | null {
  const epochs = providerIds
    .filter((id) => snapshot.enabled[id])
    .map((id) => snapshot[id].last_successful_update_epoch)
    .filter((epoch) => epoch !== null);
  return epochs.length > 0 ? Math.max(...epochs) : null;
}

/** Whole units, floored, so the label only moves forward. */
export function refreshedAgo(epoch: number | null, now: number): string {
  if (epoch === null) return "Not refreshed yet";
  const minutes = Math.floor(Math.max(0, now - epoch) / 60);
  if (minutes < 1) return "Refreshed just now";
  if (minutes < 60) return ago(minutes, "minute");
  if (minutes < 1440) return ago(Math.floor(minutes / 60), "hour");
  return ago(Math.floor(minutes / 1440), "day");
}

function ago(count: number, unit: "minute" | "hour" | "day"): string {
  return `Refreshed ${count} ${unit}${count === 1 ? "" : "s"} ago`;
}
