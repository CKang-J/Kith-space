import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { appDbFile } from "../paths.js";
import { migrateAppDatabase } from "./appDatabaseMigrations.js";

const MAX_HUMAN_NAME = 64;
const MAX_HUMAN_EMAIL = 254;
const MAX_HUMAN_DESCRIPTION = 3000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AppDataErrorCode =
  | "HUMAN_ALREADY_INITIALIZED"
  | "HUMAN_NOT_INITIALIZED"
  | "HUMAN_NAME_INVALID"
  | "HUMAN_EMAIL_INVALID"
  | "HUMAN_DESCRIPTION_INVALID"
  | "HOME_SPACE_NOT_FOUND"
  | "HOME_SPACE_ALREADY_INITIALIZED"
  | "HOME_SPACE_CANNOT_UNREGISTER";

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
  const freshInstall = !existsSync(dbPath);
  const sqlite = new Database(dbPath);
  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("secure_delete = ON");
    sqlite.pragma("busy_timeout = 5000");
    migrateAppDatabase(sqlite, dbPath, { freshInstall });
    sqlite.pragma("journal_mode = WAL");
  } catch (error) {
    sqlite.close();
    throw error;
  }
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

export function getHomeSpaceId(): string | undefined {
  const row = appDataConnection().prepare(`
    SELECT home_space_id FROM installation_state WHERE singleton_key = 1
  `).get() as { home_space_id: string | null } | undefined;
  return row?.home_space_id ?? undefined;
}

/** Stable installation-local key used only for irreversible context lineage HMACs. */
export function getContentHmacKey(): Buffer {
  const value = appDataConnection().prepare(`
    SELECT content_hmac_key FROM installation_state WHERE singleton_key = 1
  `).pluck().get();
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("installation content HMAC key is unavailable");
  }
  return Buffer.from(value, "hex");
}

export function getHomeSpaceRecord(): SpaceRecord | undefined {
  const homeSpaceId = getHomeSpaceId();
  return homeSpaceId ? getSpaceRecord(homeSpaceId) : undefined;
}

export function setHomeSpaceId(spaceId: string): SpaceRecord {
  const home = getSpaceRecord(spaceId);
  if (!home) {
    throw new AppDataError("HOME_SPACE_NOT_FOUND", `Home Space is not registered: ${spaceId}`);
  }
  const currentHomeSpaceId = getHomeSpaceId();
  if (currentHomeSpaceId && currentHomeSpaceId !== spaceId) {
    throw new AppDataError(
      "HOME_SPACE_ALREADY_INITIALIZED",
      `Home Space is already initialized: ${currentHomeSpaceId}`,
    );
  }
  if (!currentHomeSpaceId) {
    appDataConnection().prepare(`
      UPDATE installation_state SET home_space_id = ? WHERE singleton_key = 1
    `).run(spaceId);
  }
  return home;
}

export function registerHomeSpace(record: {
  id: string;
  name: string;
  slug: string;
  rootPath: string;
  lastOpenedAt?: Date;
}): SpaceRecord {
  const sqlite = appDataConnection();
  const claimHome = sqlite.transaction(() => {
    const currentHome = getHomeSpaceRecord();
    if (currentHome) return currentHome;
    const home = registerSpace(record);
    setHomeSpaceId(home.id);
    return home;
  });
  return claimHome.immediate();
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

/** Insert a newly discovered Space without the upsert semantics used by legacy/internal callers. */
export function insertSpaceRecord(record: {
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
  `).run({ ...record, rootPath, lastOpenedAt: lastOpenedAt.getTime() });
  return { id: record.id, name: record.name, slug: record.slug, rootPath, lastOpenedAt };
}

/** Change only the host folder associated with an existing stable Space identity. */
export function updateSpaceRootPath(spaceId: string, rootPath: string): SpaceRecord | undefined {
  const normalized = path.resolve(rootPath);
  const result = appDataConnection().prepare(`
    UPDATE spaces SET root_path = ?, last_opened_at = ? WHERE id = ?
  `).run(normalized, Date.now(), spaceId);
  return result.changes === 1 ? getSpaceRecord(spaceId) : undefined;
}

export function touchSpace(spaceId: string): void {
  appDataConnection().prepare("UPDATE spaces SET last_opened_at = ? WHERE id = ?").run(Date.now(), spaceId);
}

export function renameSpace(spaceId: string, name: string): void {
  appDataConnection().prepare("UPDATE spaces SET name = ?, last_opened_at = ? WHERE id = ?").run(name, Date.now(), spaceId);
}

export function unregisterSpace(spaceId: string): void {
  if (getHomeSpaceId() === spaceId) {
    throw new AppDataError("HOME_SPACE_CANNOT_UNREGISTER", "Home Space cannot be unregistered");
  }
  appDataConnection().prepare("DELETE FROM spaces WHERE id = ?").run(spaceId);
}

export function closeAppDatabase(): void {
  connection?.sqlite.close();
  connection = undefined;
}
