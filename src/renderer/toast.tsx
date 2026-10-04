import { useEffect, useState } from "react";

export function Toast() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let mounted = true;
    const show = (message: string | null) => {
      if (!mounted || !message) return;
      clearTimeout(timer);
      setMessage(message);
      timer = setTimeout(() => setMessage(null), 10_000);
    };
    const stop = window.tantalus.on("toast", show);
    void window.tantalus.current("toast").then(show, () => {});
    return () => {
      mounted = false;
      stop();
      clearTimeout(timer);
    };
  }, []);
  return (
    message && (
      <div className="toast" role="status">
        <span>{message}</span>
        <button aria-label="Dismiss notification" onClick={() => setMessage(null)}>
          Dismiss
        </button>
      </div>
    )
  );
}
