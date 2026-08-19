import { eq } from "drizzle-orm";
import type { SpaceTransaction } from "../counters.js";
import { spaceRecord, type SpaceDb } from "../db/index.js";
import { schema } from "../db/index.js";
import { HarnessError } from "../harness/errors.js";
import type { TurnCapabilityClaims } from "../capabilities/contracts.js";
import { readObjectSync } from "../files/localObjectStorage.js";
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
  expandCanvasAccessGrantAfterCreateInTransaction,
  resolveCanvasAccessGrantInTransaction,
  type CanvasGrantAction,
} from "./canvasAccessGrant.js";
import { CanvasAssetStore } from "./canvasAssetStore.js";
import { mapCanvasToolOps, parseCanvasOpError } from "./canvasToolOps.js";
import type { CanvasJson } from "./canvasTypes.js";
import {
  typedCanvasCommandToToolOp,
  type CanvasTypedMutationCommand,
  type CanvasTypedToolName,
} from "./canvasAgentTools.js";
import { canvasMutationFeedback, type CanvasMutationFeedback } from "./canvasMutationFeedback.js";
import { executeCanvasSceneSummary } from "./canvasSceneSummary.js";

export { executeCanvasSceneSummary };

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
    const parsed = parseCanvasOpError(error.message);
    throw new HarnessError("capability_scope_denied", error.message, parsed ? {
      canvasCode: parsed.code,
      ...(parsed.fix ? { fix: parsed.fix } : {}),
      ...(parsed.detail ? { detail: parsed.detail } : {}),
    } : {});
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
): CanvasMutationFeedback {
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
  const createdIds = [...mapped.createdElementIds, ...mapped.createdFrameIds];
  const deletedIds = [...mapped.deletedElementIds, ...mapped.deletedFrameIds];
  if (!mapped.operation) {
    return canvasMutationFeedback({
      operationId,
      canvasId: grant.canvasId,
      snapshotId: grant.snapshotId,
      previousRevision: live.revisions.revision,
      revision: live.revisions.revision,
      mutationId: null,
      createdIds,
      deletedIds,
      viewport: mapped.viewport,
    });
  }
  const analyzed = analyzeCanvasOperationBatch(live.document as CanvasJson, mapped.operation, live.title);
  authorizeCanvasMutationImpact(grant, analyzed.impact, {
    createdElementIds: mapped.createdElementIds,
    createdFrameIds: mapped.createdFrameIds,
    deletedElementIds: mapped.deletedElementIds,
    deletedFrameIds: mapped.deletedFrameIds,
    reorderedElementIds: mapped.reorderedElementIds,
    reorderedFrameIds: mapped.reorderedFrameIds,
    confirmDestructive: command.confirmDestructive,
  });
  const snapshot = core.apply({
    canvasId: grant.canvasId,
    operationId,
    expectedRevision: command.expectedRevision,
    operation: mapped.operation,
  });
  const mutation = canvasMutationResultInTransaction(tx, operationId);
  if (createdIds.length) {
    expandCanvasAccessGrantAfterCreateInTransaction(tx, grant, {
      elementIds: mapped.createdElementIds,
      frameIds: mapped.createdFrameIds,
    });
  }
  const created = new Set(createdIds);
  const deleted = new Set(deletedIds);
  const updatedIds = [
    ...analyzed.impact.elementIds.filter((id) => !created.has(id) && !deleted.has(id)),
    ...analyzed.impact.frameIds.filter((id) => !created.has(id) && !deleted.has(id)),
  ];
  return canvasMutationFeedback({
    operationId,
    canvasId: snapshot.id,
    snapshotId: grant.snapshotId,
    previousRevision: live.revisions.revision,
    revision: snapshot.revisions.revision,
    mutationId: mutation?.mutationId ?? null,
    sequence: snapshot.sequence,
    createdIds,
    updatedIds,
    deletedIds,
    impact: analyzed.impact,
    viewport: mapped.viewport,
  });
}

export function executeCanvasTypedMutation(
  db: SpaceDb,
  tx: SpaceTransaction,
  spaceId: string,
  claims: TurnCapabilityClaims,
  toolName: Exclude<CanvasTypedToolName, "canvas.scene_summary">,
  command: CanvasTypedMutationCommand,
  operationId: string,
  now: number,
): CanvasMutationFeedback {
  const grant = grantFor(tx, claims, command);
  const operations = [typedCanvasCommandToToolOp(toolName, command, grant)];
  return executeCanvasElementsApply(
    db,
    tx,
    spaceId,
    claims,
    {
      canvasId: command.canvasId,
      snapshotId: command.snapshotId,
      expectedRevision: command.expectedRevision,
      operations,
      confirmDestructive: "confirmDestructive" in command ? command.confirmDestructive : undefined,
    },
    operationId,
    now,
  );
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
  db: SpaceDb,
  tx: SpaceTransaction,
  spaceId: string,
  claims: TurnCapabilityClaims,
  command: {
    canvasId?: string;
    snapshotId?: string;
    attachmentId?: string;
    assetId?: string;
    url?: string;
    dataUrl?: string;
  },
  now: number,
) {
  const grant = grantFor(tx, claims, command);
  assertLiveCanvasAccessGrant(tx, grant, {
    executorAgentId: claims.agentId,
    now,
    actions: ["import"],
  });
  if (command.url || command.dataUrl) {
    throw new CanvasAccessGrantError("denied", "Canvas asset import does not accept remote URLs or data URLs");
  }
  const attachmentId = command.attachmentId ?? command.assetId;
  if (!attachmentId) {
    throw new CanvasAccessGrantError("denied", "Canvas asset import requires attachmentId from a turn-bound local attachment");
  }

  const attachment = tx.select().from(schema.attachments).where(eq(schema.attachments.id, attachmentId)).get();
  if (!attachment || attachment.spaceId !== spaceId) {
    throw new CanvasAccessGrantError("denied", "attachment is outside the current Space");
  }

  const boundToGrantMessage = attachment.messageId === grant.messageId;
  const turnOwnedTemporary = attachment.uploaderType === "agent"
    && attachment.uploaderId === claims.agentId
    && attachment.sourceTurnId === claims.turnId
    && attachment.uploadState === "temporary"
    && !attachment.messageId;
  if (!boundToGrantMessage && !turnOwnedTemporary) {
    throw new CanvasAccessGrantError(
      "denied",
      "attachment is not bound to the authorized Canvas message or the current turn",
    );
  }

  const rootPath = spaceRecord(spaceId)?.rootPath;
  if (!rootPath) {
    throw new CanvasAccessGrantError("denied", "Space root is unavailable for Canvas asset import");
  }

  let bytes: Buffer;
  try {
    bytes = readObjectSync(spaceId, attachment.storageKey);
  } catch {
    throw new CanvasAccessGrantError("denied", "attachment bytes are unavailable");
  }

  const mimeType = typeof attachment.mimeType === "string" && attachment.mimeType
    ? attachment.mimeType
    : "application/octet-stream";
  const store = new CanvasAssetStore(db, spaceId, rootPath);
  const asset = store.write({
    canvasId: grant.canvasId,
    filename: attachment.filename,
    mimeType,
    bytes,
  });
  return {
    assetId: asset.id,
    canvasId: grant.canvasId,
    snapshotId: grant.snapshotId,
    attachmentId: attachment.id,
    mimeType: asset.mimeType,
    filename: asset.filename,
    sizeBytes: asset.sizeBytes,
    sha256: asset.sha256,
  };
}
