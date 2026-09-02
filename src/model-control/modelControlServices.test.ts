import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = mkdtempSync(path.join(os.tmpdir(), "kith-model-control-"));
process.env.KITH_SPACE_HOME = root;

const { closeAppDatabase } = await import("../app-data/appDatabase.js");
const { ModelProviderConnectionService } = await import("./modelProviderConnectionService.js");
const { ModelConfigurationService } = await import("./modelConfigurationService.js");
const { AdvisorBindingService } = await import("./advisorBindingService.js");
const { RuntimeProfileService } = await import("./runtimeProfileService.js");
const { runtimeConfigurationEpochGate } = await import("../runtime/config/runtimeConfigurationEpochGate.js");
const { runtimeCredentialActivationPort } = await import("../runtime/config/runtimeCredentialActivationPort.js");
const { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } = await import("../db/index.js");

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
  await assert.rejects(() => models.setStatus(model.configuration.id, "disabled"), /model_configuration_in_use/);
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

test("Pi memory advisor accepts DeepSeek-style OpenAI-compatible model configurations", async () => {
  const providers = new ModelProviderConnectionService();
  const models = new ModelConfigurationService(providers);
  const advisor = new AdvisorBindingService();
  const provider = await providers.create({
    displayName: "DeepSeek", backendId: "openai", apiKind: "openai-responses",
    canonicalOrigin: "https://api.deepseek.com", networkClass: "public_cloud",
    credentialSourceKind: "kith_secret", credentialValue: "test-key",
    dataPolicyRevision: "human-v1", dataPolicyProvenance: "human_asserted",
    allowedEgress: ["https://api.deepseek.com"],
  });
  const model = await models.create({ displayName: "deepseek-v4-flash", providerConnectionId: provider.connection.id, modelId: "deepseek-v4-flash" });
  const result = await advisor.bindModelConfiguration(model.configuration.id);
  assert.equal(result.executor?.id, "pi_sdk");
  assert.equal(result.modelConfiguration?.id, model.configuration.id);
});

test("disabling a provider cascades to unused models and refuses models still bound to a runtime", async () => {
  const providers = new ModelProviderConnectionService();
  const models = new ModelConfigurationService(providers);
  const runtimes = new RuntimeProfileService(models);
  const unusedProvider = await providers.create({
    displayName: "Unused Source", backendId: "unused", apiKind: "openai-responses",
    canonicalOrigin: "http://127.0.0.1:9912", networkClass: "loopback",
    credentialSourceKind: "keyless_local", dataPolicyRevision: "human-v1",
    dataPolicyProvenance: "human_asserted", allowedEgress: ["http://127.0.0.1:9912"],
  });
  const unusedModel = await models.create({
    displayName: "Unused Model", providerConnectionId: unusedProvider.connection.id, modelId: "unused-model",
  });

  await providers.setStatus(unusedProvider.connection.id, "disabled");
  assert.equal(providers.get(unusedProvider.connection.id).connection.status, "disabled");
  assert.equal(models.get(unusedModel.configuration.id).configuration.status, "disabled");

  const usedProvider = await providers.create({
    displayName: "Used Source", backendId: "used", apiKind: "openai-responses",
    canonicalOrigin: "http://127.0.0.1:9913", networkClass: "loopback",
    credentialSourceKind: "keyless_local", dataPolicyRevision: "human-v1",
    dataPolicyProvenance: "human_asserted", allowedEgress: ["http://127.0.0.1:9913"],
  });
  const usedModel = await models.create({
    displayName: "Used Model", providerConnectionId: usedProvider.connection.id, modelId: "used-model",
  });
  await runtimes.update("pi", {
    enabled: true,
    defaultBinding: {
      mode: "kith_model_configuration",
      modelConfigurationId: usedModel.configuration.id,
      modelConfigurationRevision: usedModel.configuration.currentRevision,
    },
  });

  await assert.rejects(
    () => providers.setStatus(usedProvider.connection.id, "disabled"),
    /model_configuration_in_use/,
  );
  assert.equal(providers.get(usedProvider.connection.id).connection.status, "active");
  assert.equal(models.get(usedModel.configuration.id).configuration.status, "active");
});

test("a model pinned by an Agent cannot be disabled", async () => {
  const providers = new ModelProviderConnectionService();
  const models = new ModelConfigurationService(providers);
  const provider = await providers.create({
    displayName: "Pinned Source", backendId: "pinned", apiKind: "openai-responses",
    canonicalOrigin: "http://127.0.0.1:9914", networkClass: "loopback",
    credentialSourceKind: "keyless_local", dataPolicyRevision: "human-v1",
    dataPolicyProvenance: "human_asserted", allowedEgress: ["http://127.0.0.1:9914"],
  });
  const model = await models.create({
    displayName: "Pinned Model", providerConnectionId: provider.connection.id, modelId: "pinned-model",
  });
  const spaceId = randomUUID();
  registerSpace({
    id: spaceId,
    name: "Pinned model test",
    slug: `pinned-${spaceId}`,
    rootPath: path.join(root, "spaces", spaceId),
  });
  try {
    dbForSpace(spaceId).insert(schema.agents).values({
      id: randomUUID(),
      spaceId,
      name: "pinned-agent",
      displayName: "Pinned Agent",
      runtime: "codex",
      modelBindingMode: "pinned",
      modelConfigurationId: model.configuration.id,
      modelConfigurationRevision: model.configuration.currentRevision,
      modelBindingState: "ready",
    }).run();
    await assert.rejects(
      () => models.setStatus(model.configuration.id, "disabled"),
      /model_configuration_in_use/,
    );
    await assert.rejects(
      () => providers.setStatus(provider.connection.id, "disabled"),
      /model_configuration_in_use/,
    );
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("a stored provider credential cannot follow an edited execution identity without re-entry", async () => {
  const providers = new ModelProviderConnectionService();
  const provider = await providers.create({
    displayName: "Keyed Source", backendId: "openai", apiKind: "openai-responses",
    canonicalOrigin: "https://api.openai.com", networkClass: "public_cloud",
    credentialSourceKind: "kith_secret", credentialValue: "test-key-one",
    dataPolicyRevision: "human-v1", dataPolicyProvenance: "human_asserted",
    allowedEgress: ["https://api.openai.com"],
  });
  const unchangedIdentity = await providers.update(provider.connection.id, {
    displayName: "Renamed Source", backendId: "openai", apiKind: "openai-responses",
    canonicalOrigin: "https://api.openai.com", networkClass: "public_cloud",
    credentialSourceKind: "kith_secret",
    credentialRef: provider.revision.credentialRef,
    credentialIdentityDigest: provider.revision.credentialIdentityDigest,
    dataPolicyRevision: "human-v1", dataPolicyProvenance: "human_asserted",
    allowedEgress: ["https://api.openai.com"],
  });
  assert.equal(unchangedIdentity.connection.displayName, "Renamed Source");

  await assert.rejects(() => providers.update(provider.connection.id, {
    displayName: "Redirected Source", backendId: "openai", apiKind: "openai-responses",
    canonicalOrigin: "https://example.com", networkClass: "public_cloud",
    credentialSourceKind: "kith_secret",
    credentialRef: unchangedIdentity.revision.credentialRef,
    credentialIdentityDigest: unchangedIdentity.revision.credentialIdentityDigest,
    dataPolicyRevision: "human-v1", dataPolicyProvenance: "human_asserted",
    allowedEgress: ["https://example.com"],
  }), /credential_reentry_required/);
  assert.equal(providers.get(provider.connection.id).revision.canonicalOrigin, "https://api.openai.com");

  const redirected = await providers.update(provider.connection.id, {
    displayName: "Redirected Source", backendId: "openai", apiKind: "openai-responses",
    canonicalOrigin: "https://example.com", networkClass: "public_cloud",
    credentialSourceKind: "kith_secret", credentialValue: "test-key-two",
    dataPolicyRevision: "human-v1", dataPolicyProvenance: "human_asserted",
    allowedEgress: ["https://example.com"],
  });
  assert.equal(redirected.revision.canonicalOrigin, "https://example.com");
});

test("runtime default change confirms never-bound follow-default Agents and holds confirmed destinations", async () => {
  const { AgentModelBindingService } = await import("./agentModelBindingService.js");
  const { eq } = await import("drizzle-orm");
  const runtimes = new RuntimeProfileService();
  const spaceId = randomUUID();
  const unconfirmedId = randomUUID();
  const confirmedId = randomUUID();
  registerSpace({
    id: spaceId,
    name: "Runtime default sync",
    slug: `runtime-default-${spaceId}`,
    rootPath: path.join(root, "spaces", spaceId),
  });
  const db = dbForSpace(spaceId);
  try {
    const unset = new AgentModelBindingService().resolve("claude", { mode: "runtime_default" });
    assert.equal(unset.modelBindingState, "setup_required");
    assert.equal(unset.modelBindingFingerprint, null);
    db.insert(schema.agents).values({
      id: unconfirmedId, spaceId, name: "unconfirmed-claude", displayName: "Unconfirmed",
      runtime: "claude", status: "active", ...unset,
    }).run();
    db.insert(schema.agents).values({
      id: confirmedId, spaceId, name: "confirmed-claude", displayName: "Confirmed",
      runtime: "claude", status: "active",
      modelBindingMode: "runtime_default",
      modelBindingFingerprint: "previous-destination",
      modelBindingLabelSnapshot: "CLI 自有账户/默认供应商",
      modelBindingState: "ready",
      runtimeRestartRequired: false,
    }).run();

    await runtimes.update("claude", {
      enabled: true,
      defaultBinding: {
        mode: "unmanaged_cli_native",
        modelConfigurationId: null,
        modelConfigurationRevision: null,
      },
    });

    const expected = new AgentModelBindingService().resolve("claude", { mode: "runtime_default" });
    const unconfirmed = db.select().from(schema.agents).where(eq(schema.agents.id, unconfirmedId)).get()!;
    const confirmed = db.select().from(schema.agents).where(eq(schema.agents.id, confirmedId)).get()!;
    assert.equal(expected.modelBindingState, "ready");
    assert.equal(unconfirmed.modelBindingState, "ready");
    assert.equal(unconfirmed.runtimeRestartRequired, false);
    assert.equal(unconfirmed.modelBindingFingerprint, expected.modelBindingFingerprint);
    assert.equal(confirmed.modelBindingState, "restart_required");
    assert.equal(confirmed.runtimeRestartRequired, true);
    assert.equal(confirmed.modelBindingFingerprint, "previous-destination");
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
