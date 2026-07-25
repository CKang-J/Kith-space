import type Database from "better-sqlite3";
import {
  MIN_MIGRATABLE_SPACE_DATABASE_SCHEMA_VERSION,
  requiredSpaceForeignKeys,
  requiredSpaceIndexes,
  requiredSpaceSchema,
  SPACE_DATABASE_SCHEMA_VERSION,
  WORKSPACE_MIGRATION_HISTORY,
} from "./spaceDatabaseSchemaHistory.js";

export { MIN_MIGRATABLE_SPACE_DATABASE_SCHEMA_VERSION, SPACE_DATABASE_SCHEMA_VERSION };

export type SpaceDatabaseCompatibilityReason = "integrity" | "legacy" | "future" | "schema" | "journal";

export class SpaceDatabaseCompatibilityError extends Error {
  constructor(
    public readonly reason: SpaceDatabaseCompatibilityReason,
    message: string,
    public readonly tables: string[] = [],
  ) {
    super(message);
    this.name = "SpaceDatabaseCompatibilityError";
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function productTables(sqlite: Database.Database): string[] {
  return (sqlite.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name <> '__drizzle_migrations'
    ORDER BY name
  `).all() as Array<{ name: string }>).map((row) => row.name);
}

function tableColumns(sqlite: Database.Database, table: string): Set<string> {
  const rows = sqlite.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

/**
 * Validate an application-owned workspace database before migration or use.
 * Extra user/extension tables are tolerated, but every Kith-space table and column must exist.
 */
export function assertCompatibleSpaceDatabase(
  sqlite: Database.Database,
  dbPath: string,
  options: { allowEmpty?: boolean; requireCurrentVersion?: boolean } = {},
): { version: number; tables: string[] } {
  let quickCheck: unknown;
  try {
    quickCheck = sqlite.prepare("PRAGMA quick_check(1)").pluck().get();
  } catch (error) {
    throw new SpaceDatabaseCompatibilityError(
      "integrity",
      `workspace.db at ${dbPath} failed SQLite integrity inspection: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (quickCheck !== "ok") {
    throw new SpaceDatabaseCompatibilityError(
      "integrity",
      `workspace.db at ${dbPath} failed SQLite quick_check: ${String(quickCheck ?? "unknown error")}`,
    );
  }

  const version = Number(sqlite.pragma("user_version", { simple: true }));
  const tables = productTables(sqlite);
  if (version > SPACE_DATABASE_SCHEMA_VERSION) {
    throw new SpaceDatabaseCompatibilityError(
      "future",
      `workspace.db at ${dbPath} uses newer unsupported schema version ${version}`,
      tables,
    );
  }
  if (tables.length === 0 && options.allowEmpty && version === 0) return { version, tables };
  if (version < MIN_MIGRATABLE_SPACE_DATABASE_SCHEMA_VERSION) {
    throw new SpaceDatabaseCompatibilityError(
      "legacy",
      `workspace.db at ${dbPath} uses unsupported schema version ${version}`,
      tables,
    );
  }
  if (options.requireCurrentVersion && version !== SPACE_DATABASE_SCHEMA_VERSION) {
    throw new SpaceDatabaseCompatibilityError(
      "schema",
      `workspace.db at ${dbPath} did not migrate to schema version ${SPACE_DATABASE_SCHEMA_VERSION}`,
      tables,
    );
  }

  const migrationColumns = tableColumns(sqlite, "__drizzle_migrations");
  const missingMigrationColumns = ["id", "hash", "created_at"].filter((column) => !migrationColumns.has(column));
  if (missingMigrationColumns.length) {
    throw new SpaceDatabaseCompatibilityError(
      "schema",
      `workspace.db at ${dbPath} is missing required schema entries: ${missingMigrationColumns.map((column) => `__drizzle_migrations.${column}`).join(", ")}`,
      tables,
    );
  }
  const actualJournal = sqlite.prepare(`
    SELECT hash, created_at AS createdAt
    FROM __drizzle_migrations
    ORDER BY created_at, id
  `).all() as Array<{ hash: string; createdAt: number }>;
  const expectedJournal = WORKSPACE_MIGRATION_HISTORY
    .filter((entry) => entry.version <= version)
    .map((entry) => ({
      hashes: [entry.hash, ...(entry.compatibleHashes ?? [])],
      createdAt: entry.createdAt,
    }));
  const journalIsPrefix = actualJournal.length <= expectedJournal.length
    && actualJournal.every((entry, index) => {
      const expected = expectedJournal[index];
      return expected?.createdAt === entry.createdAt && expected.hashes.includes(entry.hash);
    });
  if (!journalIsPrefix || (options.requireCurrentVersion && actualJournal.length !== expectedJournal.length)) {
    throw new SpaceDatabaseCompatibilityError(
      "journal",
      `workspace.db at ${dbPath} has a migration journal that does not match schema version ${version}`,
      tables,
    );
  }

  const migrationCount = actualJournal.length;
  const missing: string[] = [];
  for (const [table, requiredColumns] of requiredSpaceSchema(version, migrationCount)) {
    const actual = tableColumns(sqlite, table);
    if (actual.size === 0) {
      missing.push(`${table} (table)`);
      continue;
    }
    for (const column of requiredColumns) {
      if (!actual.has(column)) missing.push(`${table}.${column}`);
    }
  }
  const actualIndexes = new Set((sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'index'
  `).all() as Array<{ name: string }>).map((row) => row.name));
  for (const index of requiredSpaceIndexes(version, migrationCount)) {
    if (!actualIndexes.has(index)) missing.push(`${index} (index)`);
  }
  for (const expected of requiredSpaceForeignKeys(version, migrationCount)) {
    const actual = sqlite.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(expected.table)})`).all() as Array<{
      table: string;
      from: string;
      on_delete: string;
    }>;
    if (!actual.some((row) => row.table === expected.targetTable && row.from === expected.from && row.on_delete === expected.onDelete)) {
      missing.push(`${expected.table}.${expected.from} (foreign key ${expected.onDelete})`);
    }
  }
  if (missing.length > 0) {
    throw new SpaceDatabaseCompatibilityError(
      "schema",
      `workspace.db at ${dbPath} is missing required schema entries: ${missing.join(", ")}`,
      tables,
    );
  }
  return { version, tables };
}
