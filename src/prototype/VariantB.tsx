// PROTOTYPE variant B: "Runway" - time-first. Each window is a countdown with a segmented burn bar.
import { clockTime, countdown, pct, updatedAt } from "./format";
import type { VariantProps, WindowUsage } from "./types";

export const nameB = "Runway";

const SEGMENTS = 24;

function Runway({ title, window, tone }: { title: string; window: WindowUsage; tone: "warm" | "cool" }) {
  const used = Math.min(100, Math.max(0, window.used_percent ?? 0));
  const filled = Math.round((used / 100) * SEGMENTS);
  return (
    <section className={`vb-card vb-card--${tone}`}>
      <div className="vb-card-head">
        <h2>{title}</h2>
        <span className="vb-remaining">{pct(window.used_percent === null ? null : 100 - window.used_percent)} left</span>
      </div>
      <div className="vb-clock">
        <strong>{countdown(window.reset_at_epoch)}</strong>
        <span>until reset - {clockTime(window.reset_at_epoch)}</span>
      </div>
      <div className="vb-segments" role="img" aria-label={`${pct(window.used_percent)} used`}>
        {Array.from({ length: SEGMENTS }, (_, index) => (
          <i key={index} className={index < filled ? "on" : ""} />
        ))}
      </div>
    </section>
  );
}

export function VariantB({ snapshot, refreshing, onRefresh }: VariantProps) {
  const credits = snapshot.reset_credit_count ?? 0;
  return (
    <div className="vb">
      <header className="vb-head">
        <div>
          <p>Tantalus</p>
          <h1>{snapshot.allowed === false || snapshot.limit_reached ? "Out of allowance" : "Running"}</h1>
        </div>
        <button onClick={onRefresh} disabled={refreshing} aria-busy={refreshing}>{refreshing ? "Syncing" : "Sync"}</button>
      </header>

      {snapshot.error_message && <p className="vb-notice">{snapshot.error_message}</p>}

      <Runway title="5-hour window" window={snapshot.five_hour} tone="warm" />
      <Runway title="7-day window" window={snapshot.seven_day} tone="cool" />

      <section className="vb-credits">
        <div className="vb-credit-dots" aria-hidden>
          {Array.from({ length: Math.max(credits, 3) }, (_, index) => (
            <i key={index} className={index < credits ? "on" : ""} />
          ))}
        </div>
        <div>
          <strong>{snapshot.reset_credit_count ?? "--"} reset credits</strong>
          <span>{credits ? "spend one to clear the 5-hour window" : "none banked right now"}</span>
        </div>
      </section>

      <footer className="vb-foot">Updated {updatedAt(snapshot.last_successful_update_epoch)}</footer>
    </div>
  );
}
