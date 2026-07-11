export interface BrowserAuthUser {
  id: string;
  name: string;
  email?: string | null;
  description?: string | null;
}

export interface BrowserSession {
  authenticated: true;
  user: BrowserAuthUser;
  csrfToken: string;
}

type ErrorBody = { error?: string; message?: string } | null;

async function readJson(response: Response): Promise<any> {
  return response.json().catch(() => null);
}

export async function loadBrowserSession(): Promise<BrowserSession | null> {
  const response = await fetch("/api/browser-auth/session", { credentials: "same-origin" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Session check failed (${response.status})`);

  const session = await readJson(response);
  if (session?.authenticated !== true || !session.user?.id || !session.csrfToken) {
    throw new Error("Session response is invalid");
  }
  return session as BrowserSession;
}

export function accessTokenFailureMessage(status: number, body: ErrorBody, retryAfter: string | null): string {
  if (status === 429) {
    const seconds = Number.parseInt(retryAfter ?? "", 10);
    return Number.isFinite(seconds) && seconds > 0
      ? `Too many attempts. Try again in ${seconds} seconds.`
      : "Too many attempts. Please wait before trying again.";
  }
  const serverMessage = body?.message || body?.error;
  if (serverMessage) return serverMessage;
  if (status === 401 || status === 403) return "The Access Token is not valid.";
  return "Kith-space could not verify the Access Token. Please try again.";
}

export type AccessTokenVerification = { ok: true } | { ok: false; message: string };

export async function verifyBrowserAccessToken(token: string): Promise<AccessTokenVerification> {
  const response = await fetch("/api/browser-auth/verify", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const body = await readJson(response);
  if (response.ok && body?.ok === true) return { ok: true };
  return {
    ok: false,
    message: accessTokenFailureMessage(response.status, body, response.headers.get("retry-after")),
  };
}

export async function revokeBrowserSession(csrfToken: string): Promise<void> {
  if (!csrfToken) throw new Error("Missing browser session CSRF token");
  const response = await fetch("/api/browser-auth/session", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "x-kith-csrf": csrfToken },
  });
  if (!response.ok) throw new Error(`Browser session revoke failed (${response.status})`);
}
