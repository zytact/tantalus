// PROTOTYPE: shared snapshot types, extracted so variants can import them.
export type WindowUsage = { used_percent: number | null; limit_window_seconds: number | null; reset_at_epoch: number | null };
export type ResetCredit = { expires_at_epoch: number | null };
export type UsageSnapshot = {
  five_hour: WindowUsage;
  seven_day: WindowUsage;
  allowed: boolean | null;
  limit_reached: boolean | null;
  reset_credits: ResetCredit[];
  reset_credit_count: number | null;
  last_successful_update_epoch: number | null;
  status: "ready" | "loading" | "stale" | "auth_missing" | "error";
  error_message: string | null;
};

export type VariantProps = {
  snapshot: UsageSnapshot;
  refreshing: boolean;
  onRefresh: () => void;
};
