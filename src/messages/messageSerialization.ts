import type { schema } from "../db/index.js";
import type { MessageMention } from "../channels/channelAllMention.js";

export interface ReactionAggregate {
  emoji: string;
  count: number;
  reactorIds: string[];
  reactorNames: string[];
}

export function persistedMessageMention(
  row: typeof schema.messageMentions.$inferSelect,
): MessageMention {
  return {
    type: row.mentionType as MessageMention["type"],
    id: row.mentionId,
    name: row.mentionName,
  };
}

export function serializeMessage(
  message: typeof schema.messages.$inferSelect,
  mentions: MessageMention[],
  attachments: (typeof schema.attachments.$inferSelect)[] = [],
  reactions: ReactionAggregate[] = [],
) {
  return {
    id: message.id,
    seq: message.seq,
    channelId: message.channelId,
    threadId: message.threadId,
    senderType: message.senderType,
    senderId: message.senderId,
    senderName: message.senderName,
    senderMembershipStatus: "active",
    messageType: message.messageType,
    content: message.content,
    actionMetadata: message.actionMetadata ?? null,
    taskStatus: message.taskStatus,
    taskNumber: message.taskNumber,
    taskAssigneeType: message.taskAssigneeType,
    taskAssigneeId: message.taskAssigneeId,
    taskClaimedAt: message.taskClaimedAt,
    taskCompletedAt: message.taskCompletedAt,
    taskParentId: message.taskParentId,
    taskRevision: message.taskRevision,
    taskExecutionMode: message.taskExecutionMode,
    dispatchChainId: message.dispatchChainId,
    dispatchDepth: message.dispatchDepth,
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    })),
    mentions: mentions.map((mention) => ({ type: mention.type, id: mention.id, name: mention.name })),
    reactions,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}
