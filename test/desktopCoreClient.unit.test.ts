import test from "node:test";
import assert from "node:assert/strict";
import { DesktopCoreClient, DesktopCoreClientError } from "../src/desktop/coreClient.ts";

type Call = { url: string; init?: RequestInit };

function harness(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift() ?? { status: 500, body: { error: "missing fake response" } };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const client = new DesktopCoreClient(() => 8123, "desktop-secret", fetchImpl);
  return { calls, client };
}

test("Desktop Core client scopes its private credential to loopback management requests", async () => {
  const { calls, client } = harness([
    { body: { closeBehavior: "tray", launchAtLogin: false } },
    { body: { mode: "off", port: 8123, hasAccessToken: false, tokenRevision: 0, activeSessions: 0, lanWarning: null } },
  ]);

  assert.equal((await client.getLifecycleSettings()).closeBehavior, "tray");
  assert.equal((await client.getBrowserAccess()).mode, "off");
  assert.deepEqual(calls.map((call) => call.url), [
    "http://127.0.0.1:8123/api/desktop/settings",
    "http://127.0.0.1:8123/api/desktop/browser-access",
  ]);
  for (const call of calls) {
    assert.equal((call.init?.headers as Record<string, string>)["x-kith-desktop-token"], "desktop-secret");
  }
});

test("Desktop Core client sends typed lifecycle and browser mutations", async () => {
  const { calls, client } = harness([
    { body: { closeBehavior: "quit", launchAtLogin: true } },
    { body: { mode: "lan", port: 9000, hasAccessToken: true, tokenRevision: 2, activeSessions: 0, lanWarning: "private LAN", accessToken: "generated", restartRequired: true } },
    { body: { ok: true, revoked: 3 } },
  ]);

  await client.updateLifecycleSettings({ closeBehavior: "quit", launchAtLogin: true });
  const browser = await client.updateBrowserAccess({ mode: "lan", port: 9000, accessToken: null });
  assert.equal(browser.accessToken, "generated");
  assert.equal(await client.revokeBrowserSessions(), 3);
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { closeBehavior: "quit", launchAtLogin: true });
  assert.deepEqual(JSON.parse(String(calls[1]!.init?.body)), { mode: "lan", port: 9000, accessToken: null });
});

test("Desktop Core client preserves safe server errors without exposing credentials", async () => {
  const { client } = harness([{ status: 400, body: { error: "port must be available" } }]);
  await assert.rejects(
    client.updateBrowserAccess({ port: 0 }),
    (error: unknown) => error instanceof DesktopCoreClientError
      && error.status === 400
      && error.message === "port must be available"
      && !error.message.includes("desktop-secret"),
  );
});
