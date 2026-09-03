import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { CanvasAssetStore } from "../../canvas/canvasAssetStore.js";
import { CanvasCore } from "../../canvas/canvasCore.js";
import { closeSpaceDb, dbForSpace, registerSpace, unregisterSpace } from "../../db/index.js";
import { kithSpaceHome } from "../../paths.js";
import { handleCanvasAssetResolver } from "./canvas.js";

test("immutable Canvas resolver never returns bytes that fail the per-read hash", () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "canvas-resolver-test", spaceId);
  registerSpace({ id: spaceId, name: "Canvas Resolver", slug: `canvas-resolver-${spaceId}`, rootPath });
  try {
    const db = dbForSpace(spaceId);
    const canvas = new CanvasCore(db, spaceId).create({ title: "Resolver", document: { deltaSetLike: { ROOT: { children: [] } }, frames: [] } });
    const store = new CanvasAssetStore(db, spaceId, rootPath);
    const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32, 1)]);
    const asset = store.write({ canvasId: canvas.id, filename: "resolver.png", mimeType: "image/png", bytes });
    writeFileSync(store.filePath(asset), Buffer.concat([bytes.subarray(0, 8), Buffer.alloc(32, 9)]));

    let status = 0;
    const responseChunks: Buffer[] = [];
    const res = {
      writeHead(code: number) { status = code; return this; },
      end(chunk?: string | Buffer) { if (chunk) responseChunks.push(Buffer.from(chunk)); return this; },
    };
    const handled = handleCanvasAssetResolver({
      req: {} as never,
      res: res as never,
      url: new URL(`http://localhost/api/canvas-assets/${spaceId}/${canvas.id}/${asset.id}`),
      method: "GET",
      p: `/api/canvas-assets/${spaceId}/${canvas.id}/${asset.id}`,
      humanId: "human",
    });
    assert.equal(handled, true);
    assert.equal(status, 400);
    assert.equal(Buffer.concat(responseChunks).includes(Buffer.alloc(32, 9)), false);
    assert.match(Buffer.concat(responseChunks).toString("utf8"), /integrity/i);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("canvas asset resolver serves media bytes with single-range 206 support", () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "canvas-resolver-range-test", spaceId);
  registerSpace({ id: spaceId, name: "Canvas Resolver Range", slug: `canvas-resolver-range-${spaceId}`, rootPath });
  try {
    const db = dbForSpace(spaceId);
    const canvas = new CanvasCore(db, spaceId).create({ title: "Resolver Range", document: { deltaSetLike: { ROOT: { children: [] } }, frames: [] } });
    const store = new CanvasAssetStore(db, spaceId, rootPath);
    // Minimal mp4-shaped fixture: 24-byte ftyp box header so the store MIME sniff accepts it.
    const bytes = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from("ftypisom", "ascii"),
      Buffer.from([0x00, 0x00, 0x02, 0x00]),
      Buffer.from("isommp42", "ascii"),
      Buffer.alloc(16, 7),
    ]);
    const asset = store.write({ canvasId: canvas.id, filename: "clip.mp4", mimeType: "video/mp4", bytes });

    const call = (range?: string) => {
      let status = 0;
      let headers: Record<string, unknown> = {};
      const responseChunks: Buffer[] = [];
      const res = {
        writeHead(code: number, responseHeaders?: Record<string, unknown>) {
          status = code;
          headers = responseHeaders ?? {};
          return this;
        },
        end(chunk?: string | Buffer) { if (chunk) responseChunks.push(Buffer.from(chunk)); return this; },
      };
      const handled = handleCanvasAssetResolver({
        req: { headers: range ? { range } : {} } as never,
        res: res as never,
        url: new URL(`http://localhost/api/canvas-assets/${spaceId}/${canvas.id}/${asset.id}`),
        method: "GET",
        p: `/api/canvas-assets/${spaceId}/${canvas.id}/${asset.id}`,
        humanId: "human",
      });
      assert.equal(handled, true);
      return { status, headers, body: Buffer.concat(responseChunks) };
    };

    const full = call();
    assert.equal(full.status, 200);
    assert.equal(full.headers["content-type"], "video/mp4");
    assert.equal(full.headers["accept-ranges"], "bytes");
    assert.equal(full.headers["content-length"], "40");
    assert.deepEqual(full.body, bytes);

    const mid = call("bytes=4-9");
    assert.equal(mid.status, 206);
    assert.equal(mid.headers["content-range"], "bytes 4-9/40");
    assert.equal(mid.headers["content-length"], "6");
    assert.deepEqual(mid.body, bytes.subarray(4, 10));

    const suffix = call("bytes=-5");
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers["content-range"], "bytes 35-39/40");
    assert.deepEqual(suffix.body, bytes.subarray(35, 40));

    const openEnded = call("bytes=38-");
    assert.equal(openEnded.status, 206);
    assert.equal(openEnded.headers["content-range"], "bytes 38-39/40");

    const invalid = call("bytes=100-200");
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers["content-range"], "bytes */40");
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
