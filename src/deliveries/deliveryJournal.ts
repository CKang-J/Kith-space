import { and, eq, inArray } from "drizzle-orm";
import { agentHasScope } from "../agents/agentScopes.js";
import { decideAgentMessageResponse } from "../agents/agentResponseDelivery.js";
import { resolveAgentDispatchSettingsInTransaction } from "../agents/agentResponseSettings.js";
import type { SpaceTransaction } from "../counters.js";
import { schema } from "../db/index.js";
import { dbForSpace } from "../db/index.js";
import type { MessageMention } from "../channels/channelAllMention.js";
import { advanceDeliveryFrontierInTransaction } from "./deliveryFrontier.js";

export interface PersistDeliveryInput {
  spaceId: string;
  channel: typeof schema.channels.$inferSelect;
  message: typeof schema.messages.$inferSelect;
  senderType: "human" | "agent" | "system";
  senderId: string | null;
  candidateAgentIds: string[];
  mentions: MessageMention[];
  explicitTaskAgentId?: string | null;
  allowedHarnessModes?: Array<"migrating" | "v2">;
  targetSurface?: { kind: "channel" | "private" | "dm" | "thread"; id: string };
  forceObserveAgentIds?: string[];
}

/** Writes the durable v2 inbox inside the caller's message transaction. */
export class DeliveryJournal {
  constructor(private readonly scheduler?: (spaceId: string) => Promise<void>) {}

  schedulePending(spaceId: string): Promise<void> {
    return this.scheduler?.(spaceId) ?? Promise.resolve();
  }

  usesV2(spaceId: string, agentId: string): boolean {
    return dbForSpace(spaceId).select({ mode: schema.agentHarnessState.mode }).from(schema.agentHarnessState)
      .where(eq(schema.agentHarnessState.agentId, agentId)).get()?.mode === "v2";
  }

  persistMessageInTransaction(tx: SpaceTransaction, input: PersistDeliveryInput): number {
    const agentIds = [...new Set(input.candidateAgentIds)];
    if (!agentIds.length) return 0;
    const harnessRows = tx.select().from(schema.agentHarnessState).where(inArray(schema.agentHarnessState.agentId, agentIds)).all();
    const allowedModes = new Set(input.allowedHarnessModes ?? ["v2"]);
    const v2AgentIds = new Set(harnessRows.filter((row) => allowedModes.has(row.mode as "migrating" | "v2")).map((row) => row.agentId));
    if (!v2AgentIds.size) return 0;
    const settings = resolveAgentDispatchSettingsInTransaction(tx, input.spaceId, input.channel.id, [...v2AgentIds]);
    const settingByAgent = new Map(settings.map((setting) => [setting.responseMode.agentId, setting]));
    const mentioned = new Set(input.mentions.filter((mention) => mention.type === "agent").map((mention) => mention.id));
    const forceObserve = new Set(input.forceObserveAgentIds ?? []);
    const parentTask = input.channel.type === "thread" && input.channel.parentMessageId
      ? tx.select({ taskAssigneeId: schema.messages.taskAssigneeId, taskStatus: schema.messages.taskStatus })
          .from(schema.messages).where(eq(schema.messages.id, input.channel.parentMessageId)).get()
      : null;
    const now = new Date();
    const values: Array<typeof schema.agentDeliveryItems.$inferInsert> = [];
    for (const agentId of v2AgentIds) {
      const setting = settingByAgent.get(agentId);
      if (!setting) continue;
      const responseMode = setting.responseMode;
      const isSelf = input.senderType === "agent" && input.senderId === agentId;
      const decision = decideAgentMessageResponse({
        agentId,
        channelType: input.channel.type as "channel" | "private" | "dm" | "thread",
        senderType: input.senderType,
        effectiveMode: responseMode.effectiveResponseMode,
        messageSeq: input.message.seq,
        mentioned: mentioned.has(agentId),
        explicitTaskAssignment: input.explicitTaskAgentId === agentId,
        taskAssigneeId: input.message.taskStatus ? input.message.taskAssigneeId : null,
        parentTaskAssigneeId: parentTask?.taskStatus ? parentTask.taskAssigneeId : null,
        isTask: Boolean(input.message.taskStatus),
        ambientWakeAfterSeq: responseMode.ambientWakeAfterSeq,
        mentionWakeAfterSeq: responseMode.mentionWakeAfterSeq,
      });
      const ambientScopeDenied = decision.deliveryClass === "ambient" && !agentHasScope(setting.scopes, "inbox:receive");
      const directive = forceObserve.has(agentId) || isSelf || !decision.wake || ambientScopeDenied ? "observe" : decision.directive;
      const disposition = directive === "observe" ? "observed" : "pending";
      values.push({
        spaceId: input.spaceId,
        agentId,
        messageId: input.message.id,
        sourceChannelId: input.message.channelId,
        sourceSeq: input.message.seq,
        cursorOwnerChannelId: input.message.channelId,
        targetSurfaceKind: input.targetSurface?.kind ?? input.channel.type as "channel" | "private" | "dm" | "thread",
        targetSurfaceId: input.targetSurface?.id ?? input.channel.id,
        directive,
        reason: forceObserve.has(agentId) ? "task_not_assigned" : isSelf ? "self_message" : ambientScopeDenied ? "ambient_scope_denied" : decision.reason,
        policySnapshot: {
          defaultResponseMode: responseMode.defaultResponseMode,
          responseModeOverride: responseMode.responseModeOverride,
          effectiveResponseMode: responseMode.effectiveResponseMode,
          responseModeSource: responseMode.responseModeSource,
          ambientWakeAfterSeq: responseMode.ambientWakeAfterSeq,
          mentionWakeAfterSeq: responseMode.mentionWakeAfterSeq,
          mentioned: mentioned.has(agentId),
          senderType: input.senderType,
          decisionReason: decision.reason,
          deliveryClass: decision.deliveryClass,
        },
        disposition,
        settledAt: disposition === "observed" ? now : null,
      });
    }
    if (!values.length) return 0;
    const changes = tx.insert(schema.agentDeliveryItems).values(values).onConflictDoNothing().run().changes;
    for (const value of values) {
      if (value.disposition === "observed") this.advanceTerminalFrontier(tx, value.agentId, value.cursorOwnerChannelId);
    }
    return changes;
  }

  persistChannelMessageInTransaction(tx: SpaceTransaction, spaceId: string, message: typeof schema.messages.$inferSelect): number {
    const channel = tx.select().from(schema.channels).where(and(
      eq(schema.channels.id, message.channelId),
      eq(schema.channels.spaceId, spaceId),
    )).get();
    if (!channel) return 0;
    const candidateAgentIds = tx.select({ agentId: schema.channelAgentMembers.agentId }).from(schema.channelAgentMembers)
      .where(eq(schema.channelAgentMembers.channelId, channel.id)).all().map((row) => row.agentId);
    const mentions = tx.select().from(schema.messageMentions).where(eq(schema.messageMentions.messageId, message.id)).all()
      .map((mention) => ({ type: mention.mentionType as MessageMention["type"], id: mention.mentionId, name: mention.mentionName }));
    return this.persistMessageInTransaction(tx, {
      spaceId,
      channel,
      message,
      senderType: message.senderType as PersistDeliveryInput["senderType"],
      senderId: message.senderId,
      candidateAgentIds,
      mentions,
      explicitTaskAgentId: message.taskAssigneeType === "agent" ? message.taskAssigneeId : null,
    });
  }

  advanceTerminalFrontier(tx: SpaceTransaction, agentId: string, channelId: string): void {
    advanceDeliveryFrontierInTransaction(tx, agentId, channelId);
  }
}
