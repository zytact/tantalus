import { useState } from "react";
import type { ReactNode } from "react";
import { version as runningVersion } from "../../package.json";
import type { AvailableUpdate, InstallProgress, ReleaseNotice } from "../shared/ipc";
import { installStatus } from "./presentation";
import { BusyButton } from "./busy";
import { usePublishedState } from "./published-state";
import { ReleaseNotesPage } from "./release-notes";

/** Whose update is on offer: this app's, or with `host` the one waiting on the host a paired device
 * shows. `onHost` says where in a sentence about it, and `range` names the versions its release notes span. */
function sourceFor(host: string | undefined) {
  return host === undefined
    ? ({
        update: "updateAvailable",
        progress: "installProgress",
        check: "checkForUpdate",
        install: "installUpdate",
        notes: "releaseNotes",
        onHost: "",
        range: (version: string) => `v${runningVersion} to v${version}`,
      } as const)
    : ({
        update: "hostUpdate",
        progress: "hostInstallProgress",
        check: "checkForHostUpdate",
        install: "installHostUpdate",
        notes: "hostReleaseNotes",
        onHost: ` on ${host}`,
        range: (version: string) => `Up to v${version} on ${host}`,
      } as const);
}
type Source = ReturnType<typeof sourceFor>;

/** Offers the release the main process found in the background. Installing relaunches into the new version, so
 * a success never comes back here; only a failure, such as a cancelled password prompt, does. With
 * `host`, the name of the host a paired device shows, it offers that host's update instead. */
export function UpdateNotice({ host }: { host?: string }) {
  const source = sourceFor(host);
  const [update] = usePublishedState(source.update);
  const [progress] = usePublishedState(source.progress);
  if (!update) return null;
  return update.manualInstall ? (
    <ManualUpdate version={update.version} host={host} />
  ) : (
    <InstallableUpdate update={update} progress={progress} source={source} />
  );
}

/** A fresh install happens at the host's own screen, so a paired device can only say it is needed. */
function ManualUpdate({ version, host }: { version: string; host?: string }) {
  return (
    <section className="update update-manual" aria-label="Update available">
      {host === undefined ? (
        <>
          <p>Version {version} is available. Quit Tantalus, then download and install the latest release.</p>
          <button onClick={() => void window.tantalus.invoke("openLatestRelease")}>Open latest release</button>
        </>
      ) : (
        <p>
          Version {version} is available on {host}, and it needs a fresh install. Quit Tantalus there, then download and
          install the latest release.
        </p>
      )}
    </section>
  );
}

function InstallableUpdate({
  update,
  progress,
  source,
}: {
  update: AvailableUpdate;
  progress: InstallProgress | null;
  source: Source;
}) {
  const { onHost } = source;
  const { installing, error, install } = useInstall(source.install);
  const [notesOpen, setNotesOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const noticeKey = `${update.version}:${update.notices.map(({ id }) => id).join(",")}`;
  const accepted = update.notices.length === 0 || acknowledged === noticeKey;
  const noticeContent = (
    <NoticeAcknowledgement
      notices={update.notices}
      accepted={accepted}
      onChange={(checked) => setAcknowledged(checked ? noticeKey : null)}
    />
  );
  const installButton = (
    <BusyButton
      label="Install update"
      busyLabel="Installing"
      busy={installing}
      disabled={!accepted}
      onClick={() => void install(update.notices.map(({ id }) => id))}
    />
  );
  const alert = <InstallError error={error} />;
  const footer = (
    <>
      {alert}
      {noticeContent}
      <InstallProgressStrip version={update.version} progress={progress}>
        <div className="release-notes-install">
          <p>Tantalus{onHost} relaunches after installing.</p>
          {installButton}
        </div>
      </InstallProgressStrip>
    </>
  );

  return (
    <>
      <UpdateBanner
        version={update.version}
        onHost={onHost}
        progress={progress}
        notice={noticeContent}
        installButton={installButton}
        onNotes={() => setNotesOpen(true)}
      />
      {alert}
      {notesOpen && (
        <ReleaseNotesPage
          range={source.range(update.version)}
          command={source.notes}
          onClose={() => setNotesOpen(false)}
          footer={footer}
        />
      )}
    </>
  );
}

function UpdateBanner({
  version,
  onHost,
  progress,
  notice,
  installButton,
  onNotes,
}: {
  version: string;
  onHost: string;
  progress: InstallProgress | null;
  notice: ReactNode;
  installButton: ReactNode;
  onNotes: () => void;
}) {
  return (
    <InstallProgressStrip version={version} progress={progress}>
      <section className="update" aria-label="Update available">
        <div className="update-content">
          <p>
            Version {version} is available{onHost}.
          </p>
          {notice}
          <div className="update-actions">
            <button className="quiet" onClick={onNotes}>
              What's new
            </button>
            {installButton}
          </div>
        </div>
      </section>
    </InstallProgressStrip>
  );
}

function NoticeAcknowledgement({
  notices,
  accepted,
  onChange,
}: {
  notices: ReleaseNotice[];
  accepted: boolean;
  onChange: (checked: boolean) => void;
}) {
  if (notices.length === 0) return null;
  return (
    <div className="update-notices" role="alert">
      <strong>Before you update</strong>
      {notices.map(({ id, message }) => (
        <p key={id}>{message}</p>
      ))}
      <label>
        <input type="checkbox" checked={accepted} onChange={(event) => onChange(event.target.checked)} />
        I have read these notices
      </label>
    </div>
  );
}

/** Stands in for `children` while an install runs. Only the download can be measured, so the steps
 * after it, and a download of unstated size, slide a bar instead of filling it. */
function InstallProgressStrip({
  version,
  progress,
  children,
}: {
  version: string;
  progress: InstallProgress | null;
  children: ReactNode;
}) {
  if (!progress) return children;
  const { label, detail, percent } = installStatus(version, progress);
  return (
    <section className="update" aria-label="Installing update">
      <p>
        <strong>{label}</strong> <span className="update-detail">{detail}</span>
      </p>
      {percent !== null && <span className="update-detail">{percent}%</span>}
      <ProgressBar percent={percent} />
    </section>
  );
}

function ProgressBar({ percent }: { percent: number | null }) {
  return percent === null ? (
    <div className="update-progress" role="progressbar" aria-label="Update progress" data-indeterminate>
      <span />
    </div>
  ) : (
    <div className="update-progress" role="progressbar" aria-label="Update progress" aria-valuenow={percent}>
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

function useInstall(command: Source["install"]) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const install = async (acknowledgedNoticeIds: string[]) => {
    setInstalling(true);
    setError(null);
    try {
      await window.tantalus.invoke(command, acknowledgedNoticeIds);
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

/** A manual check for this app's update, or with `host` for the one on the host a paired device shows.
 * A found release is offered by the update notice, which the announcement reaches the same way as a
 * background check. */
export function useUpdateCheck(host?: string) {
  const [state, setState] = useState<"idle" | "checking" | "latest">("idle");
  const [error, setError] = useState<string | null>(null);
  const check = async (): Promise<AvailableUpdate | null> => {
    setState("checking");
    setError(null);
    try {
      const update = await window.tantalus.invoke(sourceFor(host).check);
      setState(update ? "idle" : "latest");
      return update;
    } catch (reason) {
      setState("idle");
      setError(reason instanceof Error ? reason.message : "Could not check for updates.");
      return null;
    }
  };
  return { state, error, check };
}

/** The manual check a paired device has for its host's update. The button names the host, since a
 * Tantalus following one also has a check for its own version. `onFound` runs when a release turns up. */
export function HostUpdateCheck({ host, onFound }: { host: string; onFound?: () => void }) {
  const { state, error, check } = useUpdateCheck(host);
  return (
    <>
      <section className="setting-row">
        <div className="setting-copy">
          <h2>Tantalus on {host}</h2>
          <p>
            {state === "latest"
              ? `Tantalus on ${host} is up to date.`
              : `Look for a newer release of Tantalus on ${host} and install it from here.`}
          </p>
        </div>
        <BusyButton
          label={`Check ${host} for updates`}
          busyLabel="Checking"
          busy={state === "checking"}
          onClick={() => void check().then((update) => update && onFound?.())}
        />
      </section>
      {error && (
        <p className="notice settings-notice" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
