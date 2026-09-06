// PROTOTYPE variant 0: the shipped design, kept for side-by-side comparison.
import { usagePercent } from "../presentation";
import type { VariantProps, WindowUsage } from "./types";

export const nameCurrent = "Shipped";

function time(value: number | null) {
  if (value === null) return "Unavailable";
  const seconds = Math.max(0, value - Date.now() / 1000);
  if (seconds < 60) return "Resetting now";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `Resets in ${hours}h ${minutes}m` : `Resets in ${minutes}m`;
}
function absoluteTime(value: number | null) {
  return value === null ? "No expiry reported" : new Date(value * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
function lastUpdate(value: number | null) {
  return value === null ? "No successful update yet" : `Updated ${new Date(value * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function UsageRow({ title, titleId, duration, window }: { title: string; titleId: string; duration: number; window: WindowUsage }) {
  const used = window.used_percent;
  const reported = window.limit_window_seconds === duration;
  const rowTitle = reported ? title : "Usage window unavailable";
  return <section className="usage-row" aria-labelledby={titleId}>
    <div className="row-top"><h2 id={titleId}>{rowTitle}</h2><strong>{usagePercent(reported ? used : null)}</strong></div>
    <div className="meter" role="progressbar" aria-label={`${rowTitle} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={reported ? used ?? undefined : undefined} aria-valuetext={usagePercent(reported ? used : null)}>
      <span style={{ width: `${Math.min(100, Math.max(0, reported ? used ?? 0 : 0))}%` }} />
    </div>
    <div className="row-bottom"><span>{reported ? time(window.reset_at_epoch) : "No recognized duration was reported"}</span><span>{reported && window.reset_at_epoch !== null ? absoluteTime(window.reset_at_epoch) : ""}</span></div>
  </section>;
}

export function VariantCurrent({ snapshot, refreshing, onRefresh }: VariantProps) {
  const statusText = snapshot.status === "auth_missing" ? "Authentication needed"
    : snapshot.status === "error" ? "Could not refresh"
    : snapshot.status === "stale" ? "Showing cached data"
    : snapshot.allowed === false || snapshot.limit_reached ? "Allowance blocked" : "Allowance available";
  return <main>
    <header><div><p className="app-name">Tantalus</p><h1>{statusText}</h1></div><button onClick={onRefresh} disabled={refreshing} aria-busy={refreshing}>{refreshing ? "Refreshing" : "Refresh"}</button></header>
    {(snapshot.status === "auth_missing" || snapshot.status === "error" || snapshot.status === "stale") && <p className="notice" role="status">{snapshot.error_message ?? "The last successful reading remains visible."}</p>}
    <div className="usage-list"><UsageRow title="5-hour window" titleId="five-hour-window-title" duration={18_000} window={snapshot.five_hour} /><UsageRow title="7-day window" titleId="seven-day-window-title" duration={604_800} window={snapshot.seven_day} /></div>
    <section className="credits" aria-labelledby="credits-title"><div><h2 id="credits-title">Reset credits</h2><strong>{snapshot.reset_credit_count === null ? "Unavailable" : `${snapshot.reset_credit_count} available`}</strong></div>
      {snapshot.reset_credits.length > 0 ? <ul>{snapshot.reset_credits.map((credit, index) => <li key={index}>Credit {index + 1}<time>{absoluteTime(credit.expires_at_epoch)}</time></li>)}</ul> : <p>No credit expiry details available.</p>}
    </section>
    <footer><span>{lastUpdate(snapshot.last_successful_update_epoch)}</span><span>Auto-refreshes every minute</span></footer>
  </main>;
}
