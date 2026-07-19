import assert from "node:assert/strict";
import test from "node:test";
import { RUNTIME_V1_CAPABILITY_BASELINE } from "./runtimeCapabilityBaseline.js";
import {
  NormalizedUsageSchema,
  RuntimeCapabilitiesSchema,
  RuntimeEventEnvelopeSchema,
  RuntimeSessionKeySchema,
} from "./runtimeContract.js";

test("P-A10 Runtime v2 codecs reject ambiguous or incomplete envelopes", () => {
  assert.deepEqual(RuntimeSessionKeySchema.parse({
    spaceId: "space-1",
    agentId: "agent-1",
    surfaceKind: "thread",
    surfaceId: "thread-1",
  }).surfaceKind, "thread");
  assert.throws(() => RuntimeSessionKeySchema.parse({ spaceId: "space-1", agentId: "agent-1", surfaceKind: "task", surfaceId: "task-1" }));
  assert.throws(() => RuntimeEventEnvelopeSchema.parse({ schemaVersion: 2, kind: "turn_completed" }));
  assert.equal(NormalizedUsageSchema.parse({ inputTokens: 10, source: "final" }).inputTokens, 10);
});

test("P-A10.0 capability baseline reports unsupported v1 behavior honestly", () => {
  for (const baseline of Object.values(RUNTIME_V1_CAPABILITY_BASELINE)) {
    assert.doesNotThrow(() => RuntimeCapabilitiesSchema.parse(baseline.capabilities));
    assert.equal(baseline.capabilities.mcp, "none");
    assert.equal(baseline.capabilities.toolIsolation, "none");
    assert.equal(baseline.support.cwdRelocation, "unsupported");
    assert.equal(baseline.support.completion, "missing");
  }
  assert.equal(RUNTIME_V1_CAPABILITY_BASELINE.claude.processModel, "persistent");
  assert.equal(RUNTIME_V1_CAPABILITY_BASELINE.codex.processModel, "persistent");
  assert.equal(RUNTIME_V1_CAPABILITY_BASELINE.opencode.processModel, "one_shot");
});
