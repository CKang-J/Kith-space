import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { agentHasScope } from "../agents/agentScopes.js";
import { decideAgentMessageResponse } from "../agents/agentResponseDelivery.js";
import {
  initialAgentResponseWakeWatermarks,
  resolveAgentDispatchSettings,
} from "../agents/agentResponseSettings.js";
import { canAutoJoinMentionedMembers } from "../agents/agentWakePolicy.js";
import {
  containsChannelAllMention,
  mergeChannelAllMentions,
  type MessageMention,
} from "../channels/channelAllMention.js";
import { requireWritableChannel } from "../channels/channelLifecycle.js";
import { nextSeq, type SpaceTransaction } from "../counters.js";
import type { MessageContextSnapshot } from "../context/contracts.js";
import { dbForSpace, schema } from "../db/index.js";
import { freezeCanvasSelectionInTransaction, attachCanvasSelectionToMessage, CANVAS_SELECTION_SNAPSHOT_REF_TYPE, loadCanvasContextsForMessages } from "../canvas/canvasSelectionSnapshot.js";
import type { CanvasSelectionInput } from "../canvas/canvasTypes.js";
import {
  resolveExecutionBindingInTransaction,
  MessageExecutionBindingError,
  type MessageExecutionBindingInput,
} from "./messageExecutionBinding.js";
import { getHumanIdentity } from "../human/humanIdentity.js";
import { humanChannelState } from "../human/humanChannelState.js";
import { createLogger } from "../log.js";
import { createTaskRecordInTransaction } from "../tasks/taskCreation.js";
import { taskAssigneeFromMentions } from "../tasks/taskMentionAssignment.js";
import { TaskOperationError } from "../tasks/taskTypes.js";
import {
  channelMembers,
  channelMembersForChannel,
  membersToAutoJoin,
  parseMentions,
  spaceMembers,
  type ConversationMember,
} from "../channels/channelMembership.js";
import { serializeMessage } from "./messageSerialization.js";
import { releaseDispatchWakeInTransaction } from "../dispatch/dispatchReservation.js";
import { hasAgentSurfaceAccessInTransaction } from "../channels/agentSurfaceAccess.js";

export type MessageSender = {
  type: "human" | "agent" | "system";
  id: string | null;
  name: string;
};

export interface MessageContext {
  spaceId: string;
  channelId: string;
  sender: MessageSender;
  threadId?: string | null;
  uiSnapshot?: MessageContextSnapshot | null;
  memoryPolicy?: "eligible" | "exclude";
}

export type PreparedAction =
  | {
      type: "channel:create";
      name: string;
      description: unknown;
      visibility: "public" | "private";
      initialAgents: unknown[];
    }
  | {
      type: "agent:create";
      name: string;
      description: string | null;
      roleTemplate: unknown;
    };

export type PostMessageCommand =
  | {
      kind: "chat";
      context: MessageContext;
      content: string;
      attachmentIds?: string[];
      canvasSelection?: CanvasSelectionInput;
      executionBinding?: MessageExecutionBindingInput | null;
    }
  | {
      kind: "agent-introduction";
      context: MessageContext;
      content: string;
      attachmentIds?: string[];
      proof: { agentId: string; token: string };
    }
  | {
      kind: "action-proposal";
      context: MessageContext;
      action: PreparedAction;
    }
  | {
      kind: "reminder";
      context: MessageContext;
      content: string;
    };

export interface CreateTaskCommand {
  messageId?: string;
  writePrecondition?: (tx: SpaceTransaction, channelId: string) => void;
  context: MessageContext;
  title: string;
  executionMode: "autopilot" | "plan-first";
  parentTaskId?: string | null;
  attachmentIds?: string[];
}

export interface MessagePostingModule {
  post(command: PostMessageCommand): Promise<typeof schema.messages.$inferSelect>;
}

export interface TaskModule {
  create(command: CreateTaskCommand): Promise<typeof schema.messages.$inferSelect>;
}

export interface LegacyMentionDispatchModule {
  dispatch(input: {
    spaceId: string;
    messageId: string;
    targetSurfaceId: string;
    targetAgentIds: string[];
  }): Promise<string[]>;
  recover(spaceId: string): Promise<number>;
}

export interface ConversationEventSink {
  publish(spaceId: string, event: unknown): Promise<void>;
}

export interface DispatchMessageContext {
  chainId: string;
  dispatchDepth: number;
  taskMessageId: string | null;
}

export interface WakeDispatchInput {
  spaceId: string;
  dispatch: DispatchMessageContext;
  messageId: string;
  targetAgent: { id: string; name: string; displayName: string };
  fallbackChannelId: string;
  commitChannelId: string;
  durableReservation?: boolean;
  delivery: {
    seq: number;
    from: string;
    target: string;
    targetName: string;
    msgShort: string;
    isTask: boolean;
    content: string;
    mentioned: boolean;
    streamId?: string;
    responseDirective: "required" | "optional";
    responseReason: string;
  };
}

export type WakeDispatchResult =
  | { status: "sent" }
  | { status: "pending"; reason: string }
  | { status: "unavailable"; reason: string }
  | { status: "blocked"; code: string; reason: string; wakeCount: number };

export interface PreparedWakeDispatch {
  dispatch(input: WakeDispatchInput): Promise<WakeDispatchResult>;
}

export interface WakeDispatchPort {
  resolveMessageContext(input: {
    spaceId: string;
    messageId: string;
    channelId: string;
    senderType: MessageSender["type"];
    senderId: string | null;
    taskMessageId: string | null;
  }): Promise<DispatchMessageContext>;
  ensureChain(input: {
    spaceId: string;
    dispatch: DispatchMessageContext;
    rootMessageId: string;
    channelId: string;
  }): Promise<void>;
  prepareTargets(input: {
    spaceId: string;
    targetAgents: WakeDispatchInput["targetAgent"][];
  }): Promise<PreparedWakeDispatch>;
  dispatch(input: WakeDispatchInput): Promise<WakeDispatchResult>;
}

export interface AgentIntroductionProofPort {
  consume(spaceId: string, agentId: string, token: string): boolean;
  complete(spaceId: string, agentId: string, token: string): void;
  restore(spaceId: string, agentId: string, token: string): void;
}

export interface DurableDeliveryJournalPort {
  usesV2(spaceId: string, agentId: string): boolean;
  persistMessageInTransaction(tx: SpaceTransaction, input: {
    spaceId: string;
    channel: typeof schema.channels.$inferSelect;
    message: typeof schema.messages.$inferSelect;
    senderType: MessageSender["type"];
    senderId: string | null;
    candidateAgentIds: string[];
    mentions: MessageMention[];
    explicitTaskAgentId?: string | null;
    targetSurface?: { kind: "channel" | "private" | "dm" | "thread"; id: string };
    forceObserveAgentIds?: string[];
    forceObserveReason?: string;
    forceRequiredAgentIds?: string[];
    forceRequiredReason?: string;
  }): number;
  persistChannelMessageInTransaction?(tx: SpaceTransaction, spaceId: string, message: typeof schema.messages.$inferSelect): number;
  schedulePending?(spaceId: string): Promise<void>;
}

export class AgentIntroductionAlreadyCompletedError extends Error {
  constructor(public readonly agentId: string) {
    super(`agent introduction already completed: ${agentId}`);
    this.name = "AgentIntroductionAlreadyCompletedError";
  }
}

export class AgentIntroductionTokenRejectedError extends Error {
  constructor(public readonly agentId: string) {
    super(`agent introduction token is no longer active: ${agentId}`);
    this.name = "AgentIntroductionTokenRejectedError";
  }
}

interface ConversationModuleDependencies {
  eventSink: ConversationEventSink;
  wakeDispatch: WakeDispatchPort;
  introductionProof: AgentIntroductionProofPort;
  deliveryJournal?: DurableDeliveryJournalPort;
}

interface PreparedWrite {
  channel: typeof schema.channels.$inferSelect;
  members: ConversationMember[];
  mentionPool: ConversationMember[];
  addressableMentions: ConversationMember[];
  channelAllScope: typeof schema.channels.$inferSelect | null;
  channelAllRecipients: ConversationMember[];
  taskAssigneeId: string | null;
  taskAssignee: typeof schema.agents.$inferSelect | null;
}

type WriteInput = {
  context: MessageContext;
  content: string;
  attachmentIds?: string[];
  messageType: "chat" | "action";
  actionMetadata?: unknown;
  introductionProof?: { agentId: string; token: string };
  canvasSelection?: CanvasSelectionInput;
  executionBinding?: MessageExecutionBindingInput | null;
  task?: { messageId?: string; writePrecondition?: (tx: SpaceTransaction, channelId: string) => void; executionMode: "autopilot" | "plan-first"; parentTaskId?: string | null };
};

interface PersistedTaskAssignmentAudit {
  message: typeof schema.messages.$inferSelect;
  dispatch: DispatchMessageContext;
}

interface DurableWriteResult {
  message: typeof schema.messages.$inferSelect;
  directThread: typeof schema.channels.$inferSelect | null;
  mentions: MessageMention[];
  attachments: (typeof schema.attachments.$inferSelect)[];
  memberUpdateCount: number;
  createdAudit: typeof schema.messages.$inferSelect | null;
  assignmentAudit: PersistedTaskAssignmentAudit | null;
}

const log = createLogger("messages:posting");

function canvasMessageContextSnapshot(
  spaceId: string,
  snapshotId: string,
  documentRevision: number,
  capturedAt: number,
): MessageContextSnapshot {
  return {
    spaceId,
    module: "canvas",
    routeId: "canvas.document",
    openObjectRefs: [{ type: CANVAS_SELECTION_SNAPSHOT_REF_TYPE, id: snapshotId, revision: documentRevision }],
    focusedRef: { type: CANVAS_SELECTION_SNAPSHOT_REF_TYPE, id: snapshotId },
    capturedAt,
  };
}

function ensureDispatchChainInTransaction(
  tx: SpaceTransaction,
  input: {
    spaceId: string;
    dispatch: DispatchMessageContext;
    rootMessageId: string;
    channelId: string;
  },
): void {
  tx.insert(schema.dispatchChains).values({
    id: input.dispatch.chainId,
    spaceId: input.spaceId,
    rootMessageId: input.rootMessageId,
    taskMessageId: input.dispatch.taskMessageId,
    channelId: input.channelId,
    maxDepthSeen: input.dispatch.dispatchDepth,
  }).onConflictDoNothing().run();
  if (input.dispatch.taskMessageId) {
    tx.update(schema.dispatchChains).set({
      taskMessageId: input.dispatch.taskMessageId,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.dispatchChains.id, input.dispatch.chainId),
      isNull(schema.dispatchChains.taskMessageId),
    )).run();
  }
}

function taskTitle(content: string): string {
  const title = ((content || "").split("\n")[0] ?? "").trim();
  return title.length > 40 ? `${title.slice(0, 40)}…` : title;
}

export function agentReplyStreamId(messageId: string, agentId: string): string {
  return `${messageId}:${agentId}`;
}

export function createConversationModules(dependencies: ConversationModuleDependencies): {
  messagePosting: MessagePostingModule;
  tasks: TaskModule;
  legacyMentionDispatch: LegacyMentionDispatchModule;
} {
  const { eventSink, wakeDispatch, introductionProof, deliveryJournal } = dependencies;

  async function runPostCommit(label: string, operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      log.warn("post-commit operation failed", {
        operation: label,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function publishThreadUpdated(
    spaceId: string,
    channel: typeof schema.channels.$inferSelect | undefined,
    senderId: string | null,
    senderType: MessageSender["type"],
  ): Promise<void> {
    if (channel?.type !== "thread" || !channel.parentMessageId) return;
    const db = dbForSpace(spaceId);
    const replies = db.select({ id: schema.messages.id }).from(schema.messages)
      .where(eq(schema.messages.channelId, channel.id)).all();
    const participants = db.select().from(schema.channelAgentMembers)
      .where(eq(schema.channelAgentMembers.channelId, channel.id)).all();
    const humanState = await humanChannelState(spaceId, channel.id);
    const parent = db.select({ channelId: schema.messages.channelId }).from(schema.messages)
      .where(eq(schema.messages.id, channel.parentMessageId)).get();
    await eventSink.publish(spaceId, {
      type: "thread:updated",
      threadChannelId: channel.id,
      parentMessageId: channel.parentMessageId,
      parentChannelId: parent?.channelId ?? null,
      replyCount: replies.length,
      participantIds: [
        ...participants.map((participant) => participant.agentId),
        ...(humanState?.threadFollowedAt
          ? [getHumanIdentity()?.id].filter((id): id is string => Boolean(id))
          : []),
      ],
      senderId,
      senderType,
    });
  }

  async function mentionAutoJoinPool(
    spaceId: string,
    channel: typeof schema.channels.$inferSelect,
  ): Promise<ConversationMember[]> {
    const db = dbForSpace(spaceId);
    let target = channel;
    if (channel.type === "thread" && channel.parentMessageId) {
      const parent = db.select().from(schema.messages).where(eq(schema.messages.id, channel.parentMessageId)).get();
      const parentChannel = parent
        ? db.select().from(schema.channels).where(eq(schema.channels.id, parent.channelId)).get()
        : undefined;
      if (parentChannel) target = parentChannel;
      else log.warn("thread parent channel unresolved; @-mention reach falls back to thread members", {
        channelId: channel.id,
        parentMessageId: channel.parentMessageId,
      });
    }
    return target.type === "channel" ? spaceMembers(spaceId) : channelMembers(spaceId, target.id);
  }

  async function agentThreadMentionPool(
    spaceId: string,
    channel: typeof schema.channels.$inferSelect,
  ): Promise<ConversationMember[]> {
    if (channel.type !== "thread" || !channel.parentMessageId) return [];
    const db = dbForSpace(spaceId);
    const parent = db.select({ channelId: schema.messages.channelId }).from(schema.messages)
      .where(eq(schema.messages.id, channel.parentMessageId)).get();
    return parent ? channelMembers(spaceId, parent.channelId) : [];
  }

  function channelAllMentionScope(
    spaceId: string,
    channel: typeof schema.channels.$inferSelect,
  ): typeof schema.channels.$inferSelect | null {
    if (channel.type === "channel" || channel.type === "private") return channel;
    if (channel.type !== "thread" || !channel.parentMessageId) return null;
    const db = dbForSpace(spaceId);
    const parentMessage = db.select({ channelId: schema.messages.channelId }).from(schema.messages).where(and(
      eq(schema.messages.id, channel.parentMessageId),
      eq(schema.messages.spaceId, spaceId),
    )).get();
    if (!parentMessage) return null;
    const parentChannel = db.select().from(schema.channels).where(and(
      eq(schema.channels.id, parentMessage.channelId),
      eq(schema.channels.spaceId, spaceId),
      isNull(schema.channels.deletedAt),
    )).get();
    return parentChannel?.type === "channel" || parentChannel?.type === "private" ? parentChannel : null;
  }

  async function preflight(input: WriteInput): Promise<PreparedWrite> {
    const { context } = input;
    const db = dbForSpace(context.spaceId);
    const channel = await requireWritableChannel(context.spaceId, context.channelId);
    let members = await channelMembersForChannel(context.spaceId, channel);
    const hasMentionToken = input.content.includes("@");
    const mentionPool = hasMentionToken
      ? canAutoJoinMentionedMembers(context.sender.type)
        ? await mentionAutoJoinPool(context.spaceId, channel)
        : context.sender.type === "agent" && channel.type === "thread"
          ? await agentThreadMentionPool(context.spaceId, channel)
          : members
      : members;
    const addressableMentions = hasMentionToken ? parseMentions(input.content, mentionPool) : [];
    const hasHumanChannelAllToken = context.sender.type === "human" && containsChannelAllMention(input.content);
    if (input.task && hasHumanChannelAllToken) {
      throw new TaskOperationError(
        "INVALID_ARGUMENT",
        "As Task does not support @all; mention exactly one Agent or leave the task unassigned",
      );
    }
    const allScope = hasHumanChannelAllToken ? channelAllMentionScope(context.spaceId, channel) : null;
    const allRecipients = allScope
      ? (await channelMembers(context.spaceId, allScope.id)).filter((member) => member.type === "agent")
      : [];
    const taskAssigneeId = taskAssigneeFromMentions({
      asTask: Boolean(input.task),
      senderType: context.sender.type,
      channelType: channel.type,
      mentions: addressableMentions,
    });
    const taskAssignee = taskAssigneeId
      ? db.select().from(schema.agents).where(and(
          eq(schema.agents.id, taskAssigneeId),
          eq(schema.agents.spaceId, context.spaceId),
          isNull(schema.agents.deletedAt),
        )).get() ?? null
      : null;
    if (taskAssigneeId && !taskAssignee) {
      throw new TaskOperationError("INVALID_ARGUMENT", "task assignee is unavailable");
    }
    return {
      channel,
      members,
      mentionPool,
      addressableMentions,
      channelAllScope: allScope,
      channelAllRecipients: allRecipients,
      taskAssigneeId,
      taskAssignee,
    };
  }

  async function taskMessageIdForChannel(
    spaceId: string,
    channel: typeof schema.channels.$inferSelect,
  ): Promise<string | null> {
    if (channel.type !== "thread" || !channel.parentMessageId) return null;
    const parent = dbForSpace(spaceId).select({ id: schema.messages.id, taskStatus: schema.messages.taskStatus })
      .from(schema.messages).where(and(
        eq(schema.messages.id, channel.parentMessageId),
        eq(schema.messages.spaceId, spaceId),
      )).get();
    return parent?.taskStatus ? parent.id : null;
  }

  async function appendSystemMessage(input: {
    spaceId: string;
    channelId: string;
    content: string;
    actor?: { type: "human" | "agent"; id: string };
    dispatch?: DispatchMessageContext & { messageId?: string };
  }): Promise<typeof schema.messages.$inferSelect> {
    const db = dbForSpace(input.spaceId);
    const seq = await nextSeq(input.spaceId);
    const message = db.transaction((tx) => {
      const inserted = tx.insert(schema.messages).values({
        ...(input.dispatch?.messageId ? { id: input.dispatch.messageId } : {}),
        seq,
        spaceId: input.spaceId,
        channelId: input.channelId,
        senderType: "system",
        senderId: input.actor?.id ?? null,
        senderName: "system",
        messageType: "system",
        content: input.content,
        memoryPolicy: "exclude",
        searchText: input.content,
        dispatchChainId: input.dispatch?.chainId ?? null,
        dispatchDepth: input.dispatch?.dispatchDepth ?? null,
      }).returning().get();
      deliveryJournal?.persistChannelMessageInTransaction?.(tx, input.spaceId, inserted);
      tx.update(schema.channels).set({ lastMessageAt: new Date() })
        .where(eq(schema.channels.id, input.channelId)).run();
      return inserted;
    });
    const channel = db.select().from(schema.channels).where(eq(schema.channels.id, input.channelId)).get();
    await eventSink.publish(input.spaceId, {
      type: "message",
      channelId: input.channelId,
      message: { ...serializeMessage(message, [], []), channelType: channel?.type ?? null },
    });
    await publishThreadUpdated(input.spaceId, channel, input.actor?.id ?? null, "system");
    await deliveryJournal?.schedulePending?.(input.spaceId);
    return message;
  }

  async function reportDispatchBlock(input: {
    spaceId: string;
    dispatch: DispatchMessageContext;
    messageId: string;
    targetAgent: { id: string; name: string };
    fallbackChannelId: string;
    blocked: Extract<WakeDispatchResult, { status: "blocked" }>;
  }): Promise<void> {
    log.warn("dispatch rejected", {
      code: input.blocked.code,
      reason: input.blocked.reason,
      chainId: input.dispatch.chainId,
      taskMessageId: input.dispatch.taskMessageId,
      messageId: input.messageId,
      targetAgentId: input.targetAgent.id,
      dispatchDepth: input.dispatch.dispatchDepth,
      wakeCount: input.blocked.wakeCount,
    });
    let channelId = input.fallbackChannelId;
    if (input.dispatch.taskMessageId) {
      const task = dbForSpace(input.spaceId).select({ threadId: schema.messages.threadId })
        .from(schema.messages).where(eq(schema.messages.id, input.dispatch.taskMessageId)).get();
      channelId = task?.threadId ?? channelId;
    }
    await appendSystemMessage({
      spaceId: input.spaceId,
      channelId,
      content: `Dispatch guard blocked wake for @${input.targetAgent.name}: ${input.blocked.reason} [${input.blocked.code}]`,
      dispatch: input.dispatch,
    });
  }

  async function dispatchOne(
    input: WakeDispatchInput,
    dispatcher: PreparedWakeDispatch = wakeDispatch,
  ): Promise<WakeDispatchResult> {
    const result = await dispatcher.dispatch(input);
    if (result.status === "blocked") {
      await reportDispatchBlock({
        spaceId: input.spaceId,
        dispatch: input.dispatch,
        messageId: input.messageId,
        targetAgent: input.targetAgent,
        fallbackChannelId: input.fallbackChannelId,
        blocked: result,
      });
    }
    return result;
  }

  async function dispatchMessageWakes(input: {
    write: WriteInput;
    prepared: PreparedWrite;
    message: typeof schema.messages.$inferSelect;
    mentions: MessageMention[];
    dispatch: DispatchMessageContext;
  }): Promise<string[]> {
    const { write, prepared, message, mentions, dispatch } = input;
    const { context } = write;
    const db = dbForSpace(context.spaceId);
    const mentionedAgents = new Set(mentions
      .filter((mention) => mention.type === "agent")
      .map((mention) => mention.id));
    const directMentionThread = message.threadId
      && !message.taskStatus
      && (prepared.channel.type === "channel" || prepared.channel.type === "private")
      && !prepared.channelAllScope
      ? db.select().from(schema.channels).where(and(
          eq(schema.channels.id, message.threadId),
          eq(schema.channels.spaceId, context.spaceId),
          eq(schema.channels.type, "thread"),
        )).get() ?? null
      : null;
    const candidateAgents = prepared.taskAssigneeId
      ? []
      : prepared.members.filter((member): member is ConversationMember & { type: "agent" } =>
          member.type === "agent"
          && member.id !== context.sender.id
          && (!directMentionThread || mentionedAgents.has(member.id))
          && !write.canvasSelection
          && !deliveryJournal?.usesV2(context.spaceId, member.id));
    if (!candidateAgents.length) return [];
    const dispatchSettings = await resolveAgentDispatchSettings(
      context.spaceId,
      directMentionThread?.id ?? context.channelId,
      candidateAgents.map((agent) => agent.id),
    );
    const dispatchSettingsByAgentId = new Map(dispatchSettings.map((settings) => [settings.responseMode.agentId, settings]));
    const parentTask = prepared.channel.type === "thread" && prepared.channel.parentMessageId
      ? db.select({
          taskStatus: schema.messages.taskStatus,
          taskAssigneeId: schema.messages.taskAssigneeId,
        }).from(schema.messages).where(eq(schema.messages.id, prepared.channel.parentMessageId)).get()
      : null;
    const deliveryChannel = directMentionThread ?? prepared.channel;
    const targetName = directMentionThread
      ? `thread:${message.id.slice(0, 8)}`
      : prepared.channel.type === "dm"
      ? `dm:@${context.sender.name}`
      : `#${prepared.channel.name ?? context.channelId}`;
    const plannedWakes: WakeDispatchInput[] = [];
    for (const member of candidateAgents) {
      const mentioned = mentionedAgents.has(member.id);
      const settings = dispatchSettingsByAgentId.get(member.id);
      if (!settings) continue;
      const responseMode = settings.responseMode;
      const decision = decideAgentMessageResponse({
        agentId: member.id,
        channelType: deliveryChannel.type as "channel" | "private" | "dm" | "thread",
        senderType: context.sender.type,
        effectiveMode: responseMode.effectiveResponseMode,
        messageSeq: message.seq,
        mentioned,
        taskAssigneeId: message.taskStatus ? message.taskAssigneeId : null,
        parentTaskAssigneeId: parentTask?.taskAssigneeId ?? null,
        isTask: Boolean(message.taskStatus),
        ambientWakeAfterSeq: responseMode.ambientWakeAfterSeq,
        mentionWakeAfterSeq: responseMode.mentionWakeAfterSeq,
      });
      if (!decision.wake || decision.directive === "observe") continue;
      if (decision.deliveryClass === "ambient" && !agentHasScope(settings.scopes, "inbox:receive")) continue;
      plannedWakes.push({
        spaceId: context.spaceId,
        dispatch,
        messageId: message.id,
        targetAgent: member,
        fallbackChannelId: context.channelId,
        commitChannelId: directMentionThread?.id ?? message.threadId ?? context.channelId,
        delivery: {
          seq: message.seq,
          from: context.sender.name,
          target: directMentionThread?.id ?? context.channelId,
          targetName,
          msgShort: message.id.slice(0, 8),
          isTask: Boolean(message.taskStatus || parentTask?.taskStatus),
          content: write.content,
          mentioned,
          streamId: agentReplyStreamId(message.id, member.id),
          responseDirective: decision.directive,
          responseReason: decision.reason,
        },
      });
    }
    if (!plannedWakes.length) return [];
    const dispatcher = await wakeDispatch.prepareTargets({
      spaceId: context.spaceId,
      targetAgents: plannedWakes.map((wake) => wake.targetAgent),
    });
    const woken: string[] = [];
    const results = await Promise.all(plannedWakes.map((wake) => dispatchOne(wake, dispatcher)));
    for (let index = 0; index < plannedWakes.length; index += 1) {
      const wake = plannedWakes[index]!;
      const result = results[index]!;
      if (result.status === "sent") {
        woken.push(`${wake.targetAgent.name}${wake.delivery.mentioned ? "(@)" : ""}:${wake.delivery.responseDirective}`);
      }
    }
    return woken;
  }

  async function dispatchPersistedLegacyMentions(input: {
    spaceId: string;
    messageId: string;
    targetSurfaceId: string;
    targetAgentIds: string[];
  }): Promise<string[]> {
    const db = dbForSpace(input.spaceId);
    const releaseReservations = (agentIds: readonly string[]): void => {
      if (!agentIds.length) return;
      db.transaction((tx) => {
        const reservations = tx.select().from(schema.dispatchWakes).where(and(
          eq(schema.dispatchWakes.spaceId, input.spaceId),
          eq(schema.dispatchWakes.messageId, input.messageId),
          eq(schema.dispatchWakes.status, "reserved"),
          inArray(schema.dispatchWakes.targetAgentId, [...agentIds]),
        )).all();
        for (const reservation of reservations) {
          releaseDispatchWakeInTransaction(tx, {
            spaceId: input.spaceId,
            reservationId: reservation.id,
          });
        }
      });
    };
    const message = db.select().from(schema.messages).where(and(
      eq(schema.messages.id, input.messageId),
      eq(schema.messages.spaceId, input.spaceId),
    )).get();
    const targetChannel = db.select().from(schema.channels).where(and(
      eq(schema.channels.id, input.targetSurfaceId),
      eq(schema.channels.spaceId, input.spaceId),
    )).get();
    if (!message || !targetChannel) {
      releaseReservations(input.targetAgentIds);
      return [];
    }
    const modes = db.select().from(schema.agentHarnessState)
      .where(inArray(schema.agentHarnessState.agentId, input.targetAgentIds)).all();
    const modeByAgent = new Map(modes.map((row) => [row.agentId, row.mode]));
    const legacyIds = [...new Set(input.targetAgentIds)].filter((agentId) => (modeByAgent.get(agentId) ?? "legacy") === "legacy");
    releaseReservations(input.targetAgentIds.filter((agentId) => !legacyIds.includes(agentId)));
    if (!legacyIds.length) return [];
    const targets = db.select().from(schema.agents).where(and(
      inArray(schema.agents.id, legacyIds),
      eq(schema.agents.spaceId, input.spaceId),
      isNull(schema.agents.deletedAt),
    )).all();
    const targetIds = new Set(targets.map((target) => target.id));
    releaseReservations(legacyIds.filter((agentId) => !targetIds.has(agentId)));
    const settings = await resolveAgentDispatchSettings(input.spaceId, targetChannel.id, targets.map((target) => target.id));
    const settingsByAgent = new Map(settings.map((item) => [item.responseMode.agentId, item]));
    const parentTask = targetChannel.type === "thread" && targetChannel.parentMessageId
      ? db.select({ id: schema.messages.id, taskStatus: schema.messages.taskStatus }).from(schema.messages)
          .where(eq(schema.messages.id, targetChannel.parentMessageId)).get()
      : null;
    const dispatch: DispatchMessageContext = {
      chainId: message.dispatchChainId ?? message.id,
      dispatchDepth: message.dispatchDepth ?? 0,
      taskMessageId: parentTask?.taskStatus ? parentTask.id : null,
    };
    const targetName = targetChannel.type === "thread" && targetChannel.parentMessageId
      ? `thread:${targetChannel.parentMessageId.slice(0, 8)}`
      : `#${targetChannel.name ?? targetChannel.id}`;
    const planned: WakeDispatchInput[] = [];
    for (const target of targets) {
      const hasAccess = db.transaction((tx) => hasAgentSurfaceAccessInTransaction(tx, {
        spaceId: input.spaceId,
        channelId: targetChannel.id,
        agentId: target.id,
      }));
      if (!hasAccess) {
        releaseReservations([target.id]);
        continue;
      }
      const setting = settingsByAgent.get(target.id);
      if (!setting) {
        releaseReservations([target.id]);
        continue;
      }
      const responseMode = setting.responseMode;
      const decision = decideAgentMessageResponse({
        agentId: target.id,
        channelType: targetChannel.type as "channel" | "private" | "dm" | "thread",
        senderType: "agent",
        effectiveMode: responseMode.effectiveResponseMode,
        messageSeq: message.seq,
        mentioned: true,
        parentTaskAssigneeId: null,
        isTask: Boolean(parentTask?.taskStatus),
        ambientWakeAfterSeq: responseMode.ambientWakeAfterSeq,
        mentionWakeAfterSeq: responseMode.mentionWakeAfterSeq,
      });
      if (!decision.wake || decision.directive === "observe") {
        releaseReservations([target.id]);
        continue;
      }
      planned.push({
        spaceId: input.spaceId,
        dispatch,
        messageId: message.id,
        targetAgent: target,
        fallbackChannelId: message.channelId,
        commitChannelId: targetChannel.id,
        durableReservation: true,
        delivery: {
          seq: message.seq,
          from: message.senderName,
          target: targetChannel.id,
          targetName,
          msgShort: message.id.slice(0, 8),
          isTask: Boolean(parentTask?.taskStatus),
          content: message.content,
          mentioned: true,
          streamId: agentReplyStreamId(message.id, target.id),
          responseDirective: decision.directive,
          responseReason: decision.reason,
        },
      });
    }
    if (!planned.length) return [];
    const dispatcher = await wakeDispatch.prepareTargets({
      spaceId: input.spaceId,
      targetAgents: planned.map((item) => item.targetAgent),
    });
    const results = await Promise.all(planned.map((item) => dispatchOne(item, dispatcher)));
    return planned.filter((_, index) => results[index]?.status === "sent").map((item) => item.targetAgent.id);
  }

  async function recoverPersistedLegacyMentions(spaceId: string): Promise<number> {
    const db = dbForSpace(spaceId);
    const reserved = db.select().from(schema.dispatchWakes).where(and(
      eq(schema.dispatchWakes.spaceId, spaceId),
      eq(schema.dispatchWakes.status, "reserved"),
    )).all();
    const groups = new Map<string, { messageId: string; targetSurfaceId: string; targetAgentIds: string[] }>();
    for (const wake of reserved) {
      const message = db.select().from(schema.messages).where(and(
        eq(schema.messages.id, wake.messageId),
        eq(schema.messages.spaceId, spaceId),
      )).get();
      if (!message) {
        db.transaction((tx) => releaseDispatchWakeInTransaction(tx, { spaceId, reservationId: wake.id }));
        continue;
      }
      if (!message.producedByTurnId) continue;
      const mention = db.select({ messageId: schema.messageMentions.messageId }).from(schema.messageMentions).where(and(
        eq(schema.messageMentions.messageId, message.id),
        eq(schema.messageMentions.mentionType, "agent"),
        eq(schema.messageMentions.mentionId, wake.targetAgentId),
      )).get();
      if (!mention) {
        db.transaction((tx) => releaseDispatchWakeInTransaction(tx, { spaceId, reservationId: wake.id }));
        continue;
      }
      const sourceChannel = db.select().from(schema.channels).where(eq(schema.channels.id, message.channelId)).get();
      const targetSurfaceId = message.threadId && (sourceChannel?.type === "channel" || sourceChannel?.type === "private")
        ? message.threadId
        : message.channelId;
      const key = `${message.id}:${targetSurfaceId}`;
      const group = groups.get(key) ?? { messageId: message.id, targetSurfaceId, targetAgentIds: [] };
      group.targetAgentIds.push(wake.targetAgentId);
      groups.set(key, group);
    }
    let recovered = 0;
    for (const group of groups.values()) {
      recovered += (await dispatchPersistedLegacyMentions({ spaceId, ...group })).length;
    }
    return recovered;
  }

  async function dispatchPersistedTaskAssignment(input: {
    write: WriteInput;
    prepared: PreparedWrite;
    task: typeof schema.messages.$inferSelect;
    audit: PersistedTaskAssignmentAudit;
  }): Promise<void> {
    const { write, prepared, task, audit } = input;
    const target = prepared.taskAssignee;
    if (!target || !task.threadId) return;
    if (deliveryJournal?.usesV2(write.context.spaceId, target.id)) return;
    const decision = decideAgentMessageResponse({
      agentId: target.id,
      channelType: "thread",
      senderType: "system",
      effectiveMode: target.defaultResponseMode,
      messageSeq: audit.message.seq,
      explicitTaskAssignment: true,
    });
    if (!decision.wake || decision.directive === "observe") return;
    await dispatchOne({
      spaceId: write.context.spaceId,
      dispatch: audit.dispatch,
      messageId: audit.message.id,
      targetAgent: { id: target.id, name: target.name, displayName: target.displayName },
      fallbackChannelId: task.threadId,
      commitChannelId: task.threadId,
      delivery: {
        seq: audit.message.seq,
        from: write.context.sender.name,
        target: task.threadId,
        targetName: `task #${task.taskNumber}`,
        msgShort: audit.message.id.slice(0, 8),
        isTask: true,
        content: `#${task.taskNumber} assigned to you`,
        mentioned: true,
        responseDirective: decision.directive,
        responseReason: decision.reason,
      },
    });
  }

  async function write(input: WriteInput): Promise<typeof schema.messages.$inferSelect> {
    const prepared = await preflight(input);
    const { context } = input;
    const db = dbForSpace(context.spaceId);
    const messageId = input.task?.messageId ?? randomUUID();
    const seq = await nextSeq(context.spaceId);
    const taskMessageId = input.task
      ? messageId
      : await taskMessageIdForChannel(context.spaceId, prepared.channel);
    const dispatch = await wakeDispatch.resolveMessageContext({
      spaceId: context.spaceId,
      messageId,
      channelId: context.channelId,
      senderType: context.sender.type,
      senderId: context.sender.id,
      taskMessageId,
    });
    if (input.canvasSelection) {
      if (input.task || input.messageType !== "chat") {
        throw new MessageExecutionBindingError("INVALID_ARGUMENT", "Canvas context can only be attached to an ordinary Chat message");
      }
      if (context.sender.type !== "human" || !context.sender.id) {
        throw new MessageExecutionBindingError("INVALID_ARGUMENT", "only the Human can attach Canvas context");
      }
    }
    let messageValues = {
      id: messageId,
      seq,
      spaceId: context.spaceId,
      channelId: context.channelId,
      senderType: context.sender.type,
      senderId: context.sender.id,
      senderName: context.sender.name,
      messageType: input.messageType,
      content: input.content,
      actionMetadata: input.actionMetadata ?? null,
      threadId: context.threadId ?? null,
      searchText: input.content,
      taskStatus: null,
      taskNumber: null,
      taskExecutionMode: input.task?.executionMode ?? "autopilot",
      dispatchChainId: dispatch.chainId,
      dispatchDepth: dispatch.dispatchDepth,
      memoryPolicy: context.sender.type === "human" ? context.memoryPolicy ?? "eligible" : "exclude",
      contextSnapshot: context.uiSnapshot ?? null,
    } satisfies typeof schema.messages.$inferInsert;

    const mentionJoined = !prepared.taskAssigneeId
      && (canAutoJoinMentionedMembers(context.sender.type)
        || (context.sender.type === "agent" && prepared.channel.type === "thread"))
      && input.content.includes("@")
      ? membersToAutoJoin(input.content, prepared.mentionPool, prepared.members)
      : [];
    let memberUpdateCount = mentionJoined.length ? 1 : 0;
    if (mentionJoined.length) prepared.members = [...prepared.members, ...mentionJoined];
    let channelAllJoined: ConversationMember[] = [];
    if (prepared.channelAllScope && prepared.channel.type === "thread") {
      const currentAgentIds = new Set(prepared.members
        .filter((member) => member.type === "agent")
        .map((member) => member.id));
      channelAllJoined = prepared.channelAllRecipients.filter((member) => !currentAgentIds.has(member.id));
      if (channelAllJoined.length) {
        memberUpdateCount++;
        prepared.members = [...prepared.members, ...channelAllJoined];
      }
    }
    const ordinaryMentions = prepared.taskAssigneeId
      ? prepared.addressableMentions
      : input.content.includes("@")
        ? parseMentions(input.content, prepared.members)
        : [];
    const mentions: MessageMention[] = prepared.channelAllScope
      ? mergeChannelAllMentions(
          ordinaryMentions,
          prepared.channelAllRecipients,
          prepared.channelAllScope.id,
        )
      : ordinaryMentions;
    const directlyMentionedAgents = mentions.filter((mention) => mention.type === "agent");
    const hasExecutionBinding = Boolean(input.canvasSelection);
    const shouldCreateDirectThread = !input.task
      && input.messageType === "chat"
      && (context.sender.type === "human" || context.sender.type === "agent")
      && (prepared.channel.type === "channel" || prepared.channel.type === "private")
      && !prepared.channelAllScope
      && !hasExecutionBinding
      && directlyMentionedAgents.length > 0;
    const directThreadId = shouldCreateDirectThread ? randomUUID() : null;
    if (directThreadId) messageValues.threadId = directThreadId;

    const actor = (context.sender.type === "human" || context.sender.type === "agent") && context.sender.id
      ? { type: context.sender.type, id: context.sender.id } as const
      : undefined;
    const createdAuditSeed = input.task
      ? { id: randomUUID(), seq: await nextSeq(context.spaceId) }
      : null;
    const assignmentAuditSeed = input.task && prepared.taskAssignee
      ? { id: randomUUID(), seq: await nextSeq(context.spaceId) }
      : null;
    const assignmentDispatch = assignmentAuditSeed
      ? {
          chainId: assignmentAuditSeed.id,
          dispatchDepth: 0,
          taskMessageId: messageId,
        } satisfies DispatchMessageContext
      : null;

    const proof = input.introductionProof;
    if (proof && !introductionProof.consume(context.spaceId, proof.agentId, proof.token)) {
      throw new AgentIntroductionTokenRejectedError(proof.agentId);
    }

    let durable: DurableWriteResult;
    try {
      durable = db.transaction((tx) => {
        input.task?.writePrecondition?.(tx, context.channelId);
        if (proof) {
          const claimed = tx.update(schema.agents).set({ introducedAt: new Date() }).where(and(
            eq(schema.agents.id, proof.agentId),
            eq(schema.agents.spaceId, context.spaceId),
            isNull(schema.agents.introducedAt),
          )).returning({ id: schema.agents.id }).get();
          if (!claimed) throw new AgentIntroductionAlreadyCompletedError(proof.agentId);
        }

        const directThread = directThreadId
          ? tx.insert(schema.channels).values({
              id: directThreadId,
              spaceId: context.spaceId,
              type: "thread",
              parentMessageId: messageId,
              name: `thread-${messageId.slice(0, 8)}`,
            }).returning().get()
          : null;
        let executionBinding: MessageExecutionBindingInput | null = null;
        let frozenCanvas: ReturnType<typeof freezeCanvasSelectionInTransaction> | null = null;
        if (input.canvasSelection && context.sender.id) {
          executionBinding = resolveExecutionBindingInTransaction(tx, {
            spaceId: context.spaceId,
            channel: prepared.channel,
            requested: input.executionBinding ?? null,
          });
          frozenCanvas = freezeCanvasSelectionInTransaction(
            tx,
            context.spaceId,
            input.canvasSelection,
            context.sender.id,
          );
          messageValues = {
            ...messageValues,
            contextSnapshot: canvasMessageContextSnapshot(
              context.spaceId,
              frozenCanvas.snapshotId,
              frozenCanvas.documentRevision,
              Date.now(),
            ),
          };
        }
        const message = input.task
          ? createTaskRecordInTransaction(tx, {
              spaceId: context.spaceId,
              channel: prepared.channel,
              message: messageValues,
              parentTaskId: input.task.parentTaskId,
              assigneeId: prepared.taskAssigneeId,
            })
          : tx.insert(schema.messages).values(messageValues).returning().get();
        if (frozenCanvas) attachCanvasSelectionToMessage(tx, frozenCanvas.snapshotId, message.id);
        if (executionBinding) {
          tx.insert(schema.messageExecutionBindings).values({
            messageId: message.id,
            executorAgentId: executionBinding.executorAgentId,
            mode: executionBinding.mode,
          }).run();
        }
        ensureDispatchChainInTransaction(tx, {
          spaceId: context.spaceId,
          dispatch,
          rootMessageId: messageId,
          channelId: context.channelId,
        });

        const insertAgentMembers = (channelId: string, members: ConversationMember[], watermark: number): void => {
          const agents = members.filter((member) => member.type === "agent");
          if (!agents.length) return;
          tx.insert(schema.channelAgentMembers).values(agents.map((member) => ({
            channelId,
            agentId: member.id,
            lastReadSeq: watermark,
            ...initialAgentResponseWakeWatermarks(watermark),
          }))).onConflictDoNothing().run();
        };

        if (context.sender.id && context.sender.type !== "system" && prepared.channel.type === "thread") {
          if (context.sender.type === "human") {
            const followedAt = new Date();
            tx.insert(schema.humanChannelStates).values({
              channelId: context.channelId,
              threadFollowedAt: followedAt,
              threadDoneAt: null,
              updatedAt: followedAt,
            }).onConflictDoUpdate({
              target: schema.humanChannelStates.channelId,
              set: { threadFollowedAt: followedAt, threadDoneAt: null, updatedAt: followedAt },
            }).run();
          } else {
            insertAgentMembers(context.channelId, [{
              type: "agent",
              id: context.sender.id,
              name: context.sender.name,
              displayName: context.sender.name,
            }], seq);
            tx.update(schema.humanChannelStates).set({ threadDoneAt: null, updatedAt: new Date() }).where(and(
              eq(schema.humanChannelStates.channelId, context.channelId),
              isNotNull(schema.humanChannelStates.threadFollowedAt),
            )).run();
          }
        }
        insertAgentMembers(context.channelId, mentionJoined, seq - 1);
        insertAgentMembers(context.channelId, channelAllJoined, seq - 1);
        if (directThread) {
          const directParticipants: ConversationMember[] = directlyMentionedAgents.map((mention) => ({
            type: "agent",
            id: mention.id,
            name: mention.name,
            displayName: mention.name,
          }));
          if (context.sender.type === "agent" && context.sender.id) {
            directParticipants.push({
              type: "agent",
              id: context.sender.id,
              name: context.sender.name,
              displayName: context.sender.name,
            });
          }
          insertAgentMembers(directThread.id, directParticipants, seq - 1);
          if (context.sender.type === "human") {
            const followedAt = new Date();
            tx.insert(schema.humanChannelStates).values({
              channelId: directThread.id,
              threadFollowedAt: followedAt,
              threadDoneAt: null,
              updatedAt: followedAt,
            }).onConflictDoUpdate({
              target: schema.humanChannelStates.channelId,
              set: { threadFollowedAt: followedAt, threadDoneAt: null, updatedAt: followedAt },
            }).run();
          }
        }

        let attachments: (typeof schema.attachments.$inferSelect)[] = [];
        if (input.attachmentIds?.length) {
          tx.update(schema.attachments).set({ messageId: message.id, channelId: context.channelId })
            .where(inArray(schema.attachments.id, input.attachmentIds)).run();
          attachments = tx.select().from(schema.attachments)
            .where(inArray(schema.attachments.id, input.attachmentIds)).all();
        }
        if (mentions.length) {
          tx.insert(schema.messageMentions).values(mentions.map((mention) => ({
            messageId: message.id,
            mentionType: mention.type,
            mentionId: mention.id,
            mentionName: mention.name,
          }))).run();
        }
        if (directThread) {
          const targetIds = directlyMentionedAgents.map((mention) => mention.id);
          deliveryJournal?.persistMessageInTransaction(tx, {
            spaceId: context.spaceId,
            channel: directThread,
            message,
            senderType: context.sender.type,
            senderId: context.sender.id,
            candidateAgentIds: targetIds,
            mentions,
            targetSurface: { kind: "thread", id: directThread.id },
          });
          const observers = prepared.members
            .filter((member) => member.type === "agent" && !targetIds.includes(member.id))
            .map((member) => member.id);
          if (observers.length) {
            deliveryJournal?.persistMessageInTransaction(tx, {
              spaceId: context.spaceId,
              channel: prepared.channel,
              message,
              senderType: context.sender.type,
              senderId: context.sender.id,
              candidateAgentIds: observers,
              mentions,
              forceObserveAgentIds: observers,
              forceObserveReason: "direct_mention_not_targeted",
            });
          }
        } else if (executionBinding) {
          const written = deliveryJournal?.persistMessageInTransaction(tx, {
            spaceId: context.spaceId,
            channel: prepared.channel,
            message,
            senderType: context.sender.type,
            senderId: context.sender.id,
            candidateAgentIds: [executionBinding.executorAgentId],
            mentions,
            forceRequiredAgentIds: [executionBinding.executorAgentId],
            forceRequiredReason: "execution_binding",
            targetSurface: { kind: prepared.channel.type as "channel" | "private" | "dm" | "thread", id: prepared.channel.id },
          }) ?? 0;
          if (written < 1) {
            throw new MessageExecutionBindingError("EXECUTOR_INELIGIBLE", "executor required delivery could not be persisted");
          }
        } else {
          deliveryJournal?.persistMessageInTransaction(tx, {
            spaceId: context.spaceId,
            channel: prepared.channel,
            message,
            senderType: context.sender.type,
            senderId: context.sender.id,
            candidateAgentIds: prepared.taskAssigneeId
              ? [prepared.taskAssigneeId]
              : prepared.members.filter((member) => member.type === "agent").map((member) => member.id),
            mentions,
            explicitTaskAgentId: prepared.taskAssigneeId,
            targetSurface: prepared.taskAssigneeId && message.threadId
              ? { kind: "thread", id: message.threadId }
              : undefined,
          });
        }
        if (prepared.taskAssigneeId) {
          const observers = prepared.members.filter((member) => member.type === "agent" && member.id !== prepared.taskAssigneeId).map((member) => member.id);
          if (observers.length) {
            deliveryJournal?.persistMessageInTransaction(tx, {
              spaceId: context.spaceId,
              channel: prepared.channel,
              message,
              senderType: context.sender.type,
              senderId: context.sender.id,
              candidateAgentIds: observers,
              mentions,
              forceObserveAgentIds: observers,
            });
          }
        }
        tx.update(schema.channels).set({ lastMessageAt: new Date() })
          .where(eq(schema.channels.id, context.channelId)).run();

        let createdAudit: typeof schema.messages.$inferSelect | null = null;
        if (createdAuditSeed) {
          const content = `${context.sender.name} created task #${message.taskNumber} "${taskTitle(input.content)}"`;
          createdAudit = tx.insert(schema.messages).values({
            id: createdAuditSeed.id,
            seq: createdAuditSeed.seq,
            spaceId: context.spaceId,
            channelId: context.channelId,
            senderType: "system",
            senderId: actor?.id ?? null,
            senderName: "system",
            messageType: "system",
            content,
            memoryPolicy: "exclude",
            searchText: content,
          }).returning().get();
          deliveryJournal?.persistMessageInTransaction(tx, {
            spaceId: context.spaceId,
            channel: prepared.channel,
            message: createdAudit,
            senderType: "system",
            senderId: actor?.id ?? null,
            candidateAgentIds: prepared.members.filter((member) => member.type === "agent").map((member) => member.id),
            mentions: [],
          });
          tx.update(schema.channels).set({ lastMessageAt: new Date() })
            .where(eq(schema.channels.id, context.channelId)).run();
        }

        let assignmentAudit: PersistedTaskAssignmentAudit | null = null;
        if (assignmentAuditSeed && assignmentDispatch && prepared.taskAssignee && message.threadId) {
          const assigneeName = prepared.taskAssignee.displayName || prepared.taskAssignee.name;
          const content = `${context.sender.name} assigned #${message.taskNumber} "${taskTitle(message.content)}" to ${assigneeName}`;
          ensureDispatchChainInTransaction(tx, {
            spaceId: context.spaceId,
            dispatch: assignmentDispatch,
            rootMessageId: assignmentAuditSeed.id,
            channelId: message.threadId,
          });
          const auditMessage = tx.insert(schema.messages).values({
            id: assignmentAuditSeed.id,
            seq: assignmentAuditSeed.seq,
            spaceId: context.spaceId,
            channelId: message.threadId,
            senderType: "system",
            senderId: actor?.id ?? null,
            senderName: "system",
            messageType: "system",
            content,
            memoryPolicy: "exclude",
            searchText: content,
            dispatchChainId: assignmentDispatch.chainId,
            dispatchDepth: assignmentDispatch.dispatchDepth,
          }).returning().get();
          const assignmentChannel = tx.select().from(schema.channels).where(eq(schema.channels.id, message.threadId)).get();
          if (assignmentChannel) {
            deliveryJournal?.persistMessageInTransaction(tx, {
              spaceId: context.spaceId,
              channel: assignmentChannel,
              message: auditMessage,
              senderType: "system",
              senderId: actor?.id ?? null,
              candidateAgentIds: [prepared.taskAssignee.id],
              mentions: [],
              explicitTaskAgentId: prepared.taskAssignee.id,
            });
          }
          tx.update(schema.channels).set({ lastMessageAt: new Date() })
            .where(eq(schema.channels.id, message.threadId)).run();
          assignmentAudit = { message: auditMessage, dispatch: assignmentDispatch };
        }
        return {
          message,
          directThread,
          mentions,
          attachments,
          memberUpdateCount,
          createdAudit,
          assignmentAudit,
        };
      });
    } catch (error) {
      if (proof) introductionProof.restore(context.spaceId, proof.agentId, proof.token);
      throw error;
    }

    if (proof) {
      await runPostCommit("complete agent introduction proof", async () => {
        introductionProof.complete(context.spaceId, proof.agentId, proof.token);
      });
    }
    for (let index = 0; index < durable.memberUpdateCount; index++) {
      await runPostCommit("publish channel membership update", () => eventSink.publish(context.spaceId, {
        type: "channel:members-updated",
        channelId: context.channelId,
      }));
    }
    await runPostCommit("publish message", () => eventSink.publish(context.spaceId, {
      type: "message",
      channelId: context.channelId,
      message: {
        ...serializeMessage(
          durable.message,
          durable.mentions,
          durable.attachments,
          [],
          loadCanvasContextsForMessages(db, context.spaceId, [durable.message.id]).get(durable.message.id) ?? null,
        ),
        channelType: prepared.channel.type,
      },
    }));
    if (durable.directThread) {
      await runPostCommit("publish direct mention thread", () => publishThreadUpdated(
        context.spaceId,
        durable.directThread ?? undefined,
        context.sender.id,
        context.sender.type,
      ));
    }
    if (input.task) {
      await runPostCommit("publish task creation", () => eventSink.publish(context.spaceId, {
        type: "task",
        op: "created",
        task: serializeMessage(durable.message, durable.mentions, durable.attachments),
      }));
      if (durable.createdAudit) {
        await runPostCommit("publish task creation audit", () => eventSink.publish(context.spaceId, {
          type: "message",
          channelId: context.channelId,
          message: {
            ...serializeMessage(durable.createdAudit!, [], []),
            channelType: prepared.channel.type,
          },
        }));
        await runPostCommit("publish task creation audit thread update", () => publishThreadUpdated(
          context.spaceId,
          prepared.channel,
          actor?.id ?? null,
          "system",
        ));
      }
      if (durable.assignmentAudit && durable.message.threadId) {
        const assignmentChannel = db.select().from(schema.channels)
          .where(eq(schema.channels.id, durable.message.threadId)).get();
        await runPostCommit("publish task assignment audit", () => eventSink.publish(context.spaceId, {
          type: "message",
          channelId: durable.message.threadId!,
          message: {
            ...serializeMessage(durable.assignmentAudit!.message, [], []),
            channelType: assignmentChannel?.type ?? "thread",
          },
        }));
        await runPostCommit("publish task assignment thread update", () => publishThreadUpdated(
          context.spaceId,
          assignmentChannel,
          actor?.id ?? null,
          "system",
        ));
        await runPostCommit("dispatch task assignment", () => dispatchPersistedTaskAssignment({
          write: input,
          prepared,
          task: durable.message,
          audit: durable.assignmentAudit!,
        }));
      }
    }
    await runPostCommit("publish thread update", () => publishThreadUpdated(
      context.spaceId,
      prepared.channel,
      context.sender.id,
      context.sender.type,
    ));
    await runPostCommit("schedule durable v2 deliveries", () => deliveryJournal?.schedulePending?.(context.spaceId) ?? Promise.resolve());
    let woken: string[] = [];
    await runPostCommit("dispatch message wakes", async () => {
      woken = await dispatchMessageWakes({
        write: input,
        prepared,
        message: durable.message,
        mentions: durable.mentions,
        dispatch,
      });
    });
    log.info("message created", {
      seq,
      channel: context.channelId,
      from: context.sender.name,
      kind: context.sender.type,
      mentions: durable.mentions.map((mention) => mention.name),
      wakeAgents: woken,
    });
    return durable.message;
  }


  const messagePosting: MessagePostingModule = {
    post(command) {
      if (command.kind === "action-proposal") {
        return write({
          context: command.context,
          content: "",
          messageType: "action",
          actionMetadata: {
            kind: "action-card",
            state: "prepared",
            action: command.action,
            executedAt: null,
            executedByUserId: null,
            executedByUserName: null,
            result: null,
          },
        });
      }
      return write({
        context: command.context,
        content: command.content,
        attachmentIds: "attachmentIds" in command ? command.attachmentIds : undefined,
        messageType: "chat",
        introductionProof: command.kind === "agent-introduction" ? command.proof : undefined,
        canvasSelection: command.kind === "chat" ? command.canvasSelection : undefined,
        executionBinding: command.kind === "chat" ? command.executionBinding : undefined,
      });
    },
  };
  const tasks: TaskModule = {
    create(command) {
      return write({
        context: command.context,
        content: command.title,
        attachmentIds: command.attachmentIds,
        messageType: "chat",
        task: {
          messageId: command.messageId,
          writePrecondition: command.writePrecondition,
          executionMode: command.executionMode,
          parentTaskId: command.parentTaskId,
        },
      });
    },
  };
  return {
    messagePosting,
    tasks,
    legacyMentionDispatch: { dispatch: dispatchPersistedLegacyMentions, recover: recoverPersistedLegacyMentions },
  };
}
