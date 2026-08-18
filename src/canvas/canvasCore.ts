import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, lte } from "drizzle-orm";
import type { SpaceDb } from "../db/index.js";
import { schema } from "../db/index.js";
import type {
  ApplyCanvasOperationInput,
  CanvasJson,
  CanvasMutationImpact,
  CanvasOperation,
  CanvasSnapshot,
} from "./canvasTypes.js";
import { canonicalJson } from "./canonicalJson.js";
import { KITH_ENTITY_REVISION_KEY, stampCanvasEntityRevisions } from "./canvasEntityRevision.js";

const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
const MAX_PATCHES = 10_000;
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor", KITH_ENTITY_REVISION_KEY]);
const MEDIA_URL_KEYS = new Set(["src", "url", "href", "poster", "thumbnail"]);

export class CanvasNotFoundError extends Error {}
export class CanvasValidationError extends Error {}
export class CanvasConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super(`canvas document revision conflict; current revision is ${currentRevision}`);
  }
}
export class CanvasIdempotencyError extends Error {}

function requestHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function cloneJson(value: unknown): CanvasJson {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new CanvasValidationError("canvas document must be JSON serializable");
  }
  if (encoded === undefined || Buffer.byteLength(encoded) > MAX_DOCUMENT_BYTES) {
    throw new CanvasValidationError("canvas document exceeds the 16 MiB limit");
  }
  return JSON.parse(encoded) as CanvasJson;
}

function safeTitle(value: unknown): string {
  if (typeof value !== "string") throw new CanvasValidationError("canvas title must be a string");
  const title = value.trim();
  if (!title || title.length > 160) throw new CanvasValidationError("canvas title must contain 1-160 characters");
  return title;
}

const emptyImpact = (): CanvasMutationImpact => ({
  metadata: false,
  document: false,
  element: false,
  frame: false,
  structure: false,
  elementIds: [],
  frameIds: [],
  readResources: [],
  writeResources: [],
});

function addResource(impact: CanvasMutationImpact, mode: "read" | "write", resource: string | null | undefined): void {
  if (!resource) return;
  const target = mode === "read" ? impact.readResources : impact.writeResources;
  if (!target.includes(resource)) target.push(resource);
}

function nodeParent(value: CanvasJson | undefined): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parentId = (value as Record<string, CanvasJson>).parentId;
  return typeof parentId === "string" ? parentId : null;
}

function nodeChildren(value: CanvasJson | undefined): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const children = (value as Record<string, CanvasJson>).children;
  return Array.isArray(children) ? children.filter((child): child is string => typeof child === "string") : [];
}

function frameIds(value: CanvasJson | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((frame) => frame && typeof frame === "object" && !Array.isArray(frame)
    && typeof (frame as Record<string, CanvasJson>).id === "string"
    ? [(frame as Record<string, CanvasJson>).id as string]
    : []);
}

function addStructuralNodeResources(impact: CanvasMutationImpact, entityId: string, before: CanvasJson | undefined, after: CanvasJson | undefined): void {
  const beforeParent = nodeParent(before);
  const afterParent = nodeParent(after);
  const beforeChildren = nodeChildren(before);
  const afterChildren = nodeChildren(after);
  const beforeFrame = before && typeof before === "object" && !Array.isArray(before) && typeof before.frameId === "string" ? before.frameId : null;
  const afterFrame = after && typeof after === "object" && !Array.isArray(after) && typeof after.frameId === "string" ? after.frameId : null;
  if (beforeParent !== afterParent) {
    addResource(impact, "write", `parent:${entityId}`);
    addResource(impact, "write", `children:${beforeParent ?? "ROOT"}`);
    addResource(impact, "write", `children:${afterParent ?? "ROOT"}`);
  }
  if (JSON.stringify(beforeChildren) !== JSON.stringify(afterChildren)) {
    addResource(impact, "write", `children:${entityId}`);
    for (const child of new Set([...beforeChildren, ...afterChildren])) addResource(impact, "write", `parent:${child}`);
  }
  if (beforeFrame !== afterFrame) {
    impact.frame = true;
    impact.structure = true;
    for (const frameId of new Set([beforeFrame, afterFrame].filter((id): id is string => Boolean(id)))) {
      impact.frameIds.push(frameId);
      addResource(impact, "read", `frame:${frameId}`);
      addResource(impact, "write", `frame-membership:${frameId}`);
    }
    addResource(impact, "write", `frame-membership:${entityId}`);
  }
}

function impactsConflict(incoming: CanvasMutationImpact, committed: CanvasMutationImpact): boolean {
  if (!Array.isArray(committed.readResources) || !Array.isArray(committed.writeResources)) {
    return true;
  }
  if (incoming.structure && committed.structure) return true;
  const incomingReads = new Set(incoming.readResources);
  const incomingWrites = new Set(incoming.writeResources);
  const committedReads = new Set(committed.readResources);
  const committedWrites = new Set(committed.writeResources);
  return [...incomingWrites].some((resource) => committedWrites.has(resource) || committedReads.has(resource))
    || [...incomingReads].some((resource) => committedWrites.has(resource));
}

function validatePath(path: string[]): void {
  if (path.length === 0 || path.length > 16) throw new CanvasValidationError("canvas patch path depth is invalid");
  for (const segment of path) {
    if (!segment || segment.length > 256 || FORBIDDEN_PATH_SEGMENTS.has(segment)) {
      throw new CanvasValidationError("canvas patch path contains an unsafe segment");
    }
  }
}

function frameSelectorIndex(parent: CanvasJson[], segment: string): number | null {
  if (!segment.startsWith("frame:")) return null;
  const frameId = segment.slice(6);
  const indexes = parent.flatMap((frame, index) => frame && typeof frame === "object" && !Array.isArray(frame)
    && frame.id === frameId ? [index] : []);
  if (indexes.length !== 1) throw new CanvasValidationError("canvas Frame selector must resolve exactly one Frame");
  return indexes[0]!;
}

function patchDocument(document: CanvasJson, operation: unknown, currentTitle = "Untitled Canvas"): {
  document: CanvasJson;
  impact: CanvasMutationImpact;
  title?: string;
  inverseOperation: CanvasOperation;
} {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new CanvasValidationError("a Canvas operation object is required");
  }
  const candidate = operation as Record<string, unknown>;
  if (candidate.type === "metadata.rename") {
    const impact = { ...emptyImpact(), metadata: true };
    addResource(impact, "write", "metadata:title");
    return {
      document,
      impact,
      title: safeTitle(candidate.title),
      inverseOperation: { type: "metadata.rename", title: currentTitle },
    };
  }
  if (candidate.type !== "document.patch") throw new CanvasValidationError("unknown Canvas operation type");
  if (!Array.isArray(candidate.patches) || candidate.patches.length === 0 || candidate.patches.length > MAX_PATCHES) {
    throw new CanvasValidationError(`document.patch requires 1-${MAX_PATCHES} patches`);
  }
  const next = cloneJson(document);
  const impact = emptyImpact();
  const inversePatches: CanvasOperation & { type: "document.patch" } = { type: "document.patch", patches: [] };
  impact.document = true;
  for (const rawPatch of candidate.patches) {
    if (!rawPatch || typeof rawPatch !== "object" || Array.isArray(rawPatch)) {
      throw new CanvasValidationError("canvas patch must be an object");
    }
    const patch = rawPatch as Record<string, unknown>;
    if (!Array.isArray(patch.path) || !patch.path.every((segment) => typeof segment === "string")) {
      throw new CanvasValidationError("canvas patch path must contain only strings");
    }
    validatePath(patch.path);
    if (patch.op !== "set" && patch.op !== "remove") throw new CanvasValidationError("unknown canvas patch operation");
    let parent: CanvasJson = next;
    for (const [pathIndex, segment] of patch.path.slice(0, -1).entries()) {
      if (parent === null || typeof parent !== "object") throw new CanvasValidationError("canvas patch parent does not exist");
      const stableFrameIndex = Array.isArray(parent) && patch.path[0] === "frames" && pathIndex === 1
        ? frameSelectorIndex(parent, segment) : null;
      const child = Array.isArray(parent) && stableFrameIndex !== null
        ? parent[stableFrameIndex]
        : (parent as Record<string, CanvasJson>)[segment];
      if (child === undefined || child === null || typeof child !== "object") {
        throw new CanvasValidationError("canvas patch parent does not exist");
      }
      parent = child;
    }
    if (parent === null || typeof parent !== "object") throw new CanvasValidationError("canvas patch parent is not an object");
    if (Array.isArray(parent) && patch.path.length === 1) {
      throw new CanvasValidationError("array-root documents do not support indexed patches");
    }
    const previousParent = Array.isArray(parent) ? cloneJson(parent) : null;
    const leaf = patch.path.at(-1)!;
    const stableFrameLeaf = Array.isArray(parent) && patch.path[0] === "frames"
      ? frameSelectorIndex(parent, leaf) : null;
    const previousLeaf = Array.isArray(parent)
      ? parent[stableFrameLeaf ?? Number(leaf)]
      : (parent as Record<string, CanvasJson>)[leaf];
    const hadLeaf = Array.isArray(parent)
      ? stableFrameLeaf !== null || (Number.isSafeInteger(Number(leaf)) && Number(leaf) >= 0 && Number(leaf) < parent.length)
      : Object.prototype.hasOwnProperty.call(parent, leaf);
    if (patch.op === "remove") {
      if (Array.isArray(parent)) {
        const index = stableFrameLeaf ?? Number(leaf);
        if (!Number.isSafeInteger(index) || index < 0 || index >= parent.length) throw new CanvasValidationError("canvas array patch index is invalid");
        parent.splice(index, 1);
      } else {
        delete (parent as Record<string, CanvasJson>)[leaf];
      }
    } else {
      if (patch.value === undefined) throw new CanvasValidationError("canvas set patch requires a value");
      const value = cloneJson(patch.value);
      if (Array.isArray(parent)) {
        const index = stableFrameLeaf ?? Number(leaf);
        if (!Number.isSafeInteger(index) || index < 0 || index > parent.length) throw new CanvasValidationError("canvas array patch index is invalid");
        parent[index] = value;
      } else {
        (parent as Record<string, CanvasJson>)[leaf] = value;
      }
    }
    inversePatches.patches.unshift(previousParent !== null
      ? { op: "set", path: patch.path.slice(0, -1), value: previousParent }
      : hadLeaf
        ? { op: "set", path: [...patch.path], value: cloneJson(previousLeaf) }
        : { op: "remove", path: [...patch.path] });
    const [root, entityId, field] = patch.path;
    if (root === "pages" || root === "activePageId") {
      throw new CanvasValidationError("Canvas Core uses one hidden ROOT and does not persist Page identity");
    }
    if (root === "deltaSetLike") {
      impact.element = true;
      if (!entityId) {
        impact.structure = true;
        addResource(impact, "write", "structure:root");
        const beforeNodes = previousLeaf && typeof previousLeaf === "object" && !Array.isArray(previousLeaf)
          ? previousLeaf as Record<string, CanvasJson> : {};
        const afterNodes = patch.op === "set" && patch.value && typeof patch.value === "object" && !Array.isArray(patch.value)
          ? patch.value as Record<string, CanvasJson> : {};
        for (const id of new Set([...Object.keys(beforeNodes), ...Object.keys(afterNodes)])) {
          if (id === "ROOT") {
            addResource(impact, "write", "children:ROOT");
            continue;
          }
          impact.elementIds.push(id);
          addResource(impact, "read", `element:${id}`);
          addResource(impact, "write", `element:${id}`);
          addStructuralNodeResources(impact, id, beforeNodes[id], afterNodes[id]);
        }
      }
      if (entityId && entityId !== "ROOT") impact.elementIds.push(entityId);
      if (entityId && entityId !== "ROOT") {
        addResource(impact, "read", `element:${entityId}`);
        addResource(impact, "write", `element:${entityId}`);
      }
      if (entityId === "ROOT") addResource(impact, "write", "structure:root");
      if (entityId === "ROOT" || field === "children" || field === "parentId") impact.structure = true;
      if (field === undefined) {
        const previousNode = previousLeaf && typeof previousLeaf === "object" && !Array.isArray(previousLeaf)
          ? previousLeaf as Record<string, CanvasJson>
          : null;
        const nextNode = patch.op === "set" && patch.value && typeof patch.value === "object" && !Array.isArray(patch.value)
          ? patch.value as Record<string, CanvasJson>
          : null;
        if (JSON.stringify(previousNode?.children) !== JSON.stringify(nextNode?.children)
          || previousNode?.parentId !== nextNode?.parentId) impact.structure = true;
        if (entityId && entityId !== "ROOT") addStructuralNodeResources(impact, entityId, previousLeaf, patch.op === "set" ? patch.value as CanvasJson : undefined);
      }
      if (entityId && entityId !== "ROOT" && field === "parentId") {
        addResource(impact, "write", `parent:${entityId}`);
        addResource(impact, "write", `children:${typeof previousLeaf === "string" ? previousLeaf : "ROOT"}`);
        addResource(impact, "write", `children:${patch.op === "set" && typeof patch.value === "string" ? patch.value : "ROOT"}`);
      }
      if (entityId && entityId !== "ROOT" && field === "frameId") {
        impact.frame = true;
        impact.structure = true;
        const beforeFrame = typeof previousLeaf === "string" ? previousLeaf : null;
        const afterFrame = patch.op === "set" && typeof patch.value === "string" ? patch.value : null;
        for (const frameId of new Set([beforeFrame, afterFrame].filter((id): id is string => Boolean(id)))) {
          impact.frameIds.push(frameId);
          addResource(impact, "read", `frame:${frameId}`);
          addResource(impact, "write", `frame-membership:${frameId}`);
        }
        addResource(impact, "write", `frame-membership:${entityId}`);
      }
      if (entityId && field === "children") {
        addResource(impact, "write", `children:${entityId}`);
        for (const child of new Set([...nodeChildren({ children: previousLeaf } as CanvasJson), ...nodeChildren({ children: patch.value as CanvasJson } as CanvasJson)])) {
          addResource(impact, "write", `parent:${child}`);
        }
      }
    }
    if (root === "frames") {
      impact.frame = true;
      const frameList = Array.isArray((next as Record<string, CanvasJson>).frames) ? (next as Record<string, CanvasJson>).frames as CanvasJson[] : [];
      const originalFrameList = Array.isArray((document as Record<string, CanvasJson>).frames)
        ? (document as Record<string, CanvasJson>).frames as CanvasJson[] : [];
      const stableFrameId = entityId?.startsWith("frame:") ? entityId.slice(6) : null;
      const indexedFrameIds = stableFrameId ? [stableFrameId] : entityId !== undefined && Number.isSafeInteger(Number(entityId))
        ? [originalFrameList[Number(entityId)], frameList[Number(entityId)]].flatMap((frame) =>
          frame && typeof frame === "object" && !Array.isArray(frame) && typeof frame.id === "string" ? [frame.id] : [])
        : entityId ? [entityId] : [];
      impact.frameIds.push(...indexedFrameIds);
      const ids = patch.path.length === 1
        ? new Set([...frameIds(previousLeaf), ...frameIds(patch.op === "set" ? patch.value as CanvasJson : undefined)])
        : new Set(indexedFrameIds);
      for (const id of ids) {
        addResource(impact, "read", `frame:${id}`);
        addResource(impact, "write", `frame:${id}`);
      }
      if (!stableFrameId || field === undefined) {
        impact.structure = true;
        addResource(impact, "write", "structure:frames");
      }
    }
    if (root === "stackOrder") {
      addResource(impact, "write", "structure:order");
      const entries = [...(Array.isArray(previousLeaf) ? previousLeaf : []), ...(Array.isArray(patch.value) ? patch.value : [])];
      for (const entry of entries) {
        if (typeof entry !== "string") continue;
        if (entry.startsWith("frame:")) addResource(impact, "read", `frame:${entry.slice(6)}`);
        if (entry.startsWith("node:")) addResource(impact, "read", `element:${entry.slice(5)}`);
        else if (!entry.startsWith("frame:")) addResource(impact, "read", `element:${entry}`);
      }
    }
    if (root === "activeFrameId") {
      addResource(impact, "write", "structure:active-frame");
      if (typeof previousLeaf === "string") addResource(impact, "read", `frame:${previousLeaf}`);
      if (typeof patch.value === "string") addResource(impact, "read", `frame:${patch.value}`);
    }
    if (root === "pages" || root === "activePageId") {
      addResource(impact, "write", "structure:root");
    }
    if (root === "pages" || root === "stackOrder" || root === "activeFrameId" || root === "activePageId") {
      impact.structure = true;
    }
    if (root !== "deltaSetLike" && root !== "frames" && root !== "stackOrder" && root !== "activeFrameId" && root !== "pages" && root !== "activePageId") {
      addResource(impact, "read", `document:${root}`);
      addResource(impact, "write", `document:${root}`);
    }
  }
  impact.elementIds = [...new Set(impact.elementIds)];
  impact.frameIds = [...new Set(impact.frameIds)];
  return { document: cloneJson(next), impact, inverseOperation: inversePatches };
}

type CanvasRow = typeof schema.canvasDocuments.$inferSelect;

function snapshot(row: CanvasRow): CanvasSnapshot {
  return {
    id: row.id,
    spaceId: row.spaceId,
    title: row.title,
    document: cloneJson(row.document),
    revisions: {
      revision: row.revision,
      metadata: row.metadataRevision,
      document: row.documentRevision,
      element: row.elementRevision,
      frame: row.frameRevision,
      structure: row.structureRevision,
    },
    sequence: row.realtimeSequence,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type StoredCanvasResult = Omit<CanvasSnapshot, "document">;

function storedResult(value: CanvasSnapshot): StoredCanvasResult {
  const { document: _document, ...metadata } = value;
  return metadata;
}

export class CanvasCore {
  constructor(private readonly db: SpaceDb, private readonly spaceId: string) {}

  create(input: { title: string; document: unknown; canvasId?: string; operationId?: string }): CanvasSnapshot {
    const canvasId = input.canvasId ?? randomUUID();
    const operationId = input.operationId ?? randomUUID();
    const title = safeTitle(input.title);
    const document = cloneJson(input.document);
    if (document && typeof document === "object" && !Array.isArray(document)) {
      delete (document as Record<string, CanvasJson>).pages;
      delete (document as Record<string, CanvasJson>).activePageId;
    }
    stampCanvasEntityRevisions(document, "all", "all", 0, 0);
    this.assertDurableMedia(document, canvasId);
    const hash = requestHash({ canvasId, title, document });
    return this.db.transaction((tx) => {
      const duplicate = tx.select().from(schema.canvasMutations).where(and(
        eq(schema.canvasMutations.canvasId, canvasId), eq(schema.canvasMutations.operationId, operationId),
      )).get();
      if (duplicate) {
        if (duplicate.requestHash !== hash) throw new CanvasIdempotencyError("creation operation id was reused with different input");
        return this.resultForMutation(duplicate);
      }
      const collision = tx.select({ id: schema.canvasDocuments.id }).from(schema.canvasDocuments)
        .where(eq(schema.canvasDocuments.id, canvasId)).get();
      if (collision) throw new CanvasIdempotencyError("canvas id already exists without the matching creation operation");
      const row = tx.insert(schema.canvasDocuments).values({ id: canvasId, spaceId: this.spaceId, title, document }).returning().get();
      const created = snapshot(row);
      tx.insert(schema.canvasMutations).values({
        canvasId,
        operationId,
        sequence: 0,
        kind: "create",
        expectedRevision: 0,
        requestHash: hash,
        operation: { type: "create" },
        beforeTitle: "",
        afterTitle: title,
        beforeDocument: {},
        afterDocument: document,
        impact: { ...emptyImpact(), metadata: true, document: true },
        result: storedResult(created),
      }).run();
      return created;
    });
  }

  importScene(input: { title: string; document: unknown; canvasId: string; operationId: string }): CanvasSnapshot {
    const title = safeTitle(input.title);
    const document = cloneJson(input.document);
    if (!document || typeof document !== "object" || Array.isArray(document)
      || Object.prototype.hasOwnProperty.call(document, "pages")
      || Object.prototype.hasOwnProperty.call(document, "activePageId")) {
      throw new CanvasValidationError("Canvas import must use the single hidden ROOT document format");
    }
    const operation: CanvasOperation = {
      type: "document.patch",
      patches: Object.entries(document).map(([key, value]) => ({ op: "set", path: [key], value })),
    };
    const hash = requestHash({ canvasId: input.canvasId, title, operation });
    return this.db.transaction((tx) => {
      const duplicate = tx.select().from(schema.canvasMutations).where(and(
        eq(schema.canvasMutations.canvasId, input.canvasId), eq(schema.canvasMutations.operationId, input.operationId),
      )).get();
      if (duplicate) {
        if (duplicate.requestHash !== hash) throw new CanvasIdempotencyError("import operation id was reused with different input");
        return this.resultForMutation(duplicate);
      }
      const collision = tx.select({ id: schema.canvasDocuments.id }).from(schema.canvasDocuments)
        .where(eq(schema.canvasDocuments.id, input.canvasId)).get();
      if (collision) throw new CanvasIdempotencyError("canvas id already exists without the matching import operation");
      const emptyDocument: CanvasJson = {};
      const createdRow = tx.insert(schema.canvasDocuments).values({
        id: input.canvasId,
        spaceId: this.spaceId,
        title,
        document: emptyDocument,
      }).returning().get();
      const created = snapshot(createdRow);
      tx.insert(schema.canvasMutations).values({
        canvasId: input.canvasId,
        operationId: `create:${input.operationId}`,
        sequence: 0,
        kind: "create",
        expectedRevision: 0,
        requestHash: requestHash({ canvasId: input.canvasId, title, document: emptyDocument }),
        operation: { type: "create" },
        beforeTitle: "",
        afterTitle: title,
        beforeDocument: {},
        afterDocument: emptyDocument,
        impact: { ...emptyImpact(), metadata: true, document: true },
        result: storedResult(created),
      }).run();
      const applied = patchDocument(emptyDocument, operation, title);
      stampCanvasEntityRevisions(
        applied.document,
        applied.impact.elementIds.length ? applied.impact.elementIds : "all",
        applied.impact.frameIds.length ? applied.impact.frameIds : "all",
        Number(applied.impact.element),
        Number(applied.impact.frame),
      );
      this.assertDurableMedia(applied.document, input.canvasId);
      const row = tx.update(schema.canvasDocuments).set({
        document: applied.document,
        revision: 1,
        documentRevision: 1,
        elementRevision: Number(applied.impact.element),
        frameRevision: Number(applied.impact.frame),
        structureRevision: Number(applied.impact.structure),
        realtimeSequence: 1,
        updatedAt: new Date(),
      }).where(eq(schema.canvasDocuments.id, input.canvasId)).returning().get();
      const result = snapshot(row);
      tx.insert(schema.canvasMutations).values({
        canvasId: input.canvasId,
        operationId: input.operationId,
        sequence: 1,
        kind: "edit",
        expectedRevision: 0,
        requestHash: hash,
        operation,
        beforeTitle: title,
        afterTitle: title,
        beforeDocument: applied.inverseOperation,
        afterDocument: {},
        impact: applied.impact,
        result: storedResult(result),
      }).run();
      return result;
    });
  }

  list(): CanvasSnapshot[] {
    return this.db.select().from(schema.canvasDocuments)
      .where(and(eq(schema.canvasDocuments.spaceId, this.spaceId), isNull(schema.canvasDocuments.deletedAt)))
      .orderBy(desc(schema.canvasDocuments.updatedAt)).all().map(snapshot);
  }

  read(canvasId: string): CanvasSnapshot {
    const row = this.db.select().from(schema.canvasDocuments).where(and(
      eq(schema.canvasDocuments.id, canvasId),
      eq(schema.canvasDocuments.spaceId, this.spaceId),
      isNull(schema.canvasDocuments.deletedAt),
    )).get();
    if (!row) throw new CanvasNotFoundError(`canvas not found: ${canvasId}`);
    return snapshot(row);
  }

  exportScene(canvasId: string): { format: "kith-canvas-scene"; version: 1; title: string; scene: CanvasJson } {
    const current = this.read(canvasId);
    const scene = cloneJson(current.document);
    if (scene && typeof scene === "object" && !Array.isArray(scene)) {
      delete (scene as Record<string, CanvasJson>).pages;
      delete (scene as Record<string, CanvasJson>).activePageId;
    }
    return { format: "kith-canvas-scene", version: 1, title: current.title, scene };
  }

  /** Soft deletion keeps the mutation ledger and asset rows recoverable. Asset
   * GC is intentionally deferred until no retained history can reach them. */
  delete(canvasId: string, operationId: string, expectedRevision: number): CanvasSnapshot {
    return this.db.transaction((tx) => {
      const hash = requestHash({ kind: "delete", expectedRevision });
      const duplicate = tx.select().from(schema.canvasMutations).where(and(
        eq(schema.canvasMutations.canvasId, canvasId), eq(schema.canvasMutations.operationId, operationId),
      )).get();
      if (duplicate) {
        if (duplicate.requestHash !== hash) throw new CanvasIdempotencyError("delete operation id was reused with different input");
        return this.resultForMutation(duplicate);
      }
      const row = tx.select().from(schema.canvasDocuments).where(and(
        eq(schema.canvasDocuments.id, canvasId), eq(schema.canvasDocuments.spaceId, this.spaceId),
      )).get();
      if (!row) throw new CanvasNotFoundError(`canvas not found: ${canvasId}`);
      if (row.deletedAt) throw new CanvasNotFoundError(`canvas not found: ${canvasId}`);
      const current = snapshot(row);
      if (current.revisions.revision !== expectedRevision) throw new CanvasConflictError(current.revisions.revision);
      const deleted = tx.update(schema.canvasDocuments).set({
        deletedAt: new Date(), updatedAt: new Date(), revision: current.revisions.revision + 1,
        metadataRevision: current.revisions.metadata + 1, realtimeSequence: current.sequence + 1,
      }).where(and(eq(schema.canvasDocuments.id, canvasId), eq(schema.canvasDocuments.spaceId, this.spaceId))).returning().get();
      const result = snapshot(deleted);
      tx.insert(schema.canvasMutations).values({
        canvasId, operationId, sequence: result.sequence, kind: "delete", expectedRevision,
        requestHash: hash, operation: { type: "metadata.rename", title: current.title },
        beforeTitle: current.title, afterTitle: current.title, beforeDocument: {}, afterDocument: {},
        impact: { ...emptyImpact(), metadata: true, writeResources: ["metadata:lifecycle"] },
        result: storedResult(result),
      }).run();
      return result;
    });
  }

  apply(input: ApplyCanvasOperationInput): CanvasSnapshot {
    return this.db.transaction((tx) => {
      const hash = requestHash({ expectedRevision: input.expectedRevision, operation: input.operation });
      const existing = tx.select().from(schema.canvasMutations).where(and(
        eq(schema.canvasMutations.canvasId, input.canvasId),
        eq(schema.canvasMutations.operationId, input.operationId),
      )).get();
      if (existing) {
        if (existing.requestHash !== hash) throw new CanvasIdempotencyError("operation id was reused with different input");
        return this.resultForMutation(existing);
      }
      const current = this.read(input.canvasId);
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision > current.revisions.revision) {
        throw new CanvasConflictError(current.revisions.revision);
      }
      const result = patchDocument(current.document, input.operation, current.title);
      const nextElementRevision = current.revisions.element + Number(result.impact.element);
      const nextFrameRevision = current.revisions.frame + Number(result.impact.frame);
      if (result.impact.element) {
        stampCanvasEntityRevisions(result.document, result.impact.elementIds, [], nextElementRevision, nextFrameRevision);
      }
      if (result.impact.frame) {
        stampCanvasEntityRevisions(result.document, [], result.impact.frameIds, nextElementRevision, nextFrameRevision);
      }
      if (input.expectedRevision < current.revisions.revision) {
        const committed = tx.select({ impact: schema.canvasMutations.impact }).from(schema.canvasMutations).where(and(
          eq(schema.canvasMutations.canvasId, input.canvasId),
          gt(schema.canvasMutations.sequence, input.expectedRevision),
        )).all();
        if (committed.some(({ impact }) => impactsConflict(result.impact, impact as CanvasMutationImpact))) {
          throw new CanvasConflictError(current.revisions.revision);
        }
      }
      this.assertDurableMedia(result.document, input.canvasId);
      const now = new Date();
      tx.update(schema.canvasMutations).set({ state: "discarded" }).where(and(
        eq(schema.canvasMutations.canvasId, input.canvasId),
        eq(schema.canvasMutations.kind, "edit"),
        eq(schema.canvasMutations.state, "reverted"),
      )).run();
      const row = tx.update(schema.canvasDocuments).set({
        ...(result.title ? { title: result.title } : {}),
        document: result.document,
        revision: current.revisions.revision + 1,
        metadataRevision: current.revisions.metadata + Number(result.impact.metadata),
        documentRevision: current.revisions.document + Number(result.impact.document),
        elementRevision: current.revisions.element + Number(result.impact.element),
        frameRevision: current.revisions.frame + Number(result.impact.frame),
        structureRevision: current.revisions.structure + Number(result.impact.structure),
        realtimeSequence: current.sequence + 1,
        updatedAt: now,
      }).where(eq(schema.canvasDocuments.id, input.canvasId)).returning().get();
      tx.insert(schema.canvasMutations).values({
        canvasId: input.canvasId,
        operationId: input.operationId,
        sequence: row.realtimeSequence,
        kind: "edit",
        expectedRevision: input.expectedRevision,
        requestHash: hash,
        operation: input.operation,
        beforeTitle: current.title,
        afterTitle: row.title,
        beforeDocument: result.inverseOperation,
        afterDocument: {},
        impact: result.impact,
        result: storedResult(snapshot(row)),
      }).run();
      return snapshot(row);
    });
  }

  undo(canvasId: string, operationId: string, expectedRevision: number): CanvasSnapshot {
    return this.historyMutation("undo", canvasId, operationId, expectedRevision);
  }

  redo(canvasId: string, operationId: string, expectedRevision: number): CanvasSnapshot {
    return this.historyMutation("redo", canvasId, operationId, expectedRevision);
  }

  changesSince(canvasId: string, sequence: number) {
    this.read(canvasId);
    return this.db.select({
      sequence: schema.canvasMutations.sequence,
      kind: schema.canvasMutations.kind,
      impact: schema.canvasMutations.impact,
      createdAt: schema.canvasMutations.createdAt,
    }).from(schema.canvasMutations).where(and(
      eq(schema.canvasMutations.canvasId, canvasId),
      gt(schema.canvasMutations.sequence, sequence),
    )).orderBy(asc(schema.canvasMutations.sequence)).limit(256).all();
  }

  recoverySince(canvasId: string, sequence: number) {
    const row = this.db.select().from(schema.canvasDocuments).where(and(
      eq(schema.canvasDocuments.id, canvasId),
      eq(schema.canvasDocuments.spaceId, this.spaceId),
    )).get();
    if (!row) throw new CanvasNotFoundError(`canvas not found: ${canvasId}`);
    if (row.deletedAt) {
      return {
        deleted: true as const,
        canvasId,
        spaceId: this.spaceId,
        sequence: row.realtimeSequence,
      };
    }
    return {
      deleted: false as const,
      snapshot: snapshot(row),
      changes: this.changesSince(canvasId, sequence),
    };
  }

  private historyMutation(kind: "undo" | "redo", canvasId: string, operationId: string, expectedRevision: number): CanvasSnapshot {
    return this.db.transaction((tx) => {
      const hash = requestHash({ kind, expectedRevision });
      const duplicate = tx.select().from(schema.canvasMutations).where(and(
        eq(schema.canvasMutations.canvasId, canvasId), eq(schema.canvasMutations.operationId, operationId),
      )).get();
      if (duplicate) {
        if (duplicate.requestHash !== hash) throw new CanvasIdempotencyError("operation id was reused with different input");
        return this.resultForMutation(duplicate);
      }
      const current = this.read(canvasId);
      if (current.revisions.revision !== expectedRevision) throw new CanvasConflictError(current.revisions.revision);
      const source = tx.select().from(schema.canvasMutations).where(and(
        eq(schema.canvasMutations.canvasId, canvasId),
        eq(schema.canvasMutations.kind, "edit"),
        eq(schema.canvasMutations.state, kind === "undo" ? "applied" : "reverted"),
      )).orderBy(kind === "undo" ? desc(schema.canvasMutations.sequence) : asc(schema.canvasMutations.sequence)).get();
      if (!source) throw new CanvasValidationError(`nothing to ${kind}`);
      const impact = source.impact as CanvasMutationImpact;
      const operation = cloneJson(kind === "undo" ? source.beforeDocument : source.operation) as CanvasOperation;
      const applied = patchDocument(current.document, operation, current.title);
      const document = applied.document;
      const title = applied.title ?? current.title;
      const nextElementRevision = current.revisions.element + Number(impact.element);
      const nextFrameRevision = current.revisions.frame + Number(impact.frame);
      if (impact.element) {
        stampCanvasEntityRevisions(document, impact.elementIds, [], nextElementRevision, nextFrameRevision);
      }
      if (impact.frame) {
        stampCanvasEntityRevisions(document, [], impact.frameIds, nextElementRevision, nextFrameRevision);
      }
      this.assertDurableMedia(document, canvasId);
      tx.update(schema.canvasMutations).set({ state: kind === "undo" ? "reverted" : "applied" })
        .where(eq(schema.canvasMutations.id, source.id)).run();
      const row = tx.update(schema.canvasDocuments).set({
        title,
        document,
        revision: current.revisions.revision + 1,
        metadataRevision: current.revisions.metadata + Number(impact.metadata),
        documentRevision: current.revisions.document + Number(impact.document),
        elementRevision: current.revisions.element + Number(impact.element),
        frameRevision: current.revisions.frame + Number(impact.frame),
        structureRevision: current.revisions.structure + Number(impact.structure),
        realtimeSequence: current.sequence + 1,
        updatedAt: new Date(),
      }).where(eq(schema.canvasDocuments.id, canvasId)).returning().get();
      tx.insert(schema.canvasMutations).values({
        canvasId,
        operationId,
        sequence: row.realtimeSequence,
        kind,
        sourceMutationId: source.id,
        expectedRevision,
        requestHash: hash,
        operation,
        beforeTitle: current.title,
        afterTitle: title,
        beforeDocument: {},
        afterDocument: {},
        impact,
        result: storedResult(snapshot(row)),
      }).run();
      return snapshot(row);
    });
  }

  private resultForMutation(target: typeof schema.canvasMutations.$inferSelect): CanvasSnapshot {
    const rows = this.db.select().from(schema.canvasMutations).where(and(
      eq(schema.canvasMutations.canvasId, target.canvasId),
      lte(schema.canvasMutations.sequence, target.sequence),
    )).orderBy(asc(schema.canvasMutations.sequence)).all();
    const created = rows.find((row) => row.kind === "create");
    if (!created) throw new CanvasValidationError("canvas creation checkpoint is missing");
    let document = cloneJson(created.afterDocument);
    let title = created.afterTitle;
    for (const row of rows) {
      if (row.kind === "create") continue;
      const applied = patchDocument(document, row.operation as CanvasOperation, title);
      document = applied.document;
      title = applied.title ?? title;
      const stored = row.result as StoredCanvasResult;
      const impact = row.impact as CanvasMutationImpact;
      if (impact.element) {
        stampCanvasEntityRevisions(
          document,
          impact.elementIds.length ? impact.elementIds : "all",
          [],
          stored.revisions.element,
          stored.revisions.frame,
        );
      }
      if (impact.frame) {
        stampCanvasEntityRevisions(
          document,
          [],
          impact.frameIds.length ? impact.frameIds : "all",
          stored.revisions.element,
          stored.revisions.frame,
        );
      }
    }
    return { ...(target.result as StoredCanvasResult), title, document };
  }

  private assertDurableMedia(document: CanvasJson, targetCanvasId: string): void {
    const inspect = (value: CanvasJson, key = ""): void => {
      if (typeof value === "string" && MEDIA_URL_KEYS.has(key)) {
        const url = value.trim();
        if (!url) return;
        const match = /^\/api\/canvas-assets\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url);
        if (!match) throw new CanvasValidationError("canvas media must use a durable local asset URL");
        let spaceId: string;
        let canvasId: string;
        let assetId: string;
        try {
          spaceId = decodeURIComponent(match[1]!);
          canvasId = decodeURIComponent(match[2]!);
          assetId = decodeURIComponent(match[3]!);
        } catch {
          throw new CanvasValidationError("canvas media asset URL is malformed");
        }
        if (spaceId !== this.spaceId) throw new CanvasValidationError("canvas media cannot cross Space boundaries");
        if (canvasId !== targetCanvasId) throw new CanvasValidationError("canvas media cannot cross Canvas boundaries");
        const asset = this.db.select({ id: schema.canvasAssets.id }).from(schema.canvasAssets).innerJoin(
          schema.canvasDocuments,
          eq(schema.canvasDocuments.id, schema.canvasAssets.canvasId),
        ).where(and(
          eq(schema.canvasAssets.id, assetId),
          eq(schema.canvasAssets.canvasId, canvasId),
          eq(schema.canvasAssets.state, "ready"),
          isNull(schema.canvasAssets.deletedAt),
          eq(schema.canvasDocuments.spaceId, this.spaceId),
          isNull(schema.canvasDocuments.deletedAt),
        )).get();
        if (!asset) throw new CanvasValidationError("canvas media asset does not exist");
        return;
      }
      if (Array.isArray(value)) for (const child of value) inspect(child);
      else if (value && typeof value === "object") for (const [childKey, child] of Object.entries(value)) inspect(child, childKey);
    };
    inspect(document);
  }
}
