import assert from "node:assert/strict";
import path from "node:path";
import { once } from "node:events";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { kithSpaceHome } from "../paths.js";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { CanvasCore } from "./canvasCore.js";
import { CanvasAssetInUseError, CanvasAssetStore, CanvasAssetValidationError } from "./canvasAssetStore.js";
import { normalizeCanvasSceneImport, sanitizeCanvasSceneJson } from "./canvasImportService.js";

function fixture() {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "canvas-assets-test", spaceId);
  registerSpace({ id: spaceId, name: "Canvas Assets", slug: `canvas-assets-${spaceId}`, rootPath });
  const db = dbForSpace(spaceId);
  const canvas = new CanvasCore(db, spaceId).create({ title: "Assets", document: { deltaSetLike: { ROOT: { children: [] } }, frames: [] } });
  return {
    spaceId, rootPath, canvasId: canvas.id,
    store: new CanvasAssetStore(db, spaceId, rootPath),
    cleanup() { closeSpaceDb(spaceId); unregisterSpace(spaceId); },
  };
}

test("malicious SVG and Scene JSON are rejected without orphan files", () => {
  const f = fixture();
  try {
    assert.throws(() => f.store.write({
      canvasId: f.canvasId,
      filename: "attack.svg",
      mimeType: "image/svg+xml",
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    }), CanvasAssetValidationError);
    assert.throws(() => f.store.write({
      canvasId: f.canvasId,
      filename: "external.svg",
      mimeType: "image/svg+xml",
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="//example.invalid/pixel.png"/></svg>'),
    }), CanvasAssetValidationError);
    assert.throws(() => f.store.write({
      canvasId: f.canvasId,
      filename: "spoofed.png",
      mimeType: "image/png",
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    }), CanvasAssetValidationError);
    assert.equal(f.store.list(f.canvasId).length, 0);
    assert.throws(() => sanitizeCanvasSceneJson(JSON.stringify({
      deltaSetLike: { ROOT: { children: ["x"] }, x: { id: "x", key: "image", attrs: { src: "javascript:alert(1)" } } },
      frames: [],
    })), CanvasAssetValidationError);
    assert.throws(() => sanitizeCanvasSceneJson(JSON.stringify({
      deltaSetLike: { ROOT: { children: ["x"] }, x: { id: "x", key: "image", attrs: { src: "blob:ephemeral-import" } } },
      frames: [],
    })), CanvasAssetValidationError);
    assert.throws(() => sanitizeCanvasSceneJson(JSON.stringify({
      deltaSetLike: { ROOT: { children: ["missing"] }, x: { id: "x", key: "shape" } },
      frames: [],
    })), CanvasAssetValidationError);
    assert.throws(() => sanitizeCanvasSceneJson(JSON.stringify({
      deltaSetLike: {
        ROOT: { children: ["x"] },
        x: { id: "x", key: "group", children: ["y"] },
        y: { id: "y", key: "group", children: ["x"] },
      },
      frames: [],
    })), CanvasAssetValidationError);
    assert.throws(() => sanitizeCanvasSceneJson(JSON.stringify({
      width: "boom",
      height: 100,
      deltaSetLike: { ROOT: { children: [] } },
      frames: [{ id: "dup", x: 0, y: 0, width: 10, height: 10 }, { id: "dup", x: 1, y: 1, width: 10, height: 10 }],
      activeFrameId: "missing",
      stackOrder: ["node:missing", "frame:missing"],
    })), CanvasAssetValidationError);
    assert.doesNotThrow(() => sanitizeCanvasSceneJson(JSON.stringify({
      width: 100,
      height: 100,
      deltaSetLike: { ROOT: { children: ["x"] }, x: { id: "x", key: "image", attrs: { src: `/api/canvas-assets/${f.spaceId}/${f.canvasId}/asset-id` } } },
      frames: [],
    }), { spaceId: f.spaceId, assetExists: () => true }));
    assert.throws(() => sanitizeCanvasSceneJson(JSON.stringify({
      deltaSetLike: { ROOT: { children: ["x"] }, x: { id: "x", key: "image", attrs: { src: `/api/canvas-assets/another-space/${f.canvasId}/asset-id` } } },
      frames: [],
    }), { spaceId: f.spaceId }), CanvasAssetValidationError);
    assert.throws(() => sanitizeCanvasSceneJson(JSON.stringify({
      deltaSetLike: { ROOT: { children: ["x"] }, x: { id: "x", key: "image", attrs: { src: `/api/canvas-assets/${f.spaceId}/${f.canvasId}/missing` } } },
      frames: [],
    }), { spaceId: f.spaceId, assetExists: () => false }), CanvasAssetValidationError);
  } finally { f.cleanup(); }
});

test("Scene import remaps every external id and normalizes Page into the hidden ROOT", () => {
  const document = JSON.parse(readFileSync(new URL("../../web/src/features/canvas/fixtures/recombyn-empty-scene.json", import.meta.url), "utf8"));
  const source = {
    ...document,
    deltaSetLike: {
      ROOT: { ...document.deltaSetLike.ROOT, children: ["group-old"] },
      "group-old": { id: "group-old", key: "group", parentId: "ROOT", children: ["shape-old"] },
      "shape-old": { id: "shape-old", key: "shape", parentId: "group-old", frameId: "frame-old", children: [] },
    },
    frames: [{ id: "frame-old", x: 0, y: 0, width: 100, height: 100 }],
    activeFrameId: "frame-old",
    stackOrder: ["node:group-old", "frame:frame-old"],
    activePageId: "page-old",
    pages: [{ id: "page-old", children: ["group-old"] }],
  };
  const imported = normalizeCanvasSceneImport({ format: "kith-canvas-scene", version: 1, scene: source }) as any;
  assert.equal("pages" in imported, false);
  assert.equal("activePageId" in imported, false);
  const groupId = imported.deltaSetLike.ROOT.children[0];
  const shapeId = imported.deltaSetLike[groupId].children[0];
  const frameId = imported.frames[0].id;
  assert.notEqual(groupId, "group-old");
  assert.notEqual(shapeId, "shape-old");
  assert.notEqual(frameId, "frame-old");
  assert.equal(imported.deltaSetLike[groupId].id, groupId);
  assert.equal(imported.deltaSetLike[shapeId].parentId, groupId);
  assert.equal(imported.deltaSetLike[shapeId].frameId, frameId);
  assert.deepEqual(imported.stackOrder, [`node:${groupId}`, `frame:${frameId}`]);
  assert.equal(imported.activeFrameId, frameId);
  assert.doesNotThrow(() => normalizeCanvasSceneImport({ format: "kith-canvas-scene", version: 1, title: "Exported", scene: document }));
  assert.throws(() => normalizeCanvasSceneImport({ format: "kith-canvas-scene", version: 2, scene: document }), /unsupported/);
  assert.throws(() => normalizeCanvasSceneImport(document), /versioned/);
});

test("Scene import strips Core lifecycle state from ROOT, nodes, Frames, and attribute bags", () => {
  const imported = normalizeCanvasSceneImport({ format: "kith-canvas-scene", version: 1, scene: {
    width: 640,
    height: 480,
    deltaSetLike: {
      ROOT: { children: ["node-old"], revision: 91, lifecycle: "deleted", attrs: {
        sequence: 7,
        fill: "red",
        visual: [{ opacity: 0.5, revisions: { structure: 8 }, canvasId: "foreign" }],
      } },
      "node-old": {
        id: "node-old", key: "shape", parentId: "ROOT", children: [], x: 1, y: 2, width: 30, height: 40,
        attrs: {
          shapeType: "rect", mutation: { operationId: "external" }, fill: "blue",
          effects: [{ blur: 4, lifecycle: "deleted", metadataRevision: 12, spaceId: "foreign" }],
        },
        deletedAt: "2026-01-01", operationId: "external", revision: 42,
      },
    },
    frames: [{
      id: "frame-old", name: "Frame", x: 0, y: 0, width: 100, height: 100,
      backgroundColor: "#fff", sequence: 9, mutationId: "external", lifecycle: "deleted",
      fill: {
        type: "gradient",
        stops: [{ color: "#fff", offset: 0, revision: 3 }, { color: "#000", offset: 1, canvasId: "foreign" }],
        revisions: { frame: 4 },
        spaceId: "foreign",
      },
    }],
    stackOrder: ["node:node-old", "frame:frame-old"],
  } }) as any;

  const nodeId = imported.deltaSetLike.ROOT.children[0];
  assert.deepEqual(imported.deltaSetLike.ROOT.attrs, { fill: "red", visual: [{ opacity: 0.5 }] });
  assert.deepEqual(imported.deltaSetLike[nodeId].attrs, { shapeType: "rect", fill: "blue", effects: [{ blur: 4 }] });
  assert.equal(imported.deltaSetLike[nodeId].deletedAt, undefined);
  assert.equal(imported.deltaSetLike[nodeId].revision, undefined);
  assert.equal(imported.frames[0].sequence, undefined);
  assert.equal(imported.frames[0].lifecycle, undefined);
  assert.equal(imported.frames[0].name, "Frame");
  assert.deepEqual(imported.frames[0].fill, {
    type: "gradient",
    stops: [{ color: "#fff", offset: 0 }, { color: "#000", offset: 1 }],
  });
});

test("Scene export visual fields round-trip without widening the approved root or media boundary", () => {
  const f = fixture();
  const scene = {
    width: 640,
    height: 480,
    backgroundGradient: {
      type: "linear",
      angle: 45,
      stops: [{ color: "#fff", offset: 0 }, { color: "#000", offset: 1 }],
    },
    backgroundOpacity: 0.75,
    backgroundImageFit: "cover",
    backgroundImageRotate: 90,
    backgroundImageAdjust: { brightness: 1.1 },
    deltaSetLike: { ROOT: { children: [] } },
    frames: [],
  };
  try {
    const core = new CanvasCore(dbForSpace(f.spaceId), f.spaceId);
    const exported = core.exportScene(core.create({ title: "Visual round-trip", document: scene }).id);
    const imported = normalizeCanvasSceneImport(exported) as any;
    assert.deepEqual(imported.backgroundGradient, scene.backgroundGradient);
    assert.equal(imported.backgroundOpacity, 0.75);
    assert.equal(imported.backgroundImageFit, "cover");
    assert.equal(imported.backgroundImageRotate, 90);
    assert.deepEqual(imported.backgroundImageAdjust, { brightness: 1.1 });

    const stripped = normalizeCanvasSceneImport({ format: "kith-canvas-scene", version: 1, scene: {
      ...scene,
      backgroundGradient: {
        ...scene.backgroundGradient,
        revisions: { document: 4 },
        stops: [{ color: "#fff", offset: 0, lifecycle: "deleted" }, { color: "#000", offset: 1 }],
      },
      backgroundImageAdjust: { brightness: 1.1, metadataRevision: 8 },
    } }) as any;
    assert.deepEqual(stripped.backgroundGradient, scene.backgroundGradient);
    assert.deepEqual(stripped.backgroundImageAdjust, { brightness: 1.1 });

    for (const backgroundImageSrc of [
      "https://example.invalid/image.png",
      "data:image/png;base64,AAAA",
      "blob:ephemeral",
      "/Users/example/image.png",
      "/api/canvas-assets/space-a/canvas-a/asset-a",
    ]) {
      assert.throws(() => normalizeCanvasSceneImport({
        format: "kith-canvas-scene",
        version: 1,
        scene: { ...scene, backgroundImageSrc },
      }), /untrusted media URL|invalid asset reference/);
    }
    assert.throws(() => normalizeCanvasSceneImport({
      format: "kith-canvas-scene",
      version: 1,
      scene: { ...scene, backgroundImageSrc: "/api/canvas-assets/space-a/canvas-a/asset-a" },
    }, { spaceId: "space-a", assetExists: () => true }), /must be rebound/);
    assert.throws(() => normalizeCanvasSceneImport({
      format: "kith-canvas-scene",
      version: 1,
      scene: { ...scene, unknownVisualField: true },
    }), /root key is not allowed/);
  } finally { f.cleanup(); }
});

test("Scene import rejects assets that were not rebound to the new Canvas", () => {
  const f = fixture();
  try {
    const asset = f.store.write({
      canvasId: f.canvasId,
      filename: "source.png",
      mimeType: "image/png",
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    assert.throws(() => normalizeCanvasSceneImport({ format: "kith-canvas-scene", version: 1, scene: {
      width: 100,
      height: 100,
      deltaSetLike: {
        ROOT: { children: ["image-old"] },
        "image-old": { id: "image-old", key: "image", parentId: "ROOT", children: [], attrs: { src: `/api/canvas-assets/${f.spaceId}/${f.canvasId}/${asset.id}` } },
      },
      frames: [],
    } }, { spaceId: f.spaceId, assetExists: (canvasId, assetId) => f.store.has(canvasId, assetId) }), /must be rebound/);
  } finally { f.cleanup(); }
});

test("PNG magic-byte detection accepts a complete file rather than only an eight-byte prefix", () => {
  const f = fixture();
  try {
    const bytes = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.alloc(32, 1),
    ]);
    const asset = f.store.write({ canvasId: f.canvasId, filename: "complete.png", mimeType: "image/png", bytes });
    assert.deepEqual(f.store.read(f.canvasId, asset.id).bytes, bytes);
  } finally { f.cleanup(); }
});

test("every ready asset read rejects replacement, truncation, and same-size tampering", () => {
  for (const attack of ["replacement", "truncation", "same-size"] as const) {
    const f = fixture();
    try {
      const original = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32, 1)]);
      const asset = f.store.write({ canvasId: f.canvasId, filename: `${attack}.png`, mimeType: "image/png", bytes: original });
      const target = f.store.filePath(asset);
      if (attack === "replacement") {
        renameSync(target, `${target}.original`);
        writeFileSync(target, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32, 2)]));
      } else if (attack === "truncation") {
        writeFileSync(target, original.subarray(0, 8));
      } else {
        writeFileSync(target, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32, 3)]));
      }
      assert.throws(() => f.store.read(f.canvasId, asset.id), /integrity/i);
    } finally { f.cleanup(); }
  }
});

test("asset recovery closes DB/file crash windows without physically deleting unknown staging files", () => {
  const f = fixture();
  try {
    for (const failpoint of ["after-file", "after-db", "after-rename"] as const) {
      assert.throws(() => f.store.write({
        canvasId: f.canvasId,
        filename: `${failpoint}.png`,
        mimeType: "image/png",
        bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        failpoint,
      }));
    }
    f.store.recover();
    const assets = f.store.list(f.canvasId);
    assert.equal(assets.length, 2, "both durable rows recover while the unowned staging file is retained for future GC");
    assert.ok(assets.every((asset) => asset.state === "ready" && existsSync(f.store.filePath(asset))));
    const retainedStaging = path.join(f.rootPath, ".kith", "canvas-assets", ".staging");
    assert.ok(readdirSync(retainedStaging).length >= 3);
  } finally { f.cleanup(); }
});

test("a ready DB row recovers a rename that was not durably linked", () => {
  const f = fixture();
  try {
    const asset = f.store.write({
      canvasId: f.canvasId,
      filename: "rename-window.png",
      mimeType: "image/png",
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    const stagingPath = path.join(f.rootPath, ".kith", "canvas-assets", ".staging", `${asset.id}.tmp`);
    renameSync(f.store.filePath(asset), stagingPath);
    f.store.recover();
    assert.ok(existsSync(f.store.filePath(asset)));
    assert.equal(f.store.read(f.canvasId, asset.id).bytes.length, 8);
  } finally { f.cleanup(); }
});

test("recovery retains the verified staging duplicate for later safe GC", () => {
  const f = fixture();
  try {
    const asset = f.store.write({
      canvasId: f.canvasId,
      filename: "duplicate-window.png",
      mimeType: "image/png",
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    const stagingPath = path.join(f.rootPath, ".kith", "canvas-assets", ".staging", `${asset.id}.tmp`);
    copyFileSync(f.store.filePath(asset), stagingPath);
    f.store.recover();
    assert.ok(existsSync(f.store.filePath(asset)));
    assert.equal(existsSync(stagingPath), true);
  } finally { f.cleanup(); }
});

test("recovery redirects a verified staging copy around a partial final without deleting either path", () => {
  const f = fixture();
  try {
    const asset = f.store.write({
      canvasId: f.canvasId,
      filename: "partial-copy.png",
      mimeType: "image/png",
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    const finalPath = f.store.filePath(asset);
    const stagingPath = path.join(f.rootPath, ".kith", "canvas-assets", ".staging", `${asset.id}.tmp`);
    copyFileSync(finalPath, stagingPath);
    writeFileSync(finalPath, Buffer.from([137, 80]));
    f.store.recover();
    const recovered = f.store.list(f.canvasId).find((candidate) => candidate.id === asset.id)!;
    assert.equal(recovered.id, asset.id);
    assert.equal(recovered.state, "ready");
    assert.notEqual(recovered.storageKey, asset.storageKey);
    assert.deepEqual(f.store.read(f.canvasId, asset.id).bytes, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.deepEqual(readFileSync(finalPath), Buffer.from([137, 80]));
    assert.equal(existsSync(stagingPath), true);
  } finally { f.cleanup(); }
});

test("recovery fails closed when both the final and staging copies are corrupt", () => {
  const f = fixture();
  try {
    const asset = f.store.write({
      canvasId: f.canvasId,
      filename: "double-corrupt.png",
      mimeType: "image/png",
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    const finalPath = f.store.filePath(asset);
    const stagingPath = path.join(f.rootPath, ".kith", "canvas-assets", ".staging", `${asset.id}.tmp`);
    writeFileSync(finalPath, Buffer.from([137, 80]));
    writeFileSync(stagingPath, Buffer.from([137, 81]));
    assert.throws(() => f.store.recover(), /integrity/i);
    assert.deepEqual(readFileSync(finalPath), Buffer.from([137, 80]));
    assert.deepEqual(readFileSync(stagingPath), Buffer.from([137, 81]));
    assert.equal(f.store.list(f.canvasId)[0]?.storageKey, asset.storageKey);
  } finally { f.cleanup(); }
});

test("recovery CAS cannot revive an asset deleted after sibling verification", async () => {
  const f = fixture();
  let worker: Worker | undefined;
  try {
    const bytes = Buffer.alloc(16 * 1024 * 1024, 1);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    const asset = f.store.write({ canvasId: f.canvasId, filename: "recovery-race.png", mimeType: "image/png", bytes });
    const finalPath = f.store.filePath(asset);
    const stagingPath = path.join(f.rootPath, ".kith", "canvas-assets", ".staging", `${asset.id}.tmp`);
    copyFileSync(finalPath, stagingPath);
    writeFileSync(finalPath, Buffer.from([137, 80]));

    worker = new Worker(`
      const { parentPort, workerData } = require("node:worker_threads");
      const { readdirSync } = require("node:fs");
      const Database = require("better-sqlite3");
      const pause = new Int32Array(new SharedArrayBuffer(4));
      parentPort.postMessage("ready");
      const deadline = Date.now() + 5000;
      let changed = false;
      while (Date.now() < deadline) {
        if (readdirSync(workerData.assetDir).some((name) => name.startsWith(workerData.prefix))) {
          const db = new Database(workerData.databasePath);
          const result = db.prepare("UPDATE canvas_assets SET state = 'deleting', deleted_at = ? WHERE id = ?")
            .run(Date.now(), workerData.assetId);
          db.close();
          parentPort.postMessage({ changed: result.changes });
          changed = true;
          break;
        }
        Atomics.wait(pause, 0, 0, 1);
      }
      if (!changed) parentPort.postMessage({ timeout: true });
    `, {
      eval: true,
      workerData: {
        assetDir: path.dirname(finalPath),
        prefix: `${asset.id}.recovered-`,
        databasePath: path.join(f.rootPath, ".kith", "workspace.db"),
        assetId: asset.id,
      },
    });
    await once(worker, "message");
    const changed = once(worker, "message");
    assert.throws(() => f.store.recover(), /changed during crash recovery/);
    assert.deepEqual(await changed, [{ changed: 1 }]);

    const row = dbForSpace(f.spaceId).select().from(schema.canvasAssets).get();
    assert.equal(row?.state, "deleting");
    assert.ok(row?.deletedAt);
    assert.equal(row?.storageKey, asset.storageKey);
    assert.deepEqual(readFileSync(finalPath), Buffer.from([137, 80]));
    assert.equal(existsSync(stagingPath), true);
    assert.ok(readdirSync(path.dirname(finalPath)).some((name) => name.startsWith(`${asset.id}.recovered-`)));
    assert.doesNotThrow(() => f.store.recover(), "a later recovery leaves the deleting row and safe orphan untouched");
  } finally {
    await worker?.terminate();
    f.cleanup();
  }
});

test("an asset reachable from current or undo history cannot be deleted", () => {
  const f = fixture();
  try {
    const asset = f.store.write({
      canvasId: f.canvasId,
      filename: "reachable.png",
      mimeType: "image/png",
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    const core = new CanvasCore(dbForSpace(f.spaceId), f.spaceId);
    core.apply({
      canvasId: f.canvasId,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{
        op: "set",
        path: ["deltaSetLike", "asset-node"],
        value: { id: "asset-node", key: "image", attrs: { src: `/api/canvas-assets/${f.spaceId}/${f.canvasId}/${asset.id}` }, children: [] },
      }] },
    });
    core.undo(f.canvasId, randomUUID(), 1);
    assert.throws(() => f.store.delete(f.canvasId, asset.id), CanvasAssetInUseError);
    assert.ok(existsSync(f.store.filePath(asset)));
  } finally { f.cleanup(); }
});

test("a Canvas cannot persist a media reference owned by another Canvas in the same Space", () => {
  const f = fixture();
  try {
    const asset = f.store.write({
      canvasId: f.canvasId,
      filename: "shared.png",
      mimeType: "image/png",
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    const core = new CanvasCore(dbForSpace(f.spaceId), f.spaceId);
    const imported = core.create({ title: "Imported", document: { deltaSetLike: { ROOT: { children: [] } }, frames: [] } });
    assert.throws(() => core.apply({
      canvasId: imported.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{
        op: "set",
        path: ["deltaSetLike", "asset-node"],
        value: { id: "asset-node", key: "image", attrs: { src: `/api/canvas-assets/${f.spaceId}/${f.canvasId}/${asset.id}` }, children: [] },
      }] },
    }), /cannot cross Canvas boundaries/);
    assert.doesNotThrow(() => f.store.delete(f.canvasId, asset.id));
  } finally { f.cleanup(); }
});

test("asset deletion is a durable DB tombstone and never physically unlinks the file", () => {
  const f = fixture();
  try {
    const asset = f.store.write({
      canvasId: f.canvasId,
      filename: "soft-delete.png",
      mimeType: "image/png",
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    const target = f.store.filePath(asset);
    f.store.delete(f.canvasId, asset.id);
    assert.equal(f.store.list(f.canvasId).some((candidate) => candidate.id === asset.id), false);
    assert.ok(existsSync(target));
    f.store.recover();
    assert.ok(existsSync(target));
  } finally { f.cleanup(); }
});

test("parent-directory exchange during deletion fails closed without touching the replacement target", () => {
  const f = fixture();
  try {
    const asset = f.store.write({
      canvasId: f.canvasId,
      filename: "exchange.png",
      mimeType: "image/png",
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    const assetPath = f.store.filePath(asset);
    const assetFilename = path.basename(assetPath);
    const canvasDirectory = path.dirname(assetPath);
    const retainedDirectory = `${canvasDirectory}.retained`;
    const outsideDirectory = path.join(f.rootPath, "outside-delete-target");
    mkdirSync(outsideDirectory, { recursive: true });
    const outsideTarget = path.join(outsideDirectory, assetFilename);
    writeFileSync(outsideTarget, "outside-must-survive");
    renameSync(canvasDirectory, retainedDirectory);
    symlinkSync(outsideDirectory, canvasDirectory, process.platform === "win32" ? "junction" : "dir");
    f.store.delete(f.canvasId, asset.id);
    assert.equal(readFileSync(outsideTarget, "utf8"), "outside-must-survive");
    assert.ok(existsSync(path.join(retainedDirectory, assetFilename)));
    assert.doesNotThrow(() => f.store.recover());
    assert.equal(readFileSync(outsideTarget, "utf8"), "outside-must-survive");
  } finally { f.cleanup(); }
});

test("asset filesystem operations reject symlink and junction escapes", () => {
  const cases = ["staging-directory", "canvas-directory", "ready-file"] as const;
  for (const attack of cases) {
    const f = fixture();
    try {
      const outside = path.join(f.rootPath, "outside", attack);
      mkdirSync(outside, { recursive: true });
      const assetRoot = path.join(f.rootPath, ".kith", "canvas-assets");
      mkdirSync(assetRoot, { recursive: true });
      if (attack === "staging-directory") {
        symlinkSync(outside, path.join(assetRoot, ".staging"), process.platform === "win32" ? "junction" : "dir");
        assert.throws(() => f.store.write({
          canvasId: f.canvasId,
          filename: "escaped.png",
          mimeType: "image/png",
          bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        }), CanvasAssetValidationError);
      } else if (attack === "canvas-directory") {
        mkdirSync(path.join(assetRoot, ".staging"), { recursive: true });
        symlinkSync(outside, path.join(assetRoot, f.canvasId), process.platform === "win32" ? "junction" : "dir");
        assert.throws(() => f.store.write({
          canvasId: f.canvasId,
          filename: "escaped.png",
          mimeType: "image/png",
          bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        }), CanvasAssetValidationError);
      } else {
        const asset = f.store.write({
          canvasId: f.canvasId,
          filename: "safe.png",
          mimeType: "image/png",
          bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        });
        const target = path.join(outside, "escaped.png");
        writeFileSync(target, "outside");
        renameSync(f.store.filePath(asset), `${f.store.filePath(asset)}.safe`);
        symlinkSync(target, f.store.filePath(asset), "file");
        assert.throws(() => f.store.read(f.canvasId, asset.id), CanvasAssetValidationError);
        assert.throws(() => f.store.recover(), CanvasAssetValidationError);
        assert.equal(readFileSync(target, "utf8"), "outside");
      }
    } finally { f.cleanup(); }
  }
});
