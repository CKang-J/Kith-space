import test from "node:test";
import assert from "node:assert/strict";

const previousDesktopToken = process.env.KITH_SPACE_DESKTOP_TOKEN;
const previousWorkerToken = process.env.KITH_SPACE_WORKER_TOKEN;

process.env.KITH_SPACE_DESKTOP_TOKEN = "desktop-test-token";
process.env.KITH_SPACE_WORKER_TOKEN = "worker-test-token";

const credentials = await import("../src/local-runtime/internalCredentials.ts");

test.after(() => {
  if (previousDesktopToken === undefined) delete process.env.KITH_SPACE_DESKTOP_TOKEN;
  else process.env.KITH_SPACE_DESKTOP_TOKEN = previousDesktopToken;
  if (previousWorkerToken === undefined) delete process.env.KITH_SPACE_WORKER_TOKEN;
  else process.env.KITH_SPACE_WORKER_TOKEN = previousWorkerToken;
});

test("generates independent high-entropy credentials for each local process boundary", () => {
  const first = credentials.generateInternalProcessCredentials();
  const second = credentials.generateInternalProcessCredentials();

  for (const token of [first.desktopTrustToken, first.workerToken, second.desktopTrustToken, second.workerToken]) {
    assert.equal(Buffer.from(token, "base64url").byteLength, 32);
  }
  assert.equal(new Set([
    first.desktopTrustToken,
    first.workerToken,
    second.desktopTrustToken,
    second.workerToken,
  ]).size, 4);
});

test("accepts Desktop trust only through the dedicated request header", () => {
  const request = (headers: Record<string, string | string[]>, remoteAddress = "127.0.0.1") => ({
    headers,
    socket: { remoteAddress },
  }) as any;
  assert.equal(credentials.isDesktopTrustedRequest(request({ "x-kith-desktop-token": "desktop-test-token" })), true);
  assert.equal(credentials.isDesktopTrustedRequest(request({ "x-kith-desktop-token": "wrong" })), false);
  assert.equal(credentials.isDesktopTrustedRequest(request({ authorization: "Bearer desktop-test-token" })), false);
  assert.equal(credentials.isDesktopTrustedRequest(request({ "x-kith-desktop-token": ["desktop-test-token"] })), false);
  assert.equal(credentials.isDesktopTrustedRequest(request({})), false);
  assert.equal(credentials.isDesktopTrustedRequest(request({ "x-kith-desktop-token": "desktop-test-token" }, "192.168.1.25")), false);
});

test("exposes only the configured Worker bootstrap token to the Worker control plane", () => {
  assert.equal(credentials.workerBootstrapToken(), "worker-test-token");
});

test("rejects either missing internal process credential", () => {
  delete process.env.KITH_SPACE_DESKTOP_TOKEN;
  assert.throws(
    () => credentials.assertInternalCredentialsConfigured(),
    /KITH_SPACE_DESKTOP_TOKEN/,
  );

  process.env.KITH_SPACE_DESKTOP_TOKEN = "desktop-test-token";
  delete process.env.KITH_SPACE_WORKER_TOKEN;
  assert.throws(
    () => credentials.assertInternalCredentialsConfigured(),
    /KITH_SPACE_WORKER_TOKEN/,
  );

  process.env.KITH_SPACE_WORKER_TOKEN = "worker-test-token";
  assert.doesNotThrow(() => credentials.assertInternalCredentialsConfigured());
});
