import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

export const APP_DATABASE_SCHEMA_VERSION = 2;

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
  const expectedSchema = version >= 2 ? APP_SCHEMA_V2 : APP_SCHEMA_V1;
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
  ];
}

function assertJournal(sqlite: Database.Database, dbPath: string, version = APP_DATABASE_SCHEMA_VERSION): void {
  const rows = sqlite.prepare(`
    SELECT version, name, checksum FROM app_migration_journal ORDER BY version
  `).all() as Array<{ version: number; name: string; checksum: string }>;
  const expected = expectedJournal(version);
  if (JSON.stringify(rows) !== JSON.stringify(expected)) {
    throw new AppDatabaseMigrationError(
      "schema",
      `app.db at ${dbPath} has an inconsistent migration journal`,
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
export function migrateAppDatabase(sqlite: Database.Database, dbPath: string): void {
  let { version } = assertCompatibleAppDatabase(sqlite, dbPath);
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
  }
  assertCompatibleAppDatabase(sqlite, dbPath, { requireCurrentVersion: true });
}
