import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("active Core Service paths use the installation-local worker instead of Machine records", () => {
  const core = read("../src/server/core.ts");
  const agents = read("../src/server/routes-api/agents.ts");
  const localRuntime = read("../src/server/routes-api/localRuntime.ts");
  const catchup = read("../src/server/reconnectCatchup.ts");

  assert.match(core, /isWorkerConnected, sendToWorker, workerRuntimes/);
  assert.doesNotMatch(core, /schema\.machines|schema\.agents\.machineId|sendToMachine|broadcastToDaemons/);
  assert.match(agents, /machineId is no longer supported/);
  assert.doesNotMatch(agents, /schema\.machines|machineId: agent/);
  assert.match(localRuntime, /const match =/);
  assert.match(localRuntime, /getDynamicModels\(runtime\)/);
  assert.doesNotMatch(localRuntime, /\/machines|schema\.machines/);
  assert.match(catchup, /const spaces = listSpaces\(\)/);
  assert.match(catchup, /for \(const space of spaces\)/);
  assert.match(catchup, /sendToWorker/);
  assert.doesNotMatch(catchup, /schema\.machines|schema\.agents\.machineId|sendToMachine/);
});

test("browser access policy owns the Core listener while the runtime worker remains installation-local", () => {
  const server = read("../src/server/index.ts");
  const workerSocket = read("../src/server/ws.ts");
  assert.match(server, /new BrowserAccessPolicy\(\)/);
  assert.match(server, /const listenerPolicy = accessPolicy\.getListenerPolicy\(\)/);
  assert.match(server, /const HOST = listenerPolicy\.host/);
  assert.match(server, /server\.listen\(PORT, HOST/);
  assert.match(server, /workerConnected: isWorkerConnected\(\)/);
  assert.doesNotMatch(server, /reconcileMachinesOnBoot|startMachineSweeper/);
  assert.match(workerSocket, /req\.headers\[WORKER_TOKEN_HEADER\]/);
  assert.match(workerSocket, /isLoopbackAddress\(req\.socket\.remoteAddress\)/);
  assert.doesNotMatch(workerSocket, /searchParams\.get\("key"\)/);
  assert.match(workerSocket, /agent\.status === "sleeping" \|\| agent\.activity === "sleeping"/);
  assert.match(workerSocket, /eq\(schema\.agents\.status, "active"\)/);
});

test("CLI and QA seed no longer carry Machine credentials or records", () => {
  const cli = read("../src/cli/index.ts");
  const qaSeed = read("../src/db/qa-seed.ts");
  assert.match(cli, /const KEY = process\.env\.KITH_SPACE_AGENT_TOKEN;/);
  assert.doesNotMatch(cli, /KITH_SPACE_MACHINE_KEY|KITH_SPACE_API_KEY|poc-secret-key/);
  assert.doesNotMatch(qaSeed, /schema\.machines|machineId|QA_KEY/);
});
