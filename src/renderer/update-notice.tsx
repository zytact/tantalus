import { useState } from "react";
import { usePublishedState } from "./published-state";

/** Offers the release the main process found in the background. Installing relaunches into the new version, so
 * a success never comes back here; only a failure, such as a cancelled password prompt, does. */
export function UpdateNotice() {
  const [update] = usePublishedState("updateAvailable");
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!update) return null;

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      await window.tantalus.invoke("installUpdate");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not install the update.");
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
