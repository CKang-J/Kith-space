import { and, eq, inArray, or } from "drizzle-orm";
import { dbForSpace, purgeDeletedSpaceContent, schema } from "../db/index.js";
import { deleteObject } from "../files/localObjectStorage.js";
import { clearAgentPrivateMemoryInTransaction } from "../memory/memoryLifecycle.js";

/**
 * Permanently remove the Human↔Agent private conversation while leaving the
 * agent row intact for attribution in shared channel and thread history.
 */
export async function deleteAgentAndPrivateConversations(spaceId: string, agentId: string): Promise<string[]> {
  const db = dbForSpace(spaceId);
  const deleted = db.transaction((tx) => {
    const humanDmChannelIds = tx.select({ channelId: schema.humanChannelStates.channelId })
      .from(schema.humanChannelStates)
      .where(eq(schema.humanChannelStates.dmAgentId, agentId))
      .all()
      .map((row) => row.channelId);
    const agentDmChannelIds = tx.select({ channelId: schema.channelAgentMembers.channelId })
      .from(schema.channelAgentMembers)
      .innerJoin(schema.channels, eq(schema.channels.id, schema.channelAgentMembers.channelId))
      .where(and(
        eq(schema.channelAgentMembers.agentId, agentId),
        eq(schema.channels.spaceId, spaceId),
        eq(schema.channels.type, "dm"),
      ))
      .all()
      .map((row) => row.channelId);
    const dmChannelIds = [...new Set([...humanDmChannelIds, ...agentDmChannelIds])];
    clearAgentPrivateMemoryInTransaction(tx, agentId, "agent_deleted");
    tx.delete(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.agentId, agentId)).run();
    tx.update(schema.agents).set({
      deletedAt: new Date(),
      status: "inactive",
      activity: "offline",
      agentTokenHash: null,
    }).where(and(eq(schema.agents.id, agentId), eq(schema.agents.spaceId, spaceId))).run();
    if (!dmChannelIds.length) return { channelIds: [] as string[], storageKeys: [] as string[] };

    const dmMessageIds = tx.select({ id: schema.messages.id })
      .from(schema.messages)
      .where(inArray(schema.messages.channelId, dmChannelIds))
      .all()
      .map((row) => row.id);
    const threadChannelIds = dmMessageIds.length
      ? tx.select({ id: schema.channels.id })
        .from(schema.channels)
        .where(inArray(schema.channels.parentMessageId, dmMessageIds))
        .all()
        .map((row) => row.id)
      : [];
    const channelIds = [...dmChannelIds, ...threadChannelIds];
    const messageIds = tx.select({ id: schema.messages.id })
      .from(schema.messages)
      .where(inArray(schema.messages.channelId, channelIds))
      .all()
      .map((row) => row.id);
    const attachmentScope = messageIds.length
      ? or(inArray(schema.attachments.messageId, messageIds), inArray(schema.attachments.channelId, channelIds))
      : inArray(schema.attachments.channelId, channelIds);
    const storageKeys = tx.select({ storageKey: schema.attachments.storageKey })
      .from(schema.attachments)
      .where(attachmentScope)
      .all()
      .map((attachment) => attachment.storageKey);

    if (messageIds.length) {
      tx.delete(schema.attachments).where(or(
        inArray(schema.attachments.messageId, messageIds),
        inArray(schema.attachments.channelId, channelIds),
      )).run();
      tx.delete(schema.humanSavedMessages).where(inArray(schema.humanSavedMessages.messageId, messageIds)).run();
      tx.delete(schema.messageMentions).where(inArray(schema.messageMentions.messageId, messageIds)).run();
      tx.delete(schema.reactions).where(inArray(schema.reactions.messageId, messageIds)).run();
    }

    const dispatchChainIds = tx.select({ id: schema.dispatchChains.id })
      .from(schema.dispatchChains)
      .where(inArray(schema.dispatchChains.channelId, channelIds))
      .all()
      .map((row) => row.id);
    if (dispatchChainIds.length) {
      tx.delete(schema.dispatchContexts).where(inArray(schema.dispatchContexts.chainId, dispatchChainIds)).run();
      tx.delete(schema.dispatchWakes).where(inArray(schema.dispatchWakes.chainId, dispatchChainIds)).run();
      tx.delete(schema.dispatchChains).where(inArray(schema.dispatchChains.id, dispatchChainIds)).run();
    }

    tx.delete(schema.dispatchStops).where(inArray(schema.dispatchStops.scopeId, [...channelIds, ...messageIds])).run();
    tx.delete(schema.reminders).where(inArray(schema.reminders.channelId, channelIds)).run();
    if (messageIds.length) tx.delete(schema.messages).where(inArray(schema.messages.id, messageIds)).run();
    tx.delete(schema.channels).where(inArray(schema.channels.id, channelIds)).run();
    return { channelIds, storageKeys };
  });
  purgeDeletedSpaceContent(spaceId);
  await Promise.allSettled(deleted.storageKeys.map((storageKey) => deleteObject(spaceId, storageKey)));
  return deleted.channelIds;
}
