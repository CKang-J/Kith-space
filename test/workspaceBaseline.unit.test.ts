import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import {
  closeSpaceDb,
  dbForSpace,
  registerSpace,
  schema,
  unregisterSpace,
} from "../src/db/index.ts";
import { kithSpaceHome, workspaceDbFile } from "../src/paths.ts";
import {
  SPACE_DATABASE_SCHEMA_VERSION,
  WORKSPACE_MIGRATION_HISTORY,
} from "../src/db/spaceDatabaseSchemaHistory.ts";

function migration(version: number) {
  return WORKSPACE_MIGRATION_HISTORY.find((entry) => entry.version === version)!;
}

function tables(sqlite: Database.Database): string[] {
  return (sqlite.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name: string }>).map((row) => row.name);
}

function columns(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

test("workspace migration history pins canonical LF and known Windows CRLF byte hashes", () => {
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  for (const entry of WORKSPACE_MIGRATION_HISTORY) {
    const sql = readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8")
      .replaceAll("\r\n", "\n");
    assert.equal(entry.hash, digest(sql), `${entry.tag} canonical hash must use LF bytes`);
    for (const compatibleHash of entry.compatibleHashes ?? []) {
      assert.equal(compatibleHash, digest(sql.replaceAll("\n", "\r\n")), `${entry.tag} compatible hash must use CRLF bytes`);
    }
  }
});

test("fresh Space database uses the Personal AgentOS baseline and seeds its Space plus #all", () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "workspace-baseline-test", spaceId);
  registerSpace({ id: spaceId, name: "Baseline", slug: `baseline-${spaceId}`, rootPath });

  dbForSpace(spaceId);
  closeSpaceDb(spaceId);

  const sqlite = new Database(workspaceDbFile(rootPath), { readonly: true });
  try {
    const names = tables(sqlite);
    for (const expected of [
      "agent_harness_state",
      "agent_delivery_items",
      "agent_turns",
      "spaces",
      "agents",
      "channels",
      "channel_agent_members",
      "human_channel_states",
      "messages",
      "human_saved_messages",
      "human_space_preferences",
      "runtime_sessions",
      "turn_operations",
    ]) assert.ok(names.includes(expected), `missing ${expected}`);
    for (const removed of ["users", "servers", "server_members", "machines", "join_links", "channel_members", "saved_messages", "server_sidebar_prefs"])
      assert.ok(!names.includes(removed), `legacy table remains: ${removed}`);

    assert.deepEqual(columns(sqlite, "spaces"), ["id", "name", "slug", "avatar_url", "created_at"]);
    assert.ok(columns(sqlite, "agents").includes("introduced_at"), "agents must persist successful Human introduction");
    assert.ok(columns(sqlite, "agents").includes("default_response_mode"), "agents must persist their default response mode");
    for (const field of [
      "model_binding_mode", "model_configuration_id", "model_configuration_revision",
      "model_binding_label_snapshot", "model_binding_fingerprint",
      "confirmed_effective_provider_snapshot", "confirmed_installation_identity_digest",
      "model_binding_state", "runtime_restart_required",
    ]) assert.ok(columns(sqlite, "agents").includes(field), `agents must persist ${field}`);
    for (const field of ["response_mode_override", "ambient_wake_after_seq", "mention_wake_after_seq"]) {
      assert.ok(columns(sqlite, "channel_agent_members").includes(field), `channel_agent_members must persist ${field}`);
    }
    assert.ok(columns(sqlite, "human_channel_states").includes("notification_level"), "Human channel notification level must be persisted");
    for (const table of names) {
      const fields = columns(sqlite, table);
      assert.ok(!fields.includes("server_id"), `${table} still has server_id`);
      assert.ok(!fields.includes("machine_id"), `${table} still has machine_id`);
    }

    assert.deepEqual(sqlite.prepare("SELECT id, name, slug FROM spaces").all(), [{
      id: spaceId,
      name: "Baseline",
      slug: `baseline-${spaceId}`,
    }]);
    assert.deepEqual(sqlite.prepare("SELECT name, type, space_id FROM channels").all(), [{
      name: "all",
      type: "channel",
      space_id: spaceId,
    }]);
    assert.equal(sqlite.pragma("user_version", { simple: true }), SPACE_DATABASE_SCHEMA_VERSION);
    assert.deepEqual((sqlite.prepare("PRAGMA index_info(memory_mutations_key_uniq)").all() as Array<{ name: string }>).map((row) => row.name), [
      "actor_json", "idempotency_key",
    ]);
    const currentRevisionFks = sqlite.prepare("PRAGMA foreign_key_list(episodic_memories)").all() as Array<{ table: string; from: string }>;
    assert.ok(currentRevisionFks.some((row) => row.table === "episodic_memory_revisions" && row.from === "current_revision"));
    const evidenceFks = sqlite.prepare("PRAGMA foreign_key_list(memory_evidence)").all() as Array<{ table: string; from: string }>;
    assert.ok(evidenceFks.some((row) => row.table === "episodic_memory_revisions" && row.from === "memory_revision"));
    for (const field of [
      "approved_provider_revision", "approved_model_profile_revision", "approved_provider_epoch",
      "approved_egress_digest", "consent_epoch", "consent_purpose", "consent_source_scope_json",
      "consent_at", "consent_actor_id", "installation_identity_digest", "provider_epoch_mirror",
    ]) assert.ok(columns(sqlite, "memory_advisor_settings").includes(field), `memory_advisor_settings must persist ${field}`);
    for (const field of [
      "provider_revision", "model_profile_revision", "provider_epoch", "installation_identity_digest",
      "execution_snapshot_json", "execution_snapshot_digest", "capability_digest", "policy_version",
      "agent_consent_epoch", "source_scope_digest", "provider_run_id", "worker_generation",
    ]) assert.ok(columns(sqlite, "memory_advisor_jobs").includes(field), `memory_advisor_jobs must pin ${field}`);
    assert.ok(names.includes("advisor_provider_runs"));
    assert.ok(names.includes("canvas_generation_jobs"));
    assert.ok(columns(sqlite, "canvas_generation_jobs").includes("idempotency_key"));
  } finally {
    sqlite.close();
    unregisterSpace(spaceId);
  }
});

test("schema version 2 Space database migrates to the current version without being rejected as legacy", () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "workspace-v2-migration-test", spaceId);
  const dbPath = workspaceDbFile(rootPath);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const version2 = new Database(dbPath);
  version2.exec(readFileSync(new URL("../drizzle/0000_personal_agent_os.sql", import.meta.url), "utf8"));
  version2.exec(`
    CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric);
    INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${migration(2).hash}', ${migration(2).createdAt});
    INSERT INTO spaces (id, name, slug, created_at) VALUES ('${spaceId}', 'Migrated', 'migrated-${spaceId}', 1700000000000);
    INSERT INTO agents (id, space_id, name, display_name, created_at) VALUES ('legacy-agent', '${spaceId}', 'legacy', 'Legacy', 1700000000123);
  `);
  version2.close();
  registerSpace({ id: spaceId, name: "Migrated", slug: `migrated-${spaceId}`, rootPath });

  dbForSpace(spaceId);
  closeSpaceDb(spaceId);

  const sqlite = new Database(dbPath);
  try {
    assert.equal(sqlite.pragma("user_version", { simple: true }), SPACE_DATABASE_SCHEMA_VERSION);
    assert.ok(columns(sqlite, "agents").includes("introduced_at"));
    assert.ok(columns(sqlite, "agents").includes("default_response_mode"));
    assert.ok(columns(sqlite, "human_channel_states").includes("notification_level"));
    assert.equal(sqlite.prepare("SELECT introduced_at FROM agents WHERE id = 'legacy-agent'").pluck().get(), 1700000000123);
    assert.equal(sqlite.prepare("SELECT default_response_mode FROM agents WHERE id = 'legacy-agent'").pluck().get(), "active");
    sqlite.prepare("INSERT INTO agents (id, space_id, name, display_name) VALUES ('new-agent', ?, 'new', 'New')").run(spaceId);
    assert.equal(sqlite.prepare("SELECT introduced_at FROM agents WHERE id = 'new-agent'").pluck().get(), null);
  } finally {
    sqlite.close();
    unregisterSpace(spaceId);
  }
});

test("schema version 3 Space database migrates through the version-aware compatibility gate", () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "workspace-v3-migration-test", spaceId);
  const dbPath = workspaceDbFile(rootPath);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const version3 = new Database(dbPath);
  version3.exec(readFileSync(new URL("../drizzle/0000_personal_agent_os.sql", import.meta.url), "utf8"));
  version3.exec(readFileSync(new URL("../drizzle/0001_agent_introduction.sql", import.meta.url), "utf8"));
  version3.exec(`
    CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric);
    INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${migration(2).hash}', ${migration(2).createdAt});
    INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${migration(3).hash}', ${migration(3).createdAt});
    INSERT INTO spaces (id, name, slug, created_at) VALUES ('${spaceId}', 'Migrated v3', 'migrated-v3-${spaceId}', 1700000000000);
  `);
  version3.close();
  registerSpace({ id: spaceId, name: "Migrated v3", slug: `migrated-v3-${spaceId}`, rootPath });

  dbForSpace(spaceId);
  closeSpaceDb(spaceId);

  const sqlite = new Database(dbPath);
  try {
    assert.equal(sqlite.pragma("user_version", { simple: true }), SPACE_DATABASE_SCHEMA_VERSION);
    assert.ok(columns(sqlite, "human_channel_states").includes("notification_level"));
    assert.ok(columns(sqlite, "agents").includes("default_response_mode"));
  } finally {
    sqlite.close();
    unregisterSpace(spaceId);
  }
});

test("schema version 4 migrates response settings and the harness tables in place", () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "workspace-v4-migration-test", spaceId);
  const dbPath = workspaceDbFile(rootPath);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const version4 = new Database(dbPath);
  version4.exec(readFileSync(new URL("../drizzle/0000_personal_agent_os.sql", import.meta.url), "utf8"));
  version4.exec(readFileSync(new URL("../drizzle/0001_agent_introduction.sql", import.meta.url), "utf8"));
  version4.exec(readFileSync(new URL("../drizzle/0002_channel_notification_level.sql", import.meta.url), "utf8"));
  version4.exec(`
    CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric);
    INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${migration(2).hash}', ${migration(2).createdAt});
    INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${migration(3).hash}', ${migration(3).createdAt});
    INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${migration(4).hash}', ${migration(4).createdAt});
    INSERT INTO spaces (id, name, slug, created_at) VALUES ('${spaceId}', 'Migrated v4', 'migrated-v4-${spaceId}', 1700000000000);
    INSERT INTO agents (id, space_id, name, display_name, created_at) VALUES ('v4-agent', '${spaceId}', 'v4-agent', 'V4 Agent', 1700000000123);
    INSERT INTO channels (id, space_id, name, type, created_at) VALUES ('v4-channel', '${spaceId}', 'v4-channel', 'channel', 1700000000456);
    INSERT INTO channel_agent_members (channel_id, agent_id, last_read_seq, joined_at) VALUES ('v4-channel', 'v4-agent', 7, 1700000000789);
  `);
  version4.close();
  registerSpace({ id: spaceId, name: "Migrated v4", slug: `migrated-v4-${spaceId}`, rootPath });

  dbForSpace(spaceId);
  closeSpaceDb(spaceId);

  const sqlite = new Database(dbPath);
  try {
    assert.equal(sqlite.pragma("user_version", { simple: true }), SPACE_DATABASE_SCHEMA_VERSION);
    assert.ok(tables(sqlite).includes("episodic_memories"));
    assert.equal(sqlite.prepare("SELECT default_response_mode FROM agents WHERE id = 'v4-agent'").pluck().get(), "active");
    assert.deepEqual(sqlite.prepare(`
      SELECT response_mode_override, ambient_wake_after_seq, mention_wake_after_seq, last_read_seq
      FROM channel_agent_members WHERE channel_id = 'v4-channel' AND agent_id = 'v4-agent'
    `).get(), {
      response_mode_override: null,
      ambient_wake_after_seq: 0,
      mention_wake_after_seq: 0,
      last_read_seq: 7,
    });
    assert.throws(() => sqlite.prepare("UPDATE agents SET default_response_mode = 'invalid' WHERE id = 'v4-agent'").run());
    assert.throws(() => sqlite.prepare("UPDATE channel_agent_members SET response_mode_override = 'invalid'").run());
  } finally {
    sqlite.close();
    unregisterSpace(spaceId);
  }
});

test("schema version 5 preserves legacy Agent sessions while backfilling explicit harness state", () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "workspace-v5-migration-test", spaceId);
  const dbPath = workspaceDbFile(rootPath);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const version5 = new Database(dbPath);
  for (const migrationFile of [
    "0000_personal_agent_os.sql",
    "0001_agent_introduction.sql",
    "0002_channel_notification_level.sql",
    "0003_agent_response_modes.sql",
  ]) version5.exec(readFileSync(new URL(`../drizzle/${migrationFile}`, import.meta.url), "utf8"));
  version5.exec(`
    CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric);
    ${[2, 3, 4, 5].map((version) => `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${migration(version).hash}', ${migration(version).createdAt});`).join("\n")}
    INSERT INTO spaces (id, name, slug, created_at) VALUES ('${spaceId}', 'Migrated v5', 'migrated-v5-${spaceId}', 1700000000000);
    INSERT INTO agents (id, space_id, name, display_name, session_id, created_at)
    VALUES ('v5-agent', '${spaceId}', 'v5-agent', 'V5 Agent', 'legacy-global-session', 1700000000123);
  `);
  version5.close();
  registerSpace({ id: spaceId, name: "Migrated v5", slug: `migrated-v5-${spaceId}`, rootPath });

  dbForSpace(spaceId);
  closeSpaceDb(spaceId);

  const sqlite = new Database(dbPath);
  try {
    assert.equal(sqlite.pragma("user_version", { simple: true }), SPACE_DATABASE_SCHEMA_VERSION);
    assert.equal(sqlite.prepare("SELECT session_id FROM agents WHERE id = 'v5-agent'").pluck().get(), "legacy-global-session");
    assert.deepEqual(sqlite.prepare("SELECT mode, cutover_at FROM agent_harness_state WHERE agent_id = 'v5-agent'").get(), {
      mode: "legacy",
      cutover_at: null,
    });
    assert.equal(sqlite.prepare("SELECT count(*) FROM runtime_sessions").pluck().get(), 0);
  } finally {
    sqlite.close();
    unregisterSpace(spaceId);
  }
});

test("the P-A10.1 schema v6 journal prefix migrates to the current durable harness", () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "workspace-v6-prefix-test", spaceId);
  const dbPath = workspaceDbFile(rootPath);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const prefix = new Database(dbPath);
  for (const migrationFile of [
    "0000_personal_agent_os.sql",
    "0001_agent_introduction.sql",
    "0002_channel_notification_level.sql",
    "0003_agent_response_modes.sql",
    "0004_agent_harness_sessions.sql",
  ]) prefix.exec(readFileSync(new URL(`../drizzle/${migrationFile}`, import.meta.url), "utf8"));
  prefix.exec(`
    CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric);
    ${WORKSPACE_MIGRATION_HISTORY.slice(0, 5).map((entry) => `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${entry.hash}', ${entry.createdAt});`).join("\n")}
    INSERT INTO spaces (id, name, slug, created_at) VALUES ('${spaceId}', 'V6 prefix', 'v6-prefix-${spaceId}', 1700000000000);
  `);
  prefix.close();
  registerSpace({ id: spaceId, name: "V6 prefix", slug: `v6-prefix-${spaceId}`, rootPath });

  dbForSpace(spaceId);
  closeSpaceDb(spaceId);

  const sqlite = new Database(dbPath);
  try {
    assert.equal(sqlite.pragma("user_version", { simple: true }), SPACE_DATABASE_SCHEMA_VERSION);
    assert.ok(tables(sqlite).includes("agent_delivery_items"));
    assert.ok(tables(sqlite).includes("turn_capability_activations"));
    assert.equal(sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get(), WORKSPACE_MIGRATION_HISTORY.length);
  } finally {
    sqlite.close();
    unregisterSpace(spaceId);
  }
});

test("schema version 7 episodic memory data migrates in place to the advisor schema", () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "workspace-v7-advisor-test", spaceId);
  const dbPath = workspaceDbFile(rootPath);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const version7 = new Database(dbPath);
  for (const migrationFile of [
    "0000_personal_agent_os.sql",
    "0001_agent_introduction.sql",
    "0002_channel_notification_level.sql",
    "0003_agent_response_modes.sql",
    "0004_agent_harness_sessions.sql",
    "0005_agent_durable_turns.sql",
    "0006_legacy_dispatch_recovery.sql",
    "0007_temporary_attachment_lifecycle.sql",
    "0008_episodic_memory_core.sql",
  ]) version7.exec(readFileSync(new URL(`../drizzle/${migrationFile}`, import.meta.url), "utf8"));
  version7.exec(`
    CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric);
    ${WORKSPACE_MIGRATION_HISTORY.slice(0, 9).map((entry) => `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${entry.hash}', ${entry.createdAt});`).join("\n")}
    INSERT INTO spaces (id, name, slug, created_at) VALUES ('${spaceId}', 'V7 memory', 'v7-memory-${spaceId}', 1700000000000);
    INSERT INTO agents (id, space_id, name, display_name, created_at) VALUES ('v7-agent', '${spaceId}', 'v7-agent', 'V7 Agent', 1700000000001);
  `);
  version7.close();
  registerSpace({ id: spaceId, name: "V7 memory", slug: `v7-memory-${spaceId}`, rootPath });

  dbForSpace(spaceId);
  closeSpaceDb(spaceId);

  const sqlite = new Database(dbPath);
  try {
    assert.equal(sqlite.pragma("user_version", { simple: true }), SPACE_DATABASE_SCHEMA_VERSION);
    assert.ok(tables(sqlite).includes("memory_advisor_jobs"));
    assert.ok(tables(sqlite).includes("memory_advisor_proposals"));
    const sessionColumns = sqlite.prepare("PRAGMA table_info(runtime_sessions)").all() as Array<{ name: string }>;
    assert.ok(sessionColumns.some((column) => column.name === "checklist_revision"));
    assert.ok(sessionColumns.some((column) => column.name === "compaction_revision"));
    assert.ok(sessionColumns.some((column) => column.name === "context_compaction_revision"));
    assert.equal(sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get(), WORKSPACE_MIGRATION_HISTORY.length);
    assert.equal(sqlite.prepare("SELECT count(*) FROM agents WHERE id = 'v7-agent'").pluck().get(), 1);
  } finally {
    sqlite.close();
    unregisterSpace(spaceId);
  }
});

test("opening a Space database restores the required #all channel lifecycle", () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "workspace-required-all-test", spaceId);
  registerSpace({ id: spaceId, name: "Required all", slug: `required-all-${spaceId}`, rootPath });

  const db = dbForSpace(spaceId);
  const all = db.select().from(schema.channels).where(and(
    eq(schema.channels.spaceId, spaceId),
    eq(schema.channels.name, "all"),
  )).get()!;
  db.update(schema.channels).set({ archivedAt: new Date(), deletedAt: new Date() })
    .where(eq(schema.channels.id, all.id)).run();
  closeSpaceDb(spaceId);

  const reopened = dbForSpace(spaceId);
  const restored = reopened.select().from(schema.channels).where(eq(schema.channels.id, all.id)).get();
  assert.equal(restored?.archivedAt, null);
  assert.equal(restored?.deletedAt, null);

  closeSpaceDb(spaceId);
  unregisterSpace(spaceId);
});

test("legacy workspace schema is rejected before Drizzle mutates it", () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "workspace-legacy-test", spaceId);
  const dbPath = workspaceDbFile(rootPath);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const legacy = new Database(dbPath);
  legacy.exec("CREATE TABLE servers (id TEXT PRIMARY KEY NOT NULL)");
  legacy.close();
  registerSpace({ id: spaceId, name: "Legacy", slug: `legacy-${spaceId}`, rootPath });

  assert.throws(
    () => dbForSpace(spaceId),
    (error: unknown) => error instanceof Error
      && error.message.includes("legacy workspace database")
      && error.message.includes(dbPath),
  );

  const sqlite = new Database(dbPath, { readonly: true });
  try {
    assert.deepEqual(tables(sqlite), ["servers"]);
  } finally {
    sqlite.close();
    unregisterSpace(spaceId);
  }
});

test("an empty future-version workspace is rejected before Drizzle can downgrade it", () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "workspace-empty-future-test", spaceId);
  const dbPath = workspaceDbFile(rootPath);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const future = new Database(dbPath);
  future.pragma("user_version = 999");
  future.close();
  registerSpace({ id: spaceId, name: "Future", slug: `future-${spaceId}`, rootPath });

  assert.throws(() => dbForSpace(spaceId), /newer unsupported schema version 999/);

  const sqlite = new Database(dbPath, { readonly: true });
  try {
    assert.equal(sqlite.pragma("user_version", { simple: true }), 999);
    assert.deepEqual(tables(sqlite), []);
  } finally {
    sqlite.close();
    unregisterSpace(spaceId);
  }
});

test("workspace migration journal rejects both missing and unexpected entries", () => {
  for (const variant of ["missing", "unexpected"] as const) {
    const spaceId = randomUUID();
    const rootPath = path.join(kithSpaceHome(), `workspace-journal-${variant}-test`, spaceId);
    const dbPath = workspaceDbFile(rootPath);
    registerSpace({ id: spaceId, name: `Journal ${variant}`, slug: `journal-${variant}-${spaceId}`, rootPath });

    dbForSpace(spaceId);
    closeSpaceDb(spaceId);

    const sqlite = new Database(dbPath);
    if (variant === "missing") {
      sqlite.prepare("DELETE FROM __drizzle_migrations WHERE created_at = ?").run(migration(6).createdAt);
    } else {
      sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('unexpected', ?)")
        .run(migration(6).createdAt + 1);
    }
    sqlite.close();

    try {
      assert.throws(
        () => dbForSpace(spaceId),
        new RegExp(`migration journal that does not match schema version ${SPACE_DATABASE_SCHEMA_VERSION}`),
      );
    } finally {
      closeSpaceDb(spaceId);
      unregisterSpace(spaceId);
    }
  }
});

test("workspace migration journal accepts the known Windows CRLF migration hashes", () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "workspace-crlf-journal-test", spaceId);
  const dbPath = workspaceDbFile(rootPath);
  registerSpace({ id: spaceId, name: "CRLF journal", slug: `crlf-journal-${spaceId}`, rootPath });

  dbForSpace(spaceId);
  closeSpaceDb(spaceId);

  const migrationEntry = WORKSPACE_MIGRATION_HISTORY[0]!;
  const crlfHash = migrationEntry.compatibleHashes?.[0];
  assert.ok(crlfHash, "fixture migration must declare its CRLF hash");
  const sqlite = new Database(dbPath);
  sqlite.prepare("UPDATE __drizzle_migrations SET hash = ? WHERE created_at = ?")
    .run(crlfHash, migrationEntry.createdAt);
  sqlite.close();

  try {
    assert.doesNotThrow(() => dbForSpace(spaceId));
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("current workspace rejects a missing episodic-memory FTS projection", () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "workspace-missing-memory-fts", spaceId);
  const dbPath = workspaceDbFile(rootPath);
  registerSpace({ id: spaceId, name: "Missing memory FTS", slug: `missing-memory-fts-${spaceId}`, rootPath });
  dbForSpace(spaceId);
  closeSpaceDb(spaceId);
  const sqlite = new Database(dbPath);
  sqlite.exec("DROP TABLE memory_fts");
  sqlite.close();
  try {
    assert.throws(() => dbForSpace(spaceId), /memory_fts/);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
