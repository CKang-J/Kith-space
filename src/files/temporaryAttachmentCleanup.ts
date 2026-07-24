import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";
import { deleteObject, listObjects } from "./localObjectStorage.js";

export const TEMPORARY_ATTACHMENT_TTL_MS = 60 * 60 * 1_000;
const lastOrphanSweepAt = new Map<string, number>();

/** Claims expired uploads in SQLite before touching disk, so reply binding and cleanup cannot race. */
export async function cleanupTemporaryAttachments(
  spaceId: string,
  db: SpaceDb = dbForSpace(spaceId),
  now: () => number = Date.now,
  limit = 100,
): Promise<{ claimed: number; deleted: number; orphaned: number }> {
  const claimed = db.transaction((tx) => {
    const rows = tx.select().from(schema.attachments).where(and(
      eq(schema.attachments.uploaderType, "agent"),
      isNull(schema.attachments.messageId),
      or(
        eq(schema.attachments.uploadState, "deleting"),
        and(eq(schema.attachments.uploadState, "temporary"), lte(schema.attachments.expiresAt, new Date(now()))),
      ),
    )).limit(limit).all();
    const temporaryIds = rows.filter((row) => row.uploadState === "temporary").map((row) => row.id);
    if (temporaryIds.length) {
      tx.update(schema.attachments).set({ uploadState: "deleting" }).where(and(
        inArray(schema.attachments.id, temporaryIds),
        eq(schema.attachments.uploadState, "temporary"),
        isNull(schema.attachments.messageId),
      )).run();
    }
    return rows;
  });
  const deletedIds: string[] = [];
  for (const attachment of claimed) {
    try {
      await deleteObject(spaceId, attachment.storageKey);
      deletedIds.push(attachment.id);
    } catch {
      // Keep the durable `deleting` row so a later sweep can retry.
    }
  }
  if (deletedIds.length) {
    db.delete(schema.attachments).where(and(
      inArray(schema.attachments.id, deletedIds),
      eq(schema.attachments.uploadState, "deleting"),
      isNull(schema.attachments.messageId),
    )).run();
  }
  const orphaned: string[] = [];
  const sweepAt = now();
  if ((lastOrphanSweepAt.get(spaceId) ?? 0) + TEMPORARY_ATTACHMENT_TTL_MS <= sweepAt) {
    const referenced = new Set(db.select({ storageKey: schema.attachments.storageKey }).from(schema.attachments).all()
      .map((row) => row.storageKey));
    for (const object of await listObjects(spaceId)) {
      if (referenced.has(object.key) || object.modifiedAt > sweepAt - TEMPORARY_ATTACHMENT_TTL_MS) continue;
      try {
        await deleteObject(spaceId, object.key);
        orphaned.push(object.key);
      } catch {
        // A later startup/schedule sweep retries filesystem failures.
      }
    }
    lastOrphanSweepAt.set(spaceId, sweepAt);
  }
  return { claimed: claimed.length, deleted: deletedIds.length, orphaned: orphaned.length };
}

export async function runTemporaryAttachmentMaintenance(
  spaceId: string,
  cleanup: (spaceId: string) => Promise<unknown> = cleanupTemporaryAttachments,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    await cleanup(spaceId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
