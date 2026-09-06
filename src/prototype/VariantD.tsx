// PROTOTYPE variant D: "Tiles" - two full-bleed tiles that fill from the bottom as the window burns.
import { countdown, pct, updatedAt } from "./format";
import type { VariantProps, WindowUsage } from "./types";

export const nameD = "Tiles";

function Tile({ title, window, accent }: { title: string; window: WindowUsage; accent: string }) {
  const used = Math.min(100, Math.max(0, window.used_percent ?? 0));
  return (
    <section className="vd-tile" style={{ ["--accent" as string]: accent }}>
      <div className="vd-flood" style={{ height: `${used}%` }} />
      <div className="vd-tile-body">
        <p className="vd-tile-title">{title}</p>
        <strong className="vd-tile-num">{pct(window.used_percent)}</strong>
        <p className="vd-tile-sub">resets in {countdown(window.reset_at_epoch)}</p>
      </div>
    </section>
  );
}

export function VariantD({ snapshot, refreshing, onRefresh }: VariantProps) {
  const blocked = snapshot.allowed === false || snapshot.limit_reached === true;
  return (
    <div className="vd">
      <div className="vd-tiles">
        <Tile title="5 hours" window={snapshot.five_hour} accent="#f2b544" />
        <Tile title="7 days" window={snapshot.seven_day} accent="#7fb2ee" />
      </div>

      <div className="vd-bar">
        <div className="vd-bar-main">
          <strong>{blocked ? "Allowance blocked" : "Allowance available"}</strong>
          <span>
            {snapshot.reset_credit_count ?? "--"} reset credits - updated {updatedAt(snapshot.last_successful_update_epoch)}
          </span>
          {snapshot.error_message && <span className="vd-err">{snapshot.error_message}</span>}
        </div>
        <button onClick={onRefresh} disabled={refreshing} aria-busy={refreshing}>{refreshing ? "..." : "Refresh"}</button>
      </div>
    </div>
  );
}
