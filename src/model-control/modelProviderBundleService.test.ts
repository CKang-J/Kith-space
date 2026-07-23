import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = mkdtempSync(path.join(os.tmpdir(), "kith-model-provider-bundle-"));
process.env.KITH_SPACE_HOME = root;

const {
  closeAppDatabase,
  registerSpace: registerAppSpace,
  unregisterSpace: unregisterAppSpace,
} = await import("../app-data/appDatabase.js");
const {
  dbForSpace,
  registerSpace: registerWorkspace,
  schema,
  unregisterSpace: unregisterWorkspace,
} = await import("../db/index.js");
const { ModelConfigurationService } = await import("./modelConfigurationService.js");
const { ModelProviderBundleService } = await import("./modelProviderBundleService.js");
const { ModelProviderConnectionService } = await import("./modelProviderConnectionService.js");
const { withRuntimeConfigurationChange } = await import("./runtimeConfigurationChange.js");
const { RuntimeProfileService } = await import("./runtimeProfileService.js");
const { AgentModelBindingService } = await import("./agentModelBindingService.js");

test.after(() => {
  closeAppDatabase();
  rmSync(root, { recursive: true, force: true });
});

const providerInput = (displayName: string) => ({
  displayName,
  backendId: "openai",
  apiKind: "openai-responses" as const,
  canonicalOrigin: "http://127.0.0.1:9920",
  networkClass: "loopback" as const,
  credentialSourceKind: "keyless_local" as const,
  dataPolicyRevision: "human-v1",
  dataPolicyProvenance: "human_asserted" as const,
  allowedEgress: ["http://127.0.0.1:9920"],
});

test("provider bundle edits roll back completely when a requested model removal is in use", async () => {
  const providers = new ModelProviderConnectionService();
  const configurations = new ModelConfigurationService(providers);
  const bundles = new ModelProviderBundleService(providers, configurations);
  const runtimes = new RuntimeProfileService(configurations);
  const created = await bundles.save({
    provider: providerInput("Atomic Source"),
    models: [
      { displayName: "Keep", modelId: "keep" },
      { displayName: "Bound", modelId: "bound" },
    ],
  });
  const [keep, bound] = created.models;
  await runtimes.update("codex", {
    enabled: true,
    defaultBinding: {
      mode: "kith_model_configuration",
      modelConfigurationId: bound!.configuration.id,
      modelConfigurationRevision: bound!.configuration.currentRevision,
    },
  });
  const beforeProvider = providers.get(created.provider.connection.id);
  const beforeKeep = configurations.get(keep!.configuration.id);

  await assert.rejects(() => bundles.save({
    providerId: created.provider.connection.id,
    provider: providerInput("Must Roll Back"),
    models: [{ id: keep!.configuration.id, displayName: "Keep Changed", modelId: "keep-v2" }],
  }), (error: any) => {
    assert.equal(error?.code, "model_configuration_in_use");
    assert.deepEqual(error?.details?.usage, [{
      configurationId: bound!.configuration.id,
      kind: "runtime_default",
      runtimeId: "codex",
      runtimeEnabled: true,
    }]);
    return true;
  });

  assert.equal(providers.get(created.provider.connection.id).connection.displayName, "Atomic Source");
  assert.equal(providers.get(created.provider.connection.id).connection.currentRevision,
    beforeProvider.connection.currentRevision);
  assert.equal(configurations.get(keep!.configuration.id).configuration.currentRevision,
    beforeKeep.configuration.currentRevision);
  assert.equal(configurations.get(bound!.configuration.id).configuration.status, "active");
});

test("provider bundle commits provider revision, retained model revision, and unused removal together", async () => {
  const providers = new ModelProviderConnectionService();
  const configurations = new ModelConfigurationService(providers);
  const bundles = new ModelProviderBundleService(providers, configurations);
  const created = await bundles.save({
    provider: providerInput("Editable Source"),
    models: [
      { displayName: "Retained", modelId: "retained" },
      { displayName: "Remove", modelId: "remove" },
    ],
  });
  const [retained, removed] = created.models;
  const updated = await bundles.save({
    providerId: created.provider.connection.id,
    provider: providerInput("Edited Source"),
    models: [{
      id: retained!.configuration.id,
      displayName: "Retained v2",
      modelId: "retained-v2",
    }],
  });

  assert.equal(updated.provider.connection.displayName, "Edited Source");
  assert.equal(updated.models[0]!.revision.providerRevision, updated.provider.connection.currentRevision);
  assert.equal(configurations.get(removed!.configuration.id).configuration.status, "disabled");
  assert.throws(() => new AgentModelBindingService(providers, configurations).resolve("codex", {
    mode: "pinned",
    modelConfigurationId: removed!.configuration.id,
    modelConfigurationRevision: removed!.configuration.currentRevision,
  }), /model_configuration_not_found/);
  await assert.rejects(() => new RuntimeProfileService(configurations).update("codex", {
    enabled: true,
    defaultBinding: {
      mode: "kith_model_configuration",
      modelConfigurationId: removed!.configuration.id,
      modelConfigurationRevision: removed!.configuration.currentRevision,
    },
  }), /model_configuration_not_found/);
});

test("soft-deleted pinned Agents no longer keep a model permanently in use", async () => {
  const providers = new ModelProviderConnectionService();
  const configurations = new ModelConfigurationService(providers);
  const bundles = new ModelProviderBundleService(providers, configurations);
  const created = await bundles.save({
    provider: providerInput("Deleted Agent Source"),
    models: [{ displayName: "Retired Binding", modelId: "retired-binding" }],
  });
  const model = created.models[0]!;
  const spaceId = "soft-deleted-agent-space";
  const spaceRoot = path.join(root, "spaces", spaceId);
  registerWorkspace({ id: spaceId, name: "Soft Deleted", slug: spaceId, rootPath: spaceRoot });
  try {
    const db = dbForSpace(spaceId);
    await db.insert(schema.agents).values({
      spaceId,
      name: "retired",
      displayName: "Retired",
      modelBindingMode: "pinned",
      modelConfigurationId: model.configuration.id,
      modelConfigurationRevision: model.configuration.currentRevision,
      modelBindingState: "ready",
      deletedAt: new Date(),
    });

    await bundles.save({
      providerId: created.provider.connection.id,
      provider: providerInput("Deleted Agent Source"),
      models: [],
    });
    assert.equal(configurations.get(model.configuration.id).configuration.status, "disabled");
  } finally {
    unregisterWorkspace(spaceId);
  }
});

test("model removal fails closed while any registered Space is unavailable", async () => {
  const providers = new ModelProviderConnectionService();
  const configurations = new ModelConfigurationService(providers);
  const bundles = new ModelProviderBundleService(providers, configurations);
  const created = await bundles.save({
    provider: providerInput("Offline Space Source"),
    models: [{ displayName: "Potentially Bound", modelId: "potentially-bound" }],
  });
  const model = created.models[0]!;
  const spaceId = "offline-model-usage-space";
  registerAppSpace({
    id: spaceId,
    name: "Offline",
    slug: spaceId,
    rootPath: path.join(root, "missing-space-root"),
  });
  try {
    await assert.rejects(() => bundles.save({
      providerId: created.provider.connection.id,
      provider: providerInput("Must Not Save"),
      models: [],
    }), (error: any) => error?.code === "space_unavailable");
    assert.equal(providers.get(created.provider.connection.id).connection.displayName, "Offline Space Source");
    assert.equal(configurations.get(model.configuration.id).configuration.status, "active");
  } finally {
    unregisterAppSpace(spaceId);
  }
});

test("queued bundle saves recompute removals only after entering the configuration gate", async () => {
  const providers = new ModelProviderConnectionService();
  const configurations = new ModelConfigurationService(providers);
  const bundles = new ModelProviderBundleService(providers, configurations);
  const created = await bundles.save({
    provider: providerInput("Concurrent Source"),
    models: [
      { displayName: "Keep", modelId: "concurrent-keep" },
      { displayName: "Remove", modelId: "concurrent-remove" },
    ],
  });
  const [keep, removed] = created.models;
  let release!: () => void;
  let entered!: () => void;
  const enteredGate = new Promise<void>((resolve) => { entered = resolve; });
  const holdGate = new Promise<void>((resolve) => { release = resolve; });
  const blocker = withRuntimeConfigurationChange(async () => {
    entered();
    await holdGate;
  });
  await enteredGate;

  const remove = bundles.save({
    providerId: created.provider.connection.id,
    provider: providerInput("First Save"),
    models: [{ id: keep!.configuration.id, displayName: "Keep", modelId: "concurrent-keep" }],
  });
  const staleKeep = bundles.save({
    providerId: created.provider.connection.id,
    provider: providerInput("Stale Save"),
    models: [
      { id: keep!.configuration.id, displayName: "Keep", modelId: "concurrent-keep" },
      { id: removed!.configuration.id, displayName: "Remove", modelId: "concurrent-remove" },
    ],
  });
  release();
  await blocker;

  await remove;
  await assert.rejects(() => staleKeep, (error: any) => error?.code === "model_configuration_not_found");
  assert.equal(configurations.get(removed!.configuration.id).configuration.status, "disabled");
  assert.equal(providers.get(created.provider.connection.id).connection.displayName, "First Save");
});
