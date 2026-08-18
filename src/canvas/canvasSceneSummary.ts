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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textOf(node: Record<string, unknown>): string | null {
  if (typeof node.text === "string" && node.text) return node.text;
  const attrs = asRecord(node.attrs);
  return typeof attrs?.text === "string" && attrs.text ? attrs.text : null;
}

export type CanvasSceneSummaryFrame = {
  id: string;
  name: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
};

export type CanvasSceneSummaryElement = {
  id: string;
  type: string | null;
  parentId: string | null;
  bounds: { x: number | null; y: number | null; width: number | null; height: number | null };
  text: string | null;
};

export type CanvasSceneSummary = {
  canvasId: string;
  snapshotId: string;
  revision: number;
  grantId: string;
  selectedFrames: CanvasSceneSummaryFrame[];
  elements: CanvasSceneSummaryElement[];
  allowedCreateParents: string[];
  emptySelection: boolean;
  nextSuggestedAction: string;
};

function liveFrames(document: CanvasJson): CanvasSceneSummaryFrame[] {
  const root = asRecord(document) ?? {};
  const frames = Array.isArray(root.frames) ? root.frames : [];
  return frames.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string") return [];
    return [{
      id: record.id,
      name: typeof record.name === "string" ? record.name : null,
      x: numberOf(record.x),
      y: numberOf(record.y),
      width: numberOf(record.width),
      height: numberOf(record.height),
    }];
  });
}

function liveElements(document: CanvasJson, ids: string[]): CanvasSceneSummaryElement[] {
  const root = asRecord(document) ?? {};
  const nodes = asRecord(root.deltaSetLike) ?? {};
  return ids.flatMap((id) => {
    const node = asRecord(nodes[id]);
    if (!node) return [];
    return [{
      id,
      type: typeof node.key === "string" ? node.key : null,
      parentId: typeof node.parentId === "string" ? node.parentId : null,
      bounds: {
        x: numberOf(node.x),
        y: numberOf(node.y),
        width: numberOf(node.width),
        height: numberOf(node.height),
      },
      text: textOf(node),
    }];
  });
}

function snapshotFrames(grant: CanvasAccessGrantRow, snapshot: { projection: unknown; selectedFrames: Array<{ id: string }> }): CanvasSceneSummaryFrame[] {
  const projection = asRecord(snapshot.projection);
  const frames = Array.isArray(projection?.frames) ? projection.frames : [];
  const allowed = new Set(grant.objectScope.frameIds);
  return frames.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string" || !allowed.has(record.id)) return [];
    return [{
      id: record.id,
      name: typeof record.name === "string" ? record.name : null,
      x: numberOf(record.x),
      y: numberOf(record.y),
      width: numberOf(record.width),
      height: numberOf(record.height),
    }];
  });
}

function snapshotElements(grant: CanvasAccessGrantRow, snapshot: { projection: unknown }): CanvasSceneSummaryElement[] {
  const projection = asRecord(snapshot.projection);
  const elements = Array.isArray(projection?.elements) ? projection.elements : [];
  const allowed = new Set(grant.objectScope.elementIds);
  return elements.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string" || !allowed.has(record.id)) return [];
    return [{
      id: record.id,
      type: typeof record.key === "string" ? record.key : null,
      parentId: null,
      bounds: {
        x: numberOf(record.x),
        y: numberOf(record.y),
        width: numberOf(record.width),
        height: numberOf(record.height),
      },
      text: typeof record.text === "string" ? record.text : null,
    }];
  });
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
  if (liveRead) {
    const live = new CanvasCore(db, spaceId).read(grant.canvasId);
    revision = live.revisions.revision;
    const frames = liveFrames(live.document as CanvasJson);
    const allowedFrames = new Set(grant.objectScope.frameIds);
    selectedFrames = frames.filter((frame) => allowedFrames.has(frame.id));
    elements = liveElements(live.document as CanvasJson, grant.objectScope.elementIds);
  }
  const allowedCreateParents = grant.objectScope.emptySelection ? [] : grant.objectScope.createParents;
  return {
    canvasId: grant.canvasId,
    snapshotId: grant.snapshotId,
    revision,
    grantId: grant.id,
    selectedFrames,
    elements,
    allowedCreateParents,
    emptySelection: grant.objectScope.emptySelection,
    nextSuggestedAction: grant.objectScope.emptySelection
      ? "Grant is read-only. Use canvas.snapshot_get / canvas.export. Do not call create/update/delete."
      : "Create inside allowedCreateParents. Call typed canvas.create_* or canvas.update_node, then verify with canvas.scene_summary before turn.reply outputRefs.canvas_mutation.",
  };
}
