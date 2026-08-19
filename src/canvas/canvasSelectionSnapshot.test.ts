import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { CanvasCore, CanvasNotFoundError, CanvasValidationError } from "./canvasCore.js";
import {
  freezeCanvasSelectionInTransaction,
  parseCanvasSelectionInput,
} from "./canvasSelectionSnapshot.js";

const baseDocument = {
  width: 800,
  height: 600,
  deltaSetLike: {
    ROOT: { children: ["shape-1", "text-1"] },
    "shape-1": { id: "shape-1", key: "shape", x: 10, y: 20, width: 100, height: 80, attrs: {}, children: [] },
    "text-1": { id: "text-1", key: "text", x: 500, y: 60, width: 120, height: 24, attrs: { text: "hello" }, children: [] },
  },
  frames: [{ id: "frame-1", name: "Board", x: 0, y: 0, width: 400, height: 300 }],
  stackOrder: ["shape-1", "text-1"],
};

function fixture() {
  const spaceId = randomUUID();
  registerSpace({
    id: spaceId,
    name: "Canvas snapshot",
    slug: `canvas-snap-${spaceId}`,
    rootPath: path.join(kithSpaceHome(), "canvas-snapshot", spaceId),
  });
  const db = dbForSpace(spaceId);
  const core = new CanvasCore(db, spaceId);
  return {
    spaceId,
    db,
    core,
    cleanup() {
      closeSpaceDb(spaceId);
      unregisterSpace(spaceId);
    },
  };
}

test("empty selectedIds freezes the whole live canvas as a bounded snapshot", () => {
  const f = fixture();
  try {
    const created = f.core.create({ title: "Board", document: baseDocument });
    const frozen = f.db.transaction((tx) => freezeCanvasSelectionInTransaction(
      tx,
      f.spaceId,
      { canvasId: created.id, selectedIds: [] },
      "human-1",
    ));
    assert.equal(frozen.projection.wholeCanvas, true);
    assert.equal(frozen.documentRevision, 0);
    assert.equal(frozen.selectedElements.length, 2);
    assert.equal(frozen.selectedFrames.length, 1);
    assert.match(frozen.summary, /entire canvas/);
    assert.deepEqual(frozen.deepLink, { moduleId: "canvas", canvas: created.id });
    const parsed = parseCanvasSelectionInput({ canvasId: created.id, selectedIds: [] });
    assert.ok(parsed);
    assert.equal(parsed.selectedIds?.length ?? -1, 0);
  } finally {
    f.cleanup();
  }
});

test("element and Frame selection projects only the requested live objects", () => {
  const f = fixture();
  try {
    const created = f.core.create({ title: "Select", document: baseDocument });
    const frozen = f.db.transaction((tx) => freezeCanvasSelectionInTransaction(
      tx,
      f.spaceId,
      { canvasId: created.id, selectedIds: ["shape-1", "frame:frame-1"] },
      "human-1",
    ));
    assert.equal(frozen.projection.wholeCanvas, false);
    assert.deepEqual(frozen.selectedElements.map((item) => item.id), ["shape-1"]);
    assert.deepEqual(frozen.selectedFrames.map((item) => item.id), ["frame-1"]);
    assert.equal(frozen.projection.elements[0]?.x, 10);
    assert.equal(frozen.projection.frames[0]?.name, "Board");
  } finally {
    f.cleanup();
  }
});

test("selecting a Frame also freezes overlapping member nodes and keeps the Frame", () => {
  const f = fixture();
  try {
    const created = f.core.create({ title: "Frame members", document: baseDocument });
    const frozen = f.db.transaction((tx) => freezeCanvasSelectionInTransaction(
      tx,
      f.spaceId,
      { canvasId: created.id, selectedIds: ["frame:frame-1"] },
      "human-1",
    ));
    assert.equal(frozen.projection.wholeCanvas, false);
    assert.deepEqual(frozen.selectedFrames.map((item) => item.id), ["frame-1"]);
    assert.ok(frozen.selectedElements.some((item) => item.id === "shape-1"));
    assert.equal(frozen.selectedElements.some((item) => item.id === "text-1"), false);
  } finally {
    f.cleanup();
  }
});

test("a later canvas mutation does not rewrite an already frozen snapshot", () => {
  const f = fixture();
  try {
    const created = f.core.create({ title: "Immutable", document: baseDocument });
    const frozen = f.db.transaction((tx) => freezeCanvasSelectionInTransaction(
      tx,
      f.spaceId,
      { canvasId: created.id, selectedIds: ["shape-1"] },
      "human-1",
    ));
    f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: created.revisions.revision,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["deltaSetLike", "shape-1", "x"], value: 240 }] },
    });
    const row = f.db.select().from(schema.canvasSelectionSnapshots)
      .where(eq(schema.canvasSelectionSnapshots.id, frozen.snapshotId)).get();
    assert.equal(row?.documentRevision, 0);
    assert.equal((row?.projection as { elements: Array<{ x: number }> }).elements[0]?.x, 10);
    assert.equal(row?.selectionHash, frozen.selectionHash);
    assert.equal((f.core.read(created.id).document as typeof baseDocument).deltaSetLike["shape-1"].x, 240);
  } finally {
    f.cleanup();
  }
});

test("selection snapshot records per-element revisions instead of a single document revision", () => {
  const f = fixture();
  try {
    const created = f.core.create({ title: "Revisions", document: baseDocument });
    const before = f.db.transaction((tx) => freezeCanvasSelectionInTransaction(
      tx,
      f.spaceId,
      { canvasId: created.id, selectedIds: ["shape-1", "text-1"] },
      "human-1",
    ));
    assert.deepEqual(before.selectedElements, [
      { id: "shape-1", revision: 0 },
      { id: "text-1", revision: 0 },
    ]);
    f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: created.revisions.revision,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["deltaSetLike", "shape-1", "x"], value: 88 }] },
    });
    const after = f.db.transaction((tx) => freezeCanvasSelectionInTransaction(
      tx,
      f.spaceId,
      { canvasId: created.id, selectedIds: ["shape-1", "text-1"] },
      "human-1",
    ));
    const shape = after.selectedElements.find((item) => item.id === "shape-1");
    const text = after.selectedElements.find((item) => item.id === "text-1");
    assert.ok(shape);
    assert.ok(text);
    assert.equal(text.revision, 0);
    assert.ok(shape.revision > text.revision);
    assert.notEqual(after.selectionHash, before.selectionHash);
  } finally {
    f.cleanup();
  }
});

test("deleted canvases and unmatched selections fail closed before a snapshot exists", () => {
  const f = fixture();
  try {
    const created = f.core.create({ title: "Gone", document: baseDocument });
    f.core.delete(created.id, randomUUID(), created.revisions.revision);
    assert.throws(
      () => f.db.transaction((tx) => freezeCanvasSelectionInTransaction(
        tx, f.spaceId, { canvasId: created.id, selectedIds: ["shape-1"] }, "human-1",
      )),
      CanvasNotFoundError,
    );
    const live = f.core.create({ title: "Live", document: baseDocument });
    assert.throws(
      () => f.db.transaction((tx) => freezeCanvasSelectionInTransaction(
        tx, f.spaceId, { canvasId: live.id, selectedIds: ["missing-node"] }, "human-1",
      )),
      CanvasValidationError,
    );
    assert.equal(f.db.select().from(schema.canvasSelectionSnapshots).all().length, 0);
  } finally {
    f.cleanup();
  }
});
