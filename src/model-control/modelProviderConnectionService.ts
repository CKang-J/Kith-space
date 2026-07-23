import { randomUUID } from "node:crypto";
import { appDataConnection } from "../app-data/appDatabase.js";
import { providerCredentialPort } from "../advisor-provider/credentialPort.js";
import type { AdvisorCredentialSourceKind } from "../advisor-provider/contracts.js";
import { canonicalAdvisorOrigin } from "../advisor-provider/advisorModelCompiler.js";
import { ModelControlError, type ModelProviderConnectionRevision } from "./contracts.js";
import { withRuntimeConfigurationChange } from "./runtimeConfigurationChange.js";

export interface SaveModelProviderConnectionInput {
  displayName: string;
  backendId: string;
  apiKind: ModelProviderConnectionRevision["apiKind"];
  canonicalOrigin: string;
  networkClass: ModelProviderConnectionRevision["networkClass"];
  credentialSourceKind: AdvisorCredentialSourceKind;
  credentialValue?: string;
  credentialRef?: string | null;
  credentialIdentityDigest?: string;
  dataPolicyRevision: string;
  dataPolicyProvenance: ModelProviderConnectionRevision["dataPolicyProvenance"];
  allowedEgress: readonly string[];
  capabilitySnapshot?: Readonly<Record<string, unknown>>;
  sourceKind?: ModelProviderConnectionRevision["sourceKind"];
  sourceSnapshotDigest?: string;
}

type ConnectionRow = {
  id: string; display_name: string; status: "active" | "disabled"; current_revision: number;
  created_at: number; updated_at: number;
};
type RevisionRow = {
  connection_id: string; revision: number; backend_id: string; api_kind: ModelProviderConnectionRevision["apiKind"];
  canonical_origin: string; network_class: ModelProviderConnectionRevision["networkClass"];
  credential_source_kind: AdvisorCredentialSourceKind; credential_ref: string | null;
  credential_identity_digest: string; data_policy_revision: string;
  data_policy_provenance: ModelProviderConnectionRevision["dataPolicyProvenance"];
  allowed_egress_json: string; capability_snapshot_json: string;
  source_kind: ModelProviderConnectionRevision["sourceKind"]; source_snapshot_digest: string; created_at: number;
};

function normalizeOrigin(
  value: string,
  networkClass: ModelProviderConnectionRevision["networkClass"],
): string {
  try {
    return canonicalAdvisorOrigin(value, networkClass);
  } catch {
    throw new ModelControlError("model_provider_not_found", "invalid provider origin or network class");
  }
}

function map(row: ConnectionRow, revision: RevisionRow) {
  return {
    connection: {
      id: row.id, displayName: row.display_name, status: row.status, currentRevision: row.current_revision,
      createdAt: row.created_at, updatedAt: row.updated_at,
    },
    revision: {
      connectionId: revision.connection_id, revision: revision.revision, backendId: revision.backend_id,
      apiKind: revision.api_kind, canonicalOrigin: revision.canonical_origin, networkClass: revision.network_class,
      credentialSourceKind: revision.credential_source_kind, credentialRef: revision.credential_ref,
      credentialIdentityDigest: revision.credential_identity_digest, dataPolicyRevision: revision.data_policy_revision,
      dataPolicyProvenance: revision.data_policy_provenance, allowedEgress: JSON.parse(revision.allowed_egress_json),
      capabilitySnapshot: JSON.parse(revision.capability_snapshot_json), sourceKind: revision.source_kind,
      sourceSnapshotDigest: revision.source_snapshot_digest, createdAt: revision.created_at,
    } satisfies ModelProviderConnectionRevision,
  };
}

export class ModelProviderConnectionService {
  list() {
    const sqlite = appDataConnection();
    return (sqlite.prepare("SELECT * FROM model_provider_connections ORDER BY display_name, id").all() as ConnectionRow[])
      .map((row) => this.get(row.id));
  }

  get(id: string) {
    const sqlite = appDataConnection();
    const row = sqlite.prepare("SELECT * FROM model_provider_connections WHERE id = ?").get(id) as ConnectionRow | undefined;
    if (!row) throw new ModelControlError("model_provider_not_found");
    return this.getRevision(id, row.current_revision);
  }

  getRevision(id: string, revisionNumber: number) {
    const sqlite = appDataConnection();
    const row = sqlite.prepare("SELECT * FROM model_provider_connections WHERE id = ?").get(id) as ConnectionRow | undefined;
    if (!row) throw new ModelControlError("model_provider_not_found");
    const revision = sqlite.prepare(`
      SELECT * FROM model_provider_connection_revisions WHERE connection_id = ? AND revision = ?
    `).get(id, revisionNumber) as RevisionRow | undefined;
    if (!revision) throw new ModelControlError("model_provider_not_found");
    return map(row, revision);
  }

  async create(input: SaveModelProviderConnectionInput) {
    return withRuntimeConfigurationChange(() => this.save(randomUUID(), input, true));
  }

  async update(id: string, input: SaveModelProviderConnectionInput) {
    this.get(id);
    return withRuntimeConfigurationChange(() => this.save(id, input, false));
  }

  setStatus(id: string, status: "active" | "disabled") {
    const sqlite = appDataConnection();
    const current = this.get(id);
    if (status === "disabled") {
      const inUse = Number(sqlite.prepare(`
        SELECT count(*) FROM model_configurations c
        JOIN model_configuration_revisions r
          ON r.configuration_id = c.id AND r.revision = c.current_revision
        WHERE c.status = 'active' AND r.provider_connection_id = ?
      `).pluck().get(id));
      if (inUse > 0) throw new ModelControlError("model_configuration_in_use");
    }
    sqlite.prepare("UPDATE model_provider_connections SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, Date.now(), id);
    return { ...current, connection: { ...current.connection, status, updatedAt: Date.now() } };
  }

  private save(id: string, input: SaveModelProviderConnectionInput, create: boolean) {
    const displayName = input.displayName.trim();
    if (!displayName || !input.backendId.trim() || input.allowedEgress.length === 0) {
      throw new ModelControlError("model_provider_not_found", "provider fields are required");
    }
    const canonicalOrigin = normalizeOrigin(input.canonicalOrigin, input.networkClass);
    const allowedEgress = [...new Set(input.allowedEgress.map((origin) => normalizeOrigin(origin, input.networkClass)))];
    if (!allowedEgress.includes(canonicalOrigin)) throw new ModelControlError("model_provider_not_found", "origin must be allowed egress");
    let credentialRef = input.credentialRef ?? null;
    let credentialIdentityDigest = input.credentialIdentityDigest ?? "";
    if (input.credentialSourceKind === "kith_secret") {
      if (input.credentialValue) {
        const stored = providerCredentialPort.storeKithSecret(input.backendId, input.credentialValue);
        credentialRef = stored.credentialRef;
        credentialIdentityDigest = stored.credentialIdentityDigest;
      } else if (!credentialRef || !credentialIdentityDigest) {
        throw new ModelControlError("desktop_trust_required", "credential is required");
      }
    } else if (input.credentialSourceKind === "keyless_local") {
      credentialRef = null;
      credentialIdentityDigest = providerCredentialPort.keylessIdentity();
    } else if (!credentialRef || !credentialIdentityDigest) {
      throw new ModelControlError("desktop_trust_required", "credential reference is required");
    }
    const sqlite = appDataConnection();
    const result = sqlite.transaction(() => {
      const now = Date.now();
      const previous = create ? undefined : sqlite.prepare(
        "SELECT current_revision FROM model_provider_connections WHERE id = ?",
      ).get(id) as { current_revision: number } | undefined;
      const revision = (previous?.current_revision ?? 0) + 1;
      if (create) sqlite.prepare(`
        INSERT INTO model_provider_connections (id, display_name, status, current_revision, created_at, updated_at)
        VALUES (?, ?, 'active', ?, ?, ?)
      `).run(id, displayName, revision, now, now);
      sqlite.prepare(`
        INSERT INTO model_provider_connection_revisions (
          connection_id, revision, backend_id, api_kind, canonical_origin, network_class,
          credential_source_kind, credential_ref, credential_identity_digest, data_policy_revision,
          data_policy_provenance, allowed_egress_json, capability_snapshot_json, source_kind,
          source_snapshot_digest, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, revision, input.backendId.trim(), input.apiKind, canonicalOrigin, input.networkClass,
        input.credentialSourceKind, credentialRef, credentialIdentityDigest, input.dataPolicyRevision,
        input.dataPolicyProvenance, JSON.stringify(allowedEgress), JSON.stringify(input.capabilitySnapshot ?? {}),
        input.sourceKind ?? "manual", input.sourceSnapshotDigest ?? `manual:${id}:${revision}`, now);
      if (!create) sqlite.prepare(`
        UPDATE model_provider_connections SET display_name = ?, current_revision = ?, updated_at = ? WHERE id = ?
      `).run(displayName, revision, now, id);
      sqlite.prepare(`
        UPDATE installation_state SET runtime_configuration_epoch = runtime_configuration_epoch + 1
        WHERE singleton_key = 1
      `).run();
      return this.get(id);
    }).immediate();
    return result;
  }
}
