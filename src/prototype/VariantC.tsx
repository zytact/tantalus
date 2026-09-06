// PROTOTYPE variant C: "Console" - dark, monospace, dense. No chrome, every field on one line.
import { clockTime, countdown, pct, statusLabel, updatedAt } from "./format";
import type { VariantProps, WindowUsage } from "./types";

export const nameC = "Console";

const WIDTH = 28;

function bar(used: number | null) {
  if (used === null) return "?".repeat(WIDTH);
  const filled = Math.round((Math.min(100, Math.max(0, used)) / 100) * WIDTH);
  return "█".repeat(filled) + "░".repeat(WIDTH - filled);
}

function Line({ label, window }: { label: string; window: WindowUsage }) {
  const used = window.used_percent;
  return (
    <div className="vc-block">
      <div className="vc-line">
        <span className="vc-label">{label}</span>
        <span className={`vc-num ${used !== null && used >= 90 ? "vc-num--hot" : ""}`}>{pct(used)}</span>
      </div>
      <pre className={used !== null && used >= 90 ? "vc-bar vc-bar--hot" : "vc-bar"}>{bar(used)}</pre>
      <div className="vc-line vc-line--dim">
        <span>reset {countdown(window.reset_at_epoch)}</span>
        <span>{clockTime(window.reset_at_epoch)}</span>
      </div>
    </div>
  );
}

export function VariantC({ snapshot, refreshing, onRefresh }: VariantProps) {
  const blocked = snapshot.allowed === false || snapshot.limit_reached === true;
  return (
    <div className="vc">
      <div className="vc-topbar">
        <span className="vc-brand">tantalus</span>
        <span className={`vc-status ${blocked ? "vc-status--bad" : "vc-status--ok"}`}>
          {blocked ? "LIMIT REACHED" : statusLabel(snapshot.status).toUpperCase()}
        </span>
      </div>

      <Line label="5h" window={snapshot.five_hour} />
      <Line label="7d" window={snapshot.seven_day} />

      <div className="vc-block">
        <div className="vc-line">
          <span className="vc-label">credits</span>
          <span className="vc-num">{snapshot.reset_credit_count ?? "--"}</span>
        </div>
        {snapshot.reset_credits.map((credit, index) => (
          <div key={index} className="vc-line vc-line--dim">
            <span>[{index + 1}]</span>
            <span>{credit.expires_at_epoch === null ? "no expiry" : clockTime(credit.expires_at_epoch)}</span>
          </div>
        ))}
      </div>

      {snapshot.error_message && <p className="vc-err">! {snapshot.error_message}</p>}

      <div className="vc-footer">
        <span>upd {updatedAt(snapshot.last_successful_update_epoch)}</span>
        <button onClick={onRefresh} disabled={refreshing}>{refreshing ? "..." : "[r] refresh"}</button>
      </div>
    </div>
  );
}
