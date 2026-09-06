// PROTOTYPE: floating variant switcher. Never rendered in a production build.
import { useEffect } from "react";

export function useVariant(keys: readonly string[]) {
  const fromUrl = new URLSearchParams(window.location.search).get("variant");
  const current = keys.includes(fromUrl ?? "") ? (fromUrl as string) : keys[0];

  const go = (offset: number) => {
    const next = keys[(keys.indexOf(current) + offset + keys.length) % keys.length];
    const params = new URLSearchParams(window.location.search);
    params.set("variant", next);
    window.history.replaceState(null, "", `?${params.toString()}`);
    window.dispatchEvent(new Event("popstate"));
  };

  return { current, go };
}

export function PrototypeSwitcher({ label, go }: { label: string; go: (offset: number) => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  return (
    <div className="proto-switcher">
      <button onClick={() => go(-1)} aria-label="Previous variant">‹</button>
      <span>{label}</span>
      <button onClick={() => go(1)} aria-label="Next variant">›</button>
    </div>
  );
}
