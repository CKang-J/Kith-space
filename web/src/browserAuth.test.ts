import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  accessTokenFailureMessage,
  revokeBrowserSession,
  loadBrowserSession,
  verifyBrowserAccessToken,
} from "./browserAuth.ts";

test("Access Token failures distinguish invalid credentials from rate limiting", () => {
  assert.equal(accessTokenFailureMessage(401, null, null), "The Access Token is not valid.");
  assert.equal(
    accessTokenFailureMessage(429, null, "30"),
    "Too many attempts. Try again in 30 seconds.",
  );
});

test("server-provided Access Token errors remain visible", () => {
  assert.equal(
    accessTokenFailureMessage(403, { error: "Browser access is disabled." }, null),
    "Browser access is disabled.",
  );
});

test("browser auth uses same-origin Cookie endpoints and CSRF only for session revoke", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/session")) {
      return Response.json({ authenticated: true, user: { id: "human", name: "You" }, csrfToken: "csrf-1" });
    }
    if (url.endsWith("/verify")) return Response.json({ ok: true, user: { id: "human" }, csrfToken: "csrf-1" });
    return new Response(null, { status: 204 });
  };

  assert.equal((await loadBrowserSession())?.user.id, "human");
  assert.deepEqual(await verifyBrowserAccessToken("access-1"), { ok: true });
  await revokeBrowserSession("csrf-1");

  assert.deepEqual(calls.map(({ url }) => url), [
    "/api/browser-auth/session",
    "/api/browser-auth/verify",
    "/api/browser-auth/session",
  ]);
  assert.equal(calls.every(({ init }) => init?.credentials === "same-origin"), true);
  assert.equal(new Headers(calls[0]!.init?.headers).has("authorization"), false);
  assert.equal(new Headers(calls[1]!.init?.headers).has("x-kith-csrf"), false);
  assert.equal(calls[2]!.init?.method, "DELETE");
  assert.equal(new Headers(calls[2]!.init?.headers).get("x-kith-csrf"), "csrf-1");
  assert.deepEqual(JSON.parse(String(calls[1]!.init?.body)), { token: "access-1" });
});

test("the frontend has no Human JWT, URL token, or dev-login fallback", () => {
  const store = readFileSync(new URL("./store.tsx", import.meta.url), "utf8");
  const routing = readFileSync(new URL("./routing.ts", import.meta.url), "utf8");
  const main = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
  const authSources = `${store}\n${routing}`;

  assert.doesNotMatch(authSources, /TOKEN_KEY|kith-space\.token|dev-login|authorization|Bearer|\?token=|\?as=/i);
  assert.match(store, /auth:\s*\{\s*spaceId:\s*spaceIdRef\.current\s*\}/);
  assert.doesNotMatch(store, /auth:\s*\{[^}]*token/);
  assert.match(main, /default:\s*return <AccessTokenGate \/>/);
  assert.doesNotMatch(main, /views\/Landing|<Landing/);
});
