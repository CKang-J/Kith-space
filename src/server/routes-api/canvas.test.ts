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
