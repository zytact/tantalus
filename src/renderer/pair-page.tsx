import { useState } from "react";

/** What a browser sees until it pairs. The host keeps the token as a cookie, so a reload opens the
 * allowance page. */
export function PairPage() {
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pair = async () => {
    setPairing(true);
    setError(null);
    const response = await fetch("/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tantalus-action": "pair" },
      body: JSON.stringify({ code }),
    }).catch(() => null);
    if (response?.ok) return location.reload();
    setError(response ? await response.text() : "Could not reach Tantalus.");
    setPairing(false);
  };

  return (
    <main>
      <header>
        <h1>Pair this device</h1>
      </header>
      <p className="pair-intro">
        On the computer running Tantalus, open Settings, choose Pair a device, and enter the code it shows.
      </p>
      <form
        className="hub-form"
        onSubmit={(event) => {
          event.preventDefault();
          void pair();
        }}
      >
        <label className="hub-form-wide">
          Pairing code
          <input
            required
            autoFocus
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <button disabled={pairing} type="submit">
          {pairing ? "Pairing" : "Pair"}
        </button>
      </form>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
