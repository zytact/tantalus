import { PendingLabel, useVisiblePending } from "./busy";

export function Toggle({
  label,
  checked,
  busy = false,
  onToggle,
}: {
  label: string;
  checked: boolean;
  busy?: boolean;
  onToggle: () => void;
}) {
  const saving = useVisiblePending(busy);
  const toggle = () => {
    if (!busy) onToggle();
  };
  return (
    <button
      className="setting-toggle"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={saving}
      disabled={saving}
      onClick={toggle}
    >
      <span className="setting-state">{saving ? "Saving" : checked ? "On" : "Off"}</span>
      <span className="switch-track" aria-hidden="true">
        <span className="switch-knob" />
      </span>
    </button>
  );
}

export function SettingPending({ failed }: { failed: boolean }) {
  return <PendingLabel className="setting-state" failed={failed} failedLabel="Unavailable" pendingLabel="Checking" />;
}
