import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { registryDbFile, workspaceDbFile } from "../paths.js";
import * as schema from "./schema.js";

export interface WorkspaceRecord {
  id: string;
  name: string;
  rootPath: string;
  lastOpenedAt: Date;
}

export type WorkspaceDb = BetterSQLite3Database<typeof schema>;

interface WorkspaceConnection {
  sqlite: Database.Database;
  db: WorkspaceDb;
  dbPath: string;
}

interface RegistryConnection {
  sqlite: Database.Database;
  dbPath: string;
}

const workspaceConnections = new Map<string, WorkspaceConnection>();
let registryConnection: RegistryConnection | undefined;

const migrationsFolder = process.env.KITH_SPACE_MIGRATIONS_DIR
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

function registry(): Database.Database {
  const dbPath = path.resolve(registryDbFile());
  if (registryConnection?.dbPath === dbPath) return registryConnection.sqlite;
  registryConnection?.sqlite.close();
  registryConnection = undefined;
  for (const conn of workspaceConnections.values()) conn.sqlite.close();
  workspaceConnections.clear();
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      last_opened_at INTEGER NOT NULL
    )
  `);
  registryConnection = { sqlite, dbPath };
  return sqlite;
}

function mapWorkspace(row: { id: string; name: string; root_path: string; last_opened_at: number }): WorkspaceRecord {
  return { id: row.id, name: row.name, rootPath: row.root_path, lastOpenedAt: new Date(row.last_opened_at) };
}

export function workspaceRecord(workspaceId: string): WorkspaceRecord | undefined {
  const row = registry().prepare("SELECT id, name, root_path, last_opened_at FROM workspaces WHERE id = ?")
    .get(workspaceId) as { id: string; name: string; root_path: string; last_opened_at: number } | undefined;
  return row ? mapWorkspace(row) : undefined;
}

export function listWorkspaces(): WorkspaceRecord[] {
  const rows = registry().prepare("SELECT id, name, root_path, last_opened_at FROM workspaces ORDER BY last_opened_at DESC")
    .all() as { id: string; name: string; root_path: string; last_opened_at: number }[];
  return rows.map(mapWorkspace);
}

export function registerWorkspace(record: { id: string; name: string; rootPath: string; lastOpenedAt?: Date }): WorkspaceRecord {
  const rootPath = path.resolve(record.rootPath);
  const lastOpenedAt = record.lastOpenedAt ?? new Date();
  mkdirSync(path.join(rootPath, ".kith"), { recursive: true });
  registry().prepare(`
    INSERT INTO workspaces (id, name, root_path, last_opened_at)
    VALUES (@id, @name, @rootPath, @lastOpenedAt)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      root_path = excluded.root_path,
      last_opened_at = excluded.last_opened_at
  `).run({ id: record.id, name: record.name, rootPath, lastOpenedAt: lastOpenedAt.getTime() });
  return { id: record.id, name: record.name, rootPath, lastOpenedAt };
}

export function touchWorkspace(workspaceId: string): void {
  registry().prepare("UPDATE workspaces SET last_opened_at = ? WHERE id = ?").run(Date.now(), workspaceId);
}

export function renameWorkspace(workspaceId: string, name: string): void {
  registry().prepare("UPDATE workspaces SET name = ?, last_opened_at = ? WHERE id = ?").run(name, Date.now(), workspaceId);
}

export function unregisterWorkspace(workspaceId: string): void {
  closeWorkspaceDb(workspaceId);
  registry().prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
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
  registryConnection?.sqlite.close();
  registryConnection = undefined;
}

export { schema };
