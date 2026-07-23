import assert from "node:assert/strict";
import test from "node:test";
import { ProviderEpochGate } from "./providerEpochGate.js";

test("ProviderEpochGate closes on restart and serializes mutation after in-flight commit", async () => {
  const gate = new ProviderEpochGate();
  await assert.rejects(() => gate.withRead(1, async () => undefined), /provider_revision_changed/);
  gate.open(3);
  let release!: () => void;
  const held = gate.withRead(3, () => new Promise<void>((resolve) => { release = resolve; }));
  let mutated = false;
  const mutation = gate.withWrite(async () => { mutated = true; return 4; });
  await Promise.resolve();
  assert.equal(mutated, false);
  release();
  await held;
  await mutation;
  await assert.rejects(() => gate.withRead(3, async () => undefined), /provider_revision_changed/);
  gate.open(4);
  await gate.withRead(4, async () => undefined);
});
