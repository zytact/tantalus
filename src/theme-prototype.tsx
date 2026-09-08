// PROTOTYPE - throwaway. Floating switcher for the three dark-theme variants, rendered on the
// real allowance route. Reads ?variant=a|b|c and ?appearance=auto|light|dark, writes both back to
// the URL so a reload keeps the choice. Never rendered in a production build.
import { useEffect, useState } from "react";
import "./theme-prototype.css";

const variants = [
  ["a", "Targaryen faithful"],
  ["b", "Inverted press"],
  ["c", "Layered ember"],
] as const;
const appearances = ["auto", "light", "dark"] as const;

type Variant = (typeof variants)[number][0];
type Appearance = (typeof appearances)[number];

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const value = new URLSearchParams(location.search).get(key);
  return allowed.find((option) => option === value) ?? fallback;
}

export function ThemePrototypeBar() {
  const [variant, setVariant] = useState<Variant>(() =>
    read(
      "variant",
      variants.map(([key]) => key),
      "a",
    ),
  );
  const [appearance, setAppearance] = useState<Appearance>(() => read("appearance", appearances, "dark"));

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.protoVariant = variant;
    if (appearance === "auto") delete root.dataset.protoAppearance;
    else root.dataset.protoAppearance = appearance;
    const params = new URLSearchParams(location.search);
    params.set("variant", variant);
    params.set("appearance", appearance);
    history.replaceState(null, "", `?${params}`);
  }, [variant, appearance]);

  const step = (delta: number) => {
    const keys = variants.map(([key]) => key);
    setVariant(keys[(keys.indexOf(variant) + delta + keys.length) % keys.length]!);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const name = variants.find(([key]) => key === variant)?.[1];
  return (
    <div className="proto-bar">
      <button onClick={() => step(-1)} aria-label="Previous variant">
        ←
      </button>
      <span>
        {variant.toUpperCase()} · {name}
      </span>
      <button onClick={() => step(1)} aria-label="Next variant">
        →
      </button>
      <button onClick={() => setAppearance(appearances[(appearances.indexOf(appearance) + 1) % 3]!)}>
        {appearance}
      </button>
    </div>
  );
}
