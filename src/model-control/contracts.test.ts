import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelControlError,
  assertRuntimeDefaultBinding,
  type ModelConfigurationRevision,
  type ModelProviderConnectionRevision,
} from "./contracts.js";
import { SettingsPresentationService } from "./settingsPresentationService.js";

const provider: ModelProviderConnectionRevision = {
  connectionId: "provider-1",
  revision: 3,
  backendId: "deepseek",
  apiKind: "openai-completions",
  canonicalOrigin: "https://api.deepseek.com",
  networkClass: "public_cloud",
  credentialSourceKind: "kith_secret",
  credentialRef: "secret-ref-must-not-leak",
  credentialIdentityDigest: "a".repeat(64),
  dataPolicyRevision: "deepseek-policy-1",
  dataPolicyProvenance: "human_asserted",
  allowedEgress: ["https://api.deepseek.com"],
  capabilitySnapshot: {},
  sourceKind: "manual",
  sourceSnapshotDigest: "b".repeat(64),
  createdAt: 1,
};

const model: ModelConfigurationRevision = {
  configurationId: "model-1",
  revision: 2,
  providerConnectionId: provider.connectionId,
  providerRevision: provider.revision,
  modelId: "deepseek-v4-pro",
  reasoning: "high",
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
  inputCapabilities: ["text"],
  runtimeCompatibilitySnapshot: {
    claude: { supported: false, reason: "wire_api_not_supported" },
    codex: { supported: false, reason: "requires_responses_api" },
    pi: { supported: true },
  },
  options: {},
  createdAt: 2,
};

test("runtime default binding keeps unmanaged, unset, and Kith configuration distinct", () => {
  assert.deepEqual(assertRuntimeDefaultBinding({
    mode: "unset",
    modelConfigurationId: null,
    modelConfigurationRevision: null,
  }), {
    mode: "unset",
    modelConfigurationId: null,
    modelConfigurationRevision: null,
  });
  assert.deepEqual(assertRuntimeDefaultBinding({
    mode: "unmanaged_cli_native",
    modelConfigurationId: null,
    modelConfigurationRevision: null,
  }).mode, "unmanaged_cli_native");
  assert.throws(() => assertRuntimeDefaultBinding({
    mode: "kith_model_configuration",
    modelConfigurationId: null,
    modelConfigurationRevision: null,
  }), (error: unknown) => error instanceof ModelControlError && error.code === "invalid_runtime_default_binding");
  assert.throws(() => assertRuntimeDefaultBinding({
    mode: "unmanaged_cli_native",
    modelConfigurationId: "model-1",
    modelConfigurationRevision: 1,
  }), (error: unknown) => error instanceof ModelControlError && error.code === "invalid_runtime_default_binding");
});

test("settings presenter exposes actionable summaries without credential refs or raw digests", () => {
  const presented = new SettingsPresentationService().presentModelConfiguration({
    connection: { id: provider.connectionId, displayName: "DeepSeek", status: "active", currentRevision: 3, createdAt: 1, updatedAt: 1 },
    provider,
    configuration: { id: model.configurationId, displayName: "DeepSeek V4 Pro", status: "active", currentRevision: 2, createdAt: 2, updatedAt: 2 },
    model,
  });
  assert.deepEqual(presented.destination, {
    host: "api.deepseek.com",
    networkClass: "public_cloud",
    label: "Cloud",
  });
  assert.equal(presented.compatibility.codex?.reason, "requires_responses_api");
  assert.equal(presented.advisorCompatibility.pi_sdk?.supported, true);
  assert.equal(presented.advisorCompatibility.claude_cli?.supported, false);
  const serialized = JSON.stringify(presented);
  assert.doesNotMatch(serialized, /secret-ref-must-not-leak/);
  assert.doesNotMatch(serialized, new RegExp("a{64}|b{64}"));
});
