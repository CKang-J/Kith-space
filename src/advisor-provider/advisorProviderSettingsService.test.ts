import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { AdvisorProviderSettingsService } from "./advisorProviderSettingsService.js";
import { appDataConnection } from "../app-data/appDatabase.js";

test("provider and model revisions are independent and exact consent is invalidated on change", async () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  registerSpace({ id: spaceId, name: "Provider", slug: `provider-${spaceId}`, rootPath: path.join(kithSpaceHome(), "provider-test", spaceId) });
  const db = dbForSpace(spaceId);
  db.insert(schema.agents).values({ id: agentId, spaceId, name: "agent", displayName: "Agent", runtime: "codex" }).run();
  const service = new AdvisorProviderSettingsService();
  try {
    const initial = service.summary();
    assert.equal(initial.settings.executionMode, "provider_v1");
    assert.equal(initial.provider?.adapterId, "pi_sdk");
    assert.equal(initial.modelProfile, null);
    await assert.rejects(() => service.createModelProfile({
      sourceKind: "manual", sourceSnapshotDigest: "forged", descriptorTrust: "bundled_verified",
      backendId: "anthropic", modelId: "claude-haiku-4-5", apiKind: "anthropic-messages", thinkingLevel: "off",
      canonicalOrigin: "https://api.anthropic.com", credentialSourceKind: "kith_secret", credentialValue: "must-not-store",
      providerSchemaVersion: 1, dataPolicyRevision: "forged", dataPolicyProvenance: "vendor_verified",
      networkClass: "public_cloud", allowedEgress: ["https://api.anthropic.com"], modelMetadata: { supportedThinking: ["off"] },
    }), /provider_model_incompatible/);
    assert.equal(service.summary().modelProfile, null);
    const profile = await service.createModelProfile({
      sourceKind: "manual",
      sourceSnapshotDigest: "manual-v1",
      descriptorTrust: "manual",
      backendId: "anthropic",
      modelId: "claude-haiku-4-5",
      apiKind: "anthropic-messages",
      thinkingLevel: "off",
      canonicalOrigin: "https://api.anthropic.com",
      credentialSourceKind: "kith_secret",
      credentialValue: "test-only-not-real",
      providerSchemaVersion: 1,
      dataPolicyRevision: "local-only-v1",
      dataPolicyProvenance: "human_asserted",
      networkClass: "public_cloud",
      allowedEgress: ["https://api.anthropic.com"],
      modelMetadata: { supportedThinking: ["off"] },
    });
    service.recordProbe(true);
    const firstProbeSnapshot = service.currentExecution().snapshot;
    const consent = service.consentAgent(spaceId, agentId, "human", { public: true, private: false, dm: false });
    assert.equal(consent.approvedProviderRevision, initial.provider?.revision);
    assert.equal(consent.approvedModelProfileRevision, profile.revision);
    assert.equal(consent.consentEpoch, 1);
    const second = await service.createModelProfile({ ...profile.profile, modelId: "claude-haiku-4-5-20251001", sourceSnapshotDigest: "manual-v2",
      credentialValue: "test-only-not-real-v2" });
    assert.equal(second.revision, profile.revision + 1);
    service.recordProbe(true, undefined, firstProbeSnapshot);
    assert.equal(service.summary().settings.state, "probing", "a stale probe cannot mark the replacement model ready");
    const invalidated = db.select().from(schema.memoryAdvisorSettings).where(eq(schema.memoryAdvisorSettings.agentId, agentId)).get()!;
    assert.equal(invalidated.approvedModelProfileRevision, null);
    assert.equal(invalidated.consentEpoch, 2);
    assert.equal((await service.rollbackToLegacy()).settings.executionMode, "legacy_runtime");
    const sqlite = appDataConnection();
    sqlite.prepare("UPDATE advisor_provider_settings SET execution_mode = 'migrating', current_provider_revision = 1 WHERE singleton_id = 1").run();
    service.recover();
    assert.equal(service.summary().settings.executionMode, "provider_v1");
    sqlite.prepare("UPDATE advisor_provider_settings SET execution_mode = 'migrating', current_provider_revision = NULL WHERE singleton_id = 1").run();
    service.recover();
    assert.equal(service.summary().settings.executionMode, "legacy_runtime");
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
