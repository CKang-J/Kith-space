import { and, eq, inArray, sql } from "drizzle-orm";
import type { SpaceTransaction } from "../counters.js";
import { dbForSpace, purgeDeletedSpaceContent, schema } from "../db/index.js";

/** Deletes only one Agent's private structured-memory payload and suppressions. */
export function clearAgentPrivateMemoryInTransaction(tx: SpaceTransaction, agentId: string): number {
  const memoryIds = tx.select({ id: schema.episodicMemories.id }).from(schema.episodicMemories).where(and(
    eq(schema.episodicMemories.scope, "agent_private"),
    eq(schema.episodicMemories.ownerAgentId, agentId),
  )).all().map((row) => row.id);
  for (const memoryId of memoryIds) tx.run(sql`DELETE FROM memory_fts WHERE memory_id = ${memoryId}`);
  if (memoryIds.length) tx.delete(schema.episodicMemories).where(inArray(schema.episodicMemories.id, memoryIds)).run();
  tx.delete(schema.memorySuppressions).where(and(
    eq(schema.memorySuppressions.scope, "agent_private"),
    eq(schema.memorySuppressions.ownerAgentId, agentId),
  )).run();
  return memoryIds.length;
}

export function clearAgentPrivateMemory(spaceId: string, agentId: string): number {
  const deleted = dbForSpace(spaceId).transaction((tx) => clearAgentPrivateMemoryInTransaction(tx, agentId));
  purgeDeletedSpaceContent(spaceId);
  return deleted;
}
