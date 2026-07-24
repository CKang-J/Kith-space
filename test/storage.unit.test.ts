// Unit contract for Space-scoped local attachment object storage.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const home = await mkdtemp(path.join(tmpdir(), "kith-storage-home-"));
const spaceARoot = await mkdtemp(path.join(tmpdir(), "kith-storage-space-a-"));
const spaceBRoot = await mkdtemp(path.join(tmpdir(), "kith-storage-space-b-"));
const legacyUploadOverride = path.join(home, "legacy-upload-override");
const previousHome = process.env.KITH_SPACE_HOME;
const previousUploadDir = process.env.KITH_SPACE_UPLOAD_DIR;
const previousStorageDriver = process.env.KITH_SPACE_STORAGE;

process.env.KITH_SPACE_HOME = home;
process.env.KITH_SPACE_UPLOAD_DIR = legacyUploadOverride;
process.env.KITH_SPACE_STORAGE = "s3";

const { closeAppDatabase, registerSpace } = await import("../src/app-data/appDatabase.ts");
const { spaceUploadsDir } = await import("../src/paths.ts");
const { readObject, saveObject } = await import("../src/files/localObjectStorage.ts");

const spaceA = "storage-space-a";
const spaceB = "storage-space-b";
registerSpace({ id: spaceA, name: "Storage A", slug: spaceA, rootPath: spaceARoot });
registerSpace({ id: spaceB, name: "Storage B", slug: spaceB, rootPath: spaceBRoot });

after(async () => {
  closeAppDatabase();
  if (previousHome === undefined) delete process.env.KITH_SPACE_HOME;
  else process.env.KITH_SPACE_HOME = previousHome;
  if (previousUploadDir === undefined) delete process.env.KITH_SPACE_UPLOAD_DIR;
  else process.env.KITH_SPACE_UPLOAD_DIR = previousUploadDir;
  if (previousStorageDriver === undefined) delete process.env.KITH_SPACE_STORAGE;
  else process.env.KITH_SPACE_STORAGE = previousStorageDriver;
  await Promise.all([
    rm(home, { recursive: true, force: true }),
    rm(spaceARoot, { recursive: true, force: true }),
    rm(spaceBRoot, { recursive: true, force: true }),
  ]);
});

test("saveObject persists under the registered Space root and ignores app-level upload overrides", async () => {
  const body = Buffer.from("local attachment contents");

  const saved = await saveObject(spaceA, "quarterly report?.txt", Readable.from([body]));

  assert.equal(saved.size, body.length);
  assert.match(saved.key, /^[0-9a-f-]{36}__quarterly_report_.txt$/);
  assert.deepEqual(await readObject(spaceA, saved.key), body);
  await assert.rejects(access(path.join(home, "uploads", saved.key)), { code: "ENOENT" });
  await assert.rejects(access(path.join(legacyUploadOverride, saved.key)), { code: "ENOENT" });
});

test("the same flat key resolves independently inside two Space roots", async () => {
  const key = "shared-key.txt";
  await mkdir(spaceUploadsDir(spaceARoot), { recursive: true });
  await mkdir(spaceUploadsDir(spaceBRoot), { recursive: true });
  await writeFile(path.join(spaceUploadsDir(spaceARoot), key), "space-a");
  await writeFile(path.join(spaceUploadsDir(spaceBRoot), key), "space-b");

  assert.equal((await readObject(spaceA, key)).toString(), "space-a");
  assert.equal((await readObject(spaceB, key)).toString(), "space-b");
});

test("storage rejects unknown Spaces and flat keys that escape the Space upload directory", async () => {
  await writeFile(path.join(spaceARoot, "outside.txt"), "must stay outside");

  await assert.rejects(readObject("missing-space", "file.txt"), /Space not registered/i);
  await assert.rejects(saveObject("missing-space", "file.txt", Readable.from(["x"])), /Space not registered/i);
  await assert.rejects(readObject(spaceA, "../outside.txt"), /invalid storage key/i);
  assert.equal(await readFile(path.join(spaceARoot, "outside.txt"), "utf8"), "must stay outside");
});
