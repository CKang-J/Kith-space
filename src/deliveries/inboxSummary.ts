import { and, eq, inArray, sql } from "drizzle-orm";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";

export interface InboxSummary {
  pendingCount: number;
  surfaces: Array<{ surfaceKind: string; surfaceId: string; count: number; required: number }>;
}

/** Control-plane summary deliberately contains no message body or cross-surface transcript. */
export function inboxSummary(
  spaceId: string,
  agentId: string,
  db: SpaceDb = dbForSpace(spaceId),
): InboxSummary {
  const rows = db.select({
    surfaceKind: schema.agentDeliveryItems.targetSurfaceKind,
    surfaceId: schema.agentDeliveryItems.targetSurfaceId,
    count: sql<number>`count(*)`,
    required: sql<number>`sum(case when ${schema.agentDeliveryItems.directive} = 'required' then 1 else 0 end)`,
  }).from(schema.agentDeliveryItems).where(and(
    eq(schema.agentDeliveryItems.spaceId, spaceId),
    eq(schema.agentDeliveryItems.agentId, agentId),
    inArray(schema.agentDeliveryItems.disposition, ["pending", "bound"]),
  )).groupBy(schema.agentDeliveryItems.targetSurfaceKind, schema.agentDeliveryItems.targetSurfaceId).all();
  const surfaces = rows.map((row) => ({
    surfaceKind: row.surfaceKind,
    surfaceId: row.surfaceId,
    count: Number(row.count),
    required: Number(row.required),
  }));
  return { pendingCount: surfaces.reduce((total, surface) => total + surface.count, 0), surfaces };
}
