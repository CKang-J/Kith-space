// Local-only attachment object storage. Keys are opaque flat filenames under uploadsDir().
import { createWriteStream } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { uploadsDir } from "../paths.js";

const LOCAL_DIR = uploadsDir();

export interface Saved { key: string; size: number }

function localObjectPath(key: string): string {
  if (!key || path.isAbsolute(key) || key.includes("/") || key.includes("\\") || path.basename(key) !== key) {
    throw new Error("Invalid storage key: expected a local attachment filename");
  }
  return path.join(LOCAL_DIR, key);
}

/** Stream-save an object and return its local storage key plus byte count. */
export async function saveObject(filename: string, stream: Readable): Promise<Saved> {
  const safe = (filename || "file").replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
  const key = `${randomUUID()}__${safe}`;
  await mkdir(LOCAL_DIR, { recursive: true });
  let size = 0;
  await new Promise<void>((res, rej) => {
    stream.on("data", (d: Buffer) => { size += d.length; });
    const ws = createWriteStream(path.join(LOCAL_DIR, key));
    ws.on("close", () => res()); ws.on("error", rej);
    stream.pipe(ws);
  });
  return { key, size };
}

export async function readObject(key: string): Promise<Buffer> {
  return readFile(localObjectPath(key));
}
