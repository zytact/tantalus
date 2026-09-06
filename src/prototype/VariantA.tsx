// PROTOTYPE variant A: "Dial" - one radial gauge for the window that runs out first.
import { countdown, pct, statusLabel, updatedAt } from "./format";
import type { UsageSnapshot, VariantProps } from "./types";

export const nameA = "Dial";

function binding(snapshot: UsageSnapshot) {
  const five = snapshot.five_hour.used_percent ?? 0;
  const seven = snapshot.seven_day.used_percent ?? 0;
  return five >= seven
    ? { label: "5-hour window", window: snapshot.five_hour, other: { label: "7 days", window: snapshot.seven_day } }
    : { label: "7-day window", window: snapshot.seven_day, other: { label: "5 hours", window: snapshot.five_hour } };
}

export function VariantA({ snapshot, refreshing, onRefresh }: VariantProps) {
  const { label, window, other } = binding(snapshot);
  const used = window.used_percent ?? 0;
  const radius = 88;
  const circumference = Math.PI * radius; // half circle
  const blocked = snapshot.allowed === false || snapshot.limit_reached === true;

  return (
    <div className="va">
      <div className="va-top">
        <span className={`va-chip va-chip--${blocked ? "bad" : snapshot.status}`}>{blocked ? "Blocked" : statusLabel(snapshot.status)}</span>
        <button className="va-refresh" onClick={onRefresh} disabled={refreshing}>{refreshing ? "..." : "Refresh"}</button>
      </div>

      <div className="va-gauge">
        <svg viewBox="0 0 220 122" role="img" aria-label={`${label} ${pct(window.used_percent)} used`}>
          <path d="M 22 110 A 88 88 0 0 1 198 110" className="va-track" />
          <path
            d="M 22 110 A 88 88 0 0 1 198 110"
            className={`va-fill ${used >= 90 ? "va-fill--hot" : ""}`}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - Math.min(100, used) / 100)}
          />
        </svg>
        <div className="va-readout">
          <strong>{pct(window.used_percent)}</strong>
          <span>used</span>
        </div>
      </div>

      <p className="va-caption">{label} resets in <b>{countdown(window.reset_at_epoch)}</b></p>

      <div className="va-secondary">
        <div>
          <span className="va-key">{other.label}</span>
          <span className="va-val">{pct(other.window.used_percent)}</span>
          <span className="va-sub">resets in {countdown(other.window.reset_at_epoch)}</span>
        </div>
        <div>
          <span className="va-key">Reset credits</span>
          <span className="va-val">{snapshot.reset_credit_count ?? "--"}</span>
          <span className="va-sub">{snapshot.reset_credits.length ? "no expiry reported" : "none banked"}</span>
        </div>
      </div>

      {snapshot.error_message && <p className="va-error">{snapshot.error_message}</p>}
      <p className="va-foot">Updated {updatedAt(snapshot.last_successful_update_epoch)} - auto every minute</p>
    </div>
  );
}
