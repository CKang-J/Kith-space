import { and, eq, inArray } from "drizzle-orm";
import { CANVAS_SELECTION_SNAPSHOT_REF_TYPE, canvasSelectionPresentation } from "../canvas/canvasSelectionSnapshot.js";
import { schema, type SpaceDb } from "../db/index.js";
import {
  registerContextObjectSnapshotResolver,
  type ResolvedContextObject,
} from "./objectSnapshotResolver.js";

export const MAX_CANVAS_CONTEXT_REFS_PER_TURN = 8;

function canvasDeleted(db: SpaceDb, canvasId: string, spaceId: string): boolean {
  const row = db.select({ deletedAt: schema.canvasDocuments.deletedAt }).from(schema.canvasDocuments).where(and(
    eq(schema.canvasDocuments.id, canvasId),
    eq(schema.canvasDocuments.spaceId, spaceId),
  )).get();
  return !row || Boolean(row.deletedAt);
}

registerContextObjectSnapshotResolver({
  type: CANVAS_SELECTION_SNAPSHOT_REF_TYPE,
  resolve(input) {
    const limited = input.refs.slice(0, MAX_CANVAS_CONTEXT_REFS_PER_TURN);
    if (!limited.length) return [];
    const snapshotIds = limited.map((ref) => ref.id);
    const rows = input.db.select().from(schema.canvasSelectionSnapshots)
      .where(inArray(schema.canvasSelectionSnapshots.id, snapshotIds)).all();
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const boundMessageIds = new Set(input.messageIds);
    const authorized = input.db.select({ messageId: schema.messageExecutionBindings.messageId })
      .from(schema.messageExecutionBindings)
      .where(and(
        inArray(schema.messageExecutionBindings.messageId, [...boundMessageIds]),
        eq(schema.messageExecutionBindings.executorAgentId, input.agentId),
      )).all();
    const authorizedMessages = new Set(authorized.map((row) => row.messageId));
    const resolved: ResolvedContextObject[] = [];
    for (const ref of limited) {
      const row = rowById.get(ref.id);
      if (!row || row.spaceId !== input.spaceId) continue;
      if (!row.messageId || !boundMessageIds.has(row.messageId) || !authorizedMessages.has(row.messageId)) continue;
      const deleted = canvasDeleted(input.db, row.canvasId, input.spaceId);
      const presentation = canvasSelectionPresentation(row, deleted);
      const boundMessage = input.db.select({
        channelId: schema.messages.channelId,
      }).from(schema.messages).where(and(
        eq(schema.messages.id, row.messageId),
        eq(schema.messages.spaceId, input.spaceId),
      )).get();
      const sourceChannel = boundMessage
        ? input.db.select({
          id: schema.channels.id,
          type: schema.channels.type,
          name: schema.channels.name,
        }).from(schema.channels).where(and(
          eq(schema.channels.id, boundMessage.channelId),
          eq(schema.channels.spaceId, input.spaceId),
        )).get()
        : undefined;
      resolved.push({
        sourceKind: CANVAS_SELECTION_SNAPSHOT_REF_TYPE,
        sourceId: row.id,
        sourceRevision: row.documentRevision,
        payload: {
          snapshotId: presentation.snapshotId,
          canvasId: presentation.canvasId,
          canvasTitle: presentation.canvasTitle,
          documentRevision: presentation.documentRevision,
          structureRevision: presentation.structureRevision,
          selectedElementCount: presentation.selectedElements.length,
          selectedFrameCount: presentation.selectedFrames.length,
          selectedElements: presentation.selectedElements,
          selectedFrames: presentation.selectedFrames,
          summary: presentation.summary,
          projection: presentation.projection,
          previewAssetId: presentation.previewAssetId,
          selectionHash: presentation.selectionHash,
          deepLink: presentation.deepLink,
          canvasAvailable: !deleted,
          liveReadWrite: deleted ? "fail_closed" : "snapshot_only",
          sourceSurface: sourceChannel ? {
            kind: sourceChannel.type,
            id: sourceChannel.id,
            name: sourceChannel.type === "dm" ? null : sourceChannel.name,
          } : null,
        },
        reason: deleted
          ? "canvas_selection_snapshot_audit_after_delete"
          : "canvas_selection_snapshot_at_send",
        visibility: "private",
        disclosureProjection: "canonical",
      });
    }
    return resolved;
  },
});
