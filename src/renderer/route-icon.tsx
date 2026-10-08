import type { ReactNode } from "react";
import type { RemoteRoute } from "../shared/ipc";

/** Tailscale's mark is from its brand page, since svgl has none. The local network route is a plain
 * Wi-Fi glyph. Both draw in the page ink. */
const marks: Record<RemoteRoute, { viewBox: string; children: ReactNode }> = {
  tailscale: {
    viewBox: "0 0 28 28",
    children: (
      <>
        {[3.5, 14, 24.5].flatMap((y) =>
          [3.5, 14, 24.5].map((x) => (
            <circle
              key={`${x} ${y}`}
              cx={x}
              cy={y}
              r={3.5}
              fill="currentColor"
              opacity={y === 14 || (y === 24.5 && x === 14) ? 1 : 0.4}
            />
          )),
        )}
      </>
    ),
  },
  localNetwork: {
    viewBox: "0 0 24 24",
    children: (
      <g fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
        <path d="M2 8.8a15 15 0 0 1 20 0" />
        <path d="M5 12.6a10.5 10.5 0 0 1 14 0" />
        <path d="M8.5 16.4a5.5 5.5 0 0 1 7 0" />
        <circle cx={12} cy={20} r={0.6} />
      </g>
    ),
  },
};

/** The mark that leads a route row. The route name carries the meaning, so the mark is hidden from
 * assistive technology. */
export function RouteIcon({ kind }: { kind: RemoteRoute }) {
  const mark = marks[kind];
  return (
    <svg className="route-icon" viewBox={mark.viewBox} aria-hidden="true">
      {mark.children}
    </svg>
  );
}
