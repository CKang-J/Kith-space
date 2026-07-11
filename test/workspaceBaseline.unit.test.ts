import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  closeSpaceDb,
  dbForSpace,
  registerSpace,
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
    assert.equal(sqlite.pragma("user_version", { simple: true }), 2);
  } finally {
    sqlite.close();
    unregisterSpace(spaceId);
  }
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
