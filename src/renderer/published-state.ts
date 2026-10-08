import { useEffect, useState } from "react";
import type { Events } from "../shared/ipc";

/** State the main process publishes as `event` and also serves as its current value. The listener is
 * attached before the read, since the main process can publish while the page is still loading and a
 * value landing between the two would otherwise be lost until the next publish. Once anything is
 * published, the read is stale, so it is dropped even when the published value is null. `failed` means the
 * read failed and nothing has been published since. */
export function usePublishedState<E extends keyof Events>(event: E) {
  const [value, setValue] = useState<Events[E] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    let published = false;
    const stop = window.tantalus.on(event, (value) => {
      published = true;
      if (mounted) {
        setValue(value);
        setFailed(false);
      }
    });
    void window.tantalus.current(event).then(
      (read) => {
        if (mounted && !published) setValue(read);
      },
      () => {
        if (mounted) setFailed(true);
      },
    );
    return () => {
      mounted = false;
      stop();
    };
  }, [event]);

  return [value, setValue, failed] as const;
}
