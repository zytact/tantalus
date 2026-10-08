import { useEffect, useState } from "react";
import type { PairedDevice, PairingCode, RemoteDevices } from "../shared/ipc";
import { elapsed, nowEpoch } from "../shared/usage";
import { usePublishedState } from "./published-state";
import { SettingPending } from "./settings-controls";

/** The devices paired to read usage over remote access, and the code that pairs another. */
export function PairedDevicesRows() {
  const [published, setPublished, failed] = usePublishedState("remoteDevices");
  const { busy, error, change } = useChange(setPublished);

  return (
    <>
      <section className="setting-row">
        <div className="setting-copy">
          <h2>Paired devices</h2>
          <p>Another device can read your usage only after it pairs with a one-time code.</p>
        </div>
        {published === null ? (
          <SettingPending failed={failed} />
        ) : (
          <PairingButton offered={published.pairing !== null} busy={busy} change={change} />
        )}
      </section>
      {published && <Devices devices={published} busy={busy} change={change} />}
      {error && (
        <p className="notice settings-notice" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function Devices({ devices, busy, change }: { devices: RemoteDevices; busy: boolean; change: Change }) {
  return (
    <>
      {devices.pairing && <PairingCodeRow pairing={devices.pairing} />}
      {devices.devices.map((device) => (
        <DeviceRow
          key={device.id}
          device={device}
          busy={busy}
          onRename={(name) =>
            change(() => window.tantalus.invoke("renameDevice", device.id, name), "Could not rename the device.")
          }
          onRemove={() =>
            void change(() => window.tantalus.invoke("removeDevice", device.id), "Could not remove the device.")
          }
        />
      ))}
    </>
  );
}

type Change = (run: () => Promise<RemoteDevices>, failure: string) => Promise<boolean>;

/** Runs one device change at a time, keeping its result or saying why it failed. */
function useChange(onChange: (devices: RemoteDevices) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change: Change = async (run, failure) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await run());
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : failure);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, change };
}

function PairingButton({ offered, busy, change }: { offered: boolean; busy: boolean; change: Change }) {
  const [command, label, failure] = offered
    ? (["cancelPairing", "Cancel", "Could not cancel pairing."] as const)
    : (["offerPairing", "Pair a device", "Could not start pairing."] as const);
  return (
    <button disabled={busy} onClick={() => void change(() => window.tantalus.invoke(command), failure)}>
      {label}
    </button>
  );
}

function PairingCodeRow({ pairing }: { pairing: PairingCode }) {
  const now = useSeconds();
  const left = Math.max(0, pairing.expiresAt - now);
  const countdown = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <section className="setting-row pairing">
      <div className="setting-copy">
        <p>Open one of the addresses above on the other device and enter this code. It expires in {countdown}.</p>
        <p className="pairing-code">{pairing.code}</p>
      </div>
    </section>
  );
}

function DeviceRow({
  device,
  busy,
  onRename,
  onRemove,
}: {
  device: PairedDevice;
  busy: boolean;
  onRename: (name: string) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  const now = useSeconds();
  const seen = device.connected
    ? "Connected"
    : device.lastSeenAt === null
      ? "Not seen yet"
      : `Last seen ${elapsed(device.lastSeenAt, now)}`;

  if (editing) {
    return (
      <form
        className="hub-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onRename(name).then((saved) => saved && setEditing(false));
        }}
      >
        <label className="hub-form-wide">
          Device name
          <input required value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        <div className="setting-actions">
          <button disabled={busy} type="submit">
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <section className="setting-row">
      <div className="setting-copy">
        <h2>{device.name}</h2>
        <p>{seen}</p>
      </div>
      <div className="setting-actions">
        <button
          disabled={busy}
          aria-label={`Rename ${device.name}`}
          onClick={() => {
            setName(device.name);
            setEditing(true);
          }}
        >
          Rename
        </button>
        <button disabled={busy} aria-label={`Remove ${device.name}`} onClick={onRemove}>
          Remove
        </button>
      </div>
    </section>
  );
}

/** The current epoch in whole seconds, ticking every second. */
function useSeconds() {
  const [now, setNow] = useState(nowEpoch);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowEpoch()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
