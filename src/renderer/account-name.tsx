import { useSyncExternalStore } from "react";
import type { AccountName as Name } from "../shared/usage";

/** Emails revealed on this page. Revealing one shows it everywhere it appears until the page reloads. */
const revealed = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function toggle(email: string) {
  if (!revealed.delete(email)) revealed.add(email);
  for (const listener of listeners) listener();
}

const useRevealed = (email: string) => useSyncExternalStore(subscribe, () => revealed.has(email));

/** An email blurred until clicked. `label` names its account for screen readers while it is hidden. */
export function Email({ email, label }: { email: string; label: string }) {
  const visible = useRevealed(email);
  return (
    <button
      className="account-email"
      data-visible={visible}
      aria-label={visible ? `${email}, hide email for ${label}` : `Show email for ${label}`}
      aria-pressed={visible}
      title={visible ? "Hide email" : "Show email"}
      onClick={() => toggle(email)}
    >
      <span aria-hidden={!visible}>{email}</span>
    </button>
  );
}

/** An account's name, with its email blurred until clicked. With `plain`, the email cannot be clicked,
 * for places such as a menu option that cannot hold a button, and shows once revealed elsewhere. */
export function AccountName({ name: { title, email }, plain = false }: { name: Name; plain?: boolean }) {
  if (email === null) return title;
  return (
    <>
      {title} · {plain ? <PlainEmail email={email} /> : <Email email={email} label={title} />}
    </>
  );
}

function PlainEmail({ email }: { email: string }) {
  return (
    <span className="account-email" data-visible={useRevealed(email)}>
      <span>{email}</span>
    </span>
  );
}
