import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

/** Mirrors `update::AvailableUpdate` in Rust. */
export type AvailableUpdate = { version: string };

/** Offers the release Rust found in the background. Installing relaunches into the new version, so
 * a success never comes back here; only a failure, such as a cancelled password prompt, does. */
export function UpdateNotice() {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same order as the usage snapshot: listen first, so a check finishing during the read is kept.
  useEffect(() => {
    let mounted = true;
    let stop: (() => void) | undefined;
    void listen<AvailableUpdate>("update-available", (event) => {
      if (mounted) setUpdate(event.payload);
    })
      .then((unlisten) => {
        if (mounted) stop = unlisten;
        else unlisten();
        return invoke<AvailableUpdate | null>("available_update");
      })
      .then(
        (pending) => {
          if (mounted) setUpdate((current) => current ?? pending);
        },
        () => {},
      );
    return () => {
      mounted = false;
      stop?.();
    };
  }, []);

  if (!update) return null;

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      await invoke("install_update");
    } catch (reason) {
      setError(typeof reason === "string" ? reason : "Could not install the update.");
    } finally {
      setInstalling(false);
    }
  };

  return (
    <>
      <section className="update" aria-label="Update available">
        <p>Version {update.version} is available.</p>
        <button onClick={() => void install()} disabled={installing} aria-busy={installing}>
          {installing ? "Installing" : "Install update"}
        </button>
      </section>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
