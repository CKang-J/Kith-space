import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worker = readFileSync(new URL("../src/daemon/index.ts", import.meta.url), "utf8");
const core = readFileSync(new URL("../src/server/index.ts", import.meta.url), "utf8");
const adapter = readFileSync(new URL("../src/desktop/nodeChildProcess.ts", import.meta.url), "utf8");

test("Desktop asks Core and Worker to shut down before forcing their processes", () => {
  assert.match(adapter, /child\.send\(\{ type: "kith:shutdown" \}/);
  assert.match(worker, /type === "kith:shutdown"\) void shutdown\(\)/);
  assert.match(worker, /mgr\.stopAllAndWait\(\)/);
  assert.match(adapter, /taskkill\.exe/);
  assert.match(adapter, /"\/T", "\/F"/);
  assert.match(core, /type === "kith:shutdown"\) shutdown\(\)/);
  assert.match(core, /server\.close\(\(\) => process\.exit\(0\)\)/);
});
