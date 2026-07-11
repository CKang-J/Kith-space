// Regression contract for multipart uploads backed by the local attachment store.
// Run: npx tsx --test --test-force-exit test/attachments.unit.test.ts
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const root = await mkdtemp(path.join(tmpdir(), "kith-attachments-"));
const uploads = path.join(root, "uploads");
const previousUploadDir = process.env.KITH_SPACE_UPLOAD_DIR;

process.env.KITH_SPACE_UPLOAD_DIR = uploads;
const { parseUpload } = await import("../src/server/attachments.ts");
const { readObject } = await import("../src/server/storage.ts");

after(async () => {
  if (previousUploadDir === undefined) delete process.env.KITH_SPACE_UPLOAD_DIR;
  else process.env.KITH_SPACE_UPLOAD_DIR = previousUploadDir;
  await rm(root, { recursive: true, force: true });
});

function uploadRequest(contents: string): Readable & { headers: Record<string, string> } {
  const boundary = "----kithTestBoundary";
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="channelId"\r\n\r\nchannel-1\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="t.txt"\r\nContent-Type: text/plain\r\n\r\n${contents}\r\n` +
    `--${boundary}--\r\n`,
  );
  const req = Readable.from([body]) as Readable & { headers: Record<string, string> };
  req.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
  return req;
}

test("parseUpload stores multipart files in the local attachment store", async () => {
  const result = await parseUpload(uploadRequest("hello-bytes") as any);

  assert.deepEqual(result.fields, { channelId: "channel-1" });
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0]!.filename, "t.txt");
  assert.equal(result.files[0]!.mimeType, "text/plain");
  assert.equal(result.files[0]!.size, Buffer.byteLength("hello-bytes"));
  assert.equal((await readObject(result.files[0]!.storageKey)).toString(), "hello-bytes");
});

test("parseUpload rejects instead of hanging when local storage fails before consuming the stream", { timeout: 8000 }, async () => {
  await rm(uploads, { recursive: true, force: true });
  await writeFile(uploads, "a file blocks creation of the upload directory");

  await assert.rejects(parseUpload(uploadRequest("will-fail") as any), { code: "EEXIST" });
  assert.equal(await readFile(uploads, "utf8"), "a file blocks creation of the upload directory");
});
