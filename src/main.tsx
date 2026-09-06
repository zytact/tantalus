import "@fontsource-variable/inter-tight/wght.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-500.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { absoluteTime, countdown, creditExpiry, lastUpdate, remainingPercent, usagePercent } from "./presentation";
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
  five_hour: { used_percent: null, limit_window_seconds: null, reset_at_epoch: null },
  seven_day: { used_percent: null, limit_window_seconds: null, reset_at_epoch: null },
  allowed: null, limit_reached: null, reset_credits: [], reset_credit_count: null,
  last_successful_update_epoch: null, status: "loading", error_message: null
};

function statusLine(snapshot: UsageSnapshot): string {
  switch (snapshot.status) {
    case "auth_missing": return "Authentication needed";
    case "error": return "Could not refresh";
    case "stale": return "Showing cached data";
    case "loading": return "Loading";
    default: return snapshot.allowed === false || snapshot.limit_reached ? "Blocked until the next reset" : "Live";
  }
}

/** One window as a ledger entry: headline figure, consumption rule, then the supporting facts. */
function Entry({ label, span, duration, window: usage }: { label: string; span: string; duration: number; window: WindowUsage }) {
  const reported = usage.limit_window_seconds === duration;
  const used = reported ? usage.used_percent : null;
  const entryLabel = reported ? label : "Window unavailable";
  return (
    <section className="entry" aria-label={entryLabel}>
      <div className="entry-head">
        <h2>{entryLabel}<i>{reported ? span : "unrecognized duration"}</i></h2>
        <strong className="figure">{usagePercent(used)}</strong>
      </div>
      <div
        className="rule"
        role="progressbar"
        aria-label={`${entryLabel} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used ?? undefined}
        aria-valuetext={usagePercent(used)}
      >
        <span style={{ width: `${Math.min(100, Math.max(0, used ?? 0))}%` }} />
      </div>
      <dl className="facts">
        <div><dt>Resets</dt><dd>{countdown(reported ? usage.reset_at_epoch : null)}</dd></div>
        <div><dt>At</dt><dd>{absoluteTime(reported ? usage.reset_at_epoch : null)}</dd></div>
        <div><dt>Remaining</dt><dd>{remainingPercent(used)}</dd></div>
      </dl>
    </section>
  );
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

  const degraded = snapshot.status === "auth_missing" || snapshot.status === "error" || snapshot.status === "stale";

  return (
    <main>
      <header>
        <div>
          <h1>Allowance</h1>
          <p className="status">{statusLine(snapshot)} - {lastUpdate(snapshot.last_successful_update_epoch)}</p>
        </div>
        <button onClick={() => void refresh()} disabled={refreshing} aria-busy={refreshing}>
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </header>

      {degraded && (
        <p className="notice" role="status">{snapshot.error_message ?? "The last successful reading remains visible."}</p>
      )}

      <Entry label="Short window" span="5 hours" duration={18_000} window={snapshot.five_hour} />
      <Entry label="Long window" span="7 days" duration={604_800} window={snapshot.seven_day} />

      <section className="entry" aria-label="Reset credits">
        <div className="entry-head">
          <h2>Reset credits<i>banked</i></h2>
          <strong className="figure">{snapshot.reset_credit_count ?? "Unavailable"}</strong>
        </div>
        {snapshot.reset_credits.length > 0 ? (
          <ol className="credits">
            {snapshot.reset_credits.map((credit, index) => (
              <li key={index}><span>Credit {index + 1}</span><span>{creditExpiry(credit.expires_at_epoch)}</span></li>
            ))}
          </ol>
        ) : (
          <p className="empty">No credit details available.</p>
        )}
      </section>

      <footer>Auto-refreshes every minute</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
