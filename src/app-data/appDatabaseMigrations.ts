import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

export const APP_DATABASE_SCHEMA_VERSION = 10;

export type AppDatabaseCompatibilityReason = "integrity" | "future" | "schema";

export class AppDatabaseMigrationError extends Error {
  constructor(
    public readonly reason: AppDatabaseCompatibilityReason,
    message: string,
  ) {
    super(message);
    this.name = "AppDatabaseMigrationError";
  }
}

const APP_BASELINE_SQL = `
  CREATE TABLE IF NOT EXISTS human_profile (
    singleton_key INTEGER PRIMARY KEY NOT NULL CHECK (singleton_key = 1),
    id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    root_path TEXT NOT NULL UNIQUE,
    last_opened_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS installation_state (
    singleton_key INTEGER PRIMARY KEY NOT NULL CHECK (singleton_key = 1),
    home_space_id TEXT REFERENCES spaces(id) ON DELETE RESTRICT
  );
  CREATE TABLE IF NOT EXISTS browser_access_settings (
    singleton_key INTEGER PRIMARY KEY NOT NULL CHECK (singleton_key = 1),
    mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'local', 'lan')),
    port INTEGER NOT NULL DEFAULT 7777 CHECK (port BETWEEN 1 AND 65535),
    access_token_hash TEXT,
    token_revision INTEGER NOT NULL DEFAULT 0 CHECK (token_revision >= 0)
  );
  CREATE TABLE IF NOT EXISTS browser_sessions (
    token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64),
    token_revision INTEGER NOT NULL CHECK (token_revision > 0),
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS desktop_settings (
    singleton_key INTEGER PRIMARY KEY NOT NULL CHECK (singleton_key = 1),
    close_behavior TEXT NOT NULL DEFAULT 'tray' CHECK (close_behavior IN ('tray', 'quit')),
    launch_at_login INTEGER NOT NULL DEFAULT 0 CHECK (launch_at_login IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS app_migration_journal (
    version INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS browser_sessions_revision_idx
    ON browser_sessions (token_revision);
  INSERT OR IGNORE INTO browser_access_settings (
    singleton_key, mode, port, access_token_hash, token_revision
  ) VALUES (1, 'off', 7777, NULL, 0);
  INSERT OR IGNORE INTO desktop_settings (
    singleton_key, close_behavior, launch_at_login
  ) VALUES (1, 'tray', 0);
  INSERT OR IGNORE INTO installation_state (
    singleton_key, home_space_id
  ) VALUES (1, NULL);
  UPDATE installation_state
  SET home_space_id = (SELECT id FROM spaces WHERE slug = 'home')
  WHERE singleton_key = 1
    AND home_space_id IS NULL
    AND EXISTS (SELECT 1 FROM spaces WHERE slug = 'home');
`;

const APP_SCHEMA_V1 = new Map<string, string[]>([
  ["human_profile", ["singleton_key", "id", "name", "email", "description", "created_at", "updated_at"]],
  ["spaces", ["id", "name", "slug", "root_path", "last_opened_at"]],
  ["installation_state", ["singleton_key", "home_space_id"]],
  ["browser_access_settings", ["singleton_key", "mode", "port", "access_token_hash", "token_revision"]],
  ["browser_sessions", ["token_hash", "token_revision", "created_at", "last_seen_at"]],
  ["desktop_settings", ["singleton_key", "close_behavior", "launch_at_login"]],
  ["app_migration_journal", ["version", "name", "checksum", "applied_at"]],
]);

const APP_V2_CONTENT_HMAC_SQL = `
  ALTER TABLE installation_state ADD COLUMN content_hmac_key TEXT;
  UPDATE installation_state
  SET content_hmac_key = lower(hex(randomblob(32)))
  WHERE singleton_key = 1 AND content_hmac_key IS NULL;
`;

const APP_SCHEMA_V2 = new Map(APP_SCHEMA_V1);
APP_SCHEMA_V2.set("installation_state", ["singleton_key", "home_space_id", "content_hmac_key"]);

const APP_V3_USER_GLOBAL_MEMORY_SQL = `
  CREATE TABLE user_episodic_memories (
    id TEXT PRIMARY KEY NOT NULL,
    scope TEXT NOT NULL DEFAULT 'user_global' CHECK (scope = 'user_global'),
    kind TEXT NOT NULL,
    subject_ref_json TEXT NOT NULL,
    subject_key TEXT NOT NULL,
    predicate_key TEXT NOT NULL,
    current_revision INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL,
    confidence_millis INTEGER NOT NULL,
    importance_millis INTEGER NOT NULL,
    sensitivity TEXT NOT NULL,
    disclosure TEXT NOT NULL,
    valid_from INTEGER,
    valid_to INTEGER,
    source_access TEXT NOT NULL DEFAULT 'available',
    deletion_state TEXT NOT NULL DEFAULT 'none',
    row_version INTEGER NOT NULL DEFAULT 1,
    created_by_json TEXT NOT NULL,
    updated_by_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (id, current_revision) REFERENCES user_episodic_memory_revisions(memory_id, revision) DEFERRABLE INITIALLY DEFERRED
  );
  CREATE INDEX user_episodic_memories_claim_idx
    ON user_episodic_memories (subject_key, predicate_key);
  CREATE INDEX user_episodic_memories_recall_idx
    ON user_episodic_memories (status, source_access, updated_at);
  CREATE TABLE user_episodic_memory_revisions (
    memory_id TEXT NOT NULL REFERENCES user_episodic_memories(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    canonical_text TEXT NOT NULL,
    internal_summary TEXT,
    shareable_summary TEXT,
    content_hmac TEXT NOT NULL,
    sensitivity TEXT NOT NULL,
    disclosure TEXT NOT NULL,
    valid_from INTEGER,
    valid_to INTEGER,
    created_by_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (memory_id, revision)
  );
  CREATE TABLE user_memory_evidence (
    id TEXT PRIMARY KEY NOT NULL,
    memory_id TEXT NOT NULL REFERENCES user_episodic_memories(id) ON DELETE CASCADE,
    memory_revision INTEGER NOT NULL,
    source_space_id TEXT,
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_surface_id TEXT,
    visibility_at_occurrence TEXT NOT NULL,
    asserted_by_json TEXT NOT NULL,
    quoted_from_json TEXT,
    claim_type TEXT NOT NULL,
    memory_policy TEXT NOT NULL,
    excerpt_hmac TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    FOREIGN KEY (memory_id, memory_revision) REFERENCES user_episodic_memory_revisions(memory_id, revision) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
  );
  CREATE INDEX user_memory_evidence_memory_idx
    ON user_memory_evidence (memory_id, memory_revision);
  CREATE UNIQUE INDEX user_memory_evidence_source_uniq
    ON user_memory_evidence (memory_id, memory_revision, source_kind, source_id);
  CREATE TABLE user_memory_relations (
    id TEXT PRIMARY KEY NOT NULL,
    from_memory_id TEXT NOT NULL REFERENCES user_episodic_memories(id) ON DELETE CASCADE,
    from_revision INTEGER,
    to_memory_id TEXT NOT NULL REFERENCES user_episodic_memories(id) ON DELETE CASCADE,
    to_revision INTEGER,
    relation_type TEXT NOT NULL,
    created_by_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (from_memory_id, from_revision) REFERENCES user_episodic_memory_revisions(memory_id, revision) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (to_memory_id, to_revision) REFERENCES user_episodic_memory_revisions(memory_id, revision) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
  );
  CREATE UNIQUE INDEX user_memory_relations_uniq
    ON user_memory_relations (from_memory_id, from_revision, to_memory_id, to_revision, relation_type);
  CREATE TABLE user_memory_tags (
    memory_id TEXT NOT NULL REFERENCES user_episodic_memories(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (memory_id, tag)
  );
  CREATE INDEX user_memory_tags_tag_idx ON user_memory_tags (tag, memory_id);
  CREATE TABLE user_memory_suppressions (
    id TEXT PRIMARY KEY NOT NULL,
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    claim_hmac TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_by_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  );
  CREATE UNIQUE INDEX user_memory_suppressions_uniq
    ON user_memory_suppressions (source_kind, source_id, claim_hmac);
  CREATE TABLE user_memory_mutations (
    id TEXT PRIMARY KEY NOT NULL,
    memory_id TEXT,
    action TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result_ref_json TEXT,
    actor_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX user_memory_mutations_key_uniq
    ON user_memory_mutations (actor_json, idempotency_key);
  CREATE TABLE user_memory_lexical_terms (
    memory_id TEXT NOT NULL REFERENCES user_episodic_memories(id) ON DELETE CASCADE,
    term TEXT NOT NULL,
    PRIMARY KEY (memory_id, term)
  );
  CREATE INDEX user_memory_lexical_terms_term_idx
    ON user_memory_lexical_terms (term, memory_id);
  CREATE VIRTUAL TABLE user_memory_fts USING fts5(
    memory_id UNINDEXED,
    lexical_text,
    cjk_bigrams,
    cjk_trigrams,
    tokenize='unicode61 remove_diacritics 2'
  );
`;

const APP_SCHEMA_V3 = new Map(APP_SCHEMA_V2);
APP_SCHEMA_V3.set("user_episodic_memories", [
  "id", "scope", "kind", "subject_ref_json", "subject_key", "predicate_key", "current_revision", "status",
  "confidence_millis", "importance_millis", "sensitivity", "disclosure", "valid_from", "valid_to",
  "source_access", "deletion_state", "row_version", "created_by_json", "updated_by_json", "created_at", "updated_at",
]);
APP_SCHEMA_V3.set("user_episodic_memory_revisions", ["memory_id", "revision", "canonical_text", "internal_summary", "shareable_summary", "content_hmac", "sensitivity", "disclosure", "valid_from", "valid_to", "created_by_json", "created_at"]);
APP_SCHEMA_V3.set("user_memory_evidence", ["id", "memory_id", "memory_revision", "source_space_id", "source_kind", "source_id", "source_surface_id", "visibility_at_occurrence", "asserted_by_json", "quoted_from_json", "claim_type", "memory_policy", "excerpt_hmac", "occurred_at"]);
APP_SCHEMA_V3.set("user_memory_relations", ["id", "from_memory_id", "from_revision", "to_memory_id", "to_revision", "relation_type", "created_by_json", "created_at"]);
APP_SCHEMA_V3.set("user_memory_tags", ["memory_id", "tag"]);
APP_SCHEMA_V3.set("user_memory_suppressions", ["id", "source_kind", "source_id", "claim_hmac", "status", "created_by_json", "created_at", "revoked_at"]);
APP_SCHEMA_V3.set("user_memory_mutations", ["id", "memory_id", "action", "idempotency_key", "request_hash", "result_ref_json", "actor_json", "created_at"]);
APP_SCHEMA_V3.set("user_memory_lexical_terms", ["memory_id", "term"]);
APP_SCHEMA_V3.set("user_memory_fts", ["memory_id", "lexical_text", "cjk_bigrams", "cjk_trigrams"]);

// A pre-release v3 build created the same columns and indexes before the composite revision foreign
// keys were added. Keep that journal fact immutable and repair it with v4 instead of rewriting v3.
const APP_V3_LEGACY_CHECKSUMS = new Set([
  "3188d1283621a7b042594c340ace87b42195cef97b689ffb5c0f78535b9b7eba",
]);

// A pre-release v5 build used the same control-plane tables before the bundled Pi artifact
// metadata was finalized. Keep that exact journal fact readable; current schema validation
// still runs, and the settings service creates a new Provider revision when an active bundled
// artifact digest differs. Never rewrite the recorded checksum in place.
const APP_V5_LEGACY_CHECKSUMS = new Set([
  "935bab99c7fa6ecb6b79e0eabba2ee4e074f12f62551998c9d58daf05c6a2d0b",
]);

// A pre-release v6 build migrated legacy Advisor models before runtime compatibility
// snapshots were populated. The schema is identical; accepting its immutable journal
// lets the Human create or revise a model configuration instead of bricking app.db.
const APP_V6_LEGACY_CHECKSUMS = new Set([
  "7425bd0ddb8903b18ffed0d17f074f26a53561a249616feba1bc179c9676b8cc",
]);

const APP_V4_USER_GLOBAL_MEMORY_FOREIGN_KEYS_SQL = `
  CREATE TABLE user_episodic_memories_v4 (
    id TEXT PRIMARY KEY NOT NULL,
    scope TEXT NOT NULL DEFAULT 'user_global' CHECK (scope = 'user_global'),
    kind TEXT NOT NULL,
    subject_ref_json TEXT NOT NULL,
    subject_key TEXT NOT NULL,
    predicate_key TEXT NOT NULL,
    current_revision INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL,
    confidence_millis INTEGER NOT NULL,
    importance_millis INTEGER NOT NULL,
    sensitivity TEXT NOT NULL,
    disclosure TEXT NOT NULL,
    valid_from INTEGER,
    valid_to INTEGER,
    source_access TEXT NOT NULL DEFAULT 'available',
    deletion_state TEXT NOT NULL DEFAULT 'none',
    row_version INTEGER NOT NULL DEFAULT 1,
    created_by_json TEXT NOT NULL,
    updated_by_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (id, current_revision) REFERENCES user_episodic_memory_revisions_v4(memory_id, revision) DEFERRABLE INITIALLY DEFERRED
  );
  CREATE TABLE user_episodic_memory_revisions_v4 (
    memory_id TEXT NOT NULL REFERENCES user_episodic_memories_v4(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    canonical_text TEXT NOT NULL,
    internal_summary TEXT,
    shareable_summary TEXT,
    content_hmac TEXT NOT NULL,
    sensitivity TEXT NOT NULL,
    disclosure TEXT NOT NULL,
    valid_from INTEGER,
    valid_to INTEGER,
    created_by_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (memory_id, revision)
  );
  CREATE TABLE user_memory_evidence_v4 (
    id TEXT PRIMARY KEY NOT NULL,
    memory_id TEXT NOT NULL REFERENCES user_episodic_memories_v4(id) ON DELETE CASCADE,
    memory_revision INTEGER NOT NULL,
    source_space_id TEXT,
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_surface_id TEXT,
    visibility_at_occurrence TEXT NOT NULL,
    asserted_by_json TEXT NOT NULL,
    quoted_from_json TEXT,
    claim_type TEXT NOT NULL,
    memory_policy TEXT NOT NULL,
    excerpt_hmac TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    FOREIGN KEY (memory_id, memory_revision) REFERENCES user_episodic_memory_revisions_v4(memory_id, revision) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
  );
  CREATE TABLE user_memory_relations_v4 (
    id TEXT PRIMARY KEY NOT NULL,
    from_memory_id TEXT NOT NULL REFERENCES user_episodic_memories_v4(id) ON DELETE CASCADE,
    from_revision INTEGER,
    to_memory_id TEXT NOT NULL REFERENCES user_episodic_memories_v4(id) ON DELETE CASCADE,
    to_revision INTEGER,
    relation_type TEXT NOT NULL,
    created_by_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (from_memory_id, from_revision) REFERENCES user_episodic_memory_revisions_v4(memory_id, revision) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (to_memory_id, to_revision) REFERENCES user_episodic_memory_revisions_v4(memory_id, revision) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
  );

  INSERT INTO user_episodic_memories_v4 SELECT * FROM user_episodic_memories;
  INSERT INTO user_episodic_memory_revisions_v4 SELECT * FROM user_episodic_memory_revisions;
  INSERT INTO user_memory_evidence_v4 SELECT * FROM user_memory_evidence;
  INSERT INTO user_memory_relations_v4 SELECT * FROM user_memory_relations;

  DROP TABLE user_memory_relations;
  DROP TABLE user_memory_evidence;
  DROP TABLE user_episodic_memory_revisions;
  DROP TABLE user_episodic_memories;

  ALTER TABLE user_episodic_memories_v4 RENAME TO user_episodic_memories;
  ALTER TABLE user_episodic_memory_revisions_v4 RENAME TO user_episodic_memory_revisions;
  ALTER TABLE user_memory_evidence_v4 RENAME TO user_memory_evidence;
  ALTER TABLE user_memory_relations_v4 RENAME TO user_memory_relations;

  CREATE INDEX user_episodic_memories_claim_idx
    ON user_episodic_memories (subject_key, predicate_key);
  CREATE INDEX user_episodic_memories_recall_idx
    ON user_episodic_memories (status, source_access, updated_at);
  CREATE INDEX user_memory_evidence_memory_idx
    ON user_memory_evidence (memory_id, memory_revision);
  CREATE UNIQUE INDEX user_memory_evidence_source_uniq
    ON user_memory_evidence (memory_id, memory_revision, source_kind, source_id);
  CREATE UNIQUE INDEX user_memory_relations_uniq
    ON user_memory_relations (from_memory_id, from_revision, to_memory_id, to_revision, relation_type);
`;

const APP_SCHEMA_V4 = new Map(APP_SCHEMA_V3);

const APP_V5_ADVISOR_PROVIDER_CONTROL_PLANE_SQL = `
  CREATE TABLE advisor_provider_settings (
    singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
    installation_identity_digest TEXT NOT NULL CHECK (length(installation_identity_digest) = 64),
    execution_mode TEXT NOT NULL DEFAULT 'legacy_runtime' CHECK (execution_mode IN ('legacy_runtime', 'migrating', 'provider_v1')),
    provider_state TEXT NOT NULL DEFAULT 'setup_required' CHECK (provider_state IN ('setup_required', 'probing', 'ready', 'paused', 'unsupported')),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    current_provider_revision INTEGER REFERENCES advisor_provider_revisions(revision),
    current_model_profile_revision INTEGER REFERENCES advisor_model_profile_revisions(revision),
    provider_epoch INTEGER NOT NULL DEFAULT 1 CHECK (provider_epoch >= 1),
    revocation_epoch INTEGER NOT NULL DEFAULT 1 CHECK (revocation_epoch >= 1),
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE advisor_provider_revisions (
    revision INTEGER PRIMARY KEY NOT NULL,
    adapter_id TEXT NOT NULL CHECK (adapter_id IN ('pi_sdk', 'claude_cli')),
    adapter_version TEXT NOT NULL,
    executable_or_package_realpath TEXT,
    executable_or_package_digest TEXT NOT NULL,
    sdk_lock_digest TEXT,
    sanitized_config_json TEXT NOT NULL,
    config_digest TEXT NOT NULL,
    capability_digest TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE advisor_model_profile_revisions (
    revision INTEGER PRIMARY KEY NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('bundled_catalog', 'pi_cli_import', 'manual')),
    source_snapshot_digest TEXT NOT NULL,
    descriptor_trust TEXT NOT NULL CHECK (descriptor_trust IN ('bundled_verified', 'pi_cli_imported', 'manual')),
    backend_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    api_kind TEXT NOT NULL,
    thinking_level TEXT NOT NULL,
    canonical_origin TEXT NOT NULL,
    region TEXT,
    tenant_or_project_digest TEXT,
    credential_source_kind TEXT NOT NULL CHECK (credential_source_kind IN ('pi_cli_auth', 'kith_secret', 'env_ref', 'keyless_local')),
    credential_identity_digest TEXT NOT NULL,
    credential_ref TEXT,
    provider_schema_version INTEGER NOT NULL,
    data_policy_revision TEXT NOT NULL,
    data_policy_provenance TEXT NOT NULL CHECK (data_policy_provenance IN ('vendor_verified', 'human_asserted', 'unknown')),
    network_class TEXT NOT NULL CHECK (network_class IN ('loopback', 'lan', 'public_cloud', 'custom')),
    allowed_egress_json TEXT NOT NULL,
    model_metadata_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE pi_cli_config_imports (
    id TEXT PRIMARY KEY NOT NULL,
    config_root_digest TEXT NOT NULL,
    catalog_digest TEXT NOT NULL,
    secret_source_identity TEXT NOT NULL,
    imported_catalog_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    file_identities_json TEXT NOT NULL,
    imported_at INTEGER NOT NULL
  );
  CREATE INDEX advisor_provider_revisions_adapter_idx ON advisor_provider_revisions(adapter_id, revision);
  CREATE INDEX advisor_model_profiles_backend_idx ON advisor_model_profile_revisions(backend_id, model_id, revision);
  CREATE INDEX pi_cli_config_imports_catalog_idx ON pi_cli_config_imports(catalog_digest, imported_at);
  INSERT INTO advisor_provider_revisions (
    revision, adapter_id, adapter_version, executable_or_package_realpath, executable_or_package_digest,
    sdk_lock_digest, sanitized_config_json, config_digest, capability_digest, created_at
  ) VALUES (
    1, 'pi_sdk', '0.81.1', NULL,
    '8dc42b635ea20ca4f440fd3541b6ea1ddea7478f1622905666066fbe4936e453',
    '8dc42b635ea20ca4f440fd3541b6ea1ddea7478f1622905666066fbe4936e453',
    '{"helper":"pi-advisor-helper.mjs","environment":"allowlist","projectCustomization":"disabled"}',
    '1286a552d6f0cfae3800e177cfcf533ca65b522edcea062ec136474aad9ed3f3',
    '3c456a7fe7cff69b833dd45ecc29b0032f0b7ac3f646fae8ec4ee2cd55936162',
    unixepoch() * 1000
  );
  INSERT INTO advisor_provider_settings (
    singleton_id, installation_identity_digest, execution_mode, provider_state, enabled,
    current_provider_revision, current_model_profile_revision, provider_epoch, revocation_epoch, updated_at
  ) VALUES (1, lower(hex(randomblob(32))), 'legacy_runtime', 'setup_required', 1, NULL, NULL, 1, 1, unixepoch() * 1000);
`;

const APP_SCHEMA_V5 = new Map(APP_SCHEMA_V4);
APP_SCHEMA_V5.set("advisor_provider_settings", [
  "singleton_id", "installation_identity_digest", "execution_mode", "provider_state", "enabled",
  "current_provider_revision", "current_model_profile_revision", "provider_epoch", "revocation_epoch", "updated_at",
]);
APP_SCHEMA_V5.set("advisor_provider_revisions", [
  "revision", "adapter_id", "adapter_version", "executable_or_package_realpath", "executable_or_package_digest",
  "sdk_lock_digest", "sanitized_config_json", "config_digest", "capability_digest", "created_at",
]);
APP_SCHEMA_V5.set("advisor_model_profile_revisions", [
  "revision", "source_kind", "source_snapshot_digest", "descriptor_trust", "backend_id", "model_id", "api_kind",
  "thinking_level", "canonical_origin", "region", "tenant_or_project_digest", "credential_source_kind",
  "credential_identity_digest", "credential_ref", "provider_schema_version", "data_policy_revision",
  "data_policy_provenance", "network_class", "allowed_egress_json", "model_metadata_json", "created_at",
]);
APP_SCHEMA_V5.set("pi_cli_config_imports", [
  "id", "config_root_digest", "catalog_digest", "secret_source_identity", "imported_catalog_json", "warnings_json",
  "file_identities_json", "imported_at",
]);

const APP_V6_MODEL_RUNTIME_CONTROL_PLANE_SQL = `
  ALTER TABLE installation_state
    ADD COLUMN runtime_configuration_epoch INTEGER NOT NULL DEFAULT 1
      CHECK (runtime_configuration_epoch >= 1);

  CREATE TABLE model_provider_connections (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    current_revision INTEGER NOT NULL CHECK (current_revision >= 1),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (id, current_revision)
      REFERENCES model_provider_connection_revisions(connection_id, revision)
      DEFERRABLE INITIALLY DEFERRED
  );
  CREATE TABLE model_provider_connection_revisions (
    connection_id TEXT NOT NULL REFERENCES model_provider_connections(id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    backend_id TEXT NOT NULL,
    api_kind TEXT NOT NULL,
    canonical_origin TEXT NOT NULL,
    network_class TEXT NOT NULL CHECK (network_class IN ('loopback', 'lan', 'public_cloud', 'custom')),
    credential_source_kind TEXT NOT NULL CHECK (credential_source_kind IN ('pi_cli_auth', 'kith_secret', 'env_ref', 'keyless_local')),
    credential_ref TEXT,
    credential_identity_digest TEXT NOT NULL,
    data_policy_revision TEXT NOT NULL,
    data_policy_provenance TEXT NOT NULL CHECK (data_policy_provenance IN ('vendor_verified', 'human_asserted', 'unknown')),
    allowed_egress_json TEXT NOT NULL,
    capability_snapshot_json TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'pi_import', 'claude_import', 'codex_import', 'opencode_import', 'legacy_advisor')),
    source_snapshot_digest TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (connection_id, revision)
  );
  CREATE INDEX model_provider_connection_revisions_backend_idx
    ON model_provider_connection_revisions (backend_id, api_kind, revision);

  CREATE TABLE model_configurations (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    current_revision INTEGER NOT NULL CHECK (current_revision >= 1),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (id, current_revision)
      REFERENCES model_configuration_revisions(configuration_id, revision)
      DEFERRABLE INITIALLY DEFERRED
  );
  CREATE TABLE model_configuration_revisions (
    configuration_id TEXT NOT NULL REFERENCES model_configurations(id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    provider_connection_id TEXT NOT NULL,
    provider_revision INTEGER NOT NULL,
    model_id TEXT NOT NULL,
    reasoning TEXT,
    context_window INTEGER CHECK (context_window IS NULL OR context_window > 0),
    max_output_tokens INTEGER CHECK (max_output_tokens IS NULL OR max_output_tokens > 0),
    input_capabilities_json TEXT NOT NULL,
    runtime_compatibility_snapshot_json TEXT NOT NULL,
    options_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (configuration_id, revision),
    FOREIGN KEY (provider_connection_id, provider_revision)
      REFERENCES model_provider_connection_revisions(connection_id, revision)
      ON DELETE RESTRICT
  );
  CREATE INDEX model_configuration_revisions_provider_idx
    ON model_configuration_revisions (provider_connection_id, provider_revision, revision);

  CREATE TABLE runtime_profiles (
    runtime_id TEXT PRIMARY KEY NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    default_binding_mode TEXT NOT NULL CHECK (default_binding_mode IN ('kith_model_configuration', 'unmanaged_cli_native', 'unset')),
    default_model_configuration_id TEXT,
    default_model_configuration_revision INTEGER,
    current_revision INTEGER NOT NULL CHECK (current_revision >= 1),
    updated_at INTEGER NOT NULL,
    CHECK (
      (default_binding_mode = 'kith_model_configuration'
        AND default_model_configuration_id IS NOT NULL
        AND default_model_configuration_revision IS NOT NULL)
      OR
      (default_binding_mode IN ('unmanaged_cli_native', 'unset')
        AND default_model_configuration_id IS NULL
        AND default_model_configuration_revision IS NULL)
    ),
    FOREIGN KEY (default_model_configuration_id, default_model_configuration_revision)
      REFERENCES model_configuration_revisions(configuration_id, revision)
      ON DELETE RESTRICT,
    FOREIGN KEY (runtime_id, current_revision)
      REFERENCES runtime_profile_revisions(runtime_id, revision)
      DEFERRABLE INITIALLY DEFERRED
  );
  CREATE TABLE runtime_profile_revisions (
    runtime_id TEXT NOT NULL REFERENCES runtime_profiles(runtime_id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    executable_preference TEXT,
    runtime_options_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (runtime_id, revision)
  );
  CREATE TABLE runtime_probe_cache (
    runtime_id TEXT PRIMARY KEY NOT NULL REFERENCES runtime_profiles(runtime_id) ON DELETE CASCADE,
    executable_digest TEXT NOT NULL,
    compiler_policy_version INTEGER NOT NULL CHECK (compiler_policy_version >= 1),
    observed_version TEXT,
    status TEXT NOT NULL CHECK (status IN ('available', 'not_installed', 'version_too_old', 'capability_unsupported', 'error')),
    capability_digest TEXT,
    diagnostics_json TEXT NOT NULL,
    probed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE cli_config_import_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    runtime_id TEXT NOT NULL,
    source_paths_digest TEXT NOT NULL,
    source_mtime_digest TEXT NOT NULL,
    sanitized_payload_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX cli_config_import_snapshots_runtime_idx
    ON cli_config_import_snapshots (runtime_id, created_at);

  ALTER TABLE advisor_provider_settings ADD COLUMN model_configuration_id TEXT;
  ALTER TABLE advisor_provider_settings ADD COLUMN model_configuration_revision INTEGER;
  ALTER TABLE advisor_model_profile_revisions ADD COLUMN source_model_configuration_id TEXT;
  ALTER TABLE advisor_model_profile_revisions ADD COLUMN source_model_configuration_revision INTEGER;

  INSERT INTO runtime_profiles (
    runtime_id, enabled, default_binding_mode,
    default_model_configuration_id, default_model_configuration_revision,
    current_revision, updated_at
  ) VALUES
    ('claude', 1, 'unset', NULL, NULL, 1, unixepoch() * 1000),
    ('codex', 1, 'unset', NULL, NULL, 1, unixepoch() * 1000),
    ('opencode', 1, 'unset', NULL, NULL, 1, unixepoch() * 1000),
    ('pi', 1, 'unset', NULL, NULL, 1, unixepoch() * 1000);
  INSERT INTO runtime_profile_revisions (
    runtime_id, revision, executable_preference, runtime_options_json, created_at
  ) VALUES
    ('claude', 1, 'claude', '{}', unixepoch() * 1000),
    ('codex', 1, 'codex', '{}', unixepoch() * 1000),
    ('opencode', 1, 'opencode', '{}', unixepoch() * 1000),
    ('pi', 1, 'pi', '{}', unixepoch() * 1000);

  INSERT INTO model_provider_connections (
    id, display_name, status, current_revision, created_at, updated_at
  )
  SELECT 'legacy-advisor-provider', backend_id, 'active', 1, created_at, created_at
  FROM advisor_model_profile_revisions
  WHERE revision = (SELECT current_model_profile_revision FROM advisor_provider_settings WHERE singleton_id = 1);
  INSERT INTO model_provider_connection_revisions (
    connection_id, revision, backend_id, api_kind, canonical_origin, network_class,
    credential_source_kind, credential_ref, credential_identity_digest,
    data_policy_revision, data_policy_provenance, allowed_egress_json,
    capability_snapshot_json, source_kind, source_snapshot_digest, created_at
  )
  SELECT
    'legacy-advisor-provider', 1, backend_id, api_kind, canonical_origin, network_class,
    credential_source_kind, credential_ref, credential_identity_digest,
    data_policy_revision, data_policy_provenance, allowed_egress_json,
    '{}', 'legacy_advisor', source_snapshot_digest, created_at
  FROM advisor_model_profile_revisions
  WHERE revision = (SELECT current_model_profile_revision FROM advisor_provider_settings WHERE singleton_id = 1);

  INSERT INTO model_configurations (
    id, display_name, status, current_revision, created_at, updated_at
  )
  SELECT 'legacy-advisor-model', model_id, 'active', 1, created_at, created_at
  FROM advisor_model_profile_revisions
  WHERE revision = (SELECT current_model_profile_revision FROM advisor_provider_settings WHERE singleton_id = 1);
  INSERT INTO model_configuration_revisions (
    configuration_id, revision, provider_connection_id, provider_revision, model_id,
    reasoning, context_window, max_output_tokens, input_capabilities_json,
    runtime_compatibility_snapshot_json, options_json, created_at
  )
  SELECT
    'legacy-advisor-model', 1, 'legacy-advisor-provider', 1, model_id,
    thinking_level,
    json_extract(model_metadata_json, '$.contextWindow'),
    json_extract(model_metadata_json, '$.maxOutputTokens'),
    coalesce(json_extract(model_metadata_json, '$.inputCapabilities'), '["text"]'),
    CASE api_kind
      WHEN 'anthropic-messages' THEN '{"claude":{"supported":true},"codex":{"supported":false,"reason":"requires_responses_api"},"opencode":{"supported":true},"pi":{"supported":true}}'
      WHEN 'openai-responses' THEN '{"claude":{"supported":false,"reason":"wire_api_not_supported"},"codex":{"supported":true},"opencode":{"supported":true},"pi":{"supported":true}}'
      WHEN 'openai-completions' THEN '{"claude":{"supported":false,"reason":"wire_api_not_supported"},"codex":{"supported":false,"reason":"requires_responses_api"},"opencode":{"supported":true},"pi":{"supported":true}}'
      WHEN 'google-generative-ai' THEN '{"claude":{"supported":false,"reason":"wire_api_not_supported"},"codex":{"supported":false,"reason":"requires_responses_api"},"opencode":{"supported":true},"pi":{"supported":true}}'
      WHEN 'google-vertex' THEN '{"claude":{"supported":true},"codex":{"supported":false,"reason":"requires_responses_api"},"opencode":{"supported":true},"pi":{"supported":true}}'
      WHEN 'bedrock-converse-stream' THEN '{"claude":{"supported":true},"codex":{"supported":false,"reason":"requires_responses_api"},"opencode":{"supported":false,"reason":"wire_api_not_supported"},"pi":{"supported":true}}'
      ELSE '{"claude":{"supported":false,"reason":"wire_api_not_supported"},"codex":{"supported":false,"reason":"requires_responses_api"},"opencode":{"supported":false,"reason":"wire_api_not_supported"},"pi":{"supported":true}}'
    END,
    '{}', created_at
  FROM advisor_model_profile_revisions
  WHERE revision = (SELECT current_model_profile_revision FROM advisor_provider_settings WHERE singleton_id = 1);

  UPDATE advisor_provider_settings
  SET model_configuration_id = 'legacy-advisor-model',
      model_configuration_revision = 1
  WHERE singleton_id = 1 AND current_model_profile_revision IS NOT NULL;
  UPDATE advisor_model_profile_revisions
  SET source_model_configuration_id = 'legacy-advisor-model',
      source_model_configuration_revision = 1
  WHERE revision = (SELECT current_model_profile_revision FROM advisor_provider_settings WHERE singleton_id = 1);
`;

const APP_SCHEMA_V6 = new Map(APP_SCHEMA_V5);
APP_SCHEMA_V6.set("installation_state", [
  "singleton_key", "home_space_id", "content_hmac_key", "runtime_configuration_epoch",
]);
APP_SCHEMA_V6.set("model_provider_connections", [
  "id", "display_name", "status", "current_revision", "created_at", "updated_at",
]);
APP_SCHEMA_V6.set("model_provider_connection_revisions", [
  "connection_id", "revision", "backend_id", "api_kind", "canonical_origin", "network_class",
  "credential_source_kind", "credential_ref", "credential_identity_digest", "data_policy_revision",
  "data_policy_provenance", "allowed_egress_json", "capability_snapshot_json", "source_kind",
  "source_snapshot_digest", "created_at",
]);
APP_SCHEMA_V6.set("model_configurations", [
  "id", "display_name", "status", "current_revision", "created_at", "updated_at",
]);
APP_SCHEMA_V6.set("model_configuration_revisions", [
  "configuration_id", "revision", "provider_connection_id", "provider_revision", "model_id",
  "reasoning", "context_window", "max_output_tokens", "input_capabilities_json",
  "runtime_compatibility_snapshot_json", "options_json", "created_at",
]);
APP_SCHEMA_V6.set("runtime_profiles", [
  "runtime_id", "enabled", "default_binding_mode", "default_model_configuration_id",
  "default_model_configuration_revision", "current_revision", "updated_at",
]);
APP_SCHEMA_V6.set("runtime_profile_revisions", [
  "runtime_id", "revision", "executable_preference", "runtime_options_json", "created_at",
]);
APP_SCHEMA_V6.set("runtime_probe_cache", [
  "runtime_id", "executable_digest", "compiler_policy_version", "observed_version", "status",
  "capability_digest", "diagnostics_json", "probed_at", "expires_at",
]);
APP_SCHEMA_V6.set("cli_config_import_snapshots", [
  "id", "runtime_id", "source_paths_digest", "source_mtime_digest",
  "sanitized_payload_json", "warnings_json", "created_at",
]);
APP_SCHEMA_V6.set("advisor_provider_settings", [
  ...APP_SCHEMA_V5.get("advisor_provider_settings")!,
  "model_configuration_id", "model_configuration_revision",
]);
APP_SCHEMA_V6.set("advisor_model_profile_revisions", [
  ...APP_SCHEMA_V5.get("advisor_model_profile_revisions")!,
  "source_model_configuration_id", "source_model_configuration_revision",
]);

const APP_V7_APPEARANCE_FONT_SETTINGS_SQL = `
  ALTER TABLE installation_state
    ADD COLUMN interface_font TEXT NOT NULL DEFAULT 'sora'
      CHECK (interface_font IN ('sora', 'system_ui', 'inter', 'geist'));
  ALTER TABLE installation_state
    ADD COLUMN content_font TEXT NOT NULL DEFAULT 'follow_interface'
      CHECK (content_font IN ('follow_interface', 'system_ui', 'sora', 'inter', 'geist'));
  ALTER TABLE installation_state
    ADD COLUMN code_font TEXT NOT NULL DEFAULT 'system_monospace'
      CHECK (code_font IN ('system_monospace', 'jetbrains_mono', 'fira_code', 'geist_mono'));
`;

const APP_SCHEMA_V7 = new Map(APP_SCHEMA_V6);
APP_SCHEMA_V7.set("installation_state", [
  ...APP_SCHEMA_V6.get("installation_state")!,
  "interface_font", "content_font", "code_font",
]);

const APP_V8_APPEARANCE_FONT_GROUPS_SQL = `
  CREATE TABLE appearance_settings (
    singleton_key INTEGER PRIMARY KEY NOT NULL CHECK (singleton_key = 1),
    interface_font TEXT NOT NULL DEFAULT 'sora'
      CHECK (interface_font IN (
        'sora', 'system_ui', 'inter', 'geist',
        'system_monospace', 'jetbrains_mono', 'fira_code', 'geist_mono'
      )),
    content_font TEXT NOT NULL DEFAULT 'follow_interface'
      CHECK (content_font IN ('follow_interface', 'system_ui', 'sora', 'inter', 'geist')),
    code_font TEXT NOT NULL DEFAULT 'system_monospace'
      CHECK (code_font IN ('system_monospace', 'jetbrains_mono', 'fira_code', 'geist_mono'))
  );

  INSERT INTO appearance_settings (singleton_key, interface_font, content_font, code_font)
  SELECT singleton_key, interface_font, content_font, code_font
  FROM installation_state
  WHERE singleton_key = 1;
`;

const APP_SCHEMA_V8 = new Map(APP_SCHEMA_V7);
APP_SCHEMA_V8.set("appearance_settings", [
  "singleton_key", "interface_font", "content_font", "code_font",
]);

const APP_V9_APPEARANCE_UI_FONT_SIZE_SQL = `
  ALTER TABLE appearance_settings
  ADD COLUMN ui_font_size INTEGER NOT NULL DEFAULT 14
    CHECK (ui_font_size IN (12, 13, 14, 15, 16));
`;

const APP_SCHEMA_V9 = new Map(APP_SCHEMA_V8);
APP_SCHEMA_V9.set("appearance_settings", [
  ...APP_SCHEMA_V8.get("appearance_settings")!, "ui_font_size",
]);

const APP_V10_APPEARANCE_COLOR_MODE_SQL = `
  ALTER TABLE appearance_settings
  ADD COLUMN color_mode TEXT NOT NULL DEFAULT 'system'
    CHECK (color_mode IN ('light', 'dark', 'system'));
`;

const APP_SCHEMA_V10 = new Map(APP_SCHEMA_V9);
APP_SCHEMA_V10.set("appearance_settings", [
  ...APP_SCHEMA_V9.get("appearance_settings")!, "color_mode",
]);

function baselineChecksum(): string {
  return createHash("sha256").update(APP_BASELINE_SQL).digest("hex");
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function tableColumns(sqlite: Database.Database, table: string): Set<string> {
  const rows = sqlite.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

type ForeignKeyRow = {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_delete: string;
};

function hasForeignKey(
  sqlite: Database.Database,
  table: string,
  target: string,
  columns: ReadonlyArray<{ from: string; to: string }>,
  onDelete?: string,
): boolean {
  const rows = sqlite.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`).all() as ForeignKeyRow[];
  const groups = new Map<number, ForeignKeyRow[]>();
  for (const row of rows) groups.set(row.id, [...(groups.get(row.id) ?? []), row]);
  return [...groups.values()].some((group) => {
    const ordered = group.sort((left, right) => left.seq - right.seq);
    return ordered[0]?.table === target
      && (onDelete === undefined || ordered[0]?.on_delete.toUpperCase() === onDelete.toUpperCase())
      && ordered.length === columns.length
      && ordered.every((row, index) => row.from === columns[index]?.from && row.to === columns[index]?.to);
  });
}

function assertIntegrity(sqlite: Database.Database, dbPath: string): void {
  let quickCheck: unknown;
  try {
    quickCheck = sqlite.prepare("PRAGMA quick_check(1)").pluck().get();
  } catch (error) {
    throw new AppDatabaseMigrationError(
      "integrity",
      `app.db at ${dbPath} failed SQLite integrity inspection: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (quickCheck !== "ok") {
    throw new AppDatabaseMigrationError(
      "integrity",
      `app.db at ${dbPath} failed SQLite quick_check: ${String(quickCheck ?? "unknown error")}`,
    );
  }
}

function assertSchema(sqlite: Database.Database, dbPath: string, version = APP_DATABASE_SCHEMA_VERSION): void {
  const missing: string[] = [];
  const expectedSchema = version >= 10 ? APP_SCHEMA_V10 : version >= 9 ? APP_SCHEMA_V9 : version >= 8 ? APP_SCHEMA_V8 : version >= 7 ? APP_SCHEMA_V7 : version >= 6 ? APP_SCHEMA_V6 : version >= 5 ? APP_SCHEMA_V5 : version >= 4 ? APP_SCHEMA_V4 : version >= 3 ? APP_SCHEMA_V3 : version >= 2 ? APP_SCHEMA_V2 : APP_SCHEMA_V1;
  for (const [table, requiredColumns] of expectedSchema) {
    const actual = tableColumns(sqlite, table);
    if (actual.size === 0) {
      missing.push(`${table} (table)`);
      continue;
    }
    for (const column of requiredColumns) {
      if (!actual.has(column)) missing.push(`${table}.${column}`);
    }
  }
  if (version >= 3) {
    const indexes = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map((row) => row.name));
    for (const index of [
      "user_episodic_memories_claim_idx", "user_episodic_memories_recall_idx",
      "user_memory_evidence_memory_idx", "user_memory_evidence_source_uniq",
      "user_memory_relations_uniq", "user_memory_tags_tag_idx", "user_memory_suppressions_uniq",
      "user_memory_mutations_key_uniq", "user_memory_lexical_terms_term_idx",
    ]) {
      if (!indexes.has(index)) missing.push(`${index} (index)`);
    }
    const canonicalSql = String(sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_episodic_memories'").pluck().get() ?? "")
      .replaceAll(/\s+/g, " ").toLowerCase();
    if (!canonicalSql.includes("check (scope = 'user_global')")) missing.push("user_episodic_memories.scope (check)");
  }
  if (version >= 4) {
    for (const expected of [
      {
        table: "user_episodic_memories",
        target: "user_episodic_memory_revisions",
        columns: [{ from: "id", to: "memory_id" }, { from: "current_revision", to: "revision" }],
      },
      {
        table: "user_episodic_memory_revisions",
        target: "user_episodic_memories",
        columns: [{ from: "memory_id", to: "id" }],
        onDelete: "CASCADE",
      },
      {
        table: "user_memory_evidence",
        target: "user_episodic_memories",
        columns: [{ from: "memory_id", to: "id" }],
        onDelete: "CASCADE",
      },
      {
        table: "user_memory_evidence",
        target: "user_episodic_memory_revisions",
        columns: [{ from: "memory_id", to: "memory_id" }, { from: "memory_revision", to: "revision" }],
        onDelete: "CASCADE",
      },
      {
        table: "user_memory_relations",
        target: "user_episodic_memories",
        columns: [{ from: "from_memory_id", to: "id" }],
        onDelete: "CASCADE",
      },
      {
        table: "user_memory_relations",
        target: "user_episodic_memories",
        columns: [{ from: "to_memory_id", to: "id" }],
        onDelete: "CASCADE",
      },
      {
        table: "user_memory_relations",
        target: "user_episodic_memory_revisions",
        columns: [{ from: "from_memory_id", to: "memory_id" }, { from: "from_revision", to: "revision" }],
        onDelete: "CASCADE",
      },
      {
        table: "user_memory_relations",
        target: "user_episodic_memory_revisions",
        columns: [{ from: "to_memory_id", to: "memory_id" }, { from: "to_revision", to: "revision" }],
        onDelete: "CASCADE",
      },
    ]) {
      if (!hasForeignKey(sqlite, expected.table, expected.target, expected.columns, expected.onDelete)) {
        missing.push(`${expected.table}.${expected.columns.map((column) => column.from).join("+")} (foreign key)`);
      }
    }
  }
  if (version >= 5) {
    const indexes = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map((row) => row.name));
    for (const index of ["advisor_provider_revisions_adapter_idx", "advisor_model_profiles_backend_idx", "pi_cli_config_imports_catalog_idx"]) {
      if (!indexes.has(index)) missing.push(`${index} (index)`);
    }
    const requiredChecks: Record<string, string[]> = {
      advisor_provider_settings: ["check (singleton_id = 1)", "execution_mode in ('legacy_runtime', 'migrating', 'provider_v1')", "provider_state in ('setup_required', 'probing', 'ready', 'paused', 'unsupported')", "enabled in (0, 1)"],
      advisor_provider_revisions: ["adapter_id in ('pi_sdk', 'claude_cli')"],
      advisor_model_profile_revisions: ["source_kind in ('bundled_catalog', 'pi_cli_import', 'manual')", "credential_source_kind in ('pi_cli_auth', 'kith_secret', 'env_ref', 'keyless_local')", "network_class in ('loopback', 'lan', 'public_cloud', 'custom')"],
    };
    for (const [table, fragments] of Object.entries(requiredChecks)) {
      const sql = String(sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").pluck().get(table) ?? "")
        .replaceAll(/\s+/g, " ").toLowerCase();
      for (const fragment of fragments) if (!sql.includes(fragment)) missing.push(`${table} (${fragment})`);
    }
    for (const expected of [
      { target: "advisor_provider_revisions", columns: [{ from: "current_provider_revision", to: "revision" }] },
      { target: "advisor_model_profile_revisions", columns: [{ from: "current_model_profile_revision", to: "revision" }] },
    ]) if (!hasForeignKey(sqlite, "advisor_provider_settings", expected.target, expected.columns)) {
      missing.push(`advisor_provider_settings.${expected.columns[0]!.from} (foreign key)`);
    }
    const invalidSingleton = sqlite.prepare(`SELECT 1 FROM advisor_provider_settings
      WHERE singleton_id <> 1 OR length(installation_identity_digest) <> 64
        OR (current_provider_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM advisor_provider_revisions WHERE revision = current_provider_revision))
        OR (current_model_profile_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM advisor_model_profile_revisions WHERE revision = current_model_profile_revision))
      LIMIT 1`).get();
    const singletonCount = Number(sqlite.prepare("SELECT count(*) FROM advisor_provider_settings").pluck().get());
    if (singletonCount !== 1 || invalidSingleton) missing.push("advisor_provider_settings (singleton/reference integrity)");
  }
  if (version >= 6) {
    const indexes = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map((row) => row.name));
    for (const index of [
      "model_provider_connection_revisions_backend_idx",
      "model_configuration_revisions_provider_idx",
      "cli_config_import_snapshots_runtime_idx",
    ]) if (!indexes.has(index)) missing.push(`${index} (index)`);
    const runtimeProfilesSql = String(sqlite.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runtime_profiles'",
    ).pluck().get() ?? "").replaceAll(/\s+/g, " ").toLowerCase();
    for (const fragment of [
      "default_binding_mode in ('kith_model_configuration', 'unmanaged_cli_native', 'unset')",
      "default_binding_mode = 'kith_model_configuration'",
      "default_binding_mode in ('unmanaged_cli_native', 'unset')",
    ]) if (!runtimeProfilesSql.includes(fragment)) missing.push(`runtime_profiles (${fragment})`);
    const epoch = Number(sqlite.prepare(
      "SELECT runtime_configuration_epoch FROM installation_state WHERE singleton_key = 1",
    ).pluck().get());
    if (!Number.isSafeInteger(epoch) || epoch < 1) missing.push("installation_state.runtime_configuration_epoch (value)");
    for (const runtimeId of ["claude", "codex", "opencode", "pi"]) {
      const row = sqlite.prepare(`
        SELECT default_binding_mode, default_model_configuration_id, default_model_configuration_revision
        FROM runtime_profiles WHERE runtime_id = ?
      `).get(runtimeId) as {
        default_binding_mode: string;
        default_model_configuration_id: string | null;
        default_model_configuration_revision: number | null;
      } | undefined;
      if (!row) missing.push(`runtime_profiles.${runtimeId}`);
    }
  }
  if (version >= 7) {
    const installationStateSql = String(sqlite.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'installation_state'",
    ).pluck().get() ?? "").replaceAll(/\s+/g, " ").toLowerCase();
    for (const fragment of [
      "check (interface_font in ('sora', 'system_ui', 'inter', 'geist'))",
      "check (content_font in ('follow_interface', 'system_ui', 'sora', 'inter', 'geist'))",
      "check (code_font in ('system_monospace', 'jetbrains_mono', 'fira_code', 'geist_mono'))",
    ]) if (!installationStateSql.includes(fragment)) missing.push(`installation_state (${fragment})`);
    const row = sqlite.prepare(`
      SELECT interface_font, content_font, code_font
      FROM installation_state WHERE singleton_key = 1
    `).get() as {
      interface_font: string;
      content_font: string;
      code_font: string;
    } | undefined;
    if (!row) {
      missing.push("installation_state.appearance_fonts (singleton)");
    } else if (
      !["sora", "system_ui", "inter", "geist"].includes(row.interface_font)
      || !["follow_interface", "system_ui", "sora", "inter", "geist"].includes(row.content_font)
      || !["system_monospace", "jetbrains_mono", "fira_code", "geist_mono"].includes(row.code_font)
    ) {
      missing.push("installation_state.appearance_fonts (value)");
    }
  }
  if (version >= 8) {
    const appearanceSettingsSql = String(sqlite.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'appearance_settings'",
    ).pluck().get() ?? "").replaceAll(/\s+/g, " ").toLowerCase();
    for (const fragment of [
      "'system_monospace', 'jetbrains_mono', 'fira_code', 'geist_mono'",
      "check (content_font in ('follow_interface', 'system_ui', 'sora', 'inter', 'geist'))",
      "check (code_font in ('system_monospace', 'jetbrains_mono', 'fira_code', 'geist_mono'))",
      ...(version >= 9 ? ["check (ui_font_size in (12, 13, 14, 15, 16))"] : []),
      ...(version >= 10 ? ["check (color_mode in ('light', 'dark', 'system'))"] : []),
    ]) if (!appearanceSettingsSql.includes(fragment)) missing.push(`appearance_settings (${fragment})`);
    const row = sqlite.prepare(`
      SELECT interface_font, content_font, code_font${version >= 9 ? ", ui_font_size" : ""}${version >= 10 ? ", color_mode" : ""}
      FROM appearance_settings WHERE singleton_key = 1
    `).get() as {
      interface_font: string;
      content_font: string;
      code_font: string;
      ui_font_size?: number;
      color_mode?: string;
    } | undefined;
    if (!row) {
      missing.push("appearance_settings (singleton)");
    } else if (
      ![
        "sora", "system_ui", "inter", "geist",
        "system_monospace", "jetbrains_mono", "fira_code", "geist_mono",
      ].includes(row.interface_font)
      || !["follow_interface", "system_ui", "sora", "inter", "geist"].includes(row.content_font)
      || !["system_monospace", "jetbrains_mono", "fira_code", "geist_mono"].includes(row.code_font)
      || (version >= 9 && ![12, 13, 14, 15, 16].includes(row.ui_font_size ?? Number.NaN))
      || (version >= 10 && !["light", "dark", "system"].includes(row.color_mode ?? ""))
    ) {
      missing.push("appearance_settings (value)");
    }
  }
  if (missing.length > 0) {
    throw new AppDatabaseMigrationError(
      "schema",
      `app.db at ${dbPath} is missing required schema entries: ${missing.join(", ")}`,
    );
  }
}

function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function expectedJournal(version: number) {
  return [
    { version: 1, name: "installation-baseline", checksum: baselineChecksum() },
    ...(version >= 2 ? [{ version: 2, name: "content-hmac-key", checksum: migrationChecksum(APP_V2_CONTENT_HMAC_SQL) }] : []),
    ...(version >= 3 ? [{ version: 3, name: "user-global-memory", checksum: migrationChecksum(APP_V3_USER_GLOBAL_MEMORY_SQL) }] : []),
    ...(version >= 4 ? [{ version: 4, name: "user-global-memory-foreign-keys", checksum: migrationChecksum(APP_V4_USER_GLOBAL_MEMORY_FOREIGN_KEYS_SQL) }] : []),
    ...(version >= 5 ? [{ version: 5, name: "advisor-provider-control-plane", checksum: migrationChecksum(APP_V5_ADVISOR_PROVIDER_CONTROL_PLANE_SQL) }] : []),
    ...(version >= 6 ? [{ version: 6, name: "model-runtime-control-plane", checksum: migrationChecksum(APP_V6_MODEL_RUNTIME_CONTROL_PLANE_SQL) }] : []),
    ...(version >= 7 ? [{ version: 7, name: "appearance-font-settings", checksum: migrationChecksum(APP_V7_APPEARANCE_FONT_SETTINGS_SQL) }] : []),
    ...(version >= 8 ? [{ version: 8, name: "appearance-font-groups", checksum: migrationChecksum(APP_V8_APPEARANCE_FONT_GROUPS_SQL) }] : []),
    ...(version >= 9 ? [{ version: 9, name: "appearance-ui-font-size", checksum: migrationChecksum(APP_V9_APPEARANCE_UI_FONT_SIZE_SQL) }] : []),
    ...(version >= 10 ? [{ version: 10, name: "appearance-color-mode", checksum: migrationChecksum(APP_V10_APPEARANCE_COLOR_MODE_SQL) }] : []),
  ];
}

function assertJournal(sqlite: Database.Database, dbPath: string, version = APP_DATABASE_SCHEMA_VERSION): void {
  const rows = sqlite.prepare(`
    SELECT version, name, checksum FROM app_migration_journal ORDER BY version
  `).all() as Array<{ version: number; name: string; checksum: string }>;
  const expected = expectedJournal(version);
  const consistent = rows.length === expected.length && rows.every((row, index) => {
    const item = expected[index];
    if (!item || row.version !== item.version || row.name !== item.name) return false;
    return row.checksum === item.checksum
      || (row.version === 3 && APP_V3_LEGACY_CHECKSUMS.has(row.checksum))
      || (row.version === 5 && APP_V5_LEGACY_CHECKSUMS.has(row.checksum))
      || (row.version === 6 && APP_V6_LEGACY_CHECKSUMS.has(row.checksum));
  });
  if (!consistent) {
    throw new AppDatabaseMigrationError(
      "schema",
      `app.db at ${dbPath} has an inconsistent migration journal`,
    );
  }
}

function assertRevisionReferencesCanMigrate(sqlite: Database.Database, dbPath: string): void {
  const existingForeignKeyViolation = sqlite.prepare("PRAGMA foreign_key_check").get();
  if (existingForeignKeyViolation) {
    throw new AppDatabaseMigrationError("schema", `app.db at ${dbPath} has foreign-key violations before v4 migration`);
  }
  const orphan = sqlite.prepare(`
    SELECT 'current_revision' AS kind, memory.id AS memory_id
    FROM user_episodic_memories memory
    LEFT JOIN user_episodic_memory_revisions revision
      ON revision.memory_id = memory.id AND revision.revision = memory.current_revision
    WHERE revision.memory_id IS NULL
    UNION ALL
    SELECT 'evidence_revision', evidence.memory_id
    FROM user_memory_evidence evidence
    LEFT JOIN user_episodic_memory_revisions revision
      ON revision.memory_id = evidence.memory_id AND revision.revision = evidence.memory_revision
    WHERE revision.memory_id IS NULL
    UNION ALL
    SELECT 'relation_from_revision', relation.from_memory_id
    FROM user_memory_relations relation
    LEFT JOIN user_episodic_memory_revisions revision
      ON revision.memory_id = relation.from_memory_id AND revision.revision = relation.from_revision
    WHERE relation.from_revision IS NOT NULL AND revision.memory_id IS NULL
    UNION ALL
    SELECT 'relation_to_revision', relation.to_memory_id
    FROM user_memory_relations relation
    LEFT JOIN user_episodic_memory_revisions revision
      ON revision.memory_id = relation.to_memory_id AND revision.revision = relation.to_revision
    WHERE relation.to_revision IS NOT NULL AND revision.memory_id IS NULL
    LIMIT 1
  `).get() as { kind: string; memory_id: string } | undefined;
  if (orphan) {
    throw new AppDatabaseMigrationError(
      "schema",
      `app.db at ${dbPath} cannot migrate orphaned ${orphan.kind} for memory ${orphan.memory_id}`,
    );
  }
}

export function assertCompatibleAppDatabase(
  sqlite: Database.Database,
  dbPath: string,
  options: { requireCurrentVersion?: boolean } = {},
): { version: number } {
  assertIntegrity(sqlite, dbPath);
  const version = Number(sqlite.pragma("user_version", { simple: true }));
  if (!Number.isSafeInteger(version) || version < 0 || version > APP_DATABASE_SCHEMA_VERSION) {
    throw new AppDatabaseMigrationError(
      "future",
      `app.db at ${dbPath} uses unsupported schema version ${version}`,
    );
  }
  if (options.requireCurrentVersion) {
    if (version !== APP_DATABASE_SCHEMA_VERSION) {
      throw new AppDatabaseMigrationError(
        "schema",
        `app.db at ${dbPath} did not migrate to schema version ${APP_DATABASE_SCHEMA_VERSION}`,
      );
    }
    assertSchema(sqlite, dbPath, version);
    assertJournal(sqlite, dbPath, version);
  }
  return { version };
}

/** Migrate app.db transactionally. A failed migration leaves its prior version and rows untouched. */
export function migrateAppDatabase(sqlite: Database.Database, dbPath: string, options: { freshInstall?: boolean } = {}): void {
  let { version } = assertCompatibleAppDatabase(sqlite, dbPath);
  const inferredFresh = version === 0 && !(sqlite.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1
  `).get());
  const freshBootstrap = options.freshInstall ?? inferredFresh;
  if (version === APP_DATABASE_SCHEMA_VERSION) {
    assertSchema(sqlite, dbPath);
    assertJournal(sqlite, dbPath);
    return;
  }

  if (version === 0) {
    const applyBaseline = sqlite.transaction(() => {
      sqlite.exec(APP_BASELINE_SQL);
      assertSchema(sqlite, dbPath, 1);
      sqlite.pragma("user_version = 1");
      sqlite.prepare(`
        INSERT INTO app_migration_journal (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(1, "installation-baseline", baselineChecksum(), Date.now());
    });
    applyBaseline.immediate();
    version = 1;
  }
  if (version === 1) {
    assertSchema(sqlite, dbPath, 1);
    assertJournal(sqlite, dbPath, 1);
    const applyContentHmacKey = sqlite.transaction(() => {
      sqlite.exec(APP_V2_CONTENT_HMAC_SQL);
      assertSchema(sqlite, dbPath, 2);
      const key = sqlite.prepare(`
        SELECT content_hmac_key FROM installation_state WHERE singleton_key = 1
      `).pluck().get();
      if (typeof key !== "string" || !/^[0-9a-f]{64}$/.test(key)) {
        throw new AppDatabaseMigrationError("schema", `app.db at ${dbPath} failed to initialize content HMAC key`);
      }
      sqlite.pragma("user_version = 2");
      sqlite.prepare(`
        INSERT INTO app_migration_journal (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(2, "content-hmac-key", migrationChecksum(APP_V2_CONTENT_HMAC_SQL), Date.now());
    });
    applyContentHmacKey.immediate();
    version = 2;
  }
  if (version === 2) {
    assertSchema(sqlite, dbPath, 2);
    assertJournal(sqlite, dbPath, 2);
    const applyUserGlobalMemory = sqlite.transaction(() => {
      sqlite.exec(APP_V3_USER_GLOBAL_MEMORY_SQL);
      assertSchema(sqlite, dbPath, 3);
      sqlite.pragma("user_version = 3");
      sqlite.prepare(`
        INSERT INTO app_migration_journal (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(3, "user-global-memory", migrationChecksum(APP_V3_USER_GLOBAL_MEMORY_SQL), Date.now());
    });
    applyUserGlobalMemory.immediate();
    version = 3;
  }
  if (version === 3) {
    assertSchema(sqlite, dbPath, 3);
    assertJournal(sqlite, dbPath, 3);
    assertRevisionReferencesCanMigrate(sqlite, dbPath);
    const foreignKeysEnabled = Number(sqlite.pragma("foreign_keys", { simple: true })) === 1;
    sqlite.pragma("foreign_keys = OFF");
    try {
      const repairUserGlobalMemoryForeignKeys = sqlite.transaction(() => {
        sqlite.exec(APP_V4_USER_GLOBAL_MEMORY_FOREIGN_KEYS_SQL);
        assertSchema(sqlite, dbPath, 4);
        const foreignKeyViolation = sqlite.prepare("PRAGMA foreign_key_check").get();
        if (foreignKeyViolation) {
          throw new AppDatabaseMigrationError("schema", `app.db at ${dbPath} failed v4 foreign-key validation`);
        }
        sqlite.pragma("user_version = 4");
        sqlite.prepare(`
          INSERT INTO app_migration_journal (version, name, checksum, applied_at)
          VALUES (?, ?, ?, ?)
        `).run(4, "user-global-memory-foreign-keys", migrationChecksum(APP_V4_USER_GLOBAL_MEMORY_FOREIGN_KEYS_SQL), Date.now());
      });
      repairUserGlobalMemoryForeignKeys.immediate();
      version = 4;
    } finally {
      if (foreignKeysEnabled) sqlite.pragma("foreign_keys = ON");
    }
  }
  if (version === 4) {
    assertSchema(sqlite, dbPath, 4);
    assertJournal(sqlite, dbPath, 4);
    const applyAdvisorProviderControlPlane = sqlite.transaction(() => {
      sqlite.exec(APP_V5_ADVISOR_PROVIDER_CONTROL_PLANE_SQL);
      if (freshBootstrap) sqlite.prepare(`
        UPDATE advisor_provider_settings
        SET execution_mode = 'provider_v1', current_provider_revision = 1, provider_state = 'setup_required', updated_at = ?
        WHERE singleton_id = 1
      `).run(Date.now());
      assertSchema(sqlite, dbPath, 5);
      sqlite.pragma("user_version = 5");
      sqlite.prepare(`
        INSERT INTO app_migration_journal (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(5, "advisor-provider-control-plane", migrationChecksum(APP_V5_ADVISOR_PROVIDER_CONTROL_PLANE_SQL), Date.now());
    });
    applyAdvisorProviderControlPlane.immediate();
    version = 5;
  }
  if (version === 5) {
    assertSchema(sqlite, dbPath, 5);
    assertJournal(sqlite, dbPath, 5);
    const applyModelRuntimeControlPlane = sqlite.transaction(() => {
      sqlite.exec(APP_V6_MODEL_RUNTIME_CONTROL_PLANE_SQL);
      assertSchema(sqlite, dbPath, 6);
      const foreignKeyViolation = sqlite.prepare("PRAGMA foreign_key_check").get();
      if (foreignKeyViolation) {
        throw new AppDatabaseMigrationError("schema", `app.db at ${dbPath} failed v6 foreign-key validation`);
      }
      sqlite.pragma("user_version = 6");
      sqlite.prepare(`
        INSERT INTO app_migration_journal (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(6, "model-runtime-control-plane", migrationChecksum(APP_V6_MODEL_RUNTIME_CONTROL_PLANE_SQL), Date.now());
    });
    applyModelRuntimeControlPlane.immediate();
    version = 6;
  }
  if (version === 6) {
    assertSchema(sqlite, dbPath, 6);
    assertJournal(sqlite, dbPath, 6);
    const applyAppearanceFontSettings = sqlite.transaction(() => {
      sqlite.exec(APP_V7_APPEARANCE_FONT_SETTINGS_SQL);
      assertSchema(sqlite, dbPath, 7);
      sqlite.pragma("user_version = 7");
      sqlite.prepare(`
        INSERT INTO app_migration_journal (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(7, "appearance-font-settings", migrationChecksum(APP_V7_APPEARANCE_FONT_SETTINGS_SQL), Date.now());
    });
    applyAppearanceFontSettings.immediate();
    version = 7;
  }
  if (version === 7) {
    assertSchema(sqlite, dbPath, 7);
    assertJournal(sqlite, dbPath, 7);
    const applyAppearanceFontGroups = sqlite.transaction(() => {
      sqlite.exec(APP_V8_APPEARANCE_FONT_GROUPS_SQL);
      assertSchema(sqlite, dbPath, 8);
      sqlite.pragma("user_version = 8");
      sqlite.prepare(`
        INSERT INTO app_migration_journal (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(8, "appearance-font-groups", migrationChecksum(APP_V8_APPEARANCE_FONT_GROUPS_SQL), Date.now());
    });
    applyAppearanceFontGroups.immediate();
    version = 8;
  }
  if (version === 8) {
    assertSchema(sqlite, dbPath, 8);
    assertJournal(sqlite, dbPath, 8);
    const applyAppearanceUiFontSize = sqlite.transaction(() => {
      sqlite.exec(APP_V9_APPEARANCE_UI_FONT_SIZE_SQL);
      assertSchema(sqlite, dbPath, 9);
      sqlite.pragma("user_version = 9");
      sqlite.prepare(`
        INSERT INTO app_migration_journal (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(9, "appearance-ui-font-size", migrationChecksum(APP_V9_APPEARANCE_UI_FONT_SIZE_SQL), Date.now());
    });
    applyAppearanceUiFontSize.immediate();
    version = 9;
  }
  if (version === 9) {
    assertSchema(sqlite, dbPath, 9);
    assertJournal(sqlite, dbPath, 9);
    const applyAppearanceColorMode = sqlite.transaction(() => {
      sqlite.exec(APP_V10_APPEARANCE_COLOR_MODE_SQL);
      assertSchema(sqlite, dbPath, 10);
      sqlite.pragma("user_version = 10");
      sqlite.prepare(`
        INSERT INTO app_migration_journal (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(10, "appearance-color-mode", migrationChecksum(APP_V10_APPEARANCE_COLOR_MODE_SQL), Date.now());
    });
    applyAppearanceColorMode.immediate();
  }
  assertCompatibleAppDatabase(sqlite, dbPath, { requireCurrentVersion: true });
}
