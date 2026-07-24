// Regression contract for multipart uploads backed by Space-scoped local storage.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const home = await mkdtemp(path.join(tmpdir(), "kith-attachments-home-"));
const spaceRoot = await mkdtemp(path.join(tmpdir(), "kith-attachments-space-"));
const previousHome = process.env.KITH_SPACE_HOME;
const previousUploadDir = process.env.KITH_SPACE_UPLOAD_DIR;
process.env.KITH_SPACE_HOME = home;
process.env.KITH_SPACE_UPLOAD_DIR = path.join(home, "must-not-be-used");

const { closeAppDatabase, registerSpace } = await import("../src/app-data/appDatabase.ts");
const { spaceUploadsDir } = await import("../src/paths.ts");
const { parseUpload } = await import("../src/server/attachments.ts");
const { readObject } = await import("../src/files/localObjectStorage.ts");
const spaceId = "attachments-unit-space";
registerSpace({ id: spaceId, name: "Attachments", slug: spaceId, rootPath: spaceRoot });

after(async () => {
  closeAppDatabase();
  if (previousHome === undefined) delete process.env.KITH_SPACE_HOME;
  else process.env.KITH_SPACE_HOME = previousHome;
  if (previousUploadDir === undefined) delete process.env.KITH_SPACE_UPLOAD_DIR;
  else process.env.KITH_SPACE_UPLOAD_DIR = previousUploadDir;
  await Promise.all([
    rm(home, { recursive: true, force: true }),
    rm(spaceRoot, { recursive: true, force: true }),
  ]);
});

function uploadRequest(contents: string, filename = "t.txt"): Readable & { headers: Record<string, string> } {
  const boundary = "----kithTestBoundary";
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="channelId"\r\n\r\nchannel-1\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${contents}\r\n` +
    `--${boundary}--\r\n`,
  );
  const req = Readable.from([body]) as Readable & { headers: Record<string, string> };
  req.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
  return req;
}

function abortedUploadRequest(): Readable & { headers: Record<string, string> } {
  const boundary = "----kithAbortBoundary";
  const partial = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="partial.bin"\r\nContent-Type: application/octet-stream\r\n\r\npartial-content`,
  );
  let sent = false;
  const req = new Readable({
    read() {
      if (sent) return;
      sent = true;
      this.push(partial);
      setImmediate(() => this.destroy(new Error("client aborted")));
    },
  }) as Readable & { headers: Record<string, string> };
  req.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
  return req;
}

function multiUploadRequest(count: number): Readable & { headers: Record<string, string> } {
  const boundary = "----kithMultiBoundary";
  const parts = Array.from({ length: count }, (_, index) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="file-${index}.txt"\r\nContent-Type: text/plain\r\n\r\ncontent-${index}\r\n`).join("");
  const req = Readable.from([Buffer.from(`${parts}--${boundary}--\r\n`)]) as Readable & { headers: Record<string, string> };
  req.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
  return req;
}

test("parseUpload stores multipart files inside the authenticated Space", async () => {
  const result = await parseUpload(spaceId, uploadRequest("hello-bytes") as any);

  assert.deepEqual(result.fields, { channelId: "channel-1" });
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0]!.filename, "t.txt");
  assert.equal(result.files[0]!.mimeType, "text/plain");
  assert.equal(result.files[0]!.size, Buffer.byteLength("hello-bytes"));
  assert.equal((await readObject(spaceId, result.files[0]!.storageKey)).toString(), "hello-bytes");
});

test("parseUpload preserves UTF-8 filenames sent by browsers", async () => {
  const filename = "Loop-Engineering橙皮书-v260615.pdf";
  const result = await parseUpload(spaceId, uploadRequest("pdf-bytes", filename) as any);

  assert.equal(result.files[0]!.filename, filename);
});

test("parseUpload rejects oversized files without retaining the truncated object", async () => {
  const uploads = spaceUploadsDir(spaceRoot);
  const before = new Set(await readdir(uploads));
  await assert.rejects(
    parseUpload(spaceId, uploadRequest("x".repeat(26 * 1024 * 1024), "oversized.bin") as any),
    /25 MiB upload limit/,
  );
  assert.deepEqual(new Set(await readdir(uploads)), before);
});

test("parseUpload preserves multipart order and rejects an eleventh file as one failed batch", async () => {
  const ordered = await parseUpload(spaceId, multiUploadRequest(3) as any);
  assert.deepEqual(ordered.files.map((file) => file.filename), ["file-0.txt", "file-1.txt", "file-2.txt"]);
  const uploads = spaceUploadsDir(spaceRoot);
  const before = new Set(await readdir(uploads));
  await assert.rejects(parseUpload(spaceId, multiUploadRequest(11) as any), /10 file limit/);
  assert.deepEqual(new Set(await readdir(uploads)), before);
});

test("parseUpload rejects an aborted request and removes its partial object", { timeout: 2_000 }, async () => {
  const uploads = spaceUploadsDir(spaceRoot);
  const before = new Set(await readdir(uploads));
  await assert.rejects(parseUpload(spaceId, abortedUploadRequest() as any), /client aborted/);
  assert.deepEqual(new Set(await readdir(uploads)), before);
});

test("parseUpload rejects instead of hanging when Space storage fails before consuming the stream", { timeout: 8000 }, async () => {
  const uploads = spaceUploadsDir(spaceRoot);
  await rm(uploads, { recursive: true, force: true });
  await writeFile(uploads, "a file blocks creation of the upload directory");

  await assert.rejects(parseUpload(spaceId, uploadRequest("will-fail") as any), { code: "EEXIST" });
  assert.equal(await readFile(uploads, "utf8"), "a file blocks creation of the upload directory");
});
