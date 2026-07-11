import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  closeAppDatabase,
  getSpaceRecord,
  listSpaceRecords,
  registerSpace,
  renameSpace,
  touchSpace,
  unregisterSpace,
  type SpaceRecord,
} from "../app-data/appDatabase.js";
import { workspaceDbFile } from "../paths.js";
import * as schema from "./schema.js";

/** @deprecated A2 compatibility name. Product code is migrating to SpaceRecord. */
export type WorkspaceRecord = SpaceRecord;

export type WorkspaceDb = BetterSQLite3Database<typeof schema>;

interface WorkspaceConnection {
  sqlite: Database.Database;
  db: WorkspaceDb;
  dbPath: string;
}

const workspaceConnections = new Map<string, WorkspaceConnection>();

const migrationsFolder = process.env.KITH_SPACE_MIGRATIONS_DIR
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export function workspaceRecord(workspaceId: string): WorkspaceRecord | undefined {
  return getSpaceRecord(workspaceId);
}

export function listWorkspaces(): WorkspaceRecord[] {
  return listSpaceRecords();
}

export function registerWorkspace(record: { id: string; name: string; slug?: string; rootPath: string; lastOpenedAt?: Date }): WorkspaceRecord {
  const rootPath = path.resolve(record.rootPath);
  mkdirSync(path.join(rootPath, ".kith"), { recursive: true });
  return registerSpace({ ...record, slug: record.slug ?? record.id, rootPath });
}

export function touchWorkspace(workspaceId: string): void {
  touchSpace(workspaceId);
}

export function renameWorkspace(workspaceId: string, name: string): void {
  renameSpace(workspaceId, name);
}

export function unregisterWorkspace(workspaceId: string): void {
  closeWorkspaceDb(workspaceId);
  unregisterSpace(workspaceId);
}

export function dbFor(workspaceId: string): WorkspaceDb {
  const record = workspaceRecord(workspaceId);
  if (!record) throw new Error(`workspace not registered: ${workspaceId}`);
  const dbPath = path.resolve(workspaceDbFile(record.rootPath));
  const cached = workspaceConnections.get(workspaceId);
  if (cached?.dbPath === dbPath) return cached.db;
  if (cached) cached.sqlite.close();
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  workspaceConnections.set(workspaceId, { sqlite, db, dbPath });
  return db;
}

export function allWorkspaceDbs(): { workspace: WorkspaceRecord; db: WorkspaceDb }[] {
  return listWorkspaces().map((workspace) => ({ workspace, db: dbFor(workspace.id) }));
}

export function closeWorkspaceDb(workspaceId: string): void {
  const conn = workspaceConnections.get(workspaceId);
  if (!conn) return;
  conn.sqlite.close();
  workspaceConnections.delete(workspaceId);
}

export function closeAllDatabases(): void {
  for (const conn of workspaceConnections.values()) conn.sqlite.close();
  workspaceConnections.clear();
  closeAppDatabase();
}

export { schema };
