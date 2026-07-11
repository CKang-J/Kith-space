import { useState, type FormEvent } from "react";
import { verifyBrowserAccessToken } from "../browserAuth.ts";

export function AccessTokenGate() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = token.trim();
    if (!value || busy) return;

    setBusy(true);
    setError("");
    try {
      const result = await verifyBrowserAccessToken(value);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.reload();
    } catch {
      setError("Kith-space is not reachable. Check that Desktop is running and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">Kith-space</div>
        <h1>Enter Access Token</h1>
        <p className="auth-alt">
          Use the browser Access Token shown in Kith-space Desktop settings.
        </p>
        <label className="auth-field">
          <span>Access Token</span>
          <input
            autoFocus
            autoComplete="current-password"
            disabled={busy}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Paste your Access Token"
            spellCheck={false}
            type="password"
            value={token}
          />
        </label>
        {error ? <div className="form-err" role="alert">{error}</div> : null}
        <button className="sw-go auth-submit" disabled={busy || !token.trim()} type="submit">
          {busy ? "Verifying..." : "Continue"}
        </button>
      </form>
    </main>
  );
}
