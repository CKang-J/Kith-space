import { lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { listSpaceRecords, type SpaceRecord } from "../app-data/appDatabase.js";
import {
  assertCompatibleSpaceDatabase,
  SpaceDatabaseCompatibilityError,
} from "../db/spaceDatabaseCompatibility.js";
import { workspaceDbFile } from "../paths.js";

export type SpaceRootErrorCode =
  | "SPACE_ROOT_PATH_REQUIRED"
  | "SPACE_ROOT_NOT_ABSOLUTE"
  | "SPACE_ROOT_MISSING"
  | "SPACE_ROOT_NOT_DIRECTORY"
  | "SPACE_ROOT_ATTACH_REQUIRED"
  | "SPACE_ROOT_KITH_INVALID"
  | "SPACE_ROOT_DB_MISSING"
  | "SPACE_ROOT_DB_INVALID"
  | "SPACE_ROOT_DB_INCOMPATIBLE"
  | "SPACE_ROOT_SYMLINK_UNSUPPORTED"
  | "SPACE_MODE_INVALID"
  | "SPACE_ROOT_ALREADY_REGISTERED"
  | "SPACE_ID_ALREADY_REGISTERED"
  | "SPACE_ID_MISMATCH";

export class SpaceRootError extends Error {
  constructor(public readonly code: SpaceRootErrorCode, message: string) {
    super(message);
    this.name = "SpaceRootError";
  }
}

export interface SpaceRootIdentity {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string | null;
}

export type AttachedSpaceRoot =
  | { kind: "new"; rootPath: string }
  | { kind: "existing"; rootPath: string; identity: SpaceRootIdentity };

export type SpaceRootStatus =
  | { status: "ready"; identity: SpaceRootIdentity }
  | { status: "missing" | "error"; rootError: { code: SpaceRootErrorCode; message: string } };

function requiredAbsolutePath(value: unknown): string {
  const input = typeof value === "string" ? value.trim() : "";
  if (!input) throw new SpaceRootError("SPACE_ROOT_PATH_REQUIRED", "Space folder path is required");
  if (!path.isAbsolute(input)) {
    throw new SpaceRootError("SPACE_ROOT_NOT_ABSOLUTE", "Space folder path must be an absolute host path");
  }
  return path.resolve(input);
}

function missingPath(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

/** Resolve an existing host folder to its real absolute path without mutating it. */
export function normalizeExistingSpaceRoot(value: unknown): string {
  const resolved = requiredAbsolutePath(value);
  let realPath: string;
  try {
    realPath = realpathSync.native(resolved);
  } catch (error) {
    if (missingPath(error)) {
      throw new SpaceRootError(
        "SPACE_ROOT_MISSING",
        `Space folder is missing at ${resolved}. Restore it or use the relocate endpoint.`,
      );
    }
    throw error;
  }
  if (!statSync(realPath).isDirectory()) {
    throw new SpaceRootError("SPACE_ROOT_NOT_DIRECTORY", `Space root is not a directory: ${realPath}`);
  }
  return realPath;
}

function assertKithDirectory(rootPath: string): string | undefined {
  const kithPath = path.join(rootPath, ".kith");
  let info;
  try {
    info = lstatSync(kithPath);
  } catch (error) {
    if (missingPath(error)) return undefined;
    throw error;
  }
  if (info.isSymbolicLink()) {
    throw new SpaceRootError(
      "SPACE_ROOT_SYMLINK_UNSUPPORTED",
      `The .kith directory cannot be a symbolic link: ${kithPath}`,
    );
  }
  if (!info.isDirectory()) {
    throw new SpaceRootError("SPACE_ROOT_KITH_INVALID", `.kith is not a directory: ${kithPath}`);
  }
  return kithPath;
}

function readWorkspaceIdentity(rootPath: string): SpaceRootIdentity {
  const dbPath = workspaceDbFile(rootPath);
  let info;
  try {
    info = lstatSync(dbPath);
  } catch (error) {
    if (missingPath(error)) {
      throw new SpaceRootError(
        "SPACE_ROOT_DB_MISSING",
        `The .kith folder has no workspace.db at ${dbPath}. Back up the folder and repair it before attaching.`,
      );
    }
    throw error;
  }
  if (info.isSymbolicLink()) {
    throw new SpaceRootError(
      "SPACE_ROOT_SYMLINK_UNSUPPORTED",
      `workspace.db cannot be a symbolic link: ${dbPath}`,
    );
  }
  if (!info.isFile()) {
    throw new SpaceRootError("SPACE_ROOT_DB_INVALID", `workspace.db is not a regular file: ${dbPath}`);
  }

  let sqlite: Database.Database;
  try {
    sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    throw new SpaceRootError(
      "SPACE_ROOT_DB_INVALID",
      `workspace.db at ${dbPath} cannot be opened. Back it up and repair it before attaching.`,
    );
  }
  try {
    try {
      assertCompatibleSpaceDatabase(sqlite, dbPath);
    } catch (error) {
      if (!(error instanceof SpaceDatabaseCompatibilityError)) throw error;
      throw new SpaceRootError(
        error.reason === "integrity" ? "SPACE_ROOT_DB_INVALID" : "SPACE_ROOT_DB_INCOMPATIBLE",
        `${error.message}. Back it up before repair or rebuild.`,
      );
    }
    const rows = sqlite.prepare(`
      SELECT id, name, slug, avatar_url AS avatarUrl FROM spaces
    `).all() as SpaceRootIdentity[];
    if (
      rows.length !== 1
      || !rows[0]?.id?.trim()
      || !rows[0]?.name?.trim()
      || !rows[0]?.slug?.trim()
    ) {
      throw new SpaceRootError(
        "SPACE_ROOT_DB_INVALID",
        `workspace.db at ${dbPath} must contain exactly one valid Space identity. Back it up and repair it before attaching.`,
      );
    }
    return { ...rows[0], avatarUrl: rows[0].avatarUrl ?? null };
  } catch (error) {
    if (error instanceof SpaceRootError) throw error;
    throw new SpaceRootError(
      "SPACE_ROOT_DB_INVALID",
      `workspace.db at ${dbPath} cannot be read. Back it up and repair it before attaching.`,
    );
  } finally {
    sqlite.close();
  }
}

/** Inspect an existing user-selected folder. This function never creates or deletes files. */
export function inspectAttachedSpaceRoot(value: unknown): AttachedSpaceRoot {
  const rootPath = normalizeExistingSpaceRoot(value);
  const kithPath = assertKithDirectory(rootPath);
  if (!kithPath) return { kind: "new", rootPath };
  return { kind: "existing", rootPath, identity: readWorkspaceIdentity(rootPath) };
}

/** Create a brand-new default root. Existing folders require the explicit attach flow. */
export function createDefaultSpaceRoot(value: unknown): string {
  const rootPath = requiredAbsolutePath(value);
  try {
    lstatSync(rootPath);
    throw new SpaceRootError(
      "SPACE_ROOT_ATTACH_REQUIRED",
      `The default Space folder already exists at ${rootPath}. Attach it explicitly so existing files are not overwritten.`,
    );
  } catch (error) {
    if (error instanceof SpaceRootError) throw error;
    if (!missingPath(error)) throw error;
  }
  mkdirSync(path.dirname(rootPath), { recursive: true });
  mkdirSync(rootPath);
  const normalized = normalizeExistingSpaceRoot(rootPath);
  mkdirSync(path.join(normalized, ".kith"));
  return normalized;
}

/** Initialize metadata in a verified ordinary folder; never removes or replaces existing entries. */
export function initializeAttachedSpaceRoot(rootPath: string): void {
  const normalized = normalizeExistingSpaceRoot(rootPath);
  if (assertKithDirectory(normalized)) {
    throw new SpaceRootError(
      "SPACE_ROOT_KITH_INVALID",
      `The selected folder gained a .kith entry before initialization: ${normalized}`,
    );
  }
  mkdirSync(path.join(normalized, ".kith"));
}

function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function registeredPathKey(record: SpaceRecord): string {
  try {
    return pathKey(normalizeExistingSpaceRoot(record.rootPath));
  } catch {
    return pathKey(record.rootPath);
  }
}

export function assertSpaceRootAvailable(rootPath: string, allowedSpaceId?: string): void {
  const incoming = pathKey(rootPath);
  const owner = listSpaceRecords().find((record) => (
    record.id !== allowedSpaceId && registeredPathKey(record) === incoming
  ));
  if (owner) {
    throw new SpaceRootError(
      "SPACE_ROOT_ALREADY_REGISTERED",
      `Space folder is already registered by ${owner.name} (${owner.id}): ${rootPath}`,
    );
  }
}

export function assertSpaceIdAvailable(spaceId: string): void {
  const owner = listSpaceRecords().find((record) => record.id === spaceId);
  if (owner) {
    throw new SpaceRootError(
      "SPACE_ID_ALREADY_REGISTERED",
      `Space identity is already registered at ${owner.rootPath}: ${spaceId}. Use the relocate endpoint if the folder moved.`,
    );
  }
}

export function inspectRegisteredSpaceRoot(record: SpaceRecord): SpaceRootStatus {
  try {
    const attached = inspectAttachedSpaceRoot(record.rootPath);
    if (attached.kind !== "existing") {
      throw new SpaceRootError(
        "SPACE_ROOT_DB_MISSING",
        `Registered Space has no .kith/workspace.db at ${record.rootPath}. Restore it or relocate the Space.`,
      );
    }
    if (attached.identity.id !== record.id) {
      throw new SpaceRootError(
        "SPACE_ID_MISMATCH",
        `The folder at ${attached.rootPath} belongs to Space ${attached.identity.id}, not ${record.id}. Select the matching folder.`,
      );
    }
    return { status: "ready", identity: attached.identity };
  } catch (error) {
    if (!(error instanceof SpaceRootError)) {
      return {
        status: "error",
        rootError: {
          code: "SPACE_ROOT_DB_INVALID",
          message: `Space folder at ${record.rootPath} could not be inspected. Restore it or select another folder.`,
        },
      };
    }
    return {
      status: error.code === "SPACE_ROOT_MISSING" ? "missing" : "error",
      rootError: { code: error.code, message: error.message },
    };
  }
}
