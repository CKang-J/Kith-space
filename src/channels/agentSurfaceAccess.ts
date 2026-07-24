import { and, eq, isNull } from "drizzle-orm";
import type { SpaceTransaction } from "../counters.js";
import { schema } from "../db/index.js";
import { HarnessError } from "../harness/errors.js";

function liveMember(tx: SpaceTransaction, channelId: string, agentId: string, now: number) {
  const member = tx.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, channelId),
    eq(schema.channelAgentMembers.agentId, agentId),
  )).get();
  return member && (!member.accessExpiresAt || member.accessExpiresAt.getTime() > now) ? member : null;
}

/** Re-evaluates current membership, including expiry and an ordinary thread's parent. */
export function hasAgentSurfaceAccessInTransaction(
  tx: SpaceTransaction,
  input: { spaceId: string; channelId: string; agentId: string; now?: number },
): boolean {
  const now = input.now ?? Date.now();
  const channel = tx.select().from(schema.channels).where(and(
    eq(schema.channels.id, input.channelId),
    eq(schema.channels.spaceId, input.spaceId),
    isNull(schema.channels.deletedAt),
  )).get();
  if (!channel) return false;
  const member = liveMember(tx, channel.id, input.agentId, now);
  if (!member) return false;
  if (channel.type !== "thread") return true;
  if (member.accessKind === "task_scoped") {
    return Boolean(member.taskScope && typeof member.taskScope === "object");
  }
  if (!channel.parentMessageId) return false;
  const parent = tx.select({ channelId: schema.messages.channelId }).from(schema.messages).where(and(
    eq(schema.messages.id, channel.parentMessageId),
    eq(schema.messages.spaceId, input.spaceId),
  )).get();
  return Boolean(parent && liveMember(tx, parent.channelId, input.agentId, now));
}

/** Every Gateway call fails closed when the current surface access predicate is false. */
export function assertAgentSurfaceAccessInTransaction(
  tx: SpaceTransaction,
  input: { spaceId: string; channelId: string; agentId: string; now?: number },
): void {
  if (!hasAgentSurfaceAccessInTransaction(tx, input)) {
    throw new HarnessError("reply_target_denied", "Agent is no longer a member of the turn surface or its current parent", {
      channelId: input.channelId,
    });
  }
}
