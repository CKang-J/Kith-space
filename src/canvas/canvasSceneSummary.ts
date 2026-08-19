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

const CANVAS_AVAILABLE_FONTS = ["Alibaba PuHuiTi", "Inter"] as const;

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

function mapElement(id: string, node: Record<string, unknown>): CanvasSceneSummaryElement {
  const attrs = asRecord(node.attrs) ?? {};
  return {
    id,
    type: stringOf(node.key),
    name: stringOf(node.name),
    parentId: stringOf(node.parentId),
    frameId: stringOf(node.frameId),
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

function liveFrames(document: CanvasJson): CanvasSceneSummaryFrame[] {
  const root = asRecord(document) ?? {};
  const frames = Array.isArray(root.frames) ? root.frames : [];
  return frames.flatMap((item) => {
    const record = asRecord(item);
    const mapped = record ? mapFrame(record) : null;
    return mapped ? [mapped] : [];
  });
}

function liveElements(document: CanvasJson, ids: string[]): CanvasSceneSummaryElement[] {
  const root = asRecord(document) ?? {};
  const nodes = asRecord(root.deltaSetLike) ?? {};
  return ids.flatMap((id) => {
    const node = asRecord(nodes[id]);
    return node ? [mapElement(id, node)] : [];
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
  const allowed = new Set(grant.objectScope.elementIds);
  return elements.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string" || !allowed.has(record.id)) return [];
    return [mapElement(record.id, record)];
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
      const preview = node.text ? ` text_preview=${JSON.stringify(node.text.slice(0, 40))}` : "";
      return `- ${node.id}: ${node.type ?? "node"} name=${node.name ?? "—"} x=${formatNum(node.bounds.x)} y=${formatNum(node.bounds.y)} w=${formatNum(node.bounds.width)} h=${formatNum(node.bounds.height)} parent=${node.parentId ?? "ROOT"} frame=${node.frameId ?? "—"}${style.length ? ` style: ${style.join(" ")}` : ""}${preview}`;
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
    "=== GRANT ===",
    `actions: ${input.actions.join(", ") || "—"}`,
    `createParents: ${input.allowedCreateParents.join(", ") || "—"}`,
    `selectedElements: [${input.selectedElementIds.join(", ")}]`,
    `selectedFrames: [${input.selectedFrameIds.join(", ")}]`,
    "",
    `=== AVAILABLE_FONTS ===`,
    input.availableFonts.join(", "),
  ].join("\n");
}

export function executeCanvasSceneSummary(
  db: SpaceDb,
  tx: SpaceTransaction,
  spaceId: string,
  claims: TurnCapabilityClaims,
  command: CanvasSceneSummaryCommand,
  now: number,
): CanvasSceneSummary {
  const grant = resolveCanvasAccessGrantInTransaction(tx, {
    turnId: claims.turnId,
    executorAgentId: claims.agentId,
    requestedCanvasId: command.canvasId,
    requestedSnapshotId: command.snapshotId,
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
  if (liveRead) {
    const live = new CanvasCore(db, spaceId).read(grant.canvasId);
    revision = live.revisions.revision;
    const document = live.document as CanvasJson;
    canvasSize = liveCanvasSize(document);
    const frames = liveFrames(document);
    const allowedFrames = new Set(grant.objectScope.frameIds);
    selectedFrames = frames.filter((frame) => allowedFrames.has(frame.id));
    elements = liveElements(document, grant.objectScope.elementIds);
  }
  const allowedCreateParents = grant.objectScope.emptySelection ? [] : grant.objectScope.createParents;
  const focusFrameId = selectedFrames.length === 1 ? selectedFrames[0]!.id : null;
  const availableFonts = [...CANVAS_AVAILABLE_FONTS];
  const nextSuggestedAction = grant.objectScope.emptySelection
    ? "Grant is read-only. Use canvas.snapshot_get / canvas.export. Do not call create/update/delete."
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
  });
  return {
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
  };
}
