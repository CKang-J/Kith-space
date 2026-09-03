import type { SpaceTransaction } from "../counters.js";
import type { SpaceDb } from "../db/index.js";
import type { TurnCapabilityClaims } from "../capabilities/contracts.js";
import { CanvasCore } from "./canvasCore.js";
import {
  assertLiveCanvasAccessGrant,
  resolveCanvasAccessGrantInTransaction,
  type CanvasAccessGrantRow,
} from "./canvasAccessGrant.js";
import type { CanvasJson } from "./canvasTypes.js";
import type { CanvasSceneSummaryCommand } from "./canvasAgentTools.js";
import { MAX_CANVAS_SELECTION_IDS } from "./canvasSelectionSnapshot.js";
import { canvasNodeBelongsToFrame } from "./canvasFrameMembership.js";
import { CANVAS_AVAILABLE_FONTS, canvasAvailableFontLabels } from "./fonts/fontsCatalog.js";
import { computeCanvasSceneFacts, formatCanvasSceneFacts, type CanvasSceneFacts } from "./canvasSceneFacts.js";

const MAX_SCENE_NODES = 50;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function textOf(node: Record<string, unknown>): string | null {
  if (typeof node.text === "string" && node.text) return node.text;
  const attrs = asRecord(node.attrs);
  return typeof attrs?.text === "string" && attrs.text ? attrs.text : null;
}

function paintOf(node: Record<string, unknown>, key: "fill" | "stroke"): string | null {
  if (typeof node[key] === "string" && node[key]) return String(node[key]);
  const attrs = asRecord(node.attrs);
  if (!attrs) return null;
  if (key === "fill") {
    return stringOf(attrs["fill-color"]) ?? stringOf(attrs.fill);
  }
  return stringOf(attrs["border-color"]) ?? stringOf(attrs.stroke);
}

export type CanvasSceneSummaryFrame = {
  id: string;
  name: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  backgroundColor: string | null;
  locked: boolean | null;
};

export type CanvasSceneSummaryElement = {
  id: string;
  type: string | null;
  name: string | null;
  parentId: string | null;
  frameId: string | null;
  shapeType: string | null;
  fill: string | null;
  stroke: string | null;
  bounds: { x: number | null; y: number | null; width: number | null; height: number | null };
  text: string | null;
};

export type CanvasSceneSummary = {
  canvasId: string;
  snapshotId: string;
  revision: number;
  grantId: string;
  focusFrameId: string | null;
  canvasSize: { width: number | null; height: number | null };
  selectedFrames: CanvasSceneSummaryFrame[];
  elements: CanvasSceneSummaryElement[];
  allowedCreateParents: string[];
  availableFonts: string[];
  emptySelection: boolean;
  nextSuggestedAction: string;
  contextText: string;
};

function mapFrame(record: Record<string, unknown>): CanvasSceneSummaryFrame | null {
  if (typeof record.id !== "string") return null;
  return {
    id: record.id,
    name: stringOf(record.name),
    x: numberOf(record.x),
    y: numberOf(record.y),
    width: numberOf(record.width),
    height: numberOf(record.height),
    backgroundColor: stringOf(record.backgroundColor),
    locked: typeof record.locked === "boolean" ? record.locked : null,
  };
}

function mapElement(id: string, node: Record<string, unknown>, inferredFrameId: string | null = null): CanvasSceneSummaryElement {
  const attrs = asRecord(node.attrs) ?? {};
  return {
    id,
    type: stringOf(node.key),
    name: stringOf(node.name),
    parentId: stringOf(node.parentId),
    frameId: stringOf(node.frameId) ?? inferredFrameId,
    shapeType: stringOf(node.shapeType) ?? stringOf(attrs.shapeType),
    fill: paintOf(node, "fill"),
    stroke: paintOf(node, "stroke"),
    bounds: {
      x: numberOf(node.x),
      y: numberOf(node.y),
      width: numberOf(node.width),
      height: numberOf(node.height),
    },
    text: textOf(node),
  };
}

function inferElementFrameId(
  node: Record<string, unknown>,
  frames: CanvasSceneSummaryFrame[],
  allowedFrames: Set<string>,
): string | null {
  const bound = stringOf(node.frameId);
  if (bound) return bound;
  for (const frame of frames) {
    if (allowedFrames.has(frame.id) && canvasNodeBelongsToFrame(node, frame, frame.id)) return frame.id;
  }
  return null;
}

function liveFrames(document: CanvasJson): CanvasSceneSummaryFrame[] {
  const root = asRecord(document) ?? {};
  const frames = Array.isArray(root.frames) ? root.frames : [];
  return frames.flatMap((item) => {
    const record = asRecord(item);
    const mapped = record ? mapFrame(record) : null;
    return mapped ? [mapped] : [];
  });
}

function liveElements(document: CanvasJson, grant: CanvasAccessGrantRow): CanvasSceneSummaryElement[] {
  const root = asRecord(document) ?? {};
  const nodes = asRecord(root.deltaSetLike) ?? {};
  const frames = liveFrames(document);
  const frameById = new Map(frames.map((frame) => [frame.id, frame]));
  const allowedFrames = new Set(grant.objectScope.frameIds);
  const ids: string[] = [];
  const seen = new Set<string>();
  const take = (id: string) => {
    if (id === "ROOT" || seen.has(id) || !nodes[id]) return;
    seen.add(id);
    ids.push(id);
  };
  if (grant.objectScope.emptySelection) {
    const rootNode = asRecord(nodes.ROOT);
    const children = Array.isArray(rootNode?.children) ? rootNode.children : [];
    for (const id of children) {
      if (typeof id === "string") take(id);
    }
  }
  for (const id of grant.objectScope.elementIds) take(id);
  if (allowedFrames.size) {
    for (const id of Object.keys(nodes)) {
      const node = asRecord(nodes[id]);
      if (!node) continue;
      for (const frameId of allowedFrames) {
        const frame = frameById.get(frameId);
        if (frame && canvasNodeBelongsToFrame(node, frame, frameId)) {
          take(id);
          break;
        }
      }
    }
  }
  const limited = grant.objectScope.emptySelection ? ids.slice(0, MAX_SCENE_NODES) : ids.slice(0, MAX_CANVAS_SELECTION_IDS);
  return limited.flatMap((id) => {
    const node = asRecord(nodes[id]);
    return node ? [mapElement(id, node, inferElementFrameId(node, frames, allowedFrames))] : [];
  });
}

function liveCanvasSize(document: CanvasJson): { width: number | null; height: number | null } {
  const root = asRecord(document) ?? {};
  return { width: numberOf(root.width), height: numberOf(root.height) };
}

function snapshotFrames(grant: CanvasAccessGrantRow, snapshot: { projection: unknown; selectedFrames: Array<{ id: string }> }): CanvasSceneSummaryFrame[] {
  const projection = asRecord(snapshot.projection);
  const frames = Array.isArray(projection?.frames) ? projection.frames : [];
  const allowed = new Set(grant.objectScope.frameIds);
  return frames.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string" || !allowed.has(record.id)) return [];
    const mapped = mapFrame(record);
    return mapped ? [mapped] : [];
  });
}

function snapshotElements(grant: CanvasAccessGrantRow, snapshot: { projection: unknown }): CanvasSceneSummaryElement[] {
  const projection = asRecord(snapshot.projection);
  const elements = Array.isArray(projection?.elements) ? projection.elements : [];
  const frames = snapshotFrames(grant, { projection, selectedFrames: grant.objectScope.frameIds.map((id) => ({ id })) });
  const allowed = new Set(grant.objectScope.elementIds);
  const allowedFrames = new Set(grant.objectScope.frameIds);
  return elements.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string" || !allowed.has(record.id)) return [];
    return [mapElement(record.id, record, inferElementFrameId(record, frames, allowedFrames))];
  });
}

function formatNum(value: number | null): string {
  return value == null ? "?" : String(value);
}

function formatCanvasSceneContextText(input: {
  canvasId: string;
  snapshotId: string;
  revision: number;
  focusFrameId: string | null;
  canvasSize: { width: number | null; height: number | null };
  selectedFrames: CanvasSceneSummaryFrame[];
  elements: CanvasSceneSummaryElement[];
  allowedCreateParents: string[];
  availableFonts: string[];
  actions: string[];
  selectedElementIds: string[];
  selectedFrameIds: string[];
  sceneFacts: CanvasSceneFacts | null;
}): string {
  const frameLines = input.selectedFrames.length
    ? input.selectedFrames.map((frame) => {
      const extras = [
        frame.backgroundColor ? `backgroundColor=${frame.backgroundColor}` : "",
        frame.locked ? "locked=true" : "",
      ].filter(Boolean);
      return `- ${frame.id}: ${frame.name ?? "Frame"} x=${formatNum(frame.x)} y=${formatNum(frame.y)} width=${formatNum(frame.width)} height=${formatNum(frame.height)}${extras.length ? ` ${extras.join(" ")}` : ""}`;
    })
    : ["- (none)"];
  const nodeLines = input.elements.length
    ? input.elements.map((node) => {
      const style = [
        node.fill ? `fill=${node.fill}` : "",
        node.stroke ? `stroke=${node.stroke}` : "",
        node.shapeType ? `shapeType=${node.shapeType}` : "",
      ].filter(Boolean);
      const preview = node.text ? ` text_preview=${JSON.stringify(node.text.slice(0, 120))}` : "";
      const local = node.frameId && input.focusFrameId === node.frameId
        ? (() => {
          const frame = input.selectedFrames.find((item) => item.id === node.frameId);
          if (!frame || node.bounds.x == null || node.bounds.y == null || frame.x == null || frame.y == null) return "";
          return ` local_x=${formatNum(node.bounds.x - frame.x)} local_y=${formatNum(node.bounds.y - frame.y)}`;
        })()
        : "";
      return `- ${node.id}: ${node.type ?? "node"} name=${node.name ?? "—"} x=${formatNum(node.bounds.x)} y=${formatNum(node.bounds.y)} w=${formatNum(node.bounds.width)} h=${formatNum(node.bounds.height)} parent=${node.parentId ?? "ROOT"} frame=${node.frameId ?? "—"}${local}${style.length ? ` style: ${style.join(" ")}` : ""}${preview}`;
    })
    : ["- (none)"];
  return [
    "=== CANVAS_SCENE ===",
    `canvasId: ${input.canvasId}`,
    `snapshotId: ${input.snapshotId}`,
    `revision: ${input.revision}`,
    `FOCUS_FRAME_ID: ${input.focusFrameId ?? "(none)"}`,
    `CANVAS_SIZE: width=${formatNum(input.canvasSize.width)} height=${formatNum(input.canvasSize.height)}`,
    "",
    "=== SCENE_FRAMES ===",
    ...frameLines,
    "",
    "=== SCENE_NODES ===",
    ...nodeLines,
    "",
    "=== SCENE_FACTS ===",
    ...(input.sceneFacts
      ? [formatCanvasSceneFacts(input.sceneFacts)]
      : ["Computed facts unavailable on a snapshot-only grant (no live canvas read). 计算事实/快照只读时不可用"]),
    "",
    "=== GRANT ===",
    `actions: ${input.actions.join(", ") || "—"}`,
    `createParents: ${input.allowedCreateParents.join(", ") || "—"}`,
    `selectedElements: [${input.selectedElementIds.join(", ")}]`,
    `selectedFrames: [${input.selectedFrameIds.join(", ")}]`,
    "",
    `=== AVAILABLE_FONTS ===`,
    canvasAvailableFontLabels(input.availableFonts).join(", "),
  ].join("\n");
}

export type CanvasSceneSummaryAssembly = {
  grant: CanvasAccessGrantRow;
  summary: CanvasSceneSummary;
  sceneFacts: CanvasSceneFacts | null;
};

/**
 * Grant-scoped scene summary assembly shared by canvas.scene_summary and
 * canvas.design_review. `requested` narrows the grant when the caller can
 * disambiguate; empty locator uses the single active grant as-is.
 */
export function assembleCanvasSceneSummaryInTransaction(
  db: SpaceDb,
  tx: SpaceTransaction,
  spaceId: string,
  claims: TurnCapabilityClaims,
  requested: { canvasId?: string; snapshotId?: string },
  now: number,
): CanvasSceneSummaryAssembly {
  const grant = resolveCanvasAccessGrantInTransaction(tx, {
    turnId: claims.turnId,
    executorAgentId: claims.agentId,
    requestedCanvasId: requested.canvasId,
    requestedSnapshotId: requested.snapshotId,
  });
  const liveRead = grant.actions.includes("read_live");
  const { snapshot } = assertLiveCanvasAccessGrant(tx, grant, {
    executorAgentId: claims.agentId,
    now,
    actions: liveRead ? ["read_live"] : ["read_snapshot"],
    allowDeletedCanvas: !liveRead,
  });
  let revision = snapshot.documentRevision;
  let selectedFrames = snapshotFrames(grant, snapshot);
  let elements = snapshotElements(grant, snapshot);
  let canvasSize = { width: null as number | null, height: null as number | null };
  let liveDocument: CanvasJson | null = null;
  if (liveRead) {
    const live = new CanvasCore(db, spaceId).read(grant.canvasId);
    revision = live.revisions.revision;
    const document = live.document as CanvasJson;
    liveDocument = document;
    canvasSize = liveCanvasSize(document);
    const frames = liveFrames(document);
    const allowedFrames = new Set(grant.objectScope.frameIds);
    selectedFrames = frames.filter((frame) => allowedFrames.has(frame.id));
    elements = liveElements(document, grant);
  }
  const allowedCreateParents = grant.objectScope.createParents;
  const canCreate = grant.actions.includes("create");
  const focusFrameId = grant.objectScope.emptySelection
    ? null
    : grant.objectScope.frameIds.length === 1
      ? grant.objectScope.frameIds[0]!
      : (selectedFrames.length === 1 ? selectedFrames[0]!.id : null);
  const availableFonts = [...CANVAS_AVAILABLE_FONTS];
  const sceneFacts = liveDocument
    ? computeCanvasSceneFacts(liveDocument, { scope: grant.objectScope, focusFrameId })
    : null;
  const nextSuggestedAction = !canCreate && grant.objectScope.emptySelection
    ? "Grant is read-only. Use canvas.snapshot_get / canvas.export. Do not call create/update/delete."
    : grant.objectScope.emptySelection
      ? "FOCUS_FRAME_ID is (none). For a new poster/banner, canvas.create_frame first at the deliverable size, then place content with that new frameId (x/y are frame-local). Do not reuse an existing SCENE_FRAMES id as FOCUS unless the user pointed at it. ALLOWED_CREATE_PARENTS includes ROOT and existing Frames. Then verify with canvas.scene_summary before turn.reply outputRefs.canvas_mutation."
      : focusFrameId
        ? `FOCUS_FRAME_ID is ${focusFrameId}. Place ALL new content inside it with frameId=${focusFrameId}. x/y are frame-local (0,0 = that Frame's top-left). Do not create another frame. Then verify with canvas.scene_summary before turn.reply outputRefs.canvas_mutation.`
        : "Create inside allowedCreateParents. Call typed canvas.create_* or canvas.update_node, then verify with canvas.scene_summary before turn.reply outputRefs.canvas_mutation.";
  const contextText = formatCanvasSceneContextText({
    canvasId: grant.canvasId,
    snapshotId: grant.snapshotId,
    revision,
    focusFrameId,
    canvasSize,
    selectedFrames,
    elements,
    allowedCreateParents,
    availableFonts,
    actions: grant.actions,
    selectedElementIds: grant.objectScope.elementIds,
    selectedFrameIds: grant.objectScope.frameIds,
    sceneFacts,
  });
  return {
    grant,
    sceneFacts,
    summary: {
      canvasId: grant.canvasId,
      snapshotId: grant.snapshotId,
      revision,
      grantId: grant.id,
      focusFrameId,
      canvasSize,
      selectedFrames,
      elements,
      allowedCreateParents,
      availableFonts,
      emptySelection: grant.objectScope.emptySelection,
      nextSuggestedAction,
      contextText,
    },
  };
}

export function executeCanvasSceneSummary(
  db: SpaceDb,
  tx: SpaceTransaction,
  spaceId: string,
  claims: TurnCapabilityClaims,
  command: CanvasSceneSummaryCommand,
  now: number,
): CanvasSceneSummary {
  return assembleCanvasSceneSummaryInTransaction(db, tx, spaceId, claims, command, now).summary;
}
