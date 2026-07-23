import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = mkdtempSync(path.join(os.tmpdir(), "kith-model-control-"));
process.env.KITH_SPACE_HOME = root;

const { closeAppDatabase } = await import("../app-data/appDatabase.js");
const { ModelProviderConnectionService } = await import("./modelProviderConnectionService.js");
const { ModelConfigurationService } = await import("./modelConfigurationService.js");
const { RuntimeProfileService } = await import("./runtimeProfileService.js");
const { runtimeConfigurationEpochGate } = await import("../runtime/config/runtimeConfigurationEpochGate.js");
const { runtimeCredentialActivationPort } = await import("../runtime/config/runtimeCredentialActivationPort.js");

test.after(() => {
  closeAppDatabase();
  rmSync(root, { recursive: true, force: true });
});

test("provider, model, and runtime edits append immutable revisions and bump runtime epoch", async () => {
  const providers = new ModelProviderConnectionService();
  const models = new ModelConfigurationService(providers);
  const runtimes = new RuntimeProfileService(models);
  const provider = await providers.create({
    displayName: "Local Gateway", backendId: "openai", apiKind: "openai-responses",
    canonicalOrigin: "http://127.0.0.1:9911", networkClass: "loopback",
    credentialSourceKind: "keyless_local", dataPolicyRevision: "human-v1",
    dataPolicyProvenance: "human_asserted", allowedEgress: ["http://127.0.0.1:9911"],
  });
  const model = await models.create({
    displayName: "Local GPT", providerConnectionId: provider.connection.id, modelId: "gpt-local",
  });
  const before = runtimes.runtimeConfigurationEpoch();
  const staleActivation = {
    activationId: "stale-on-change",
    runtimeSessionId: "session-before-change",
    sessionGeneration: 1,
    workerGeneration: 1,
    runtimeId: "codex" as const,
    providerRevision: 1,
    modelConfigurationRevision: 1,
    runtimeProfileRevision: 1,
    runtimeConfigurationEpoch: before,
    effectiveConfigDigest: "a".repeat(64),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  runtimeCredentialActivationPort.issue(staleActivation, {
    value: "must-not-survive",
    type: "api_key",
    identityDigest: "identity",
  });
  const profile = await runtimes.update("codex", {
    enabled: true,
    defaultBinding: {
      mode: "kith_model_configuration",
      modelConfigurationId: model.configuration.id,
      modelConfigurationRevision: model.configuration.currentRevision,
    },
  });
  assert.equal(profile.defaultBinding.mode, "kith_model_configuration");
  assert.equal(runtimes.runtimeConfigurationEpoch(), before + 1);
  assert.equal(runtimeConfigurationEpochGate.current(), before + 1);
  assert.throws(() => runtimeCredentialActivationPort.redeem(staleActivation), /activation_unavailable/);
  await assert.rejects(
    () => runtimeConfigurationEpochGate.withAdmission(before, () => "stale"),
    /runtime_configuration_stale/,
  );
  assert.equal((await models.update(model.configuration.id, {
    displayName: "Local GPT", providerConnectionId: provider.connection.id, modelId: "gpt-local-v2",
  })).configuration.currentRevision, 2);
  assert.equal(models.get(model.configuration.id).revision.modelId, "gpt-local-v2");
  assert.throws(() => models.setStatus(model.configuration.id, "disabled"), /model_configuration_in_use/);
});

test("runtime compatibility rejects unsupported wire APIs without weakening the three-state binding", async () => {
  const providers = new ModelProviderConnectionService();
  const models = new ModelConfigurationService(providers);
  const runtimes = new RuntimeProfileService(models);
  const provider = await providers.create({
    displayName: "Anthropic", backendId: "anthropic", apiKind: "anthropic-messages",
    canonicalOrigin: "https://api.anthropic.com", networkClass: "public_cloud",
    credentialSourceKind: "keyless_local", dataPolicyRevision: "human-v1",
    dataPolicyProvenance: "human_asserted", allowedEgress: ["https://api.anthropic.com"],
  });
  const model = await models.create({ displayName: "Claude", providerConnectionId: provider.connection.id, modelId: "claude" });
  await assert.rejects(() => runtimes.update("codex", {
    enabled: true,
    defaultBinding: {
      mode: "kith_model_configuration",
      modelConfigurationId: model.configuration.id,
      modelConfigurationRevision: 1,
    },
  }), (error: any) => error?.code === "model_configuration_incompatible" && error.message === "requires_responses_api");
  assert.equal((await runtimes.update("codex", {
    enabled: true,
    defaultBinding: { mode: "unmanaged_cli_native", modelConfigurationId: null, modelConfigurationRevision: null },
  })).defaultBinding.mode, "unmanaged_cli_native");
});
