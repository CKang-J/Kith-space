import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { schema, type SpaceDb } from "../db/index.js";

export interface ConversationActivityHistoryRow {
  agentId: string;
  name: string;
  timestamp: number;
  streamId?: string;
  entry: {
    kind: string;
    activity: string | null;
    detail: string | null;
    text: string | null;
    toolName: string | null;
    toolInput: string | null;
  };
}

/**
 * Restores the newest persisted trajectory entries for one base conversation.
 * Legacy direct-channel rows did not always carry conversationId, so they are
 * included only when their channelId is the requested base conversation.
 */
export async function listConversationActivityHistory(
  db: SpaceDb,
  spaceId: string,
  conversationId: string,
  limit: number,
): Promise<ConversationActivityHistoryRow[]> {
  const rows = await db.select().from(schema.agentActivityLog).where(and(
    eq(schema.agentActivityLog.spaceId, spaceId),
    or(
      eq(schema.agentActivityLog.conversationId, conversationId),
      and(
        isNull(schema.agentActivityLog.conversationId),
        eq(schema.agentActivityLog.channelId, conversationId),
      ),
    ),
  )).orderBy(desc(schema.agentActivityLog.ts)).limit(limit);

  const agentIds = [...new Set(rows.map((row) => row.agentId))];
  const agents = agentIds.length
    ? await db.select({
      id: schema.agents.id,
      name: schema.agents.name,
    }).from(schema.agents).where(inArray(schema.agents.id, agentIds))
    : [];
  const nameByAgentId = new Map(agents.map((agent) => [agent.id, agent.name]));

  return rows.reverse().map((row) => ({
    agentId: row.agentId,
    name: nameByAgentId.get(row.agentId) ?? "Agent",
    timestamp: row.ts,
    streamId: row.streamId ?? undefined,
    entry: {
      kind: row.kind === "tool" ? "tool_start" : row.kind,
      activity: row.activity,
      detail: row.detail,
      text: row.text,
      toolName: row.toolName,
      toolInput: row.toolInput,
    },
  }));
}
