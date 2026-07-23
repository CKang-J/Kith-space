import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeConfigurationEpochGate } from "./runtimeConfigurationEpochGate.js";

test("runtime epoch gate closes old admission before asynchronous convergence", async () => {
  const gate = new RuntimeConfigurationEpochGate();
  gate.open(4);
  assert.equal(await gate.withAdmission(4, async () => "ok"), "ok");
  gate.closeBefore(5);
  await assert.rejects(() => gate.withAdmission(4, async () => "stale"), /runtime_configuration_stale/);
  await assert.rejects(() => gate.withAdmission(5, async () => "not-open"), /runtime_configuration_stale/);
  gate.open(5);
  assert.equal(await gate.withAdmission(5, async () => "new"), "new");
});

test("runtime epoch change drains an admitted turn and rejects queued stale admissions", async () => {
  const gate = new RuntimeConfigurationEpochGate();
  gate.open(7);
  let release!: () => void;
  const active = gate.withAdmission(7, () => new Promise<void>((resolve) => { release = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  let changed = false;
  const change = gate.withChange(() => {
    changed = true;
    gate.open(8);
  });
  const stale = gate.withAdmission(7, () => "must-not-run");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(changed, false);
  release();
  await active;
  await change;
  await assert.rejects(() => stale, /runtime_configuration_stale/);
  assert.equal(await gate.withAdmission(8, () => "new"), "new");
});
