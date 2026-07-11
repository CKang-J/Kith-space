import assert from "node:assert/strict";
import test from "node:test";
import { parseBrowserAccessUpdate, parseLifecycleUpdate } from "./ipcValidation.js";

test("Desktop lifecycle IPC accepts only its two typed settings", () => {
  assert.deepEqual(parseLifecycleUpdate({ closeBehavior: "quit", launchAtLogin: true }), {
    closeBehavior: "quit",
    launchAtLogin: true,
  });
  assert.throws(() => parseLifecycleUpdate({ launchAtLogin: "yes" }));
  assert.throws(() => parseLifecycleUpdate({ launchAtLogin: true, command: "open" }));
});
test("Desktop browser IPC rejects remote or malformed configuration shapes", () => {
  assert.deepEqual(parseBrowserAccessUpdate({ mode: "lan", port: 8777, accessToken: "custom token" }), {
    mode: "lan",
    port: 8777,
    accessToken: "custom token",
  });
  assert.throws(() => parseBrowserAccessUpdate({ mode: "internet" }));
  assert.throws(() => parseBrowserAccessUpdate({ port: 70000 }));
  assert.throws(() => parseBrowserAccessUpdate({ mode: "local", targetHost: "example.com" }));
});
