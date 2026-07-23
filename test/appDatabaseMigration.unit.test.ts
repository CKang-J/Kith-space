import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  APP_DATABASE_SCHEMA_VERSION,
  AppDatabaseMigrationError,
  migrateAppDatabase,
} from "../src/app-data/appDatabaseMigrations.ts";

function tableNames(sqlite: Database.Database): string[] {
  return (sqlite.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name: string }>).map((row) => row.name);
}

function withAppDatabase(run: (sqlite: Database.Database, dbPath: string) => void): void {
  const root = mkdtempSync(path.join(os.tmpdir(), "kith-space-app-migration-"));
  const dbPath = path.join(root, "app.db");
  const sqlite = new Database(dbPath);
  try {
    run(sqlite, dbPath);
  } finally {
    sqlite.close();
    rmSync(root, { recursive: true, force: true });
  }
}

const LEGACY_V3_CHECKSUM = "3188d1283621a7b042594c340ace87b42195cef97b689ffb5c0f78535b9b7eba";
const LEGACY_V5_CHECKSUM = "935bab99c7fa6ecb6b79e0eabba2ee4e074f12f62551998c9d58daf05c6a2d0b";

function downgradeToLegacyV3(sqlite: Database.Database): void {
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`
    DROP TABLE pi_cli_config_imports;
    DROP TABLE advisor_provider_settings;
    DROP TABLE advisor_model_profile_revisions;
    DROP TABLE advisor_provider_revisions;
    CREATE TABLE user_episodic_memories_legacy (
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
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE user_episodic_memory_revisions_legacy AS SELECT * FROM user_episodic_memory_revisions;
    CREATE TABLE user_memory_evidence_legacy AS SELECT * FROM user_memory_evidence;
    CREATE TABLE user_memory_relations_legacy AS SELECT * FROM user_memory_relations;
    INSERT INTO user_episodic_memories_legacy SELECT * FROM user_episodic_memories;

    DROP TABLE user_memory_relations;
    DROP TABLE user_memory_evidence;
    DROP TABLE user_episodic_memory_revisions;
    DROP TABLE user_episodic_memories;
    ALTER TABLE user_episodic_memories_legacy RENAME TO user_episodic_memories;
    ALTER TABLE user_episodic_memory_revisions_legacy RENAME TO user_episodic_memory_revisions;
    ALTER TABLE user_memory_evidence_legacy RENAME TO user_memory_evidence;
    ALTER TABLE user_memory_relations_legacy RENAME TO user_memory_relations;

    CREATE INDEX user_episodic_memories_claim_idx ON user_episodic_memories (subject_key, predicate_key);
    CREATE INDEX user_episodic_memories_recall_idx ON user_episodic_memories (status, source_access, updated_at);
    CREATE INDEX user_memory_evidence_memory_idx ON user_memory_evidence (memory_id, memory_revision);
    CREATE UNIQUE INDEX user_memory_evidence_source_uniq
      ON user_memory_evidence (memory_id, memory_revision, source_kind, source_id);
    CREATE UNIQUE INDEX user_memory_relations_uniq
      ON user_memory_relations (from_memory_id, from_revision, to_memory_id, to_revision, relation_type);

    DELETE FROM app_migration_journal WHERE version >= 4;
    UPDATE app_migration_journal SET checksum = '${LEGACY_V3_CHECKSUM}' WHERE version = 3;
    PRAGMA user_version = 3;
  `);
}

test("fresh app.db migrates transactionally to the versioned installation baseline", () => {
  withAppDatabase((sqlite, dbPath) => {
    migrateAppDatabase(sqlite, dbPath);

    assert.equal(sqlite.pragma("user_version", { simple: true }), APP_DATABASE_SCHEMA_VERSION);
    assert.deepEqual(sqlite.prepare(`
      SELECT version, name, length(checksum) AS checksumLength
      FROM app_migration_journal ORDER BY version
    `).all(), [
      { version: 1, name: "installation-baseline", checksumLength: 64 },
      { version: 2, name: "content-hmac-key", checksumLength: 64 },
      { version: 3, name: "user-global-memory", checksumLength: 64 },
      { version: 4, name: "user-global-memory-foreign-keys", checksumLength: 64 },
      { version: 5, name: "advisor-provider-control-plane", checksumLength: 64 },
    ]);
    assert.match(String(sqlite.prepare("SELECT content_hmac_key FROM installation_state WHERE singleton_key = 1").pluck().get()), /^[0-9a-f]{64}$/);
    for (const table of [
      "human_profile",
      "spaces",
      "installation_state",
      "browser_access_settings",
      "browser_sessions",
      "desktop_settings",
      "app_migration_journal",
      "user_episodic_memories",
      "user_episodic_memory_revisions",
      "user_memory_suppressions",
      "user_memory_fts",
    ]) assert.ok(tableNames(sqlite).includes(table), `missing ${table}`);
    assert.deepEqual((sqlite.prepare("PRAGMA index_info(user_memory_mutations_key_uniq)").all() as Array<{ name: string }>).map((row) => row.name), [
      "actor_json", "idempotency_key",
    ]);
    const currentRevisionFks = sqlite.prepare("PRAGMA foreign_key_list(user_episodic_memories)").all() as Array<{ table: string; from: string }>;
    assert.ok(currentRevisionFks.some((row) => row.table === "user_episodic_memory_revisions" && row.from === "current_revision"));
    assert.deepEqual(sqlite.prepare(`
      SELECT execution_mode, provider_state, current_provider_revision, current_model_profile_revision
      FROM advisor_provider_settings WHERE singleton_id = 1
    `).get(), {
      execution_mode: "provider_v1",
      provider_state: "setup_required",
      current_provider_revision: 1,
      current_model_profile_revision: null,
    });
  });
});

test("unversioned legacy app.db preserves Space rows and remains on legacy runtime", () => {
  withAppDatabase((sqlite, dbPath) => {
    sqlite.exec(`
      CREATE TABLE spaces (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        root_path TEXT NOT NULL UNIQUE,
        last_opened_at INTEGER NOT NULL
      );
      INSERT INTO spaces (id, name, slug, root_path, last_opened_at)
      VALUES ('legacy-home', 'Home', 'home', '/tmp/legacy-home', 1);
    `);

    migrateAppDatabase(sqlite, dbPath);

    assert.equal(sqlite.prepare(`
      SELECT home_space_id FROM installation_state WHERE singleton_key = 1
    `).pluck().get(), "legacy-home");
    assert.equal(sqlite.prepare("SELECT count(*) FROM spaces").pluck().get(), 1);
    assert.equal(sqlite.prepare("SELECT execution_mode FROM advisor_provider_settings WHERE singleton_id = 1").pluck().get(), "legacy_runtime");
  });
});

test("version 1 app.db upgrades in place with a stable installation content HMAC key", () => {
  withAppDatabase((sqlite, dbPath) => {
    migrateAppDatabase(sqlite, dbPath);
    sqlite.exec(`
      PRAGMA user_version = 1;
      DELETE FROM app_migration_journal WHERE version >= 2;
      DROP TABLE pi_cli_config_imports;
      DROP TABLE advisor_provider_settings;
      DROP TABLE advisor_model_profile_revisions;
      DROP TABLE advisor_provider_revisions;
      DROP TABLE user_memory_fts;
      DROP TABLE user_memory_lexical_terms;
      DROP TABLE user_memory_mutations;
      DROP TABLE user_memory_suppressions;
      DROP TABLE user_memory_tags;
      DROP TABLE user_memory_relations;
      DROP TABLE user_memory_evidence;
      DROP TABLE user_episodic_memory_revisions;
      DROP TABLE user_episodic_memories;
      ALTER TABLE installation_state DROP COLUMN content_hmac_key;
    `);
    migrateAppDatabase(sqlite, dbPath);
    const first = String(sqlite.prepare("SELECT content_hmac_key FROM installation_state WHERE singleton_key = 1").pluck().get());
    migrateAppDatabase(sqlite, dbPath);
    const second = String(sqlite.prepare("SELECT content_hmac_key FROM installation_state WHERE singleton_key = 1").pluck().get());
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(second, first);
    assert.equal(sqlite.pragma("user_version", { simple: true }), APP_DATABASE_SCHEMA_VERSION);
  });
});

test("version 2 app.db adds isolated user-global memory tables without changing the HMAC key", () => {
  withAppDatabase((sqlite, dbPath) => {
    migrateAppDatabase(sqlite, dbPath);
    const key = sqlite.prepare("SELECT content_hmac_key FROM installation_state WHERE singleton_key = 1").pluck().get();
    sqlite.exec(`
      PRAGMA user_version = 2;
      DELETE FROM app_migration_journal WHERE version >= 3;
      DROP TABLE pi_cli_config_imports;
      DROP TABLE advisor_provider_settings;
      DROP TABLE advisor_model_profile_revisions;
      DROP TABLE advisor_provider_revisions;
      DROP TABLE user_memory_fts;
      DROP TABLE user_memory_lexical_terms;
      DROP TABLE user_memory_mutations;
      DROP TABLE user_memory_suppressions;
      DROP TABLE user_memory_tags;
      DROP TABLE user_memory_relations;
      DROP TABLE user_memory_evidence;
      DROP TABLE user_episodic_memory_revisions;
      DROP TABLE user_episodic_memories;
    `);

    migrateAppDatabase(sqlite, dbPath);

    assert.equal(sqlite.pragma("user_version", { simple: true }), APP_DATABASE_SCHEMA_VERSION);
    assert.equal(sqlite.prepare("SELECT content_hmac_key FROM installation_state WHERE singleton_key = 1").pluck().get(), key);
    assert.ok(tableNames(sqlite).includes("user_episodic_memories"));
    assert.ok(tableNames(sqlite).includes("user_memory_fts"));
  });
});

test("legacy version 3 app.db repairs composite revision foreign keys without losing data", () => {
  withAppDatabase((sqlite, dbPath) => {
    migrateAppDatabase(sqlite, dbPath);
    sqlite.transaction(() => sqlite.exec(`
      INSERT INTO user_episodic_memories (
        id, scope, kind, subject_ref_json, subject_key, predicate_key, current_revision, status,
        confidence_millis, importance_millis, sensitivity, disclosure, source_access, deletion_state,
        row_version, created_by_json, updated_by_json, created_at, updated_at
      ) VALUES (
        'memory-1', 'user_global', 'preference', '{"kind":"human","id":"human"}', 'human', 'style', 1, 'active',
        1000, 1000, 'normal', 'shareable_summary', 'available', 'none', 1, '{"type":"human","id":"human"}',
        '{"type":"human","id":"human"}', 10, 10
      );
      INSERT INTO user_episodic_memory_revisions (
        memory_id, revision, canonical_text, content_hmac, sensitivity, disclosure, created_by_json, created_at
      ) VALUES ('memory-1', 1, 'Use concise Chinese', 'hmac-1', 'normal', 'shareable_summary', '{"type":"human","id":"human"}', 10);
      INSERT INTO user_memory_evidence (
        id, memory_id, memory_revision, source_kind, source_id, visibility_at_occurrence, asserted_by_json,
        claim_type, memory_policy, excerpt_hmac, occurred_at
      ) VALUES (
        'evidence-1', 'memory-1', 1, 'manual', 'source-1', 'local_file', '{"type":"human","id":"human"}',
        'manual', 'human_manual', 'excerpt-hmac', 10
      );
      INSERT INTO user_memory_relations (
        id, from_memory_id, from_revision, to_memory_id, to_revision, relation_type, created_by_json, created_at
      ) VALUES (
        'relation-1', 'memory-1', 1, 'memory-1', 1, 'confirms', '{"type":"human","id":"human"}', 10
      );
      INSERT INTO user_memory_tags (memory_id, tag) VALUES ('memory-1', 'concise');
      INSERT INTO user_memory_lexical_terms (memory_id, term) VALUES ('memory-1', 'concise');
      INSERT INTO user_memory_fts (memory_id, lexical_text, cjk_bigrams, cjk_trigrams)
      VALUES ('memory-1', 'concise chinese', '简洁 中文', '简洁中');
    `)).immediate();
    downgradeToLegacyV3(sqlite);
    assert.equal((sqlite.prepare("PRAGMA foreign_key_list(user_episodic_memories)").all() as unknown[]).length, 0);
    sqlite.pragma("foreign_keys = ON");

    migrateAppDatabase(sqlite, dbPath);
    migrateAppDatabase(sqlite, dbPath);

    assert.equal(sqlite.pragma("user_version", { simple: true }), APP_DATABASE_SCHEMA_VERSION);
    assert.equal(sqlite.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(sqlite.prepare("SELECT canonical_text FROM user_episodic_memory_revisions WHERE memory_id = 'memory-1'").pluck().get(), "Use concise Chinese");
    assert.equal(sqlite.prepare("SELECT count(*) FROM user_memory_evidence WHERE memory_id = 'memory-1'").pluck().get(), 1);
    assert.equal(sqlite.prepare("SELECT count(*) FROM user_memory_relations WHERE from_memory_id = 'memory-1'").pluck().get(), 1);
    assert.equal(sqlite.prepare("SELECT count(*) FROM user_memory_tags WHERE memory_id = 'memory-1'").pluck().get(), 1);
    assert.equal(sqlite.prepare("SELECT count(*) FROM user_memory_lexical_terms WHERE memory_id = 'memory-1'").pluck().get(), 1);
    assert.equal(sqlite.prepare("SELECT count(*) FROM user_memory_fts WHERE memory_id = 'memory-1'").pluck().get(), 1);
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(sqlite.prepare("SELECT name FROM app_migration_journal WHERE version = 4").pluck().get(), "user-global-memory-foreign-keys");
    const canonicalFks = sqlite.prepare("PRAGMA foreign_key_list(user_episodic_memories)").all() as Array<{ table: string; from: string; to: string }>;
    assert.ok(canonicalFks.some((row) => row.table === "user_episodic_memory_revisions" && row.from === "id" && row.to === "memory_id"));
    assert.ok(canonicalFks.some((row) => row.table === "user_episodic_memory_revisions" && row.from === "current_revision" && row.to === "revision"));
  });
});

test("pre-existing v4 app.db upgrades to an explicit legacy_runtime state", () => {
  withAppDatabase((sqlite, dbPath) => {
    migrateAppDatabase(sqlite, dbPath);
    sqlite.pragma("foreign_keys = OFF");
    sqlite.exec(`
      DROP TABLE pi_cli_config_imports;
      DROP TABLE advisor_model_profile_revisions;
      DROP TABLE advisor_provider_revisions;
      DROP TABLE advisor_provider_settings;
      DELETE FROM app_migration_journal WHERE version = 5;
      PRAGMA user_version = 4;
    `);
    sqlite.pragma("foreign_keys = ON");
    migrateAppDatabase(sqlite, dbPath);
    assert.equal(sqlite.prepare("SELECT execution_mode FROM advisor_provider_settings WHERE singleton_id = 1").pluck().get(), "legacy_runtime");
    assert.equal(sqlite.prepare("SELECT current_provider_revision FROM advisor_provider_settings WHERE singleton_id = 1").pluck().get(), null);
  });
});

test("legacy version 3 app.db with an orphaned current revision rolls back v4 repair", () => {
  withAppDatabase((sqlite, dbPath) => {
    migrateAppDatabase(sqlite, dbPath);
    downgradeToLegacyV3(sqlite);
    sqlite.exec(`
      INSERT INTO user_episodic_memories (
        id, scope, kind, subject_ref_json, subject_key, predicate_key, current_revision, status,
        confidence_millis, importance_millis, sensitivity, disclosure, source_access, deletion_state,
        row_version, created_by_json, updated_by_json, created_at, updated_at
      ) VALUES (
        'orphan', 'user_global', 'fact', '{}', 'human', 'orphan', 9, 'active', 1000, 1000,
        'normal', 'shareable_summary', 'available', 'none', 1, '{}', '{}', 10, 10
      );
    `);
    sqlite.pragma("foreign_keys = ON");

    assert.throws(
      () => migrateAppDatabase(sqlite, dbPath),
      (error: unknown) => error instanceof AppDatabaseMigrationError
        && error.reason === "schema"
        && error.message.includes("orphaned current_revision"),
    );
    assert.equal(sqlite.pragma("user_version", { simple: true }), 3);
    assert.equal(sqlite.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(sqlite.prepare("SELECT count(*) FROM user_episodic_memories WHERE id = 'orphan'").pluck().get(), 1);
    assert.equal(sqlite.prepare("SELECT count(*) FROM app_migration_journal WHERE version = 4").pluck().get(), 0);
    assert.equal(tableNames(sqlite).some((name) => name.endsWith("_v4")), false);
  });
});

test("future app.db is rejected before the runner mutates it", () => {
  withAppDatabase((sqlite, dbPath) => {
    sqlite.exec(`CREATE TABLE future_marker (value TEXT); PRAGMA user_version = 99;`);

    assert.throws(
      () => migrateAppDatabase(sqlite, dbPath),
      (error: unknown) => error instanceof AppDatabaseMigrationError && error.reason === "future",
    );
    assert.deepEqual(tableNames(sqlite), ["future_marker"]);
    assert.equal(sqlite.pragma("user_version", { simple: true }), 99);
  });
});

test("failed app.db baseline validation rolls back every migration side effect", () => {
  withAppDatabase((sqlite, dbPath) => {
    sqlite.exec(`
      CREATE TABLE spaces (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE
      );
    `);

    assert.throws(
      () => migrateAppDatabase(sqlite, dbPath),
      (error: unknown) => error instanceof AppDatabaseMigrationError
        && error.reason === "schema"
        && error.message.includes("spaces.root_path"),
    );
    assert.deepEqual(tableNames(sqlite), ["spaces"]);
    assert.equal(sqlite.pragma("user_version", { simple: true }), 0);
  });
});

test("current app.db rejects a missing or tampered migration journal", () => {
  withAppDatabase((sqlite, dbPath) => {
    migrateAppDatabase(sqlite, dbPath);
    sqlite.prepare("UPDATE app_migration_journal SET checksum = 'tampered' WHERE version = 1").run();

    assert.throws(
      () => migrateAppDatabase(sqlite, dbPath),
      (error: unknown) => error instanceof AppDatabaseMigrationError
        && error.reason === "schema"
        && error.message.includes("inconsistent migration journal"),
    );
    assert.equal(sqlite.pragma("user_version", { simple: true }), APP_DATABASE_SCHEMA_VERSION);
  });
});

test("pre-release v5 journal remains readable only when the final control-plane schema is intact", () => {
  withAppDatabase((sqlite, dbPath) => {
    migrateAppDatabase(sqlite, dbPath);
    sqlite.prepare("UPDATE app_migration_journal SET checksum = ? WHERE version = 5").run(LEGACY_V5_CHECKSUM);

    migrateAppDatabase(sqlite, dbPath);
    assert.equal(sqlite.pragma("user_version", { simple: true }), APP_DATABASE_SCHEMA_VERSION);

    sqlite.exec("DROP INDEX advisor_provider_revisions_adapter_idx");
    assert.throws(
      () => migrateAppDatabase(sqlite, dbPath),
      (error: unknown) => error instanceof AppDatabaseMigrationError
        && error.reason === "schema"
        && error.message.includes("advisor_provider_revisions_adapter_idx"),
    );
    sqlite.exec("CREATE INDEX advisor_provider_revisions_adapter_idx ON advisor_provider_revisions(adapter_id, revision)");

    sqlite.exec("DROP TABLE pi_cli_config_imports");
    assert.throws(
      () => migrateAppDatabase(sqlite, dbPath),
      (error: unknown) => error instanceof AppDatabaseMigrationError
        && error.reason === "schema"
        && error.message.includes("pi_cli_config_imports"),
    );
  });
});

test("current app.db rejects a missing user-global FTS projection", () => {
  withAppDatabase((sqlite, dbPath) => {
    migrateAppDatabase(sqlite, dbPath);
    sqlite.exec("DROP TABLE user_memory_fts");
    assert.throws(
      () => migrateAppDatabase(sqlite, dbPath),
      (error: unknown) => error instanceof AppDatabaseMigrationError
        && error.reason === "schema"
        && error.message.includes("user_memory_fts"),
    );
  });
});

test("current app.db rejects a missing required user-memory index", () => {
  withAppDatabase((sqlite, dbPath) => {
    migrateAppDatabase(sqlite, dbPath);
    sqlite.exec("DROP INDEX user_memory_suppressions_uniq");
    assert.throws(
      () => migrateAppDatabase(sqlite, dbPath),
      (error: unknown) => error instanceof AppDatabaseMigrationError
        && error.reason === "schema"
        && error.message.includes("user_memory_suppressions_uniq"),
    );
  });
});
