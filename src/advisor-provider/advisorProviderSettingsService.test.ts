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

test("switching to an executor with incompatible model clears only the active binding", async () => {
  const service = new AdvisorProviderSettingsService();
  const sqlite = appDataConnection();
  const revision = Number(sqlite.prepare("SELECT coalesce(max(revision), 0) + 1 FROM advisor_model_profile_revisions").pluck().get());
  sqlite.prepare(String.raw`INSERT INTO advisor_model_profile_revisions (
    revision, source_kind, source_snapshot_digest, descriptor_trust, backend_id, model_id, api_kind,
    thinking_level, canonical_origin, region, tenant_or_project_digest, credential_source_kind,
    credential_identity_digest, credential_ref, provider_schema_version, data_policy_revision,
    data_policy_provenance, network_class, allowed_egress_json, model_metadata_json,
    source_model_configuration_id, source_model_configuration_revision, created_at
  ) VALUES (?, 'manual', 'test', 'manual', 'anthropic', 'not-in-pi-catalog', 'anthropic-messages',
    'off', 'https://api.anthropic.com', NULL, NULL, 'kith_secret', 'digest', NULL, 1,
    'test', 'human_asserted', 'public_cloud', '["https://api.anthropic.com"]', '{}', NULL, NULL, ?)` )
    .run(revision, Date.now());
  sqlite.prepare("UPDATE advisor_provider_settings SET current_model_profile_revision = ?, model_configuration_id = 'stale-model', model_configuration_revision = 1 WHERE singleton_id = 1").run(revision);
  const result = await service.selectProvider("pi_sdk");
  assert.equal(result.modelProfile, null);
  const row = sqlite.prepare("SELECT model_configuration_id, model_configuration_revision FROM advisor_provider_settings WHERE singleton_id = 1").get() as { model_configuration_id: string | null; model_configuration_revision: number | null };
  assert.deepEqual(row, { model_configuration_id: null, model_configuration_revision: null });
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS count FROM advisor_model_profile_revisions WHERE revision = ?").get(revision) as { count: number }).count, 1);
});
