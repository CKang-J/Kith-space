import type Database from "better-sqlite3";
import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import * as schema from "./schema.js";

export const SPACE_DATABASE_SCHEMA_VERSION = 5;
export const MIN_MIGRATABLE_SPACE_DATABASE_SCHEMA_VERSION = 2;

export type SpaceDatabaseCompatibilityReason = "integrity" | "legacy" | "schema";

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

const CURRENT_REQUIRED_COLUMNS = new Map<string, string[]>(
  (Object.values(schema) as Table[]).map((table) => [
    getTableName(table),
    Object.values(getTableColumns(table)).map((column) => column.name),
  ]),
);

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

function requiredColumns(table: string, version: number): string[] {
  let required = CURRENT_REQUIRED_COLUMNS.get(table) ?? [];
  if (version < 3 && table === "agents") required = required.filter((column) => column !== "introduced_at");
  if (version < 4 && table === "human_channel_states") required = required.filter((column) => column !== "notification_level");
  if (version < 5 && table === "agents") required = required.filter((column) => column !== "default_response_mode");
  if (version < 5 && table === "channel_agent_members") {
    required = required.filter((column) => ![
      "response_mode_override",
      "ambient_wake_after_seq",
      "mention_wake_after_seq",
    ].includes(column));
  }
  return required;
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
  if (tables.length === 0 && options.allowEmpty) return { version, tables };
  if (
    version < MIN_MIGRATABLE_SPACE_DATABASE_SCHEMA_VERSION
    || version > SPACE_DATABASE_SCHEMA_VERSION
  ) {
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
  for (const [table] of CURRENT_REQUIRED_COLUMNS) {
    const actual = tableColumns(sqlite, table);
    if (actual.size === 0) {
      missing.push(`${table} (table)`);
      continue;
    }
    for (const column of requiredColumns(table, version)) {
      if (!actual.has(column)) missing.push(`${table}.${column}`);
    }
  }
  const migrationColumns = tableColumns(sqlite, "__drizzle_migrations");
  for (const column of ["id", "hash", "created_at"]) {
    if (!migrationColumns.has(column)) missing.push(`__drizzle_migrations.${column}`);
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
