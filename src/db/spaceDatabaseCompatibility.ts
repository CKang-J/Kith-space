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

  const missing: string[] = [];
  for (const [table, requiredColumns] of requiredSpaceSchema(version)) {
    const actual = tableColumns(sqlite, table);
    if (actual.size === 0) {
      missing.push(`${table} (table)`);
      continue;
    }
    for (const column of requiredColumns) {
      if (!actual.has(column)) missing.push(`${table}.${column}`);
    }
  }
  const migrationColumns = tableColumns(sqlite, "__drizzle_migrations");
  for (const column of ["id", "hash", "created_at"]) {
    if (!migrationColumns.has(column)) missing.push(`__drizzle_migrations.${column}`);
  }
  const actualIndexes = new Set((sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'index'
  `).all() as Array<{ name: string }>).map((row) => row.name));
  for (const index of requiredSpaceIndexes(version)) {
    if (!actualIndexes.has(index)) missing.push(`${index} (index)`);
  }
  for (const expected of requiredSpaceForeignKeys(version)) {
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
  const actualJournal = sqlite.prepare(`
    SELECT hash, created_at AS createdAt
    FROM __drizzle_migrations
    ORDER BY created_at, id
  `).all() as Array<{ hash: string; createdAt: number }>;
  const expectedJournal = WORKSPACE_MIGRATION_HISTORY
    .filter((entry) => entry.version <= version)
    .map((entry) => ({ hash: entry.hash, createdAt: entry.createdAt }));
  if (JSON.stringify(actualJournal) !== JSON.stringify(expectedJournal)) {
    throw new SpaceDatabaseCompatibilityError(
      "journal",
      `workspace.db at ${dbPath} has a migration journal that does not match schema version ${version}`,
      tables,
    );
  }
  return { version, tables };
}
