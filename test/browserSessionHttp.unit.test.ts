import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

process.env.KITH_SPACE_DESKTOP_TOKEN ??= "desktop-test-token";
process.env.KITH_SPACE_WORKER_TOKEN ??= "worker-test-token";

const {
  BROWSER_CSRF_COOKIE,
  BROWSER_SESSION_COOKIE,
  BROWSER_AUTH_BODY_LIMIT,
  BrowserTokenAttemptLimiter,
  browserMutationAllowed,
  browserOriginAllowed,
  browserRequestIsLocal,
  browserSessionToken,
  clearBrowserSessionCookies,
  readBrowserAuthBody,
  setBrowserSessionCookies,
} = await import("../src/server/browserSessionHttp.ts");

function request(input: { method?: string; origin?: string; host?: string; cookie?: string; csrf?: string; remoteAddress?: string } = {}): IncomingMessage {
  return {
    method: input.method ?? "GET",
    headers: {
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.host ? { host: input.host } : {}),
      ...(input.cookie ? { cookie: input.cookie } : {}),
      ...(input.csrf ? { "x-kith-csrf": input.csrf } : {}),
    },
    socket: { remoteAddress: input.remoteAddress ?? "127.0.0.1" },
  } as IncomingMessage;
}

test("session cookie is HttpOnly while the CSRF double-submit cookie remains readable", () => {
  const headers = new Map<string, unknown>();
  const res = { setHeader: (name: string, value: unknown) => headers.set(name, value) } as unknown as ServerResponse;
  setBrowserSessionCookies(res, "session secret", "csrf secret");
  const setCookie = headers.get("set-cookie") as string[];
  assert.match(setCookie[0]!, new RegExp(`^${BROWSER_SESSION_COOKIE}=`));
  assert.match(setCookie[0]!, /HttpOnly/);
  assert.match(setCookie[0]!, /SameSite=Strict/);
  assert.match(setCookie[1]!, new RegExp(`^${BROWSER_CSRF_COOKIE}=`));
  assert.doesNotMatch(setCookie[1]!, /HttpOnly/);
  assert.equal(browserSessionToken(request({ cookie: `${BROWSER_SESSION_COOKIE}=session%20secret` })), "session secret");

  clearBrowserSessionCookies(res);
  assert.ok((headers.get("set-cookie") as string[]).every((value) => value.includes("Max-Age=0")));
});

test("origin policy distinguishes disabled, local, and LAN browser modes", () => {
  assert.equal(browserOriginAllowed(request({ origin: "http://localhost:5273", host: "localhost:5273" }), "off"), false);
  assert.equal(browserOriginAllowed(request({ origin: "http://localhost:5273", host: "localhost:5273" }), "local"), true);
  assert.equal(browserOriginAllowed(request({ origin: "http://localhost:9999", host: "localhost:5273" }), "local"), false);
  assert.equal(browserOriginAllowed(request({
    origin: "http://localhost:5273", host: "localhost:5273", remoteAddress: "192.168.1.25",
  }), "local"), false);
  assert.equal(browserOriginAllowed(request({ origin: "http://192.168.1.20:7777", host: "192.168.1.20:7777" }), "lan"), true);
  assert.equal(browserOriginAllowed(request({ origin: "http://evil.test", host: "192.168.1.20:7777" }), "lan"), false);
});

test("browser mutations require both an allowed Origin and matching CSRF header/cookie", () => {
  const cookie = `${BROWSER_CSRF_COOKIE}=csrf-value`;
  assert.equal(browserMutationAllowed(request({
    method: "POST", origin: "http://localhost:5273", host: "localhost:5273", cookie, csrf: "csrf-value",
  }), "local"), true);
  assert.equal(browserMutationAllowed(request({
    method: "POST", origin: "http://localhost:5273", host: "localhost:5273", cookie, csrf: "wrong",
  }), "local"), false);
  assert.equal(browserMutationAllowed(request({
    method: "POST", origin: "http://localhost:9999", host: "localhost:5273", cookie, csrf: "csrf-value",
  }), "local"), false);
  assert.equal(browserMutationAllowed(request({ method: "POST", cookie, csrf: "csrf-value" }), "local"), false);
  assert.equal(browserMutationAllowed(request(), "local"), true);
});

test("secret-bearing browser writes require a loopback peer, Host, and Origin", () => {
  assert.equal(browserRequestIsLocal(request({
    method: "POST", origin: "http://localhost:7777", host: "localhost:7777",
  })), true);
  assert.equal(browserRequestIsLocal(request({
    method: "POST", origin: "http://127.0.0.1:7777", host: "127.0.0.1:7777",
  })), true);
  assert.equal(browserRequestIsLocal(request({
    method: "POST", origin: "http://localhost:9999", host: "localhost:7777",
  })), false);
  assert.equal(browserRequestIsLocal(request({
    method: "POST", origin: "http://192.168.1.20:7777", host: "192.168.1.20:7777",
  })), false);
  assert.equal(browserRequestIsLocal(request({
    method: "POST", origin: "http://localhost:7777", host: "localhost:7777", remoteAddress: "192.168.1.25",
  })), false);
  assert.equal(browserRequestIsLocal(request({ method: "POST", host: "localhost:7777" })), false);
});

test("failed token attempts are bounded per key and reset on success/window expiry", () => {
  let now = 1000;
  const limiter = new BrowserTokenAttemptLimiter(2, 5000, () => now);
  assert.equal(limiter.inspect("ip").allowed, true);
  limiter.fail("ip"); limiter.fail("ip");
  assert.equal(limiter.inspect("ip").allowed, false);
  assert.equal(limiter.inspect("other").allowed, true);
  limiter.clear("ip");
  assert.equal(limiter.inspect("ip").allowed, true);
  limiter.fail("ip"); limiter.fail("ip"); now += 5001;
  assert.equal(limiter.inspect("ip").allowed, true);
});

test("public Access Token parsing bounds unauthenticated request bodies", async () => {
  const valid = Readable.from([JSON.stringify({ token: "small-token" })]) as IncomingMessage;
  assert.deepEqual(await readBrowserAuthBody(valid), {
    value: { token: "small-token" },
    tooLarge: false,
  });

  const oversized = Readable.from(["x".repeat(BROWSER_AUTH_BODY_LIMIT + 1)]) as IncomingMessage;
  assert.deepEqual(await readBrowserAuthBody(oversized), { value: null, tooLarge: true });
});
