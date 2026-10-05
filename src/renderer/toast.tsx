import { TOAST_MILLISECONDS } from "../shared/ipc";
import { useEffect, useState } from "react";

export function Toast() {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    let mounted = true;
    let published = false;
    const show = (message: string | null) => {
      if (!mounted || !message) return;
      clearTimeout(timers.get(message));
      setMessages((current) => [...current.filter((item) => item !== message), message]);
      timers.set(
        message,
        setTimeout(() => {
          timers.delete(message);
          setMessages((current) => current.filter((item) => item !== message));
        }, TOAST_MILLISECONDS),
      );
    };
    const stop = window.tantalus.on("toast", (message) => {
      published = true;
      show(message);
    });
    void window.tantalus.current("toast").then(
      (message) => {
        if (!published) show(message);
      },
      () => {},
    );
    return () => {
      mounted = false;
      stop();
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);
  return (
    <div className="toasts">
      {messages.map((message) => (
        <div className="toast" role="status" key={message}>
          <span>{message}</span>
          <button
            aria-label={`Dismiss ${message}`}
            onClick={() => setMessages((current) => current.filter((item) => item !== message))}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
