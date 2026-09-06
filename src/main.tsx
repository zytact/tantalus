// PROTOTYPE BRANCH: five renderings of the usage window, switchable via ?variant= and the bottom bar.
// Data fetching below is the real thing; only the rendered subtree changes per variant.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { mockSnapshot } from "./prototype/mock";
import { PrototypeSwitcher, useVariant } from "./prototype/PrototypeSwitcher";
import type { UsageSnapshot, VariantProps } from "./prototype/types";
import { nameA, VariantA } from "./prototype/VariantA";
import { nameB, VariantB } from "./prototype/VariantB";
import { nameC, VariantC } from "./prototype/VariantC";
import { nameCurrent, VariantCurrent } from "./prototype/VariantCurrent";
import { nameD, VariantD } from "./prototype/VariantD";
import "./styles.css";
import "./prototype/prototype.css";

const VARIANTS: Record<string, { name: string; render: (props: VariantProps) => React.ReactNode }> = {
  "0": { name: nameCurrent, render: (props) => <VariantCurrent {...props} /> },
  A: { name: nameA, render: (props) => <VariantA {...props} /> },
  B: { name: nameB, render: (props) => <VariantB {...props} /> },
  C: { name: nameC, render: (props) => <VariantC {...props} /> },
  D: { name: nameD, render: (props) => <VariantD {...props} /> }
};
const KEYS = Object.keys(VARIANTS);

const inTauri = "__TAURI_INTERNALS__" in window;

const subscribeToUrl = (onChange: () => void) => {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
};

function App() {
  // Re-render on ?variant= changes pushed by the switcher.
  useSyncExternalStore(subscribeToUrl, () => window.location.search);
  const { current, go } = useVariant(KEYS);
  const cycle = useCallback(go, [current]);

  const [snapshot, setSnapshot] = useState<UsageSnapshot>(inTauri ? { ...mockSnapshot, status: "loading" } : mockSnapshot);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = () => {
    if (!inTauri) return;
    setRefreshing(true);
    void invoke<UsageSnapshot>("refresh_usage").then(setSnapshot).finally(() => setRefreshing(false));
  };

  useEffect(() => {
    if (!inTauri) return;
    void invoke<UsageSnapshot>("cached_usage").then(setSnapshot);
    const unlisten = listen<UsageSnapshot>("usage-snapshot", (event) => setSnapshot(event.payload));
    return () => { void unlisten.then((stop) => stop()); };
  }, []);

  const variant = VARIANTS[current];
  return <>
    {variant.render({ snapshot, refreshing, onRefresh })}
    {!import.meta.env.PROD && <PrototypeSwitcher label={`${current} (${variant.name})`} go={cycle} />}
  </>;
}

createRoot(document.getElementById("root")!).render(<App />);
