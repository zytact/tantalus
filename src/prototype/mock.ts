// PROTOTYPE: fake snapshot so `pnpm dev` renders variants in a plain browser, without the Tauri backend.
import type { UsageSnapshot } from "./types";

const now = Date.now() / 1000;

export const mockSnapshot: UsageSnapshot = {
  five_hour: { used_percent: 48, limit_window_seconds: 18_000, reset_at_epoch: now + 3600 * 3.5 },
  seven_day: { used_percent: 70, limit_window_seconds: 604_800, reset_at_epoch: now + 3600 * 117 },
  allowed: true,
  limit_reached: false,
  reset_credits: [{ expires_at_epoch: null }, { expires_at_epoch: null }],
  reset_credit_count: 2,
  last_successful_update_epoch: now - 90,
  status: "ready",
  error_message: null
};
