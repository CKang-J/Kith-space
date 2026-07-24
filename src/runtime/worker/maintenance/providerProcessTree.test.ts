import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { terminateProviderProcessTree } from "./providerProcessTree.js";

test("provider cancellation waits for exit and escalates when a child ignores SIGTERM", { timeout: 6_000 }, async () => {
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  await new Promise<void>((resolve, reject) => { child.once("message", () => resolve()); child.once("error", reject); });
  const started = Date.now();
  await terminateProviderProcessTree(child);
  assert.ok(Date.now() - started >= (process.platform === "win32" ? 0 : 1_900));
  assert.notEqual(child.exitCode === null && child.signalCode === null, true);
});
