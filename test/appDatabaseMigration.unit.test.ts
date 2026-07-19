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

test("fresh app.db migrates transactionally to the versioned installation baseline", () => {
  withAppDatabase((sqlite, dbPath) => {
    migrateAppDatabase(sqlite, dbPath);

    assert.equal(sqlite.pragma("user_version", { simple: true }), APP_DATABASE_SCHEMA_VERSION);
    assert.deepEqual(sqlite.prepare(`
      SELECT version, name, length(checksum) AS checksumLength
      FROM app_migration_journal
    `).get(), {
      version: APP_DATABASE_SCHEMA_VERSION,
      name: "installation-baseline",
      checksumLength: 64,
    });
    for (const table of [
      "human_profile",
      "spaces",
      "installation_state",
      "browser_access_settings",
      "browser_sessions",
      "desktop_settings",
      "app_migration_journal",
    ]) assert.ok(tableNames(sqlite).includes(table), `missing ${table}`);
  });
});

test("unversioned legacy app.db preserves Space rows and backfills stable Home identity", () => {
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
