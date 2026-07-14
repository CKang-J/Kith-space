import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
      "spaces",
      "agents",
      "channels",
      "channel_agent_members",
      "human_channel_states",
      "messages",
      "human_saved_messages",
      "human_space_preferences",
    ]) assert.ok(names.includes(expected), `missing ${expected}`);
    for (const removed of ["users", "servers", "server_members", "machines", "join_links", "channel_members", "saved_messages", "server_sidebar_prefs"])
      assert.ok(!names.includes(removed), `legacy table remains: ${removed}`);

    assert.deepEqual(columns(sqlite, "spaces"), ["id", "name", "slug", "avatar_url", "created_at"]);
    assert.ok(columns(sqlite, "agents").includes("introduced_at"), "agents must persist successful Human introduction");
    assert.ok(columns(sqlite, "agents").includes("default_response_mode"), "agents must persist their default response mode");
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
    assert.equal(sqlite.pragma("user_version", { simple: true }), 5);
  } finally {
    sqlite.close();
    unregisterSpace(spaceId);
  }
});

test("schema version 2 Space database migrates to version 5 without being rejected as legacy", () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "workspace-v2-migration-test", spaceId);
  const dbPath = workspaceDbFile(rootPath);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const version2 = new Database(dbPath);
  version2.exec(readFileSync(new URL("../drizzle/0000_personal_agent_os.sql", import.meta.url), "utf8"));
  version2.exec(`
    CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric);
    INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('version-2-baseline', 1783764218492);
    INSERT INTO spaces (id, name, slug, created_at) VALUES ('${spaceId}', 'Migrated', 'migrated-${spaceId}', 1700000000000);
    INSERT INTO agents (id, space_id, name, display_name, created_at) VALUES ('legacy-agent', '${spaceId}', 'legacy', 'Legacy', 1700000000123);
  `);
  version2.close();
  registerSpace({ id: spaceId, name: "Migrated", slug: `migrated-${spaceId}`, rootPath });

  dbForSpace(spaceId);
  closeSpaceDb(spaceId);

  const sqlite = new Database(dbPath);
  try {
    assert.equal(sqlite.pragma("user_version", { simple: true }), 5);
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

test("schema version 4 migrates response settings in place without adding product tables", () => {
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
    INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('version-4-baseline', 1783997806829);
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
    assert.equal(sqlite.pragma("user_version", { simple: true }), 5);
    assert.equal(tables(sqlite).filter((table) => table !== "__drizzle_migrations").length, 19);
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
