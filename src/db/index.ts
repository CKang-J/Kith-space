import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  closeAppDatabase,
  getSpaceRecord as getRegisteredSpace,
  listSpaceRecords,
  registerSpace as registerSpaceRecord,
  renameSpace as renameSpaceRecord,
  touchSpace as touchSpaceRecord,
  unregisterSpace as unregisterSpaceRecord,
  type SpaceRecord,
} from "../app-data/appDatabase.js";
import { workspaceDbFile } from "../paths.js";
import * as schema from "./schema.js";

/** @deprecated A2 compatibility name. Product code is migrating to SpaceRecord. */
export type WorkspaceRecord = SpaceRecord;

export type SpaceDb = BetterSQLite3Database<typeof schema>;
/** @deprecated A2 compatibility name. Use SpaceDb. */
export type WorkspaceDb = SpaceDb;

interface SpaceConnection {
  sqlite: Database.Database;
  db: SpaceDb;
  dbPath: string;
}

const spaceConnections = new Map<string, SpaceConnection>();

const migrationsFolder = process.env.KITH_SPACE_MIGRATIONS_DIR
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

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

export function renameSpace(spaceId: string, name: string): void {
  renameSpaceRecord(spaceId, name);
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
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  spaceConnections.set(spaceId, { sqlite, db, dbPath });
  return db;
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

/** @deprecated A2 compatibility facade. Use Space-named exports above. */
export const workspaceRecord = spaceRecord;
/** @deprecated A2 compatibility facade. */
export const listWorkspaces = listSpaces;
/** @deprecated A2 compatibility facade. */
export const registerWorkspace = registerSpace;
/** @deprecated A2 compatibility facade. */
export const touchWorkspace = touchSpace;
/** @deprecated A2 compatibility facade. */
export const renameWorkspace = renameSpace;
/** @deprecated A2 compatibility facade. */
export const unregisterWorkspace = unregisterSpace;
/** @deprecated A2 compatibility facade. */
export const dbFor = dbForSpace;
/** @deprecated A2 compatibility facade. */
export function allWorkspaceDbs(): { workspace: WorkspaceRecord; db: WorkspaceDb }[] {
  return allSpaceDbs().map(({ space, db }) => ({ workspace: space, db }));
}
/** @deprecated A2 compatibility facade. */
export const closeWorkspaceDb = closeSpaceDb;

export { schema };
