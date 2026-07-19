import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeCapabilitiesSchema } from "../contract/v2/runtimeContract.js";
import { RUNTIME_V2_CAPABILITY_MATRIX } from "./runtimeV2CapabilityMatrix.js";

test("three v2 adapters publish the observed bridge contract without claiming future security gates", () => {
  for (const report of Object.values(RUNTIME_V2_CAPABILITY_MATRIX)) {
    assert.doesNotThrow(() => RuntimeCapabilitiesSchema.parse(report.capabilities));
    assert.equal(report.adapterVersion, "v2-bridge-1");
    assert.equal(report.support.resume, "observed_v2");
    assert.equal(report.support.sessionChanged, "observed_v2");
    assert.equal(report.support.completion, "observed_v2");
    assert.equal(report.support.cancel, "observed_v2");
    assert.equal(report.support.mcpBootstrap, "unsupported");
    assert.equal(report.support.toolIsolation, "unsupported");
    assert.equal(report.support.cwdRelocation, "unsupported");
    assert.equal(report.capabilities.toolIsolation, "none");
    assert.equal(report.capabilities.cwdRelocatableResume, false);
  }
  assert.equal(RUNTIME_V2_CAPABILITY_MATRIX.claude.capabilities.persistentProcess, true);
  assert.equal(RUNTIME_V2_CAPABILITY_MATRIX.codex.capabilities.persistentProcess, true);
  assert.equal(RUNTIME_V2_CAPABILITY_MATRIX.opencode.capabilities.persistentProcess, false);
});
