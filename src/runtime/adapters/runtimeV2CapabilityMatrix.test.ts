import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeCapabilitiesSchema } from "../contract/v2/runtimeContract.js";
import { RUNTIME_V2_CAPABILITY_MATRIX } from "./runtimeV2CapabilityMatrix.js";

test("v2 adapters publish honest runtime-specific capabilities without claiming future security gates", () => {
  for (const [runtime, report] of Object.entries(RUNTIME_V2_CAPABILITY_MATRIX)) {
    assert.doesNotThrow(() => RuntimeCapabilitiesSchema.parse(report.capabilities));
    assert.equal(report.adapterVersion, runtime === "pi" ? "pi-rpc-v1" : "v2-bridge-2");
    assert.equal(report.capabilityMode, runtime === "pi" ? "cli_gateway" : "mcp_with_cli_fallback");
    assert.equal(report.support.resume, "observed_v2");
    assert.equal(report.support.sessionChanged, "observed_v2");
    assert.equal(report.support.completion, "observed_v2");
    assert.equal(report.support.cancel, "observed_v2");
    assert.equal(report.support.mcpBootstrap, runtime === "pi" ? "unsupported" : "fixture_v2");
    assert.equal(report.support.toolIsolation, "unsupported");
    assert.equal(report.support.cwdRelocation, "unsupported");
    assert.equal(report.capabilities.toolIsolation, "none");
    assert.equal(report.capabilities.cwdRelocatableResume, false);
    assert.equal(report.capabilities.mcp, runtime === "pi" ? "none" : "config");
  }
  assert.equal(RUNTIME_V2_CAPABILITY_MATRIX.claude.capabilities.persistentProcess, true);
  assert.equal(RUNTIME_V2_CAPABILITY_MATRIX.codex.capabilities.persistentProcess, true);
  assert.equal(RUNTIME_V2_CAPABILITY_MATRIX.opencode.capabilities.persistentProcess, false);
  assert.equal(RUNTIME_V2_CAPABILITY_MATRIX.pi.capabilities.persistentProcess, true);
  assert.equal(RUNTIME_V2_CAPABILITY_MATRIX.pi.support.compactionTelemetry, "observed_v2");
  assert.equal(RUNTIME_V2_CAPABILITY_MATRIX.claude.support.compactionTelemetry, "unsupported");
  assert.equal(RUNTIME_V2_CAPABILITY_MATRIX.codex.support.compactionTelemetry, "fixture_v2");
  assert.equal(RUNTIME_V2_CAPABILITY_MATRIX.opencode.support.compactionTelemetry, "unsupported");
});
