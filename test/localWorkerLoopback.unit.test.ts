import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workerEntry = fs.readFileSync(new URL("../src/daemon/index.ts", import.meta.url), "utf8");
const core = fs.readFileSync(new URL("../src/server/core.ts", import.meta.url), "utf8");

test("the installation-local Worker cannot be pointed at a remote Core Service", () => {
  assert.match(workerEntry, /const serverUrl = `http:\/\/127\.0\.0\.1:\$\{process\.env\.PORT \?\? 7777\}`/);
  assert.doesNotMatch(workerEntry, /--server-url/);
  assert.match(workerEntry, /case "agent:start": void mgr\.start\(msg\.agentId, msg\.config\);/);
  assert.match(core, /import \{ coreLoopbackUrl \} from "\.\/localEndpoint\.js"/);
  assert.match(core, /serverUrl: coreLoopbackUrl\(\)/);
});

test("local Worker send helpers carry no retired serverId parameter", () => {
  assert.doesNotMatch(core, /function sendAgent(?:Start|Deliver|Control)\(_?serverId:/);
});
