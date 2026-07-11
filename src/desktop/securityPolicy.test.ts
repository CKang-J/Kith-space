import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedDesktopUrl, shouldAttachDesktopTrust } from "./securityPolicy.js";

const policy = { corePort: 7777, uiPort: 5273 };

test("Desktop navigation accepts only the active loopback Core and UI origins", () => {
  assert.equal(isAllowedDesktopUrl("http://127.0.0.1:7777/s/local/channel", policy), true);
  assert.equal(isAllowedDesktopUrl("http://127.0.0.1:5273/", policy), true);
  assert.equal(isAllowedDesktopUrl("http://localhost:7777/", policy), false);
  assert.equal(isAllowedDesktopUrl("https://127.0.0.1:7777/", policy), false);
  assert.equal(isAllowedDesktopUrl("http://example.test:7777/", policy), false);
  assert.equal(isAllowedDesktopUrl("file:///tmp/index.html", policy), false);
});

test("Desktop trust is scoped to Core and proxied Vite product requests", () => {
  assert.equal(shouldAttachDesktopTrust("http://127.0.0.1:7777/", policy), true);
  assert.equal(shouldAttachDesktopTrust("http://127.0.0.1:7777/assets/app.js", policy), true);
  assert.equal(shouldAttachDesktopTrust("http://127.0.0.1:7777/api/desktop/settings", policy), false);
  assert.equal(shouldAttachDesktopTrust("http://127.0.0.1:7777/api/desktop/browser-access", policy), false);
  assert.equal(shouldAttachDesktopTrust("http://127.0.0.1:5273/api/desktop/settings", policy), false);
  assert.equal(shouldAttachDesktopTrust("http://127.0.0.1:5273/api/me", policy), true);
  assert.equal(shouldAttachDesktopTrust("http://127.0.0.1:5273/socket.io/?transport=polling", policy), true);
  assert.equal(shouldAttachDesktopTrust("ws://127.0.0.1:5273/socket.io/?transport=websocket", policy), true);
  assert.equal(shouldAttachDesktopTrust("ws://127.0.0.1:7777/daemon/connect", policy), false);
  assert.equal(shouldAttachDesktopTrust("http://127.0.0.1:5273/src/main.tsx", policy), false);
  assert.equal(shouldAttachDesktopTrust("http://192.168.1.20:7777/api/me", policy), false);
});
