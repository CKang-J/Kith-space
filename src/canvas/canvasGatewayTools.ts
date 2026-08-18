import { eq } from "drizzle-orm";
import type { SpaceTransaction } from "../counters.js";
import type { SpaceDb } from "../db/index.js";
import { schema } from "../db/index.js";
import { HarnessError } from "../harness/errors.js";
import type { TurnCapabilityClaims } from "../capabilities/contracts.js";
import {
  analyzeCanvasOperationBatch,
  CanvasConflictError,
  CanvasCore,
  CanvasIdempotencyError,
  CanvasNotFoundError,
  CanvasValidationError,
} from "./canvasCore.js";
import {
  assertLiveCanvasAccessGrant,
  authorizeCanvasMutationImpact,
  CanvasAccessGrantError,
  resolveCanvasAccessGrantInTransaction,
  type CanvasGrantAction,
} from "./canvasAccessGrant.js";
import { mapCanvasToolOps } from "./canvasToolOps.js";
import type { CanvasJson } from "./canvasTypes.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function mapCanvasToolError(error: unknown): never {
  if (error instanceof HarnessError) throw error;
  if (error instanceof CanvasAccessGrantError) {
    if (error.code === "expired") throw new HarnessError("capability_expired", error.message);
    if (error.code === "revoked") throw new HarnessError("capability_revoked", error.message);
    throw new HarnessError("capability_scope_denied", error.message);
  }
  if (error instanceof CanvasConflictError) {
    throw new HarnessError("capability_scope_denied", error.message, {
      canvasCode: "revision_conflict",
      currentRevision: error.currentRevision,
    });
  }
  if (error instanceof CanvasIdempotencyError) throw new HarnessError("idempotency_conflict", error.message);
  if (error instanceof CanvasValidationError || error instanceof CanvasNotFoundError) {
    throw new HarnessError("capability_scope_denied", error.message);
  }
  throw error;
}

export function canvasMutationResultInTransaction(tx: SpaceTransaction, operationId: string) {
  const mutation = tx.select().from(schema.canvasMutations).where(eq(schema.canvasMutations.operationId, operationId)).get();
  if (!mutation) return null;
  const stored = asRecord(mutation.result);
  const revisions = asRecord(stored?.revisions);
  return {
    mutationId: mutation.id,
    canvasId: mutation.canvasId,
    sequence: mutation.sequence,
    revision: typeof revisions?.revision === "number" ? revisions.revision : mutation.sequence,
    impact: mutation.impact,
  };
}

function grantFor(
  tx: SpaceTransaction,
  claims: TurnCapabilityClaims,
  command: { canvasId?: string; snapshotId?: string },
) {
  return resolveCanvasAccessGrantInTransaction(tx, {
    turnId: claims.turnId,
    executorAgentId: claims.agentId,
    requestedCanvasId: command.canvasId,
    requestedSnapshotId: command.snapshotId,
  });
}

export function executeCanvasSnapshotGet(
  tx: SpaceTransaction,
  claims: TurnCapabilityClaims,
  command: { snapshotId: string; canvasId?: string },
  now: number,
) {
  const grant = grantFor(tx, claims, command);
  const { snapshot } = assertLiveCanvasAccessGrant(tx, grant, {
    executorAgentId: claims.agentId,
    now,
    actions: ["read_snapshot"],
    allowDeletedCanvas: true,
  });
  if (snapshot.id !== command.snapshotId) {
    throw new CanvasAccessGrantError("denied", "snapshot_get can only read the authorized immutable snapshot");
  }
  return {
    snapshotId: snapshot.id,
    canvasId: snapshot.canvasId,
    documentRevision: snapshot.documentRevision,
    structureRevision: snapshot.structureRevision,
    summary: snapshot.summary,
    projection: snapshot.projection,
    selectedElements: snapshot.selectedElements,
    selectedFrames: snapshot.selectedFrames,
    grantId: grant.id,
  };
}

export function executeCanvasElementsGet(
  db: SpaceDb,
  tx: SpaceTransaction,
  spaceId: string,
  claims: TurnCapabilityClaims,
  command: { canvasId?: string; snapshotId?: string; elementIds?: string[]; frameIds?: string[] },
  now: number,
) {
  const grant = grantFor(tx, claims, command);
  assertLiveCanvasAccessGrant(tx, grant, {
    executorAgentId: claims.agentId,
    now,
    actions: ["read_live"],
    requestedElementIds: command.elementIds,
    requestedFrameIds: command.frameIds,
  });
  const core = new CanvasCore(db, spaceId);
  const live = core.read(grant.canvasId);
  const document = asRecord(live.document) ?? {};
  const nodes = asRecord(document.deltaSetLike) ?? {};
  const frames = Array.isArray(document.frames) ? document.frames : [];
  const elementIds = command.elementIds ?? grant.objectScope.elementIds;
  const frameIds = command.frameIds ?? grant.objectScope.frameIds;
  return {
    canvasId: grant.canvasId,
    snapshotId: grant.snapshotId,
    revision: live.revisions.revision,
    elements: elementIds.flatMap((id) => nodes[id] ? [{ id, node: nodes[id] }] : []),
    frames: frames.filter((frame) => {
      const record = asRecord(frame);
      return record && typeof record.id === "string" && frameIds.includes(record.id);
    }),
  };
}

export function executeCanvasElementsApply(
  db: SpaceDb,
  tx: SpaceTransaction,
  spaceId: string,
  claims: TurnCapabilityClaims,
  command: {
    canvasId?: string;
    snapshotId?: string;
    expectedRevision: number;
    operations: unknown[];
    confirmDestructive?: boolean;
  },
  operationId: string,
  now: number,
) {
  const grant = grantFor(tx, claims, command);
  const actions: CanvasGrantAction[] = ["read_live"];
  assertLiveCanvasAccessGrant(tx, grant, {
    executorAgentId: claims.agentId,
    now,
    actions,
  });
  const core = new CanvasCore(db, spaceId);
  const live = core.read(grant.canvasId);
  const mapped = mapCanvasToolOps(live.document as CanvasJson, command.operations);
  if (mapped.backgroundWrite) {
    assertLiveCanvasAccessGrant(tx, grant, {
      executorAgentId: claims.agentId,
      now,
      actions: ["set_canvas_background"],
    });
  }
  if (!mapped.operation) {
    return {
      mutationId: null,
      canvasId: grant.canvasId,
      revision: live.revisions.revision,
      viewport: mapped.viewport,
    };
  }
  const analyzed = analyzeCanvasOperationBatch(live.document as CanvasJson, mapped.operation, live.title);
  authorizeCanvasMutationImpact(grant, analyzed.impact, {
    createdElementIds: mapped.createdElementIds,
    createdFrameIds: mapped.createdFrameIds,
    deletedElementIds: mapped.deletedElementIds,
    deletedFrameIds: mapped.deletedFrameIds,
    confirmDestructive: command.confirmDestructive,
  });
  const snapshot = core.apply({
    canvasId: grant.canvasId,
    operationId,
    expectedRevision: command.expectedRevision,
    operation: mapped.operation,
  });
  const mutation = canvasMutationResultInTransaction(tx, operationId);
  return {
    mutationId: mutation?.mutationId ?? null,
    canvasId: snapshot.id,
    revision: snapshot.revisions.revision,
    sequence: snapshot.sequence,
    impact: analyzed.impact,
    viewport: mapped.viewport,
  };
}

export function executeCanvasExport(
  tx: SpaceTransaction,
  claims: TurnCapabilityClaims,
  command: { snapshotId: string; canvasId?: string },
  now: number,
) {
  const grant = grantFor(tx, claims, command);
  const { snapshot } = assertLiveCanvasAccessGrant(tx, grant, {
    executorAgentId: claims.agentId,
    now,
    actions: ["export", "read_snapshot"],
    allowDeletedCanvas: true,
  });
  return {
    format: "kith-canvas-selection-export",
    version: 1,
    snapshotId: snapshot.id,
    canvasId: snapshot.canvasId,
    summary: snapshot.summary,
    projection: snapshot.projection,
  };
}

export function executeCanvasContextBundleCreate(
  tx: SpaceTransaction,
  claims: TurnCapabilityClaims,
  command: { snapshotId: string; canvasId?: string },
  now: number,
) {
  const snapshot = executeCanvasSnapshotGet(tx, claims, command, now);
  return {
    bundle: {
      snapshot,
      grantActions: grantFor(tx, claims, command).actions,
    },
  };
}

export function executeCanvasAssetImport(
  tx: SpaceTransaction,
  claims: TurnCapabilityClaims,
  command: { canvasId?: string; snapshotId?: string; assetId?: string; url?: string; dataUrl?: string },
  now: number,
): never {
  const grant = grantFor(tx, claims, command);
  assertLiveCanvasAccessGrant(tx, grant, {
    executorAgentId: claims.agentId,
    now,
    actions: ["import"],
  });
  if (command.url || command.dataUrl) {
    throw new CanvasAccessGrantError("denied", "Canvas asset import does not accept remote URLs or data URLs");
  }
  throw new CanvasAccessGrantError("denied", "Canvas asset import is not granted for this turn");
}
