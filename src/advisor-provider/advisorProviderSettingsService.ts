import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { and, desc, eq, inArray } from "drizzle-orm";
import { appDataConnection } from "../app-data/appDatabase.js";
import { availableSpaceDbs, dbForSpace, schema } from "../db/index.js";
import { resolvePiAdvisorHelper } from "../runtime/worker/maintenance/piSdkAdvisorProvider.js";
import { canonicalJson, memoryHmac } from "../memory/memoryIntegrity.js";
import { compileAdvisorModel } from "./advisorModelCompiler.js";
import {
  AdvisorProviderError,
  type AdvisorModelProfile,
  type AdvisorProviderDescriptor,
  type ProviderExecutionSnapshot,
} from "./contracts.js";
import { providerCredentialPort } from "./credentialPort.js";
import { providerEpochGate } from "./providerEpochGate.js";
import { PiCliConfigImporter } from "./piCliConfigImporter.js";
import { VerifiedConfigFileReader } from "./verifiedConfigFileReader.js";
import { getContentHmacKey } from "../app-data/appDatabase.js";
import { ADVISOR_PROVIDER_CAPABILITIES, PI_AI_PACKAGE_INTEGRITY, advisorProviderDescriptor, listAdvisorProviderDescriptors } from "./providerRegistry.js";
import { piSdkCatalogDigest, piSdkModelCompatibility } from "./piSdkCatalog.js";
import { advisorCredentialEnvAllowed } from "./credentialEnvPolicy.js";
import { cancelActiveAdvisorRuns } from "./activeAdvisorRuns.js";
import { resolveExecutable, sha256File } from "./providerArtifact.js";
import { advisorAuthenticationCapability } from "./advisorAuthentication.js";

type SettingsRow = {
  installation_identity_digest: string;
  execution_mode: "legacy_runtime" | "migrating" | "provider_v1";
  provider_state: "setup_required" | "probing" | "ready" | "paused" | "unsupported";
  enabled: number;
  current_provider_revision: number | null;
  current_model_profile_revision: number | null;
  provider_epoch: number;
  revocation_epoch: number;
  updated_at: number;
};
type ProviderRow = {
  revision: number; adapter_id: "pi_sdk" | "claude_cli"; adapter_version: string;
  executable_or_package_realpath: string | null; executable_or_package_digest: string; sdk_lock_digest: string | null;
  sanitized_config_json: string; config_digest: string; capability_digest: string; created_at: number;
};
type ModelRow = {
  revision: number; source_kind: AdvisorModelProfile["sourceKind"]; source_snapshot_digest: string;
  descriptor_trust: AdvisorModelProfile["descriptorTrust"]; backend_id: string; model_id: string;
  api_kind: AdvisorModelProfile["apiKind"]; thinking_level: AdvisorModelProfile["thinkingLevel"];
  canonical_origin: string; region: string | null; tenant_or_project_digest: string | null;
  credential_source_kind: AdvisorModelProfile["credentialSourceKind"]; credential_identity_digest: string;
  credential_ref: string | null; provider_schema_version: number; data_policy_revision: string;
  data_policy_provenance: AdvisorModelProfile["dataPolicyProvenance"]; network_class: AdvisorModelProfile["networkClass"];
  allowed_egress_json: string; model_metadata_json: string; created_at: number;
};

function settingsRow(): SettingsRow {
  const row = appDataConnection().prepare("SELECT * FROM advisor_provider_settings WHERE singleton_id = 1").get() as SettingsRow | undefined;
  if (!row) throw new AdvisorProviderError("provider_unconfigured");
  return row;
}

function providerRow(revision: number | null): ProviderRow | null {
  return revision == null ? null : appDataConnection().prepare("SELECT * FROM advisor_provider_revisions WHERE revision = ?").get(revision) as ProviderRow | null;
}

function modelRow(revision: number | null): ModelRow | null {
  return revision == null ? null : appDataConnection().prepare("SELECT * FROM advisor_model_profile_revisions WHERE revision = ?").get(revision) as ModelRow | null;
}

function mapProfile(row: ModelRow): AdvisorModelProfile {
  return {
    sourceKind: row.source_kind,
    sourceSnapshotDigest: row.source_snapshot_digest,
    descriptorTrust: row.descriptor_trust,
    backendId: row.backend_id,
    modelId: row.model_id,
    apiKind: row.api_kind,
    thinkingLevel: row.thinking_level,
    canonicalOrigin: row.canonical_origin,
    ...(row.region ? { region: row.region } : {}),
    ...(row.tenant_or_project_digest ? { tenantOrProjectDigest: row.tenant_or_project_digest } : {}),
    credentialSourceKind: row.credential_source_kind,
    credentialIdentityDigest: row.credential_identity_digest,
    providerSchemaVersion: row.provider_schema_version,
    dataPolicyRevision: row.data_policy_revision,
    dataPolicyProvenance: row.data_policy_provenance,
    networkClass: row.network_class,
    allowedEgress: JSON.parse(row.allowed_egress_json),
    modelMetadata: JSON.parse(row.model_metadata_json),
  };
}

function digest(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }

export class AdvisorProviderSettingsService {
  constructor() {
    const current = settingsRow();
    if (current.execution_mode !== "migrating") providerEpochGate.open(current.provider_epoch);
  }

  summary() {
    const settings = settingsRow();
    const provider = providerRow(settings.current_provider_revision);
    const model = modelRow(settings.current_model_profile_revision);
    return {
      settings: {
        executionMode: settings.execution_mode,
        state: settings.provider_state,
        enabled: Boolean(settings.enabled),
        providerEpoch: settings.provider_epoch,
        revocationEpoch: settings.revocation_epoch,
        installationIdentityDigest: settings.installation_identity_digest,
      },
      provider: provider ? {
        revision: provider.revision,
        adapterId: provider.adapter_id,
        adapterVersion: provider.adapter_version,
        executableOrPackageDigest: provider.executable_or_package_digest,
        sdkLockDigest: provider.sdk_lock_digest,
        capabilityDigest: provider.capability_digest,
        capabilities: ADVISOR_PROVIDER_CAPABILITIES,
      } : null,
      modelProfile: model ? { revision: model.revision, profile: mapProfile(model) } : null,
      availableProviders: listAdvisorProviderDescriptors(),
    };
  }

  diagnostics() {
    const summary = this.summary();
    const helper = resolvePiAdvisorHelper();
    const helperDigest = existsSync(helper) ? sha256File(helper) : null;
    const claude = resolveExecutable("claude");
    return {
      executionMode: summary.settings.executionMode,
      providerState: summary.settings.state,
      helper: { available: helperDigest !== null, digestMatchesRevision: summary.provider?.adapterId !== "pi_sdk"
        || helperDigest === summary.provider.executableOrPackageDigest },
      claude: { available: claude !== null },
      environmentPolicy: "allowlist",
      ambientAuth: "disabled",
      redirects: "reject",
      dns: "preflight_pinned",
      maxConcurrentRuns: 1,
    };
  }

  listRuns(limit = 50) {
    const bounded = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
    return availableSpaceDbs().flatMap(({ space, db }) => db.select().from(schema.advisorProviderRuns)
      .orderBy(desc(schema.advisorProviderRuns.createdAt)).limit(bounded).all()
      .map((run) => {
        const provider = providerRow(run.providerRevision);
        const model = modelRow(run.modelProfileRevision);
        return { ...run, spaceName: space.name,
          provider: provider ? { adapterId: provider.adapter_id, adapterVersion: provider.adapter_version } : null,
          model: model ? { sourceKind: model.source_kind, backendId: model.backend_id, modelId: model.model_id,
            canonicalOrigin: model.canonical_origin, credentialIdentityDigest: model.credential_identity_digest,
            dataPolicyRevision: model.data_policy_revision, dataPolicyProvenance: model.data_policy_provenance,
            allowedEgress: JSON.parse(model.allowed_egress_json) } : null };
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, bounded);
  }

  listPiImports(limit = 20) {
    return appDataConnection().prepare(`SELECT id, config_root_digest AS configRootDigest,
      catalog_digest AS catalogDigest, warnings_json AS warningsJson, file_identities_json AS fileIdentitiesJson,
      imported_at AS importedAt FROM pi_cli_config_imports ORDER BY imported_at DESC LIMIT ?`).all(Math.min(100, Math.max(1, limit)))
      .map((row: any) => ({ ...row, warnings: JSON.parse(row.warningsJson), fileIdentities: JSON.parse(row.fileIdentitiesJson),
        warningsJson: undefined, fileIdentitiesJson: undefined }));
  }

  async createModelProfile(input: Omit<AdvisorModelProfile, "credentialIdentityDigest"> & {
    credentialIdentityDigest?: string;
    credentialValue?: string;
    credentialRef?: string | null;
    sourceModelConfigurationId?: string;
    sourceModelConfigurationRevision?: number;
  }): Promise<{ revision: number; profile: AdvisorModelProfile }> {
    if (Buffer.byteLength(canonicalJson(input.modelMetadata)) > 64 * 1024) throw new AdvisorProviderError("provider_model_incompatible");
    if (input.sourceKind === "manual" && (input.descriptorTrust !== "manual" || input.dataPolicyProvenance === "vendor_verified")) {
      throw new AdvisorProviderError("provider_model_incompatible");
    }
    if (input.sourceKind === "pi_cli_import") {
      const imported = appDataConnection().prepare("SELECT 1 FROM pi_cli_config_imports WHERE catalog_digest = ?").get(input.sourceSnapshotDigest);
      if (!imported || input.descriptorTrust !== "pi_cli_imported" || input.dataPolicyProvenance === "vendor_verified") {
        throw new AdvisorProviderError("provider_model_incompatible");
      }
    }
    if (input.sourceKind === "bundled_catalog"
      && (input.descriptorTrust !== "bundled_verified" || input.sourceSnapshotDigest !== piSdkCatalogDigest())) {
      throw new AdvisorProviderError("provider_model_incompatible");
    }
    const candidateProfile: AdvisorModelProfile = {
      ...input,
      credentialIdentityDigest: input.credentialIdentityDigest || "pending",
    };
    delete (candidateProfile as Partial<typeof candidateProfile> & { credentialValue?: string }).credentialValue;
    delete (candidateProfile as Partial<typeof candidateProfile> & { credentialRef?: string | null }).credentialRef;
    compileAdvisorModel(candidateProfile);
    const providerBeforeSecret = providerRow(settingsRow().current_provider_revision);
    if (providerBeforeSecret && (!advisorAuthenticationCapability(providerBeforeSecret.adapter_id, candidateProfile).supported
      || (providerBeforeSecret.adapter_id === "pi_sdk" && !piSdkModelCompatibility(candidateProfile).compatible))) {
      throw new AdvisorProviderError("provider_model_incompatible");
    }
    let credentialRef = input.credentialRef ?? null;
    let credentialIdentityDigest = input.credentialIdentityDigest ?? "";
    if (input.credentialSourceKind === "kith_secret") {
      if (input.credentialValue) {
        const stored = providerCredentialPort.storeKithSecret(input.backendId, input.credentialValue);
        credentialRef = stored.credentialRef;
        credentialIdentityDigest = stored.credentialIdentityDigest;
      } else if (credentialRef) {
        const verified = providerCredentialPort.identityForStoredRef(credentialRef, input.backendId, "kith_secret");
        if (input.credentialIdentityDigest && verified !== input.credentialIdentityDigest) {
          throw new AdvisorProviderError("provider_auth_required");
        }
        credentialIdentityDigest = verified;
      } else throw new AdvisorProviderError("provider_auth_required");
    } else if (input.credentialSourceKind === "env_ref") {
      if (!credentialRef || !advisorCredentialEnvAllowed(input.backendId, input.apiKind, credentialRef)) throw new AdvisorProviderError("provider_auth_required");
      credentialIdentityDigest = providerCredentialPort.envIdentity(credentialRef);
    } else if (input.credentialSourceKind === "keyless_local") {
      credentialRef = null;
      credentialIdentityDigest = providerCredentialPort.keylessIdentity();
    } else if (input.credentialSourceKind === "pi_cli_auth") {
      if (!credentialRef) throw new AdvisorProviderError("provider_auth_required");
      credentialIdentityDigest = providerCredentialPort.identityForStoredRef(credentialRef, input.backendId, "pi_cli_auth");
    } else throw new AdvisorProviderError("provider_auth_required");
    const profile: AdvisorModelProfile = {
      sourceKind: input.sourceKind,
      sourceSnapshotDigest: input.sourceSnapshotDigest,
      descriptorTrust: input.descriptorTrust,
      backendId: input.backendId,
      modelId: input.modelId,
      apiKind: input.apiKind,
      thinkingLevel: input.thinkingLevel,
      canonicalOrigin: input.canonicalOrigin,
      ...(input.region ? { region: input.region } : {}),
      ...(input.tenantOrProjectDigest ? { tenantOrProjectDigest: input.tenantOrProjectDigest } : {}),
      credentialSourceKind: input.credentialSourceKind,
      credentialIdentityDigest,
      providerSchemaVersion: input.providerSchemaVersion,
      dataPolicyRevision: input.dataPolicyRevision,
      dataPolicyProvenance: input.dataPolicyProvenance,
      networkClass: input.networkClass,
      allowedEgress: input.allowedEgress,
      modelMetadata: input.modelMetadata,
    };
    compileAdvisorModel(profile);
    const activeProvider = providerRow(settingsRow().current_provider_revision);
    if (activeProvider && !advisorAuthenticationCapability(activeProvider.adapter_id, profile).supported) {
      throw new AdvisorProviderError("provider_model_incompatible");
    }
    if (activeProvider?.adapter_id === "pi_sdk" && !piSdkModelCompatibility(profile).compatible) {
      throw new AdvisorProviderError("provider_model_incompatible");
    }
    let revision = 0;
    await providerEpochGate.withWrite(async () => {
      const sqlite = appDataConnection();
      const transaction = sqlite.transaction(() => {
        revision = Number(sqlite.prepare("SELECT coalesce(max(revision), 0) + 1 FROM advisor_model_profile_revisions").pluck().get());
        sqlite.prepare(`INSERT INTO advisor_model_profile_revisions (
          revision, source_kind, source_snapshot_digest, descriptor_trust, backend_id, model_id, api_kind,
          thinking_level, canonical_origin, region, tenant_or_project_digest, credential_source_kind,
          credential_identity_digest, credential_ref, provider_schema_version, data_policy_revision,
          data_policy_provenance, network_class, allowed_egress_json, model_metadata_json,
          source_model_configuration_id, source_model_configuration_revision, created_at
        ) VALUES (@revision, @sourceKind, @sourceSnapshotDigest, @descriptorTrust, @backendId, @modelId, @apiKind,
          @thinkingLevel, @canonicalOrigin, @region, @tenantOrProjectDigest, @credentialSourceKind,
          @credentialIdentityDigest, @credentialRef, @providerSchemaVersion, @dataPolicyRevision,
          @dataPolicyProvenance, @networkClass, @allowedEgress, @modelMetadata,
          @sourceModelConfigurationId, @sourceModelConfigurationRevision, @createdAt)
        `).run({ ...profile, revision, region: profile.region ?? null, tenantOrProjectDigest: profile.tenantOrProjectDigest ?? null,
          credentialRef, allowedEgress: canonicalJson(profile.allowedEgress), modelMetadata: canonicalJson(profile.modelMetadata),
          sourceModelConfigurationId: input.sourceModelConfigurationId ?? null,
          sourceModelConfigurationRevision: input.sourceModelConfigurationRevision ?? null, createdAt: Date.now() });
        sqlite.prepare(`UPDATE advisor_provider_settings SET current_model_profile_revision = ?, provider_state = 'probing',
          provider_epoch = provider_epoch + 1, revocation_epoch = revocation_epoch + 1, updated_at = ? WHERE singleton_id = 1`).run(revision, Date.now());
      });
      transaction.immediate();
      const epoch = settingsRow().provider_epoch;
      await cancelActiveAdvisorRuns();
      this.invalidateWorkspaceConsent(epoch, "provider_model_changed");
      providerEpochGate.open(epoch);
    });
    return { revision, profile };
  }

  recordProbe(ok: boolean, failureCode?: string, expected?: Pick<ProviderExecutionSnapshot, "providerEpoch" | "providerRevision" | "modelProfileRevision">): ReturnType<AdvisorProviderSettingsService["summary"]> {
    const state = ok ? "ready" : failureCode === "provider_auth_required" || failureCode === "provider_model_setup_required"
      ? "setup_required" : "unsupported";
    const pinned = expected ?? this.currentExecution().snapshot;
    appDataConnection().prepare(`UPDATE advisor_provider_settings SET provider_state = ?, updated_at = ?
      WHERE singleton_id = 1 AND provider_epoch = ? AND current_provider_revision = ? AND current_model_profile_revision = ?`)
      .run(state, Date.now(), pinned.providerEpoch, pinned.providerRevision, pinned.modelProfileRevision);
    return this.summary();
  }

  importPiCli(root: string, includeAuthProvider?: string) {
    let result;
    try { result = new PiCliConfigImporter(new VerifiedConfigFileReader(), getContentHmacKey()).import(root, { includeAuthProvider }); }
    catch { throw new AdvisorProviderError("provider_model_config_changed"); }
    if (includeAuthProvider && !result.selectedCredentialAvailable) throw new AdvisorProviderError("provider_auth_required");
    const id = randomUUID();
    appDataConnection().prepare(`INSERT INTO pi_cli_config_imports (
      id, config_root_digest, catalog_digest, secret_source_identity, imported_catalog_json,
      warnings_json, file_identities_json, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, memoryHmac({ kind: "pi_cli_root", root }), result.catalogDigest, result.secretSourceIdentity,
        canonicalJson({ defaults: result.defaults, descriptors: result.descriptors }), canonicalJson(result.warnings),
        canonicalJson(result.fileIdentities), Date.now());
    const credential = includeAuthProvider
      ? providerCredentialPort.storePiCliSource(includeAuthProvider, root, result.secretSourceIdentity)
      : null;
    return { id, ...result, ...(credential ? { credential: { backendId: includeAuthProvider, ...credential } } : {}) };
  }

  async selectProvider(adapterId: AdvisorProviderDescriptor["adapterId"]): Promise<ReturnType<AdvisorProviderSettingsService["summary"]>> {
    const descriptor = advisorProviderDescriptor(adapterId);
    const currentModel = modelRow(settingsRow().current_model_profile_revision);
    if (currentModel) {
      const profile = mapProfile(currentModel);
      if (!advisorAuthenticationCapability(adapterId, profile).supported
        || (adapterId === "pi_sdk" && !piSdkModelCompatibility(profile).compatible)) throw new AdvisorProviderError("provider_model_incompatible");
    }
    await providerEpochGate.withWrite(async () => {
      const sqlite = appDataConnection();
      let nextEpoch = 0;
      const transaction = sqlite.transaction(() => {
        const revision = Number(sqlite.prepare("SELECT coalesce(max(revision), 0) + 1 FROM advisor_provider_revisions").pluck().get());
        const artifactPath = adapterId === "pi_sdk" ? resolvePiAdvisorHelper() : resolveExecutable("claude");
        if (!artifactPath || !existsSync(artifactPath)) throw new AdvisorProviderError("provider_unavailable");
        const artifactDigest = sha256File(artifactPath);
        const capabilityDigest = digest(descriptor.capabilities);
        const config = { environment: "allowlist", projectCustomization: "disabled", helper: adapterId === "pi_sdk" ? "pi-advisor-helper.mjs" : null };
        sqlite.prepare(`INSERT INTO advisor_provider_revisions (
          revision, adapter_id, adapter_version, executable_or_package_realpath, executable_or_package_digest,
          sdk_lock_digest, sanitized_config_json, config_digest, capability_digest, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(revision, adapterId, descriptor.adapterVersion, artifactPath, artifactDigest,
            adapterId === "pi_sdk" ? digest(PI_AI_PACKAGE_INTEGRITY) : null, canonicalJson(config), digest(config), capabilityDigest, Date.now());
        sqlite.prepare(`UPDATE advisor_provider_settings SET execution_mode = 'migrating', provider_state = 'probing',
          current_provider_revision = ?, provider_epoch = provider_epoch + 1, revocation_epoch = revocation_epoch + 1,
          updated_at = ? WHERE singleton_id = 1`).run(revision, Date.now());
        nextEpoch = settingsRow().provider_epoch;
      });
      transaction.immediate();
      providerCredentialPort.revokeAll();
      await cancelActiveAdvisorRuns();
      this.invalidateWorkspaceConsent(nextEpoch, "provider_changed");
      sqlite.prepare("UPDATE advisor_provider_settings SET execution_mode = 'provider_v1', updated_at = ? WHERE singleton_id = 1").run(Date.now());
      providerEpochGate.open(nextEpoch);
    });
    return this.summary();
  }

  async rollbackToLegacy(): Promise<ReturnType<AdvisorProviderSettingsService["summary"]>> {
    await providerEpochGate.withWrite(async () => {
      const sqlite = appDataConnection();
      let nextEpoch = 0;
      sqlite.transaction(() => {
        sqlite.prepare(`UPDATE advisor_provider_settings SET execution_mode = 'migrating', provider_state = 'setup_required',
          current_provider_revision = NULL, provider_epoch = provider_epoch + 1,
          revocation_epoch = revocation_epoch + 1, updated_at = ? WHERE singleton_id = 1`).run(Date.now());
        nextEpoch = settingsRow().provider_epoch;
      }).immediate();
      providerCredentialPort.revokeAll();
      await cancelActiveAdvisorRuns();
      this.invalidateWorkspaceConsent(nextEpoch, "provider_changed");
      sqlite.prepare("UPDATE advisor_provider_settings SET execution_mode = 'legacy_runtime', updated_at = ? WHERE singleton_id = 1").run(Date.now());
      providerEpochGate.open(nextEpoch);
    });
    return this.summary();
  }

  async setEnabled(enabled: boolean): Promise<ReturnType<AdvisorProviderSettingsService["summary"]>> {
    await providerEpochGate.withWrite(async () => {
      const sqlite = appDataConnection();
      sqlite.prepare(`UPDATE advisor_provider_settings SET enabled = ?, provider_state = ?,
        provider_epoch = provider_epoch + 1, revocation_epoch = revocation_epoch + 1, updated_at = ? WHERE singleton_id = 1`)
        .run(enabled ? 1 : 0, enabled ? "probing" : "paused", Date.now());
      const epoch = settingsRow().provider_epoch;
      providerCredentialPort.revokeAll();
      await cancelActiveAdvisorRuns();
      this.invalidateWorkspaceConsent(epoch, enabled ? "provider_reenabled" : "provider_disabled");
      providerEpochGate.open(epoch);
    });
    return this.summary();
  }

  consentAgent(spaceId: string, agentId: string, humanId: string, scope: { public: boolean; private: boolean; dm: boolean }) {
    const current = this.summary();
    if (current.settings.executionMode !== "provider_v1" || current.settings.state !== "ready" || !current.provider || !current.modelProfile) throw new AdvisorProviderError("provider_consent_required");
    const profile = current.modelProfile.profile;
    const egressDigest = digest({ backendId: profile.backendId, modelId: profile.modelId, origin: profile.canonicalOrigin,
      region: profile.region ?? null, account: profile.credentialIdentityDigest, policy: profile.dataPolicyRevision, allowedEgress: profile.allowedEgress });
    const db = dbForSpace(spaceId);
    db.insert(schema.memoryAdvisorSettings).values({ agentId }).onConflictDoNothing().run();
    const previous = db.select().from(schema.memoryAdvisorSettings).where(eq(schema.memoryAdvisorSettings.agentId, agentId)).get()!;
    db.update(schema.memoryAdvisorSettings).set({
      approvedProviderRevision: current.provider.revision,
      approvedModelProfileRevision: current.modelProfile.revision,
      approvedProviderEpoch: current.settings.providerEpoch,
      approvedEgressDigest: egressDigest,
      consentEpoch: previous.consentEpoch + 1,
      consentPurpose: "memory_advisor_v1",
      consentSourceScope: scope,
      consentAt: new Date(),
      consentActorId: humanId,
      installationIdentityDigest: current.settings.installationIdentityDigest,
      providerEpochMirror: current.settings.providerEpoch,
      updatedAt: new Date(),
    }).where(eq(schema.memoryAdvisorSettings.agentId, agentId)).run();
    return db.select().from(schema.memoryAdvisorSettings).where(eq(schema.memoryAdvisorSettings.agentId, agentId)).get()!;
  }

  async revokeAgent(spaceId: string, agentId: string): Promise<void> {
    await providerEpochGate.withWrite(async () => {
      const epoch = settingsRow().provider_epoch;
      await cancelActiveAdvisorRuns({ spaceId, agentId });
      const db = dbForSpace(spaceId);
      const row = db.select().from(schema.memoryAdvisorSettings).where(eq(schema.memoryAdvisorSettings.agentId, agentId)).get();
      if (!row) { providerEpochGate.open(epoch); return; }
      db.transaction((tx) => {
      tx.update(schema.memoryAdvisorSettings).set({
        approvedProviderRevision: null, approvedModelProfileRevision: null, approvedProviderEpoch: null,
        approvedEgressDigest: null, consentEpoch: row.consentEpoch + 1, consentPurpose: null,
        consentSourceScope: null, consentAt: null, consentActorId: null, updatedAt: new Date(),
      }).where(eq(schema.memoryAdvisorSettings.agentId, agentId)).run();
      tx.update(schema.memoryAdvisorJobs).set({ status: "cancelled", errorCode: "provider_cancelled", completedAt: new Date() })
        .where(and(eq(schema.memoryAdvisorJobs.agentId, agentId), inArray(schema.memoryAdvisorJobs.status, ["queued", "running", "failed"]))).run();
      tx.update(schema.advisorProviderRuns).set({ status: "cancelled", errorCode: "provider_cancelled", completedAt: new Date() })
        .where(and(eq(schema.advisorProviderRuns.agentId, agentId), inArray(schema.advisorProviderRuns.status, ["leased", "running", "failed"]))).run();
      });
      providerEpochGate.open(epoch);
    });
  }

  async revokeSpace(spaceId: string): Promise<void> {
    await providerEpochGate.withWrite(async () => {
      const epoch = settingsRow().provider_epoch;
      await cancelActiveAdvisorRuns({ spaceId });
      let db;
      try { db = dbForSpace(spaceId); }
      catch {
        // A detached/corrupt Space cannot have durable work safely inspected. Active in-memory work is
        // already stopped above; keep registry removal available without creating or mutating its folder.
        providerEpochGate.open(epoch);
        return;
      }
      db.transaction((tx) => {
        const rows = tx.select().from(schema.memoryAdvisorSettings).all();
        for (const row of rows) tx.update(schema.memoryAdvisorSettings).set({
          approvedProviderRevision: null, approvedModelProfileRevision: null, approvedProviderEpoch: null,
          approvedEgressDigest: null, consentEpoch: row.consentEpoch + 1, consentPurpose: null,
          consentSourceScope: null, consentAt: null, consentActorId: null, updatedAt: new Date(),
        }).where(eq(schema.memoryAdvisorSettings.agentId, row.agentId)).run();
        tx.update(schema.memoryAdvisorJobs).set({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null,
          errorCode: "provider_cancelled", completedAt: new Date() })
          .where(inArray(schema.memoryAdvisorJobs.status, ["queued", "running", "failed"])).run();
        tx.update(schema.advisorProviderRuns).set({ status: "cancelled", errorCode: "provider_cancelled", completedAt: new Date() })
          .where(inArray(schema.advisorProviderRuns.status, ["leased", "running", "failed"])).run();
      });
      providerEpochGate.open(epoch);
    });
  }

  currentExecution(): {
    snapshot: ProviderExecutionSnapshot; profile: AdvisorModelProfile; credentialRef: string | null; egressDigest: string;
  } {
    const current = this.summary();
    if (current.settings.executionMode !== "provider_v1" || !current.settings.enabled || !current.provider || !current.modelProfile) throw new AdvisorProviderError("provider_model_setup_required");
    const row = modelRow(current.modelProfile.revision)!;
    const profile = current.modelProfile.profile;
    const egressDigest = digest({ backendId: profile.backendId, modelId: profile.modelId, origin: profile.canonicalOrigin,
      region: profile.region ?? null, account: profile.credentialIdentityDigest, policy: profile.dataPolicyRevision, allowedEgress: profile.allowedEgress });
    const snapshotBase = {
      installationIdDigest: current.settings.installationIdentityDigest,
      providerRevision: current.provider.revision,
      modelProfileRevision: current.modelProfile.revision,
      providerEpoch: current.settings.providerEpoch,
      adapterId: current.provider.adapterId,
      adapterVersion: current.provider.adapterVersion,
      executableOrPackageDigest: current.provider.executableOrPackageDigest,
      ...(current.provider.sdkLockDigest ? { sdkLockDigest: current.provider.sdkLockDigest } : {}),
      backendId: profile.backendId, modelId: profile.modelId, modelSource: profile.sourceKind,
      modelSourceDigest: profile.sourceSnapshotDigest, descriptorTrust: profile.descriptorTrust, apiKind: profile.apiKind,
      thinkingLevel: profile.thinkingLevel, canonicalOrigin: profile.canonicalOrigin,
      ...(profile.region ? { region: profile.region } : {}),
      ...(profile.tenantOrProjectDigest ? { tenantOrProjectDigest: profile.tenantOrProjectDigest } : {}),
      credentialIdentityDigest: profile.credentialIdentityDigest, dataPolicyRevision: profile.dataPolicyRevision,
      dataPolicyProvenance: profile.dataPolicyProvenance, networkClass: profile.networkClass,
      providerSchemaVersion: profile.providerSchemaVersion, allowedEgress: profile.allowedEgress,
      sanitizedConfig: { credentialSourceKind: profile.credentialSourceKind },
      configDigest: digest({ provider: current.provider.revision, model: current.modelProfile.revision, profile }),
      capabilityDigest: current.provider.capabilityDigest,
    };
    const snapshot: ProviderExecutionSnapshot = { ...snapshotBase, executionSnapshotDigest: digest(snapshotBase) };
    return { snapshot, profile, credentialRef: row.credential_ref, egressDigest };
  }

  resolveForAgent(spaceId: string, agentId: string): {
    snapshot: ProviderExecutionSnapshot; profile: AdvisorModelProfile; credentialRef: string | null; egressDigest: string;
  } {
    const current = this.summary();
    if (current.settings.executionMode !== "provider_v1" || current.settings.state !== "ready" || !current.provider || !current.modelProfile) throw new AdvisorProviderError("provider_model_setup_required");
    const consent = dbForSpace(spaceId).select().from(schema.memoryAdvisorSettings).where(eq(schema.memoryAdvisorSettings.agentId, agentId)).get();
    const row = modelRow(current.modelProfile.revision)!;
    const profile = current.modelProfile.profile;
    const egressDigest = digest({ backendId: profile.backendId, modelId: profile.modelId, origin: profile.canonicalOrigin,
      region: profile.region ?? null, account: profile.credentialIdentityDigest, policy: profile.dataPolicyRevision, allowedEgress: profile.allowedEgress });
    if (!consent || consent.approvedProviderRevision !== current.provider.revision
      || consent.approvedModelProfileRevision !== current.modelProfile.revision
      || consent.approvedProviderEpoch !== current.settings.providerEpoch
      || consent.approvedEgressDigest !== egressDigest
      || consent.installationIdentityDigest !== current.settings.installationIdentityDigest
      || consent.providerEpochMirror !== current.settings.providerEpoch
      || consent.consentPurpose !== "memory_advisor_v1") throw new AdvisorProviderError("provider_consent_required");
    const snapshotBase = {
      installationIdDigest: current.settings.installationIdentityDigest,
      providerRevision: current.provider.revision,
      modelProfileRevision: current.modelProfile.revision,
      providerEpoch: current.settings.providerEpoch,
      adapterId: current.provider.adapterId,
      adapterVersion: current.provider.adapterVersion,
      executableOrPackageDigest: current.provider.executableOrPackageDigest,
      ...(current.provider.sdkLockDigest ? { sdkLockDigest: current.provider.sdkLockDigest } : {}),
      backendId: profile.backendId, modelId: profile.modelId, modelSource: profile.sourceKind,
      modelSourceDigest: profile.sourceSnapshotDigest, descriptorTrust: profile.descriptorTrust, apiKind: profile.apiKind,
      thinkingLevel: profile.thinkingLevel, canonicalOrigin: profile.canonicalOrigin,
      ...(profile.region ? { region: profile.region } : {}),
      ...(profile.tenantOrProjectDigest ? { tenantOrProjectDigest: profile.tenantOrProjectDigest } : {}),
      credentialIdentityDigest: profile.credentialIdentityDigest, dataPolicyRevision: profile.dataPolicyRevision,
      dataPolicyProvenance: profile.dataPolicyProvenance, networkClass: profile.networkClass,
      providerSchemaVersion: profile.providerSchemaVersion, allowedEgress: profile.allowedEgress,
      sanitizedConfig: { credentialSourceKind: profile.credentialSourceKind },
      configDigest: digest({ provider: current.provider.revision, model: current.modelProfile.revision, profile }),
      capabilityDigest: current.provider.capabilityDigest,
    };
    const snapshot: ProviderExecutionSnapshot = { ...snapshotBase, executionSnapshotDigest: digest(snapshotBase) };
    return { snapshot, profile, credentialRef: row.credential_ref, egressDigest };
  }

  recover(): void {
    this.reconcileBundledPiArtifact();
    const current = settingsRow();
    if (current.execution_mode === "migrating") {
      this.invalidateWorkspaceConsent(current.provider_epoch, "provider_changed");
      appDataConnection().prepare("UPDATE advisor_provider_settings SET execution_mode = ?, updated_at = ? WHERE singleton_id = 1")
        .run(current.current_provider_revision == null ? "legacy_runtime" : "provider_v1", Date.now());
    }
    for (const { db } of availableSpaceDbs()) db.transaction((tx) => {
      const stale = tx.select({ id: schema.advisorProviderRuns.id }).from(schema.advisorProviderRuns)
        .where(inArray(schema.advisorProviderRuns.status, ["leased", "running"])).all();
      if (!stale.length) return;
      const ids = stale.map((run) => run.id);
      tx.update(schema.advisorProviderRuns).set({ status: "blocked", errorCode: "provider_outcome_unknown", completedAt: new Date() })
        .where(inArray(schema.advisorProviderRuns.id, ids)).run();
      tx.update(schema.memoryAdvisorJobs).set({ status: "blocked", leaseOwner: null, leaseExpiresAt: null,
        errorCode: "provider_outcome_unknown", errorDetailRedacted: "provider outcome was uncertain after restart; automatic replay is disabled", completedAt: new Date() })
        .where(and(inArray(schema.memoryAdvisorJobs.providerRunId, ids), eq(schema.memoryAdvisorJobs.status, "running"))).run();
    });
    const recovered = settingsRow();
    providerEpochGate.open(recovered.provider_epoch);
  }

  private invalidateWorkspaceConsent(providerEpoch: number, errorCode: string): void {
    for (const { db } of availableSpaceDbs()) db.transaction((tx) => {
      const rows = tx.select().from(schema.memoryAdvisorSettings).all();
      for (const row of rows) tx.update(schema.memoryAdvisorSettings).set({
        approvedProviderRevision: null, approvedModelProfileRevision: null, approvedProviderEpoch: null,
        approvedEgressDigest: null, consentEpoch: row.consentEpoch + 1, consentPurpose: null,
        consentSourceScope: null, consentAt: null, consentActorId: null, providerEpochMirror: providerEpoch, updatedAt: new Date(),
      }).where(eq(schema.memoryAdvisorSettings.agentId, row.agentId)).run();
      tx.update(schema.memoryAdvisorJobs).set({ status: "cancelled", errorCode, completedAt: new Date() })
        .where(inArray(schema.memoryAdvisorJobs.status, ["queued", "running", "failed"])).run();
      tx.update(schema.advisorProviderRuns).set({ status: "cancelled", errorCode, completedAt: new Date() })
        .where(inArray(schema.advisorProviderRuns.status, ["leased", "running", "failed"])).run();
    });
  }

  private reconcileBundledPiArtifact(): void {
    const current = settingsRow();
    if (current.execution_mode !== "provider_v1") return;
    const selected = providerRow(current.current_provider_revision);
    if (!selected || selected.adapter_id !== "pi_sdk") return;
    const artifactPath = resolvePiAdvisorHelper();
    if (!existsSync(artifactPath)) return;
    const artifactDigest = sha256File(artifactPath);
    if (selected.executable_or_package_realpath === artifactPath && selected.executable_or_package_digest === artifactDigest) return;
    const descriptor = advisorProviderDescriptor("pi_sdk");
    const sqlite = appDataConnection();
    let nextEpoch = current.provider_epoch;
    sqlite.transaction(() => {
      const latest = providerRow(settingsRow().current_provider_revision);
      if (latest?.adapter_id === "pi_sdk" && latest.executable_or_package_realpath === artifactPath
        && latest.executable_or_package_digest === artifactDigest) return;
      const revision = Number(sqlite.prepare("SELECT coalesce(max(revision), 0) + 1 FROM advisor_provider_revisions").pluck().get());
      const config = { environment: "allowlist", projectCustomization: "disabled", helper: "pi-advisor-helper.mjs" };
      sqlite.prepare(`INSERT INTO advisor_provider_revisions (
        revision, adapter_id, adapter_version, executable_or_package_realpath, executable_or_package_digest,
        sdk_lock_digest, sanitized_config_json, config_digest, capability_digest, created_at
      ) VALUES (?, 'pi_sdk', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(revision, descriptor.adapterVersion, artifactPath, artifactDigest, digest(PI_AI_PACKAGE_INTEGRITY),
          canonicalJson(config), digest(config), digest(descriptor.capabilities), Date.now());
      sqlite.prepare(`UPDATE advisor_provider_settings SET current_provider_revision = ?, provider_state = 'setup_required',
        provider_epoch = provider_epoch + 1, revocation_epoch = revocation_epoch + 1, updated_at = ? WHERE singleton_id = 1`)
        .run(revision, Date.now());
      nextEpoch = settingsRow().provider_epoch;
    }).immediate();
    if (nextEpoch !== current.provider_epoch) {
      providerCredentialPort.revokeAll();
      this.invalidateWorkspaceConsent(nextEpoch, "provider_changed");
    }
  }
}
