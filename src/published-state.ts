import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

/** State Rust publishes as `event` and also serves from `command`. The listener is attached before
 * the read, since Rust can publish while the webview is still loading and a value landing between
 * the two would otherwise be lost until the next publish. `failed` means the read failed and
 * nothing has been published since. */
export function usePublishedState<T>(event: string, command: string) {
  const [value, setValue] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    let stop: (() => void) | undefined;
    void listen<T>(event, (published) => {
      if (mounted) {
        setValue(published.payload);
        setFailed(false);
      }
    })
      .then((unlisten) => {
        if (mounted) stop = unlisten;
        else unlisten();
        return invoke<T | null>(command);
      })
      .then(
        (read) => {
          if (mounted) setValue((current) => current ?? read);
        },
        () => {
          if (mounted) setFailed(true);
        },
      );
    return () => {
      mounted = false;
      stop?.();
    };
  }, [event, command]);

  return [value, setValue, failed] as const;
}
