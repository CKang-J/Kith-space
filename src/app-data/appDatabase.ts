import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { appDbFile } from "../paths.js";

const MAX_HUMAN_NAME = 64;
const MAX_HUMAN_EMAIL = 254;
const MAX_HUMAN_DESCRIPTION = 3000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AppDataErrorCode =
  | "HUMAN_ALREADY_INITIALIZED"
  | "HUMAN_NOT_INITIALIZED"
  | "HUMAN_NAME_INVALID"
  | "HUMAN_EMAIL_INVALID"
  | "HUMAN_DESCRIPTION_INVALID";

export class AppDataError extends Error {
  constructor(public readonly code: AppDataErrorCode, message: string) {
    super(message);
    this.name = "AppDataError";
  }
}

export interface HumanProfile {
  id: string;
  name: string;
  email: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpaceRecord {
  id: string;
  name: string;
  slug: string;
  rootPath: string;
  lastOpenedAt: Date;
}

interface AppConnection {
  sqlite: Database.Database;
  dbPath: string;
}

let connection: AppConnection | undefined;

/** Internal app-data connection shared by installation-level persistence adapters. */
export function appDataConnection(): Database.Database {
  const dbPath = path.resolve(appDbFile());
  if (connection?.dbPath === dbPath) return connection.sqlite;
  connection?.sqlite.close();
  connection = undefined;
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(`
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
    CREATE INDEX IF NOT EXISTS browser_sessions_revision_idx
      ON browser_sessions (token_revision);
    INSERT OR IGNORE INTO browser_access_settings (
      singleton_key, mode, port, access_token_hash, token_revision
    ) VALUES (1, 'off', 7777, NULL, 0);
    INSERT OR IGNORE INTO desktop_settings (
      singleton_key, close_behavior, launch_at_login
    ) VALUES (1, 'tray', 0);
  `);
  connection = { sqlite, dbPath };
  return sqlite;
}

function normalizeName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > MAX_HUMAN_NAME) {
    throw new AppDataError("HUMAN_NAME_INVALID", `Human name is required and must be at most ${MAX_HUMAN_NAME} characters`);
  }
  return name;
}

function normalizeEmail(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const email = typeof value === "string" ? value.trim() : "";
  if (!email || email.length > MAX_HUMAN_EMAIL || !EMAIL_RE.test(email)) {
    throw new AppDataError("HUMAN_EMAIL_INVALID", "Human email is invalid");
  }
  return email;
}

function normalizeDescription(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > MAX_HUMAN_DESCRIPTION) {
    throw new AppDataError("HUMAN_DESCRIPTION_INVALID", `Human description must be at most ${MAX_HUMAN_DESCRIPTION} characters`);
  }
  return value.trim() || null;
}

type HumanRow = {
  id: string;
  name: string;
  email: string | null;
  description: string | null;
  created_at: number;
  updated_at: number;
};

function mapHuman(row: HumanRow): HumanProfile {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    description: row.description,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function getHumanProfile(): HumanProfile | undefined {
  const row = appDataConnection().prepare(`
    SELECT id, name, email, description, created_at, updated_at
    FROM human_profile WHERE singleton_key = 1
  `).get() as HumanRow | undefined;
  return row ? mapHuman(row) : undefined;
}

export function initializeHumanProfile(input: {
  id?: string;
  name: string;
  email?: string | null;
  description?: string | null;
}): HumanProfile {
  if (getHumanProfile()) {
    throw new AppDataError("HUMAN_ALREADY_INITIALIZED", "Human profile already initialized");
  }
  const now = Date.now();
  const values = {
    id: input.id ?? randomUUID(),
    name: normalizeName(input.name),
    email: normalizeEmail(input.email),
    description: normalizeDescription(input.description),
    createdAt: now,
    updatedAt: now,
  };
  appDataConnection().prepare(`
    INSERT INTO human_profile (singleton_key, id, name, email, description, created_at, updated_at)
    VALUES (1, @id, @name, @email, @description, @createdAt, @updatedAt)
  `).run(values);
  return getHumanProfile()!;
}

export function updateHumanProfile(input: {
  name?: string;
  email?: string | null;
  description?: string | null;
}): HumanProfile {
  const current = getHumanProfile();
  if (!current) throw new AppDataError("HUMAN_NOT_INITIALIZED", "Human profile is not initialized");
  const next = {
    name: input.name === undefined ? current.name : normalizeName(input.name),
    email: input.email === undefined ? current.email : normalizeEmail(input.email),
    description: input.description === undefined ? current.description : normalizeDescription(input.description),
    updatedAt: Date.now(),
  };
  appDataConnection().prepare(`
    UPDATE human_profile
    SET name = @name, email = @email, description = @description, updated_at = @updatedAt
    WHERE singleton_key = 1
  `).run(next);
  return getHumanProfile()!;
}

type SpaceRow = { id: string; name: string; slug: string; root_path: string; last_opened_at: number };

function mapSpace(row: SpaceRow): SpaceRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    rootPath: row.root_path,
    lastOpenedAt: new Date(row.last_opened_at),
  };
}

export function getSpaceRecord(spaceId: string): SpaceRecord | undefined {
  const row = appDataConnection().prepare(`
    SELECT id, name, slug, root_path, last_opened_at FROM spaces WHERE id = ?
  `).get(spaceId) as SpaceRow | undefined;
  return row ? mapSpace(row) : undefined;
}

export function getSpaceRecordBySlug(slug: string): SpaceRecord | undefined {
  const row = appDataConnection().prepare(`
    SELECT id, name, slug, root_path, last_opened_at FROM spaces WHERE slug = ?
  `).get(slug) as SpaceRow | undefined;
  return row ? mapSpace(row) : undefined;
}

export function listSpaceRecords(): SpaceRecord[] {
  const rows = appDataConnection().prepare(`
    SELECT id, name, slug, root_path, last_opened_at FROM spaces ORDER BY last_opened_at DESC
  `).all() as SpaceRow[];
  return rows.map(mapSpace);
}

export function registerSpace(record: {
  id: string;
  name: string;
  slug: string;
  rootPath: string;
  lastOpenedAt?: Date;
}): SpaceRecord {
  const rootPath = path.resolve(record.rootPath);
  const lastOpenedAt = record.lastOpenedAt ?? new Date();
  appDataConnection().prepare(`
    INSERT INTO spaces (id, name, slug, root_path, last_opened_at)
    VALUES (@id, @name, @slug, @rootPath, @lastOpenedAt)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      slug = excluded.slug,
      root_path = excluded.root_path,
      last_opened_at = excluded.last_opened_at
  `).run({ ...record, rootPath, lastOpenedAt: lastOpenedAt.getTime() });
  return { id: record.id, name: record.name, slug: record.slug, rootPath, lastOpenedAt };
}

export function touchSpace(spaceId: string): void {
  appDataConnection().prepare("UPDATE spaces SET last_opened_at = ? WHERE id = ?").run(Date.now(), spaceId);
}

export function renameSpace(spaceId: string, name: string): void {
  appDataConnection().prepare("UPDATE spaces SET name = ?, last_opened_at = ? WHERE id = ?").run(name, Date.now(), spaceId);
}

export function unregisterSpace(spaceId: string): void {
  appDataConnection().prepare("DELETE FROM spaces WHERE id = ?").run(spaceId);
}

export function closeAppDatabase(): void {
  connection?.sqlite.close();
  connection = undefined;
}
