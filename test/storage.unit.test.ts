// Unit contract for the local-only attachment object store.
// Run: npx tsx --test --test-force-exit test/storage.unit.test.ts
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const root = await mkdtemp(path.join(tmpdir(), "kith-storage-"));
const uploads = path.join(root, "uploads");
const previousUploadDir = process.env.KITH_SPACE_UPLOAD_DIR;
const previousStorageDriver = process.env.KITH_SPACE_STORAGE;

process.env.KITH_SPACE_UPLOAD_DIR = uploads;
// Legacy configuration must no longer switch attachment storage away from disk.
process.env.KITH_SPACE_STORAGE = "s3";

const { readObject, saveObject } = await import("../src/server/storage.ts");

after(async () => {
  if (previousUploadDir === undefined) delete process.env.KITH_SPACE_UPLOAD_DIR;
  else process.env.KITH_SPACE_UPLOAD_DIR = previousUploadDir;
  if (previousStorageDriver === undefined) delete process.env.KITH_SPACE_STORAGE;
  else process.env.KITH_SPACE_STORAGE = previousStorageDriver;
  await rm(root, { recursive: true, force: true });
});

test("saveObject persists to local disk even when the legacy S3 driver variable is set", async () => {
  const body = Buffer.from("local attachment contents");

  const saved = await saveObject("quarterly report?.txt", Readable.from([body]));

  assert.equal(saved.size, body.length);
  assert.match(saved.key, /^[0-9a-f-]{36}__quarterly_report_.txt$/);
  assert.deepEqual(await readObject(saved.key), body);
});

test("readObject rejects keys that escape the upload directory", async () => {
  await mkdir(uploads, { recursive: true });
  await writeFile(path.join(root, "outside.txt"), "must stay outside");

  await assert.rejects(readObject("../outside.txt"), /invalid storage key/i);
  assert.equal(await readFile(path.join(root, "outside.txt"), "utf8"), "must stay outside");
});
