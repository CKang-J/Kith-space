import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { SpaceTransaction } from "../counters.js";
import type { SpaceDb } from "../db/index.js";
import { schema } from "../db/index.js";
import { CanvasNotFoundError, CanvasValidationError } from "./canvasCore.js";
import { canonicalJson } from "./canonicalJson.js";
import { readEntityRevision } from "./canvasEntityRevision.js";
import { canvasNodeBelongsToFrame } from "./canvasFrameMembership.js";
import {
  canvasSelectionSummaryParts,
  formatCanvasSelectionSummary,
} from "./canvasSelectionSummary.js";
import type {
  CanvasElementProjection,
  CanvasFrameProjection,
  CanvasJson,
  CanvasMarkedRegion,
  CanvasSelectionInput,
  CanvasSelectionProjection,
  FrozenCanvasSelectionSnapshot,
} from "./canvasTypes.js";

export const CANVAS_SELECTION_SNAPSHOT_REF_TYPE = "canvas_selection_snapshot";
export const MAX_CANVAS_SELECTION_IDS = 80;
export const MAX_CANVAS_MARKED_REGIONS = 8;
const MAX_TEXT = 400;
const FRAME_PREFIX = "frame:";
const MARKED_REGION_KINDS = new Set(["manual", "image", "text", "subject"]);

function asRecord(value: unknown): Record<string, CanvasJson> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, CanvasJson>
    : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function parseSelectedIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (!id || id.length > 256 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_CANVAS_SELECTION_IDS) break;
  }
  return ids;
}

function unit01(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return Number(value.toFixed(4));
}

export function parseCanvasMarkedRegions(raw: unknown, selectedIds: readonly string[]): CanvasMarkedRegion[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(selectedIds.filter((id) => id && !id.startsWith(FRAME_PREFIX)));
  const out: CanvasMarkedRegion[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const nodeId = typeof rec.nodeId === "string" ? rec.nodeId.trim() : "";
    if (!nodeId || nodeId.length > 256) continue;
    if (allowed.size && !allowed.has(nodeId)) continue;
    const nx = unit01(rec.nx);
    const ny = unit01(rec.ny);
    const nw = unit01(rec.nw);
    const nh = unit01(rec.nh);
    if (nx == null || ny == null || nw == null || nh == null) continue;
    if (nw < 0.001 || nh < 0.001) continue;
    if (nx + nw > 1.001 || ny + nh > 1.001) continue;
    const kindRaw = typeof rec.kind === "string" ? rec.kind.trim() : "manual";
    const kind = MARKED_REGION_KINDS.has(kindRaw) ? kindRaw : "manual";
    const label = stringOrNull(typeof rec.label === "string" ? rec.label : null, 80) || "marked region";
    const key = `${nodeId}:${nx}:${ny}:${nw}:${nh}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ nodeId, label, kind, nx, ny, nw, nh });
    if (out.length >= MAX_CANVAS_MARKED_REGIONS) break;
  }
  return out;
}

function nodeKey(node: Record<string, CanvasJson>): string | null {
  return typeof node.key === "string" ? node.key : typeof node.type === "string" ? node.type : null;
}

function assetIdFrom(node: Record<string, CanvasJson>): string | null {
  const attrs = asRecord(node.attrs);
  for (const source of [node, attrs ?? {}]) {
    const assetId = source.assetId;
    if (typeof assetId === "string" && assetId) return assetId;
  }
  return null;
}

function projectElement(id: string, node: Record<string, CanvasJson>): CanvasElementProjection {
  const attrs = asRecord(node.attrs) ?? {};
  return {
    id,
    key: nodeKey(node),
    x: numberOrNull(node.x ?? attrs.x),
    y: numberOrNull(node.y ?? attrs.y),
    width: numberOrNull(node.width ?? attrs.width),
    height: numberOrNull(node.height ?? attrs.height),
    text: stringOrNull(node.text ?? attrs.text ?? node.content),
    fill: (node.fill ?? attrs.fill ?? null) as CanvasJson | null,
    stroke: (node.stroke ?? attrs.stroke ?? null) as CanvasJson | null,
    assetId: assetIdFrom(node),
  };
}

function projectFrame(frame: Record<string, CanvasJson>): CanvasFrameProjection | null {
  const id = typeof frame.id === "string" ? frame.id : null;
  if (!id) return null;
  return {
    id,
    name: stringOrNull(frame.name ?? frame.title),
    x: numberOrNull(frame.x),
    y: numberOrNull(frame.y),
    width: numberOrNull(frame.width),
    height: numberOrNull(frame.height),
  };
}

function summarize(projection: CanvasSelectionProjection): string {
  return formatCanvasSelectionSummary(canvasSelectionSummaryParts({
    canvasTitle: projection.canvasTitle,
    wholeCanvas: projection.wholeCanvas,
    elementCount: projection.elements.length,
    frameCount: projection.frames.length,
    truncated: projection.truncated,
    documentRevision: projection.documentRevision,
  }));
}

export function parseCanvasSelectionInput(value: unknown): CanvasSelectionInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const canvasId = typeof raw.canvasId === "string" ? raw.canvasId.trim() : "";
  if (!canvasId || canvasId.length > 128) return null;
  const selectedIds = parseSelectedIds(raw.selectedIds);
  const markedRegions = parseCanvasMarkedRegions(raw.markedRegions, selectedIds);
  return {
    canvasId,
    selectedIds,
    ...(markedRegions.length ? { markedRegions } : {}),
  };
}

export function freezeCanvasSelectionInTransaction(
  tx: SpaceTransaction,
  spaceId: string,
  input: CanvasSelectionInput,
  createdBy: string,
  snapshotId = randomUUID(),
): FrozenCanvasSelectionSnapshot {
  const row = tx.select().from(schema.canvasDocuments).where(and(
    eq(schema.canvasDocuments.id, input.canvasId),
    eq(schema.canvasDocuments.spaceId, spaceId),
  )).get();
  if (!row) throw new CanvasNotFoundError(`canvas not found: ${input.canvasId}`);
  if (row.deletedAt) throw new CanvasNotFoundError(`canvas not found: ${input.canvasId}`);

  const document = row.document;
  const root = asRecord(document) ?? {};
  const nodes = asRecord(root.deltaSetLike) ?? {};
  const frames = Array.isArray(root.frames)
    ? root.frames.flatMap((frame) => {
      const record = asRecord(frame);
      return record ? [record] : [];
    })
    : [];
  const frameById = new Map(frames.flatMap((frame) => typeof frame.id === "string" ? [[frame.id, frame] as const] : []));
  const requested = input.selectedIds ?? [];
  const wholeCanvas = requested.length === 0;
  const selectedNodeIds: string[] = [];
  const selectedFrameIds: string[] = [];
  const seenNodes = new Set<string>();
  const seenFrames = new Set<string>();

  const takeNode = (id: string) => {
    if (id === "ROOT" || seenNodes.has(id) || !nodes[id]) return;
    seenNodes.add(id);
    selectedNodeIds.push(id);
  };
  const takeFrame = (id: string) => {
    if (seenFrames.has(id) || !frameById.has(id)) return;
    seenFrames.add(id);
    selectedFrameIds.push(id);
  };

  if (wholeCanvas) {
    for (const id of Object.keys(nodes)) takeNode(id);
    for (const frame of frames) {
      if (typeof frame.id === "string") takeFrame(frame.id);
    }
  } else {
    for (const token of requested) {
      if (token.startsWith(FRAME_PREFIX)) takeFrame(token.slice(FRAME_PREFIX.length));
      else if (frameById.has(token) && !nodes[token]) takeFrame(token);
      else takeNode(token);
    }
    for (const frameId of selectedFrameIds) {
      const frame = frameById.get(frameId);
      if (!frame) continue;
      for (const id of Object.keys(nodes)) {
        const node = asRecord(nodes[id]);
        if (!node) continue;
        if (canvasNodeBelongsToFrame(node, frame, frameId)) takeNode(id);
      }
    }
  }
  if (!wholeCanvas && !selectedNodeIds.length && !selectedFrameIds.length) {
    throw new CanvasValidationError("canvas selection does not match any live element or Frame");
  }

  const truncated = selectedNodeIds.length + selectedFrameIds.length > MAX_CANVAS_SELECTION_IDS;
  const limitedFrames = selectedFrameIds.slice(0, MAX_CANVAS_SELECTION_IDS);
  const remaining = MAX_CANVAS_SELECTION_IDS - limitedFrames.length;
  const limitedNodes = selectedNodeIds.slice(0, Math.max(0, remaining));
  const membershipIncluded = wholeCanvas || limitedFrames.length > 0;
  const projection: CanvasSelectionProjection = {
    canvasId: row.id,
    canvasTitle: row.title,
    documentRevision: row.documentRevision,
    structureRevision: membershipIncluded ? row.structureRevision : null,
    elements: limitedNodes.flatMap((id) => {
      const node = asRecord(nodes[id]);
      return node ? [projectElement(id, node)] : [];
    }),
    frames: limitedFrames.flatMap((id) => {
      const frame = frameById.get(id);
      return frame ? [projectFrame(frame) ?? []].flat() : [];
    }),
    membershipIncluded,
    truncated,
    wholeCanvas,
  };
  const liveMarked = parseCanvasMarkedRegions(input.markedRegions, limitedNodes);
  if (liveMarked.length) projection.markedRegions = liveMarked;
  const selectedElements = limitedNodes.map((id) => ({
    id,
    revision: readEntityRevision(nodes[id], 0),
  }));
  const selectedFrames = limitedFrames.map((id) => ({
    id,
    revision: readEntityRevision(frameById.get(id), 0),
  }));
  const selectionHash = createHash("sha256").update(canonicalJson({
    canvasId: row.id,
    documentRevision: row.documentRevision,
    structureRevision: projection.structureRevision,
    selectedElements,
    selectedFrames,
    projection,
  })).digest("hex");
  const summary = summarize(projection);
  tx.insert(schema.canvasSelectionSnapshots).values({
    id: snapshotId,
    spaceId,
    canvasId: row.id,
    messageId: null,
    documentRevision: row.documentRevision,
    structureRevision: projection.structureRevision,
    selectedElements,
    selectedFrames,
    projection: projection as unknown as Record<string, unknown>,
    previewAssetId: null,
    selectionHash,
    summary,
    createdBy,
  }).run();
  return {
    snapshotId,
    canvasId: row.id,
    canvasTitle: row.title,
    documentRevision: row.documentRevision,
    structureRevision: projection.structureRevision,
    selectedElements,
    selectedFrames,
    projection,
    previewAssetId: null,
    selectionHash,
    summary,
    deepLink: { moduleId: "canvas", canvas: row.id },
    canvasDeleted: false,
  };
}

export function attachCanvasSelectionToMessage(
  tx: SpaceTransaction,
  snapshotId: string,
  messageId: string,
): void {
  tx.update(schema.canvasSelectionSnapshots).set({ messageId })
    .where(eq(schema.canvasSelectionSnapshots.id, snapshotId)).run();
}

export function canvasSelectionPresentation(
  snapshot: typeof schema.canvasSelectionSnapshots.$inferSelect,
  canvasDeleted: boolean,
): FrozenCanvasSelectionSnapshot {
  const projection = snapshot.projection as unknown as CanvasSelectionProjection;
  return {
    snapshotId: snapshot.id,
    canvasId: snapshot.canvasId,
    canvasTitle: projection.canvasTitle,
    documentRevision: snapshot.documentRevision,
    structureRevision: snapshot.structureRevision,
    selectedElements: snapshot.selectedElements,
    selectedFrames: snapshot.selectedFrames,
    projection,
    previewAssetId: snapshot.previewAssetId,
    selectionHash: snapshot.selectionHash,
    summary: snapshot.summary,
    deepLink: { moduleId: "canvas", canvas: snapshot.canvasId },
    canvasDeleted,
  };
}

export function loadCanvasContextsForMessages(
  db: SpaceDb,
  spaceId: string,
  messageIds: string[],
): Map<string, FrozenCanvasSelectionSnapshot[]> {
  const result = new Map<string, FrozenCanvasSelectionSnapshot[]>();
  if (!messageIds.length) return result;
  const rows = db.select().from(schema.canvasSelectionSnapshots)
    .where(inArray(schema.canvasSelectionSnapshots.messageId, messageIds)).all();
  if (!rows.length) return result;
  const canvasIds = [...new Set(rows.map((row) => row.canvasId))];
  const canvases = db.select({
    id: schema.canvasDocuments.id,
    deletedAt: schema.canvasDocuments.deletedAt,
  }).from(schema.canvasDocuments).where(and(
    eq(schema.canvasDocuments.spaceId, spaceId),
    inArray(schema.canvasDocuments.id, canvasIds),
  )).all();
  const deleted = new Set(canvases.filter((row) => row.deletedAt).map((row) => row.id));
  const missing = new Set(canvasIds.filter((id) => !canvases.some((row) => row.id === id)));
  const ordered = [...rows].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id);
  });
  for (const row of ordered) {
    if (!row.messageId) continue;
    const list = result.get(row.messageId) ?? [];
    list.push(canvasSelectionPresentation(row, deleted.has(row.canvasId) || missing.has(row.canvasId)));
    result.set(row.messageId, list);
  }
  return result;
}
