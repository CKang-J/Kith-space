import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { kithSpaceHome } from "../paths.js";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { CanvasConflictError, CanvasCore, CanvasValidationError } from "./canvasCore.js";
import type { CanvasPatch } from "./canvasTypes.js";

const baseDocument = {
  width: 800,
  height: 600,
  deltaSetLike: {
    ROOT: { children: ["shape-1"] },
    "shape-1": { id: "shape-1", key: "shape", x: 10, y: 20, width: 100, height: 80, attrs: {}, children: [] },
  },
  frames: [],
  stackOrder: ["shape-1"],
};

function fixture() {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "canvas-core-test", spaceId);
  registerSpace({ id: spaceId, name: "Canvas Core", slug: `canvas-${spaceId}`, rootPath });
  const core = new CanvasCore(dbForSpace(spaceId), spaceId);
  return {
    spaceId,
    core,
    reopen() {
      closeSpaceDb(spaceId);
      return new CanvasCore(dbForSpace(spaceId), spaceId);
    },
    cleanup() {
      closeSpaceDb(spaceId);
      unregisterSpace(spaceId);
    },
  };
}

test("Canvas Core persists create -> operation -> database reopen", () => {
  const f = fixture();
  try {
    const created = f.core.create({ title: "First canvas", document: baseDocument });
    const changed = f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["deltaSetLike", "shape-1", "x"], value: 240 }] },
    });
    assert.equal((changed.document as typeof baseDocument).deltaSetLike["shape-1"].x, 240);
    assert.equal(changed.revisions.document, 1);
    assert.equal(changed.revisions.element, 1);
    assert.equal(changed.sequence, 1);

    const reopened = f.reopen().read(created.id);
    assert.deepEqual(reopened, changed);
  } finally {
    f.cleanup();
  }
});

test("stale revision is rejected and an operation id is idempotent", () => {
  const f = fixture();
  try {
    const created = f.core.create({ title: "Conflict", document: baseDocument });
    const operationId = randomUUID();
    const input = {
      canvasId: created.id,
      operationId,
      expectedRevision: 0,
      operation: { type: "document.patch" as const, patches: [{ op: "set" as const, path: ["width"], value: 900 }] },
    };
    const first = f.core.apply(input);
    assert.deepEqual(f.core.apply(input), first);
    assert.throws(() => f.core.apply({ ...input, operationId: randomUUID(), expectedRevision: 0 }), CanvasConflictError);
  } finally {
    f.cleanup();
  }
});

test("fine-grained CAS accepts disjoint elements and rejects overlapping stale edits", () => {
  const f = fixture();
  try {
    const document = {
      ...baseDocument,
      deltaSetLike: {
        ROOT: { children: ["shape-1", "shape-2"] },
        "shape-1": baseDocument.deltaSetLike["shape-1"],
        "shape-2": { id: "shape-2", key: "shape", x: 30, y: 40, width: 50, height: 60, attrs: {}, children: [] },
      },
      stackOrder: ["shape-1", "shape-2"],
    };
    const created = f.core.create({ title: "Concurrent", document });
    const firstInput = {
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch" as const, patches: [{ op: "set" as const, path: ["deltaSetLike", "shape-1", "x"], value: 11 }] },
    };
    const first = f.core.apply(firstInput);
    const disjoint = f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["deltaSetLike", "shape-2", "y"], value: 44 }] },
    });
    assert.equal(disjoint.revisions.revision, 2);
    assert.equal((disjoint.document as typeof document).deltaSetLike["shape-1"].x, 11);
    assert.equal((disjoint.document as typeof document).deltaSetLike["shape-2"].y, 44);
    assert.deepEqual(f.core.apply(firstInput), first, "idempotent retry returns the original committed result");
    assert.throws(() => f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["deltaSetLike", "shape-1", "y"], value: 99 }] },
    }), CanvasConflictError);
    assert.throws(() => f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["deltaSetLike"], value: document.deltaSetLike }] },
    }), CanvasConflictError, "a whole node-map replacement cannot bypass the derived element impact set");
  } finally { f.cleanup(); }
});

test("fine-grained CAS conservatively conflicts with legacy ledger rows that lack resource sets", () => {
  const f = fixture();
  try {
    const created = f.core.create({ title: "Legacy impact", document: baseDocument });
    f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["deltaSetLike", "shape-1", "x"], value: 11 }] },
    });
    dbForSpace(f.spaceId).update(schema.canvasMutations)
      .set({ impact: { document: true, elementIds: ["shape-1"] } })
      .where(eq(schema.canvasMutations.canvasId, created.id)).run();
    assert.throws(() => f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["width"], value: 900 }] },
    }), CanvasConflictError);
  } finally { f.cleanup(); }
});

test("fine-grained CAS derives reparent, order, and Frame indirect conflicts", () => {
  const f = fixture();
  try {
    const document = {
      ...baseDocument,
      deltaSetLike: {
        ROOT: { children: ["group-a", "group-b"] },
        "group-a": { id: "group-a", key: "group", parentId: "ROOT", children: ["shape-1"] },
        "group-b": { id: "group-b", key: "group", parentId: "ROOT", children: [] },
        "shape-1": { ...baseDocument.deltaSetLike["shape-1"], parentId: "group-a" },
      },
      frames: [{ id: "frame-1", x: 0, y: 0, width: 100, height: 100 }],
      stackOrder: ["frame:frame-1", "node:group-a", "node:group-b"],
    };
    const created = f.core.create({ title: "Structure", document });
    f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [
        { op: "set", path: ["deltaSetLike", "group-a", "children"], value: [] },
        { op: "set", path: ["deltaSetLike", "group-b", "children"], value: ["shape-1"] },
        { op: "set", path: ["deltaSetLike", "shape-1", "parentId"], value: "group-b" },
      ] },
    });
    assert.throws(() => f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["deltaSetLike", "group-a", "children"], value: ["shape-1"] }] },
    }), CanvasConflictError);
    const order = f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 1,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["stackOrder"], value: ["node:group-b", "frame:frame-1", "node:group-a"] }] },
    });
    assert.throws(() => f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 1,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["frames"], value: [{ id: "frame-1", x: 5, y: 0, width: 100, height: 100 }] }] },
    }), CanvasConflictError);
    assert.equal(order.revisions.structure, 2);
  } finally { f.cleanup(); }
});

test("fine-grained CAS treats node Frame membership and indexed Frame edits as the actual Frame resource", () => {
  const f = fixture();
  try {
    const document = {
      ...baseDocument,
      deltaSetLike: {
        ROOT: { children: ["shape-1"] },
        "shape-1": { ...baseDocument.deltaSetLike["shape-1"], frameId: "frame-1" },
      },
      frames: [
        { id: "frame-1", x: 0, y: 0, width: 100, height: 100 },
        { id: "frame-2", x: 200, y: 0, width: 100, height: 100 },
      ],
      stackOrder: ["frame:frame-1", "frame:frame-2", "shape-1"],
    };
    const created = f.core.create({ title: "Frame membership", document });
    f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["deltaSetLike", "shape-1", "frameId"], value: "frame-2" }] },
    });
    assert.throws(() => f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["frames", "1", "x"], value: 240 }] },
    }), CanvasConflictError);
    const mutation = dbForSpace(f.spaceId).select({ impact: schema.canvasMutations.impact })
      .from(schema.canvasMutations).where(eq(schema.canvasMutations.canvasId, created.id)).all().at(-1);
    const impact = mutation?.impact as { frameIds?: string[]; writeResources?: string[] };
    assert.deepEqual(impact.frameIds?.sort(), ["frame-1", "frame-2"]);
    assert.ok(impact.writeResources?.includes("frame-membership:shape-1"));
    assert.equal(impact.frameIds?.includes("1"), false);
  } finally { f.cleanup(); }
});

test("stable Frame operations allow disjoint edits and conflict on the same Frame or structural changes", () => {
  const f = fixture();
  try {
    const document = {
      ...baseDocument,
      deltaSetLike: {
        ROOT: { children: ["shape-1"] },
        "shape-1": { ...baseDocument.deltaSetLike["shape-1"], frameId: "frame-a" },
      },
      frames: [
        { id: "frame-a", x: 0, y: 0, width: 100, height: 100 },
        { id: "frame-b", x: 200, y: 0, width: 100, height: 100 },
      ],
      stackOrder: ["frame:frame-a", "frame:frame-b", "shape-1"],
    };
    const created = f.core.create({ title: "Stable Frames", document });
    const first = f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["frames", "frame:frame-a", "x"], value: 12 }] },
    });
    const disjoint = f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["frames", "frame:frame-b", "y"], value: 24 }] },
    });
    assert.equal((disjoint.document as typeof document).frames[0]?.x, 12);
    assert.equal((disjoint.document as typeof document).frames[1]?.y, 24);
    assert.throws(() => f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["frames", "frame:frame-a", "y"], value: 9 }] },
    }), CanvasConflictError);

    assert.throws(() => f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: first.revisions.revision,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["frames"], value: [...document.frames].reverse() }] },
    }), CanvasConflictError);
    assert.throws(() => f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: first.revisions.revision,
      operation: { type: "document.patch", patches: [{ op: "remove", path: ["frames", "frame:frame-b"] }] },
    }), CanvasConflictError);
    assert.throws(() => f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: first.revisions.revision,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["deltaSetLike", "shape-1", "frameId"], value: "frame-b" }] },
    }), CanvasConflictError);
  } finally { f.cleanup(); }
});

test("all server-derived structure changes share one stale conflict domain", () => {
  const f = fixture();
  try {
    const document = {
      ...baseDocument,
      deltaSetLike: {
        ROOT: { children: ["group-a", "group-b"] },
        "group-a": { id: "group-a", key: "group", parentId: "ROOT", children: ["shape-1"] },
        "group-b": { id: "group-b", key: "group", parentId: "ROOT", children: [] },
        "shape-1": { ...baseDocument.deltaSetLike["shape-1"], parentId: "group-a", frameId: "frame-a" },
      },
      frames: [
        { id: "frame-a", x: 0, y: 0, width: 100, height: 100 },
        { id: "frame-b", x: 200, y: 0, width: 100, height: 100 },
      ],
      stackOrder: ["node:group-a", "node:group-b"],
    };
    const assertCrossDomainConflict = (
      firstPatches: CanvasPatch[],
      stalePatches: CanvasPatch[],
    ) => {
      const created = f.core.create({ title: "Structure domain", document });
      f.core.apply({
        canvasId: created.id,
        operationId: randomUUID(),
        expectedRevision: 0,
        operation: { type: "document.patch", patches: firstPatches },
      });
      assert.throws(() => f.core.apply({
        canvasId: created.id,
        operationId: randomUUID(),
        expectedRevision: 0,
        operation: { type: "document.patch", patches: stalePatches },
      }), CanvasConflictError);
    };

    assertCrossDomainConflict(
      [{ op: "set", path: ["deltaSetLike", "shape-1", "frameId"], value: "frame-b" }],
      [{ op: "set", path: ["stackOrder"], value: ["node:group-b", "node:group-a"] }],
    );
    assertCrossDomainConflict(
      [{ op: "set", path: ["frames"], value: [...document.frames, { id: "frame-c", x: 400, y: 0, width: 100, height: 100 }] }],
      [{ op: "set", path: ["stackOrder"], value: ["node:group-b", "node:group-a"] }],
    );
    assertCrossDomainConflict(
      [{ op: "remove", path: ["frames", "frame:frame-b"] }],
      [{ op: "set", path: ["stackOrder"], value: ["node:group-b", "node:group-a"] }],
    );
    assertCrossDomainConflict(
      [{ op: "set", path: ["frames"], value: [...document.frames].reverse() }],
      [{ op: "set", path: ["stackOrder"], value: ["node:group-b", "node:group-a"] }],
    );
    assertCrossDomainConflict(
      [
        { op: "set", path: ["deltaSetLike", "group-a", "children"], value: [] },
        { op: "set", path: ["deltaSetLike", "group-b", "children"], value: ["shape-1"] },
        { op: "set", path: ["deltaSetLike", "shape-1", "parentId"], value: "group-b" },
      ],
      [{ op: "remove", path: ["frames", "frame:frame-b"] }],
    );
  } finally { f.cleanup(); }
});

test("Canvas Core rejects malformed runtime operations with validation errors", () => {
  const f = fixture();
  try {
    assert.throws(() => f.core.create({
      title: 42 as never,
      document: baseDocument,
    }), CanvasValidationError);

    const created = f.core.create({ title: "Runtime validation", document: baseDocument });
    const malformedOperations = [
      { type: "unknown", patches: [{ op: "set", path: ["width"], value: 900 }] },
      { type: "metadata.rename", title: 42 },
      { type: "document.patch", patches: [{ op: "set", path: null, value: 900 }] },
    ];
    for (const operation of malformedOperations) {
      assert.throws(() => f.core.apply({
        canvasId: created.id,
        operationId: randomUUID(),
        expectedRevision: 0,
        operation: operation as never,
      }), CanvasValidationError);
    }
    assert.equal(f.core.read(created.id).revisions.revision, 0);
  } finally {
    f.cleanup();
  }
});

test("Core undo and redo persist across reopen", () => {
  const f = fixture();
  try {
    const created = f.core.create({ title: "History", document: baseDocument });
    f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["height"], value: 720 }] },
    });
    const undone = f.core.undo(created.id, randomUUID(), 1);
    assert.equal((undone.document as typeof baseDocument).height, 600);
    const redone = f.reopen().redo(created.id, randomUUID(), 2);
    assert.equal((redone.document as typeof baseDocument).height, 720);
    assert.equal(f.reopen().read(created.id).sequence, 3);
  } finally {
    f.cleanup();
  }
});

test("undo restores every item shifted by an array-index removal", () => {
  const f = fixture();
  try {
    const document = { ...baseDocument, stackOrder: ["shape-1", "shape-2"] };
    const created = f.core.create({ title: "Array history", document });
    const removed = f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{ op: "remove", path: ["stackOrder", "0"] }] },
    });
    assert.deepEqual((removed.document as typeof baseDocument).stackOrder, ["shape-2"]);
    const undone = f.core.undo(created.id, randomUUID(), 1);
    assert.deepEqual((undone.document as typeof baseDocument).stackOrder, ["shape-1", "shape-2"]);
    const redone = f.core.redo(created.id, randomUUID(), 2);
    assert.deepEqual((redone.document as typeof baseDocument).stackOrder, ["shape-2"]);
  } finally {
    f.cleanup();
  }
});

test("metadata undo is reversible and idempotent retry returns its original result", () => {
  const f = fixture();
  try {
    const created = f.core.create({ title: "Before", document: baseDocument });
    const operationId = randomUUID();
    const renamed = f.core.apply({
      canvasId: created.id,
      operationId,
      expectedRevision: 0,
      operation: { type: "metadata.rename", title: "After" },
    });
    f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 1,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["width"], value: 901 }] },
    });
    assert.deepEqual(f.core.apply({
      canvasId: created.id,
      operationId,
      expectedRevision: 0,
      operation: { type: "metadata.rename", title: "After" },
    }), renamed);
    const undone = f.core.undo(created.id, randomUUID(), 2);
    assert.equal((undone.document as typeof baseDocument).width, 800);
    const metadataUndone = f.core.undo(created.id, randomUUID(), 3);
    assert.equal(metadataUndone.title, "Before");
    assert.equal(metadataUndone.revisions.metadata, 2);
  } finally {
    f.cleanup();
  }
});

test("bulk operations are atomic and long pen data replays in sequence", () => {
  const f = fixture();
  try {
    const created = f.core.create({ title: "Bulk", document: baseDocument });
    assert.throws(() => f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [
        { op: "set", path: ["width"], value: 999 },
        { op: "set", path: ["missing", "child"], value: true },
      ] },
    }));
    assert.equal((f.core.read(created.id).document as typeof baseDocument).width, 800);
    assert.equal(f.core.read(created.id).revisions.revision, 0);

    const points = Array.from({ length: 8_000 }, (_, index) => [index, index % 97]);
    const changed = f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "document.patch", patches: [{
        op: "set",
        path: ["deltaSetLike", "shape-1", "attrs", "points"],
        value: points,
      }] },
    });
    const changes = f.core.changesSince(created.id, 0);
    assert.equal(changes.length, 1);
    assert.deepEqual(Object.keys(changes[0]!).sort(), ["createdAt", "impact", "kind", "sequence"]);
    const ledger = dbForSpace(f.spaceId).select().from(schema.canvasMutations).all().find((row) => row.kind === "edit")!;
    assert.deepEqual(ledger.afterDocument, {});
    assert.equal(Object.prototype.hasOwnProperty.call(ledger.result as object, "document"), false);
    assert.ok(JSON.stringify(ledger.operation).length < JSON.stringify(changed.document).length);
    assert.equal(f.core.changesSince(created.id, changed.sequence).length, 0);
    assert.deepEqual(((f.reopen().read(created.id).document as typeof baseDocument).deltaSetLike["shape-1"].attrs as { points: number[][] }).points.at(-1), [7_999, 7_999 % 97]);
  } finally { f.cleanup(); }
});

test("Canvas ids and documents cannot cross Space databases", () => {
  const first = fixture();
  const second = fixture();
  try {
    const created = first.core.create({ title: "First Space", document: baseDocument });
    second.core.create({ title: "Second Space", document: { ...baseDocument, width: 1440 } });
    assert.throws(() => second.core.read(created.id));
    assert.equal(first.core.list().length, 1);
    assert.equal(second.core.list().length, 1);
    assert.equal((second.core.list()[0]!.document as typeof baseDocument).width, 1440);
  } finally {
    first.cleanup();
    second.cleanup();
  }
});

test("Canvas creation retry returns the original committed result", () => {
  const f = fixture();
  try {
    const canvasId = randomUUID();
    const operationId = randomUUID();
    const input = { canvasId, operationId, title: "Created once", document: baseDocument };
    const created = f.core.create(input);
    f.core.apply({
      canvasId,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "metadata.rename", title: "Later title" },
    });
    assert.deepEqual(f.core.create(input), created);
    assert.equal(f.core.list().length, 1);
    assert.throws(() => f.core.create({ ...input, title: "Different retry" }));
  } finally { f.cleanup(); }
});

test("Canvas import commits through an atomic Core operation and leaves no partial Canvas on failure", () => {
  const f = fixture();
  try {
    const canvasId = randomUUID();
    const operationId = randomUUID();
    const imported = f.core.importScene({ canvasId, operationId, title: "Imported", document: baseDocument });
    assert.equal(imported.id, canvasId);
    assert.equal(imported.revisions.revision, 1);
    assert.deepEqual(f.core.importScene({ canvasId, operationId, title: "Imported", document: baseDocument }), imported);
    const ledger = dbForSpace(f.spaceId).select().from(schema.canvasMutations)
      .where(eq(schema.canvasMutations.canvasId, canvasId)).all();
    assert.deepEqual(ledger.map((row) => row.kind), ["create", "edit"]);
    assert.equal((ledger[1]!.operation as { type: string }).type, "document.patch");
    const rejectedId = randomUUID();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.throws(() => f.core.importScene({ canvasId: rejectedId, operationId: randomUUID(), title: "Bad", document: circular }));
    assert.throws(() => f.core.read(rejectedId), /not found/);
  } finally { f.cleanup(); }
});

test("Canvas export omits Page identity and soft deletion survives restart with history retained", () => {
  const f = fixture();
  try {
    const created = f.core.create({ title: "Lifecycle", document: { ...baseDocument, activePageId: "page-1", pages: [{ id: "page-1", children: ["shape-1"] }] } });
    f.core.apply({
      canvasId: created.id,
      operationId: randomUUID(),
      expectedRevision: 0,
      operation: { type: "metadata.rename", title: "Lifecycle renamed" },
    });
    const exported = f.core.exportScene(created.id);
    assert.equal(exported.format, "kith-canvas-scene");
    assert.equal(exported.version, 1);
    assert.equal(exported.title, "Lifecycle renamed");
    assert.equal("pages" in (exported.scene as object), false);
    assert.equal("activePageId" in (exported.scene as object), false);
    const deleteOperationId = randomUUID();
    const deleted = f.core.delete(created.id, deleteOperationId, 1);
    assert.equal(deleted.revisions.metadata, 2);
    assert.equal(deleted.sequence, 2);
    assert.deepEqual(f.core.delete(created.id, deleteOperationId, 1), deleted, "delete retry is idempotent");
    assert.throws(() => f.reopen().read(created.id), /not found/);
    assert.equal(f.reopen().list().length, 0);
    assert.equal(dbForSpace(f.spaceId).select().from(schema.canvasMutations).where(eq(schema.canvasMutations.canvasId, created.id)).all().length, 3);
  } finally { f.cleanup(); }
});

test("Core rejects ephemeral and remote media before they become canonical", () => {
  const f = fixture();
  try {
    assert.throws(() => f.core.create({
      title: "Unsafe media",
      document: {
        ...baseDocument,
        deltaSetLike: {
          ...baseDocument.deltaSetLike,
          "shape-1": { ...baseDocument.deltaSetLike["shape-1"], key: "image", attrs: { src: "data:image/png;base64,AAAA" } },
        },
      },
    }), CanvasValidationError);
  } finally { f.cleanup(); }
});
