import assert from "node:assert/strict";
import test from "node:test";
import { resolveViteDevProxyOrigin, shouldProxyPathToViteDev } from "../src/server/viteDevProxy.js";

test("resolveViteDevProxyOrigin accepts managed Desktop dev URLs", () => {
  const previous = process.env.KITH_SPACE_VITE_DEV_URL;
  process.env.KITH_SPACE_VITE_DEV_URL = "http://127.0.0.1:5273";
  try {
    assert.deepEqual(resolveViteDevProxyOrigin(), new URL("http://127.0.0.1:5273"));
  } finally {
    if (previous === undefined) delete process.env.KITH_SPACE_VITE_DEV_URL;
    else process.env.KITH_SPACE_VITE_DEV_URL = previous;
  }
});

test("resolveViteDevProxyOrigin rejects non-http origins", () => {
  const previous = process.env.KITH_SPACE_VITE_DEV_URL;
  process.env.KITH_SPACE_VITE_DEV_URL = "ws://127.0.0.1:5273";
  try {
    assert.equal(resolveViteDevProxyOrigin(), null);
  } finally {
    if (previous === undefined) delete process.env.KITH_SPACE_VITE_DEV_URL;
    else process.env.KITH_SPACE_VITE_DEV_URL = previous;
  }
});

test("shouldProxyPathToViteDev keeps Core-owned routes local", () => {
  assert.equal(shouldProxyPathToViteDev("/"), true);
  assert.equal(shouldProxyPathToViteDev("/src/main.tsx"), true);
  assert.equal(shouldProxyPathToViteDev("/@vite/client"), true);
  assert.equal(shouldProxyPathToViteDev("/api/me"), false);
  assert.equal(shouldProxyPathToViteDev("/agent-api/ping"), false);
  assert.equal(shouldProxyPathToViteDev("/agent-gateway/turn/context"), false);
  assert.equal(shouldProxyPathToViteDev("/socket.io/"), false);
  assert.equal(shouldProxyPathToViteDev("/health"), false);
});
