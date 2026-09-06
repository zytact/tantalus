import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type WindowUsage = { used_percent: number | null; limit_window_seconds: number | null; reset_at_epoch: number | null };
type ResetCredit = { expires_at_epoch: number | null };
type UsageSnapshot = {
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

const emptySnapshot: UsageSnapshot = {
  five_hour: { used_percent: null, limit_window_seconds: null, reset_at_epoch: null }, seven_day: { used_percent: null, limit_window_seconds: null, reset_at_epoch: null },
  allowed: null, limit_reached: null, reset_credits: [], reset_credit_count: null,
  last_successful_update_epoch: null, status: "loading", error_message: null
};

function percent(value: number | null) { return value === null ? "Unavailable" : `${Math.round(value)}% used`; }
function time(value: number | null) {
  if (value === null) return "Unavailable";
  const seconds = Math.max(0, value - Date.now() / 1000);
  if (seconds < 60) return "Resetting now";
  const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `Resets in ${hours}h ${minutes}m` : `Resets in ${minutes}m`;
}
function absoluteTime(value: number | null) { return value === null ? "No expiry reported" : new Date(value * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
function lastUpdate(value: number | null) { return value === null ? "No successful update yet" : `Updated ${new Date(value * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`; }

function UsageRow({ title, duration, window }: { title: string; duration: number; window: WindowUsage }) {
  const used = window.used_percent;
  const reported = window.limit_window_seconds === duration;
  const rowTitle = reported ? title : "Usage window unavailable";
  return <section className="usage-row" aria-labelledby={`${title}-title`}>
    <div className="row-top"><h2 id={`${title}-title`}>{rowTitle}</h2><strong>{percent(reported ? used : null)}</strong></div>
    <div className="meter" role="progressbar" aria-label={`${rowTitle} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={reported ? used ?? undefined : undefined} aria-valuetext={percent(reported ? used : null)}>
      <span style={{ width: `${Math.min(100, Math.max(0, reported ? used ?? 0 : 0))}%` }} />
    </div>
    <div className="row-bottom"><span>{reported ? time(window.reset_at_epoch) : "No recognized duration was reported"}</span><span>{reported && window.reset_at_epoch !== null ? absoluteTime(window.reset_at_epoch) : ""}</span></div>
  </section>;
}

function App() {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try { setSnapshot(await invoke<UsageSnapshot>("refresh_usage")); }
    finally { setRefreshing(false); }
  };
  useEffect(() => {
    void invoke<UsageSnapshot>("cached_usage").then(setSnapshot);
    const unlisten = listen<UsageSnapshot>("usage-snapshot", (event) => setSnapshot(event.payload));
    return () => { void unlisten.then((stop) => stop()); };
  }, []);
  const statusText = snapshot.status === "auth_missing" ? "Authentication needed" : snapshot.status === "error" ? "Could not refresh" : snapshot.status === "stale" ? "Showing cached data" : snapshot.allowed === false || snapshot.limit_reached ? "Allowance blocked" : "Allowance available";
  return <main>
    <header><div><p className="app-name">Codex usage</p><h1>{statusText}</h1></div><button onClick={() => void refresh()} disabled={refreshing} aria-busy={refreshing}>{refreshing ? "Refreshing" : "Refresh"}</button></header>
    {(snapshot.status === "auth_missing" || snapshot.status === "error" || snapshot.status === "stale") && <p className="notice" role="status">{snapshot.error_message ?? "The last successful reading remains visible."}</p>}
    <div className="usage-list"><UsageRow title="5-hour window" duration={18_000} window={snapshot.five_hour} /><UsageRow title="7-day window" duration={604_800} window={snapshot.seven_day} /></div>
    <section className="credits" aria-labelledby="credits-title"><div><h2 id="credits-title">Reset credits</h2><strong>{snapshot.reset_credit_count === null ? "Unavailable" : `${snapshot.reset_credit_count} available`}</strong></div>
      {snapshot.reset_credits.length > 0 ? <ul>{snapshot.reset_credits.map((credit, index) => <li key={index}>Credit {index + 1}<time>{absoluteTime(credit.expires_at_epoch)}</time></li>)}</ul> : <p>No credit expiry details available.</p>}
    </section>
    <footer><span>{lastUpdate(snapshot.last_successful_update_epoch)}</span><span>Auto-refreshes every minute</span></footer>
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
