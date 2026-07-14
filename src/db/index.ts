import { existsSync, lstatSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  closeAppDatabase,
  getSpaceRecord as getRegisteredSpace,
  insertSpaceRecord,
  listSpaceRecords,
  registerSpace as registerSpaceRecord,
  touchSpace as touchSpaceRecord,
  unregisterSpace as unregisterSpaceRecord,
  type SpaceRecord,
} from "../app-data/appDatabase.js";
import { workspaceDbFile } from "../paths.js";
import * as schema from "./schema.js";
import {
  assertCompatibleSpaceDatabase,
  MIN_MIGRATABLE_SPACE_DATABASE_SCHEMA_VERSION,
  SPACE_DATABASE_SCHEMA_VERSION,
  SpaceDatabaseCompatibilityError,
} from "./spaceDatabaseCompatibility.js";
import { ensureRequiredChannels } from "./requiredChannel.js";

export type SpaceDb = BetterSQLite3Database<typeof schema>;

interface SpaceConnection {
  sqlite: Database.Database;
  db: SpaceDb;
  dbPath: string;
}

const spaceConnections = new Map<string, SpaceConnection>();
const pendingSpaceInitializations = new Set<string>();

const migrationsFolder = process.env.KITH_SPACE_MIGRATIONS_DIR
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");
export { MIN_MIGRATABLE_SPACE_DATABASE_SCHEMA_VERSION, SPACE_DATABASE_SCHEMA_VERSION };

export class LegacySpaceDatabaseError extends Error {
  constructor(public readonly dbPath: string, tables: string[]) {
    super(`legacy workspace database at ${dbPath} is incompatible with the Personal AgentOS baseline (${tables.join(", ")}); back it up, then delete this workspace.db so Kith-space can create a fresh database`);
    this.name = "LegacySpaceDatabaseError";
  }
}

export class SpaceDatabaseUnavailableError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "SpaceDatabaseUnavailableError";
  }
}

function assertSpaceDatabaseLocation(record: SpaceRecord, allowCreate: boolean): string {
  const rootPath = path.resolve(record.rootPath);
  let rootInfo;
  try {
    rootInfo = statSync(rootPath);
  } catch {
    throw new SpaceDatabaseUnavailableError(
      "SPACE_ROOT_MISSING",
      `Space folder is missing at ${rootPath}. Restore it or relocate the Space; Kith-space will not recreate it.`,
    );
  }
  if (!rootInfo.isDirectory()) {
    throw new SpaceDatabaseUnavailableError("SPACE_ROOT_NOT_DIRECTORY", `Space root is not a directory: ${rootPath}`);
  }

  const kithPath = path.join(rootPath, ".kith");
  let kithInfo;
  try {
    kithInfo = lstatSync(kithPath);
  } catch {
    throw new SpaceDatabaseUnavailableError(
      "SPACE_ROOT_DB_MISSING",
      `Registered Space has no .kith directory at ${rootPath}. Restore it or relocate the Space; Kith-space will not recreate it.`,
    );
  }
  if (kithInfo.isSymbolicLink()) {
    throw new SpaceDatabaseUnavailableError("SPACE_ROOT_SYMLINK_UNSUPPORTED", `.kith cannot be a symbolic link: ${kithPath}`);
  }
  if (!kithInfo.isDirectory()) {
    throw new SpaceDatabaseUnavailableError("SPACE_ROOT_KITH_INVALID", `.kith is not a directory: ${kithPath}`);
  }

  const dbPath = path.resolve(workspaceDbFile(rootPath));
  if (!existsSync(dbPath)) {
    if (allowCreate) return dbPath;
    throw new SpaceDatabaseUnavailableError(
      "SPACE_ROOT_DB_MISSING",
      `Registered Space has no workspace.db at ${dbPath}. Restore it or relocate the Space; Kith-space will not recreate it.`,
    );
  }
  const dbInfo = lstatSync(dbPath);
  if (dbInfo.isSymbolicLink()) {
    throw new SpaceDatabaseUnavailableError("SPACE_ROOT_SYMLINK_UNSUPPORTED", `workspace.db cannot be a symbolic link: ${dbPath}`);
  }
  if (!dbInfo.isFile()) {
    throw new SpaceDatabaseUnavailableError("SPACE_ROOT_DB_INVALID", `workspace.db is not a regular file: ${dbPath}`);
  }
  return dbPath;
}

function assertCompatibleBaseline(sqlite: Database.Database, dbPath: string): void {
  try {
    assertCompatibleSpaceDatabase(sqlite, dbPath, { allowEmpty: true });
  } catch (error) {
    if (!(error instanceof SpaceDatabaseCompatibilityError)) throw error;
    if (error.reason === "legacy") throw new LegacySpaceDatabaseError(dbPath, error.tables);
    throw new SpaceDatabaseUnavailableError(
      error.reason === "integrity" ? "SPACE_ROOT_DB_INVALID" : "SPACE_ROOT_DB_INCOMPATIBLE",
      error.message,
    );
  }
}

function ensureSpaceBaseline(db: SpaceDb, sqlite: Database.Database, record: SpaceRecord): void {
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
  });
  ensureRequiredChannels(sqlite, record.id);
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
  const initializesDatabase = !existsSync(workspaceDbFile(rootPath));
  const registered = registerSpaceRecord({ ...record, slug: record.slug ?? record.id, rootPath });
  if (initializesDatabase) pendingSpaceInitializations.add(registered.id);
  else pendingSpaceInitializations.delete(registered.id);
  return registered;
}

export function registerNewSpace(record: { id: string; name: string; slug: string; rootPath: string; lastOpenedAt?: Date }): SpaceRecord {
  const rootPath = path.resolve(record.rootPath);
  mkdirSync(path.join(rootPath, ".kith"), { recursive: true });
  const initializesDatabase = !existsSync(workspaceDbFile(rootPath));
  const registered = insertSpaceRecord({ ...record, rootPath });
  if (initializesDatabase) pendingSpaceInitializations.add(registered.id);
  return registered;
}

export function touchSpace(spaceId: string): void {
  touchSpaceRecord(spaceId);
}

export function unregisterSpace(spaceId: string): void {
  closeSpaceDb(spaceId);
  pendingSpaceInitializations.delete(spaceId);
  unregisterSpaceRecord(spaceId);
}

export function dbForSpace(spaceId: string, options: { allowCreate?: boolean } = {}): SpaceDb {
  const record = spaceRecord(spaceId);
  if (!record) throw new Error(`Space not registered: ${spaceId}`);
  const allowCreate = options.allowCreate === true || pendingSpaceInitializations.has(spaceId);
  let dbPath: string;
  try {
    dbPath = assertSpaceDatabaseLocation(record, allowCreate);
  } catch (error) {
    closeSpaceDb(spaceId);
    throw error;
  }
  const cached = spaceConnections.get(spaceId);
  if (cached?.dbPath === dbPath) return cached.db;
  if (cached) cached.sqlite.close();
  const sqlite = new Database(dbPath, { fileMustExist: !allowCreate });
  try {
    assertCompatibleBaseline(sqlite, dbPath);
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("busy_timeout = 5000");
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });
    try {
      assertCompatibleSpaceDatabase(sqlite, dbPath, { requireCurrentVersion: true });
    } catch (error) {
      if (!(error instanceof SpaceDatabaseCompatibilityError)) throw error;
      throw new SpaceDatabaseUnavailableError(
        error.reason === "integrity" ? "SPACE_ROOT_DB_INVALID" : "SPACE_ROOT_DB_INCOMPATIBLE",
        error.message,
      );
    }
    ensureSpaceBaseline(db, sqlite, record);
    spaceConnections.set(spaceId, { sqlite, db, dbPath });
    pendingSpaceInitializations.delete(spaceId);
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
  pendingSpaceInitializations.clear();
  closeAppDatabase();
}

export { schema };
