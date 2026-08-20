// Local-only attachment object storage, rooted inside each registered Space.
import { randomUUID } from "node:crypto";
import { createWriteStream, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getSpaceRecord } from "../app-data/appDatabase.js";
import { spaceUploadsDir } from "../paths.js";

export interface SavedObject {
  key: string;
  size: number;
}

function uploadsForSpace(spaceId: string): string {
  const space = getSpaceRecord(spaceId);
  if (!space) throw new Error(`Space not registered: ${spaceId}`);
  return spaceUploadsDir(space.rootPath);
}

function localObjectPath(spaceId: string, key: string): string {
  if (!key || path.isAbsolute(key) || key.includes("/") || key.includes("\\") || path.basename(key) !== key) {
    throw new Error("Invalid storage key: expected a local attachment filename");
  }
  return path.join(uploadsForSpace(spaceId), key);
}

export async function saveObject(spaceId: string, filename: string, stream: Readable): Promise<SavedObject> {
  const safe = (filename || "file").replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
  const key = `${randomUUID()}__${safe}`;
  const uploads = uploadsForSpace(spaceId);
  await mkdir(uploads, { recursive: true });
  let size = 0;
  const objectPath = path.join(uploads, key);
  try {
    stream.on("data", (data: Buffer) => { size += data.length; });
    await pipeline(stream, createWriteStream(objectPath));
  } catch (error) {
    await rm(objectPath, { force: true }).catch(() => {});
    throw error;
  }
  return { key, size };
}

export async function readObject(spaceId: string, key: string): Promise<Buffer> {
  return readFile(localObjectPath(spaceId, key));
}

/** Sync read for Gateway/Canvas paths that already run inside a SQLite transaction. */
export function readObjectSync(spaceId: string, key: string): Buffer {
  return readFileSync(localObjectPath(spaceId, key));
}

export async function deleteObject(spaceId: string, key: string): Promise<void> {
  await rm(localObjectPath(spaceId, key), { force: true });
}

export async function listObjects(spaceId: string): Promise<Array<{ key: string; modifiedAt: number }>> {
  const directory = uploadsForSpace(spaceId);
  let keys: string[];
  try { keys = await readdir(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const objects: Array<{ key: string; modifiedAt: number }> = [];
  for (const key of keys) {
    try {
      const info = await stat(localObjectPath(spaceId, key));
      if (info.isFile()) objects.push({ key, modifiedAt: info.mtimeMs });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return objects;
}
