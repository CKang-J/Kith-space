import { and, eq, isNull } from "drizzle-orm";
import type { SpaceDb } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  assertEligibleExecutorInTransaction,
  deriveDmExecutorAgentId,
  MessageExecutionBindingError,
} from "../messages/messageExecutionBinding.js";

export interface EligibleCanvasExecutor {
  id: string;
  name: string;
  displayName: string;
  avatarUrl: string | null;
}

function present(agent: typeof schema.agents.$inferSelect): EligibleCanvasExecutor {
  return {
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    avatarUrl: agent.avatarUrl ?? null,
  };
}

export function listEligibleCanvasExecutors(
  db: SpaceDb,
  spaceId: string,
  channelId: string,
  now = Date.now(),
): EligibleCanvasExecutor[] {
  return db.transaction((tx) => {
    const channel = tx.select().from(schema.channels).where(and(
      eq(schema.channels.id, channelId),
      eq(schema.channels.spaceId, spaceId),
    )).get();
    if (!channel) return [];
    const eligibleFor = (executorAgentId: string): EligibleCanvasExecutor | null => {
      try {
        return present(assertEligibleExecutorInTransaction(tx, {
          spaceId,
          channelId,
          executorAgentId,
          now,
        }));
      } catch (error) {
        if (error instanceof MessageExecutionBindingError) return null;
        throw error;
      }
    };
    if (channel.type === "dm") {
      try {
        const executor = eligibleFor(deriveDmExecutorAgentId(tx, spaceId, channelId));
        return executor ? [executor] : [];
      } catch (error) {
        if (error instanceof MessageExecutionBindingError) return [];
        throw error;
      }
    }
    const members = tx.select({ agentId: schema.channelAgentMembers.agentId })
      .from(schema.channelAgentMembers)
      .where(eq(schema.channelAgentMembers.channelId, channelId))
      .all();
    return members.flatMap((member) => {
      const executor = eligibleFor(member.agentId);
      return executor ? [executor] : [];
    });
  });
}
