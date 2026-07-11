import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { and, eq, isNull } from "drizzle-orm";
import {
  closeAppDatabase,
  getSpaceRecord as getRegisteredSpace,
  listSpaceRecords,
  registerSpace as registerSpaceRecord,
  touchSpace as touchSpaceRecord,
  unregisterSpace as unregisterSpaceRecord,
  type SpaceRecord,
} from "../app-data/appDatabase.js";
import { workspaceDbFile } from "../paths.js";
import * as schema from "./schema.js";

export type SpaceDb = BetterSQLite3Database<typeof schema>;

interface SpaceConnection {
  sqlite: Database.Database;
  db: SpaceDb;
  dbPath: string;
}

const spaceConnections = new Map<string, SpaceConnection>();

const migrationsFolder = process.env.KITH_SPACE_MIGRATIONS_DIR
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");
const SPACE_DATABASE_SCHEMA_VERSION = 2;

export class LegacySpaceDatabaseError extends Error {
  constructor(public readonly dbPath: string, tables: string[]) {
    super(`legacy workspace database at ${dbPath} is incompatible with the Personal AgentOS baseline (${tables.join(", ")}); back it up, then delete this workspace.db so Kith-space can create a fresh database`);
    this.name = "LegacySpaceDatabaseError";
  }
}

function existingProductTables(sqlite: Database.Database): string[] {
  return (sqlite.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name <> '__drizzle_migrations'
    ORDER BY name
  `).all() as Array<{ name: string }>).map((row) => row.name);
}

function assertCompatibleBaseline(sqlite: Database.Database, dbPath: string): void {
  const version = Number(sqlite.pragma("user_version", { simple: true }));
  const tables = existingProductTables(sqlite);
  if (version === SPACE_DATABASE_SCHEMA_VERSION || tables.length === 0) return;
  throw new LegacySpaceDatabaseError(dbPath, tables);
}

function ensureSpaceBaseline(db: SpaceDb, record: SpaceRecord): void {
  db.transaction((tx) => {
    const existingSpaces = tx.select().from(schema.spaces).all();
    if (existingSpaces.some((space) => space.id !== record.id)) {
      throw new Error(`workspace database Space identity does not match app.db: ${record.id}`);
    }
    tx.insert(schema.spaces).values({ id: record.id, name: record.name, slug: record.slug })
      .onConflictDoUpdate({
        target: schema.spaces.id,
        set: { name: record.name, slug: record.slug },
      }).run();
    const all = tx.select({ id: schema.channels.id }).from(schema.channels).where(and(
      eq(schema.channels.spaceId, record.id),
      eq(schema.channels.name, "all"),
      eq(schema.channels.type, "channel"),
      isNull(schema.channels.deletedAt),
    )).get();
    if (!all) {
      tx.insert(schema.channels).values({
        spaceId: record.id,
        name: "all",
        description: "General channel for the Human and all agents",
        type: "channel",
      }).run();
    }
  });
}

export function spaceRecord(spaceId: string): SpaceRecord | undefined {
  return getRegisteredSpace(spaceId);
}

export function listSpaces(): SpaceRecord[] {
  return listSpaceRecords();
}

export function registerSpace(record: { id: string; name: string; slug?: string; rootPath: string; lastOpenedAt?: Date }): SpaceRecord {
  const rootPath = path.resolve(record.rootPath);
  mkdirSync(path.join(rootPath, ".kith"), { recursive: true });
  return registerSpaceRecord({ ...record, slug: record.slug ?? record.id, rootPath });
}

export function touchSpace(spaceId: string): void {
  touchSpaceRecord(spaceId);
}

export function unregisterSpace(spaceId: string): void {
  closeSpaceDb(spaceId);
  unregisterSpaceRecord(spaceId);
}

export function dbForSpace(spaceId: string): SpaceDb {
  const record = spaceRecord(spaceId);
  if (!record) throw new Error(`Space not registered: ${spaceId}`);
  const dbPath = path.resolve(workspaceDbFile(record.rootPath));
  const cached = spaceConnections.get(spaceId);
  if (cached?.dbPath === dbPath) return cached.db;
  if (cached) cached.sqlite.close();
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  try {
    assertCompatibleBaseline(sqlite, dbPath);
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("busy_timeout = 5000");
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });
    const version = Number(sqlite.pragma("user_version", { simple: true }));
    if (version !== SPACE_DATABASE_SCHEMA_VERSION) {
      throw new Error(`workspace database schema version mismatch at ${dbPath}: expected ${SPACE_DATABASE_SCHEMA_VERSION}, received ${version}`);
    }
    ensureSpaceBaseline(db, record);
    spaceConnections.set(spaceId, { sqlite, db, dbPath });
    return db;
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

export function allSpaceDbs(): { space: SpaceRecord; db: SpaceDb }[] {
  return listSpaces().map((space) => ({ space, db: dbForSpace(space.id) }));
}

export function closeSpaceDb(spaceId: string): void {
  const conn = spaceConnections.get(spaceId);
  if (!conn) return;
  conn.sqlite.close();
  spaceConnections.delete(spaceId);
}

export function closeAllDatabases(): void {
  for (const conn of spaceConnections.values()) conn.sqlite.close();
  spaceConnections.clear();
  closeAppDatabase();
}

export { schema };
