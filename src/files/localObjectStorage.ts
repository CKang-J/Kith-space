// Local-only attachment object storage, rooted inside each registered Space.
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
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
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (data: Buffer) => { size += data.length; });
    const output = createWriteStream(path.join(uploads, key));
    output.on("close", resolve);
    output.on("error", reject);
    stream.pipe(output);
  });
  return { key, size };
}

export async function readObject(spaceId: string, key: string): Promise<Buffer> {
  return readFile(localObjectPath(spaceId, key));
}

export async function deleteObject(spaceId: string, key: string): Promise<void> {
  await rm(localObjectPath(spaceId, key), { force: true });
}
