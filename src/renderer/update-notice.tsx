import { useState } from "react";
import { BusyButton } from "./busy";
import { usePublishedState } from "./published-state";
import { ReleaseNotesPage } from "./release-notes";

/** Offers the release the main process found in the background. Installing relaunches into the new version, so
 * a success never comes back here; only a failure, such as a cancelled password prompt, does. */
export function UpdateNotice() {
  const [update] = usePublishedState("updateAvailable");
  const { installing, error, install } = useInstall();
  const [notesOpen, setNotesOpen] = useState(false);

  if (!update) return null;

  const installButton = (
    <BusyButton label="Install update" busyLabel="Installing" busy={installing} onClick={() => void install()} />
  );
  const alert = <InstallError error={error} />;

  return (
    <>
      <section className="update" aria-label="Update available">
        <p>Version {update.version} is available.</p>
        <div className="update-actions">
          <button className="quiet" onClick={() => setNotesOpen(true)}>
            What's new
          </button>
          {installButton}
        </div>
      </section>
      {!notesOpen && alert}
      {notesOpen && (
        <ReleaseNotesPage
          target={update.version}
          onClose={() => setNotesOpen(false)}
          footer={
            <>
              {alert}
              <div className="release-notes-install">
                <p>Tantalus relaunches after installing.</p>
                {installButton}
              </div>
            </>
          }
        />
      )}
    </>
  );
}

function useInstall() {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  return { installing, error, install };
}

function InstallError({ error }: { error: string | null }) {
  return (
    error && (
      <p className="notice" role="alert">
        {error}
      </p>
    )
  );
}
