// Message core: seq assignment, @mention parsing, DB write, SSE broadcast (human), wake delivery (agent), target resolution.
import { randomUUID } from "node:crypto";
import { and, eq, ne, desc, gt, inArray, like, or, isNull } from "drizzle-orm";
import { dbForSpace, schema, spaceRecord } from "../db/index.js";
import { nextSeq, publish } from "./realtime.js";
import { isWorkerConnected, sendToWorker, workerRuntimes } from "../local-runtime/workerHub.js";
import type { AgentStartReason } from "../local-runtime/agentStart.js";
import { newKey, hashToken } from "./auth.js";
import { createLogger } from "../log.js";
import { coreLoopbackUrl } from "./localEndpoint.js";
import { clearAgentIntroductionTurns, completeAgentIntroductionTurn, consumeAgentIntroductionTurn, restoreAgentIntroductionTurn, setAgentIntroductionTurn } from "./agentIntroduction.js";
import { getHumanIdentity, humanIdentityForHandle, humanIdentityForId } from "../human/humanIdentity.js";
import { humanChannelState, trackHumanDm } from "../human/humanChannelState.js";
import { canHumanReadChannel } from "./channelAccess.js";
import { SqliteDispatchState, normalizeTaskExecutionMode, type DispatchMessageContext, type TaskExecutionMode, type WakeReservation } from "./dispatchGuard.js";
import { TaskOperationError, type TaskStatus } from "../tasks/taskTypes.js";
import { channelLifecycleState } from "../channels/channelLifecycle.js";
import {
  addChannelMembers,
  channelMaxSeq,
  channelMembers,
  membersToAutoJoin,
  parseMentions,
  spaceMembers,
  type ConversationMember,
} from "../channels/channelMembership.js";
import {
  persistedMessageMention,
  serializeMessage,
  type ReactionAggregate,
} from "../messages/messageSerialization.js";
import {
  AgentIntroductionAlreadyCompletedError,
  AgentIntroductionTokenRejectedError,
  agentReplyStreamId,
  createConversationModules,
  type ConversationEventSink,
  type CreateTaskCommand,
  type MessageContext,
  type PostMessageCommand,
  type PreparedAction,
  type WakeDispatchInput,
} from "../messages/messagePostingModule.js";
import { createWakeDispatchPort } from "./messageWakeDispatchAdapter.js";
import { runtimeWorkerPort } from "../runtime/control/runtimeWorkerAdapter.js";
import { WorkerAdmissionUncertainError } from "../local-runtime/workerHub.js";
import { threadModule } from "./threadModuleAdapter.js";
import {
  createTaskLifecycleModule,
  type TaskLifecycleModule,
} from "../tasks/taskLifecycleModule.js";
import { SessionModule } from "../sessions/sessionModule.js";
import { DeliveryJournal } from "../deliveries/deliveryJournal.js";
import { harnessTurnScheduler, scheduleV2Turns, turnCapabilityService } from "./harnessComposition.js";

export { TASK_STATUSES } from "../tasks/taskTypes.js";

export { AgentIntroductionAlreadyCompletedError, AgentIntroductionTokenRejectedError };

const log = createLogger("server:core");
// Per-agent raw token cache (server process memory; DB stores hash only). Injected into agent process at spawn; resolveAgent looks up by hash. See slice10.
const agentRawTokens = new Map<string, string>();

// Member description (bio) length limit (HumanDetailPanel/AgentDetailPanel both maxLength=3000 + "Description must be at most 3000 characters"). Shared by human+agent.
export const MAX_DESCRIPTION = 3000;
export const DESC_TOO_LONG = `Description must be at most ${MAX_DESCRIPTION} characters`;
export const descTooLong = (s: unknown): boolean => typeof s === "string" && s.length > MAX_DESCRIPTION;

// Agent name is the @mention handle: used directly as @<name> (parseMentions re, CLI, web) and as the
// dm:@<name> lookup key (resolveTarget). It must be a protocol-safe identifier — spaces / punctuation /
// emoji / leading digits break mention parsing and DM target resolution. Display-friendly text (Chinese,
// spaces, emoji) belongs in displayName, which is unconstrained and drives all human-facing rendering.
// `agents.name` is an unbounded `text` column, so the length cap is enforced here, not by the DB.
// Trailing / repeated hyphens (`bot--ok`, `my-agent-`) are intentionally allowed: they are harmless for
// @mention / DM resolution since the mention charset itself includes `-`; GitHub-style "no trailing
// hyphen" tightening is deferred as cosmetic. ⚠️ Keep AGENT_NAME_RE + MAX_AGENT_NAME in sync with the
// inline mirror in web/src/views/Members.tsx (CreateAgentModal) — there is no shared module because the
// web bundle must not import server code (it would pull in db/drizzle).
export const MAX_AGENT_NAME = 64;
export const AGENT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
export const INVALID_AGENT_NAME = `Agent name must be 1-${MAX_AGENT_NAME} characters, start with a letter, and contain only letters, numbers, hyphens, and underscores`;
export const invalidAgentName = (s: unknown): boolean => typeof s !== "string" || s.length > MAX_AGENT_NAME || !AGENT_NAME_RE.test(s);

export type Member = ConversationMember;
export type ReactionAgg = ReactionAggregate;
export {
  addChannelMembers,
  agentReplyStreamId,
  channelMaxSeq,
  channelMembers,
  membersToAutoJoin,
  parseMentions,
  spaceMembers,
};
export const serializeMsg = serializeMessage;

type AllowedWakeReservation = Extract<WakeReservation, { allowed: true }>;
type BlockedWakeReservation = Extract<WakeReservation, { allowed: false }>;

export async function reportDispatchRejection(o: {
  state: SqliteDispatchState;
  dispatch: DispatchMessageContext;
  messageId: string;
  targetAgentId: string;
  targetAgentName: string;
  fallbackChannelId: string;
  rejection: BlockedWakeReservation;
}): Promise<void> {
  const reservation = o.rejection;
  log.warn("dispatch rejected", {
    code: reservation.code,
    reason: reservation.reason,
    chainId: o.dispatch.chainId,
    taskMessageId: o.dispatch.taskMessageId,
    messageId: o.messageId,
    targetAgentId: o.targetAgentId,
    dispatchDepth: o.dispatch.dispatchDepth,
    wakeCount: reservation.wakeCount,
    maxDepth: o.state.limits.maxDepth,
    maxWakes: o.state.limits.maxWakes,
  });
  let noticeChannelId = o.fallbackChannelId;
  if (o.dispatch.taskMessageId) {
    const task = dbForSpace(o.state.spaceId).select({ threadId: schema.messages.threadId }).from(schema.messages)
      .where(eq(schema.messages.id, o.dispatch.taskMessageId)).get();
    noticeChannelId = task?.threadId ?? noticeChannelId;
  }
  await sysTaskMsg(
    o.state.spaceId,
    noticeChannelId,
    `Dispatch guard blocked wake for @${o.targetAgentName}: ${reservation.reason} [${reservation.code}]`,
    undefined,
    o.dispatch,
  );
}

async function reserveDispatchWake(o: {
  state: SqliteDispatchState;
  dispatch: DispatchMessageContext;
  messageId: string;
  targetAgentId: string;
  targetAgentName: string;
  fallbackChannelId: string;
}): Promise<AllowedWakeReservation | null> {
  const reservation = await o.state.getOrReserveWake({
    ...o.dispatch,
    messageId: o.messageId,
    targetAgentId: o.targetAgentId,
  });
  if (reservation.allowed) return reservation;
  await reportDispatchRejection({ ...o, rejection: reservation });
  return null;
}

async function publishThreadUpdated(
  spaceId: string,
  ch: typeof schema.channels.$inferSelect | undefined,
  senderId: string | null,
  senderType: "human" | "agent" | "system",
) {
  if (ch?.type !== "thread" || !ch.parentMessageId) return;
  const db = dbForSpace(spaceId);
  const replies = await db.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.channelId, ch.id));
  const parts = await db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, ch.id));
  const humanState = await humanChannelState(spaceId, ch.id);
  const parent = (await db.select({ channelId: schema.messages.channelId }).from(schema.messages).where(eq(schema.messages.id, ch.parentMessageId)))[0];
  await publish(spaceId, {
    type: "thread:updated",
    threadChannelId: ch.id,
    parentMessageId: ch.parentMessageId,
    parentChannelId: parent?.channelId ?? null,
    replyCount: replies.length,
    participantIds: [
      ...parts.map((participant) => participant.agentId),
      ...(humanState?.threadFollowedAt ? [getHumanIdentity()?.id].filter((id): id is string => Boolean(id)) : []),
    ],
    senderId,
    senderType,
  });
}

/** Aggregate message reactions into grouped shape: one entry per emoji {emoji,count,reactorIds,reactorNames}. */
export async function aggregateReactions(spaceId: string, messageIds: string[]): Promise<Map<string, ReactionAgg[]>> {
  const out = new Map<string, ReactionAgg[]>();
  if (!messageIds.length) return out;
  const db = dbForSpace(spaceId);
  const rows = await db.select().from(schema.reactions).where(inArray(schema.reactions.messageId, messageIds));
  if (!rows.length) return out;
  const aIds = [...new Set(rows.filter((row) => row.actorType === "agent").map((row) => row.actorId))];
  const agents = aIds.length ? await db.select().from(schema.agents).where(inArray(schema.agents.id, aIds)) : [];
  const nameOf = (t: string, id: string) => t === "human"
    ? (humanIdentityForId(id)?.displayName ?? "?")
    : (agents.find((a) => a.id === id)?.displayName || agents.find((a) => a.id === id)?.name || "?");
  for (const r of rows) {
    const list = out.get(r.messageId) ?? [];
    let e = list.find((x) => x.emoji === r.emoji);
    if (!e) { e = { emoji: r.emoji, count: 0, reactorIds: [], reactorNames: [] }; list.push(e); }
    e.count++; e.reactorIds.push(r.actorId); e.reactorNames.push(nameOf(r.actorType, r.actorId));
    out.set(r.messageId, list);
  }
  return out;
}

async function serializeMessageById(spaceId: string, messageId: string) {
  const db = dbForSpace(spaceId);
  const msg = (await db.select().from(schema.messages).where(eq(schema.messages.id, messageId)))[0];
  if (!msg) return null;
  const mts = await db.select().from(schema.messageMentions).where(eq(schema.messageMentions.messageId, messageId));
  const mentions = mts.map(persistedMessageMention);
  const atts = await db.select().from(schema.attachments).where(eq(schema.attachments.messageId, messageId));
  const reactions = (await aggregateReactions(spaceId, [messageId])).get(messageId) ?? [];
  return serializeMsg(msg, mentions, atts, reactions);
}

/** Add reaction (add-or-noop): unique index deduplication, broadcast message:updated. */
export async function addReaction(spaceId: string, messageId: string, actorType: "human" | "agent", actorId: string, emoji: string) {
  const db = dbForSpace(spaceId);
  await db.insert(schema.reactions).values({ messageId, actorType, actorId, emoji }).onConflictDoNothing();
  const m = await serializeMessageById(spaceId, messageId);
  if (m) await publish(spaceId, { type: "message:updated", message: m });
  return m;
}
export async function removeReaction(spaceId: string, messageId: string, actorType: "human" | "agent", actorId: string, emoji: string) {
  const db = dbForSpace(spaceId);
  await db.delete(schema.reactions).where(and(eq(schema.reactions.messageId, messageId), eq(schema.reactions.actorType, actorType), eq(schema.reactions.actorId, actorId), eq(schema.reactions.emoji, emoji)));
  const m = await serializeMessageById(spaceId, messageId);
  if (m) await publish(spaceId, { type: "message:updated", message: m });
  return m;
}

// ── Saved messages / bookmarks (/channels/saved) ──
// Private bookmarks: deduplicated per member (unique index), no broadcast. save is idempotent (onConflictDoNothing).
export async function saveMessage(spaceId: string, messageId: string) {
  const db = dbForSpace(spaceId);
  await db.insert(schema.humanSavedMessages).values({ spaceId, messageId }).onConflictDoNothing();
}
export async function unsaveMessage(spaceId: string, messageId: string) {
  const db = dbForSpace(spaceId);
  await db.delete(schema.humanSavedMessages).where(and(
    eq(schema.humanSavedMessages.spaceId, spaceId), eq(schema.humanSavedMessages.messageId, messageId)));
}
/** Bulk check which messageIds have been saved by this member (POST /channels/saved/check → {savedIds[]}). */
export async function checkSaved(spaceId: string, messageIds: string[]): Promise<string[]> {
  if (!messageIds.length) return [];
  const db = dbForSpace(spaceId);
  const rows = await db.select({ messageId: schema.humanSavedMessages.messageId }).from(schema.humanSavedMessages).where(and(
    eq(schema.humanSavedMessages.spaceId, spaceId), inArray(schema.humanSavedMessages.messageId, messageIds)));
  return rows.map((r) => r.messageId);
}
/** List saved messages (GET /channels/saved):
 * envelope {saved[], hasMore}; item is flat, uses messageId, inlines channel + thread parent context; no savedAt/attachments/reactions.
 * Ordered by savedAt (saved row createdAt) descending, limit+offset pagination (limit+1 probe for hasMore). */
export async function listSaved(spaceId: string, limit: number, offset: number) {
  const db = dbForSpace(spaceId);
  const rows = await db.select().from(schema.humanSavedMessages)
    .where(eq(schema.humanSavedMessages.spaceId, spaceId))
    .orderBy(desc(schema.humanSavedMessages.createdAt)).limit(limit + 1).offset(offset);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  if (!page.length) return { saved: [], hasMore: false };
  // Batch-load messages + their channels + (when thread) parent messages and parent channels, avoid N+1
  const msgs = await db.select().from(schema.messages).where(inArray(schema.messages.id, page.map((r) => r.messageId)));
  const msgById = new Map(msgs.map((m) => [m.id, m]));
  const chans = await db.select().from(schema.channels).where(inArray(schema.channels.id, [...new Set(msgs.map((m) => m.channelId))]));
  const chById = new Map(chans.map((c) => [c.id, c]));
  // thread channel → parent message → parent channel
  const parentMsgIds = [...new Set(chans.filter((c) => c.type === "thread" && c.parentMessageId).map((c) => c.parentMessageId!))];
  const parentMsgs = parentMsgIds.length ? await db.select().from(schema.messages).where(inArray(schema.messages.id, parentMsgIds)) : [];
  const parentMsgById = new Map(parentMsgs.map((m) => [m.id, m]));
  const parentChans = parentMsgs.length ? await db.select().from(schema.channels).where(inArray(schema.channels.id, [...new Set(parentMsgs.map((m) => m.channelId))])) : [];
  const parentChById = new Map(parentChans.map((c) => [c.id, c]));
  // IDOR-B5 residual (sec-idor6): read-time channel-access gate. A saved row's message may now live in a
  // channel the saver can no longer read (lost membership / channel turned private) or be an illegitimate
  // pre-write-gate save — re-check access at read time and drop what the caller can't currently see.
  // Hides (does not delete): re-gaining access surfaces it again. Same gate as the write path, per plane.
  const accessByChannel = new Map<string, boolean>(
    await Promise.all([...new Set(msgs.map((m) => m.channelId))].map(
      async (channelId) => [channelId, await canHumanReadChannel(spaceId, channelId)] as const)),
  );
  const saved = page.map((r) => {
    const m = msgById.get(r.messageId);
    if (!m) return null;
    if (!accessByChannel.get(m.channelId)) return null; // read-time channel-access gate (IDOR-B5 residual): drop messages in channels the caller can't currently read
    const ch = chById.get(m.channelId);
    const isThread = ch?.type === "thread";
    const pm = isThread && ch?.parentMessageId ? parentMsgById.get(ch.parentMessageId) : undefined;
    const pch = pm ? parentChById.get(pm.channelId) : undefined;
    return {
      messageId: m.id, content: m.content, createdAt: m.createdAt,
      channelId: m.channelId, channelType: ch?.type ?? "channel", channelName: ch?.name ?? null,
      parentChannelId: pch?.id ?? null, parentChannelType: pch?.type ?? null, parentChannelName: pch?.name ?? null,
      parentMessageId: isThread ? (ch?.parentMessageId ?? null) : null,
      senderId: m.senderId, senderType: m.senderType, senderName: m.senderName,
    };
  }).filter(Boolean);
  return { saved, hasMore };
}

async function agentConfigFromRow(a: typeof schema.agents.$inferSelect) {
  const db = dbForSpace(a.spaceId);
  const space = spaceRecord(a.spaceId);
  if (!space) return null;
  // Per-agent independent token (sk_agent_* prefix, slice10):
  // cache hit → reuse; first time → mint + store hash + cache raw; agent already running (cache lost after server restart but agent still running) → do not re-mint or send new token (daemon ignores agent:start for running agents, agent continues using old token, server verifies via DB hash) → zero desync.
  const legacyHarness = new SessionModule(a.spaceId, db).harnessMode(a.id) === "legacy";
  let token = legacyHarness ? agentRawTokens.get(a.id) : undefined;
  if (legacyHarness && !token && !(a.status === "active" && a.agentTokenHash)) {
    token = newKey("sk_agent_");
    agentRawTokens.set(a.id, token);
    await db.update(schema.agents).set({ agentTokenHash: hashToken(token) }).where(eq(schema.agents.id, a.id));
  }
  return {
    name: a.name, displayName: a.displayName, description: a.description,
    model: a.model, runtime: a.runtime, runtimeConfig: a.runtimeConfig, sessionId: a.sessionId ?? undefined, introduced: a.introducedAt != null,
    serverUrl: coreLoopbackUrl(), spaceId: a.spaceId, workspaceRoot: space.rootPath, agentId: a.id, agentToken: token,
  };
}

export interface CreateMessageOptions {
  spaceId: string;
  channelId: string;
  senderType: "human" | "agent" | "system";
  senderId: string | null;
  senderName: string;
  content: string;
  messageType?: string;
  threadId?: string | null;
  asTask?: boolean;
  attachmentIds?: string[];
  taskExecutionMode?: TaskExecutionMode;
  taskParentId?: string | null;
  introductionAgentId?: string;
  introductionToken?: string;
  actionMetadata?: unknown;
}

const conversationEventSink: ConversationEventSink = { publish };
let composedConversationModules: ReturnType<typeof createConversationModules> | null = null;

function conversationModules(): ReturnType<typeof createConversationModules> {
  if (composedConversationModules) return composedConversationModules;
  const wakeDispatch = createWakeDispatchPort({
    eventSink: conversationEventSink,
    runtimeWorker: runtimeWorkerPort,
    resolveTarget: agentStartTarget,
    resolveTargets: agentStartTargets,
    isTarget(value): value is AgentStartTarget { return value.ok; },
    wakeStartCommand(target, input: WakeDispatchInput, deliveryId) {
      return {
        type: "agent:start",
        source: "wake",
        deliveryId,
        spaceId: input.spaceId,
        agentId: input.targetAgent.id,
        config: target.cfg,
        reason: "wake",
        delivery: {
          seq: input.delivery.seq,
          from: input.delivery.from,
          target: input.delivery.target,
          targetName: input.delivery.targetName,
          msgShort: input.delivery.msgShort,
          isTask: input.delivery.isTask,
          mentioned: input.delivery.mentioned,
          ...(input.delivery.streamId ? { streamId: input.delivery.streamId } : {}),
          responseDirective: input.delivery.responseDirective,
          responseReason: input.delivery.responseReason,
        },
      };
    },
    markUnavailable: markAgentUnavailable,
  });
  composedConversationModules = createConversationModules({
    eventSink: conversationEventSink,
    wakeDispatch,
    introductionProof: {
      consume: consumeAgentIntroductionTurn,
      complete: completeAgentIntroductionTurn,
      restore: restoreAgentIntroductionTurn,
    },
    deliveryJournal: new DeliveryJournal(scheduleV2Turns),
  });
  return composedConversationModules;
}

let composedTaskLifecycle: TaskLifecycleModule | null = null;

function taskLifecycle(): TaskLifecycleModule {
  if (composedTaskLifecycle) return composedTaskLifecycle;
  composedTaskLifecycle = createTaskLifecycleModule({
    eventSink: conversationEventSink,
    threads: threadModule,
    scheduleDurableDeliveries: scheduleV2Turns,
    wake: {
      async prepare(input) {
        const dispatch = await new SqliteDispatchState(input.spaceId).resolveMessageContext({
          messageId: input.messageId,
          channelId: input.channelId,
          senderType: input.senderType,
          senderId: input.senderId,
          taskMessageId: input.taskMessageId,
        });
        return {
          chainId: dispatch.chainId,
          dispatchDepth: dispatch.dispatchDepth,
          taskMessageId: dispatch.taskMessageId ?? input.taskMessageId,
        };
      },
      async dispatch(input) {
        if (new SessionModule(input.spaceId).harnessMode(input.target.id) === "v2") {
          await scheduleV2Turns(input.spaceId);
          return;
        }
        const state = new SqliteDispatchState(input.spaceId);
        const reservation = await reserveDispatchWake({
          state,
          dispatch: input.dispatch,
          messageId: input.audit.id,
          targetAgentId: input.target.id,
          targetAgentName: input.target.name,
          fallbackChannelId: input.audit.channelId,
        });
        if (!reservation) return;
        const target = await agentStartTarget(input.spaceId, input.target.id);
        if (target.ok) {
          try {
            const admission = await runtimeWorkerPort.start({
              type: "agent:start",
              source: "wake",
              deliveryId: reservation.reservationId,
              spaceId: input.spaceId,
              agentId: input.target.id,
              config: target.cfg,
              reason: "wake",
              delivery: {
                seq: input.audit.seq,
                from: input.from,
                target: input.audit.channelId,
                targetName: `task #${input.task.taskNumber}`,
                msgShort: input.audit.id.slice(0, 8),
                isTask: true,
                mentioned: true,
                responseDirective: input.responseDirective,
                responseReason: input.responseReason,
              },
            });
            if (admission.status === "rejected") {
              await state.releaseWake(reservation.reservationId);
              return;
            }
            await state.commitWake(reservation.reservationId, {
              agentId: input.target.id,
              channelId: input.audit.channelId,
              chainId: input.dispatch.chainId,
              dispatchDepth: input.dispatch.dispatchDepth,
            });
          } catch (error) {
            if (!(error instanceof WorkerAdmissionUncertainError)) {
              log.warn("task wake admission remained pending", { agentId: input.target.id, detail: String(error) });
            }
          }
        } else {
          await state.releaseWake(reservation.reservationId);
          if (target.reason !== "agent not found") {
            await markAgentUnavailable(input.spaceId, input.target.id, target.reason);
          }
        }
      },
    },
    onPostCommitError(operation, error) {
      log.warn("task post-commit operation failed", {
        operation,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
  return composedTaskLifecycle;
}

function messageContext(options: CreateMessageOptions): MessageContext {
  return {
    spaceId: options.spaceId,
    channelId: options.channelId,
    sender: { type: options.senderType, id: options.senderId, name: options.senderName },
    threadId: options.threadId,
  };
}

export async function agentConfig(spaceId: string, agentId: string) {
  const db = dbForSpace(spaceId);
  // Skip soft-deleted agents (treated as non-existent → null, which every caller already handles): otherwise the
  // mint branch below would re-set `agentTokenHash` on a deleted row, reverting the clear done on delete (C4).
  const agent = db.select().from(schema.agents).where(and(
    eq(schema.agents.id, agentId),
    eq(schema.agents.spaceId, spaceId),
    isNull(schema.agents.deletedAt),
  )).get();
  return agent ? agentConfigFromRow(agent) : null;
}

async function agentConfigs(agents: (typeof schema.agents.$inferSelect)[]) {
  const configs = new Map<string, NonNullable<Awaited<ReturnType<typeof agentConfigFromRow>>>>();
  for (const agent of agents) {
    const config = await agentConfigFromRow(agent);
    if (config) configs.set(agent.id, config);
  }
  return configs;
}

export async function createMessage(options: CreateMessageOptions) {
  const modules = conversationModules();
  const context = messageContext(options);
  if (options.asTask) {
    const command: CreateTaskCommand = {
      context,
      title: options.content,
      executionMode: normalizeTaskExecutionMode(options.taskExecutionMode) ?? "autopilot",
      parentTaskId: options.taskParentId,
      attachmentIds: options.attachmentIds,
    };
    return modules.tasks.create(command);
  }
  let command: PostMessageCommand;
  if (options.messageType === "action") {
    const metadata = options.actionMetadata as { kind?: unknown; action?: unknown } | null;
    if (metadata?.kind !== "action-card" || !metadata.action || typeof metadata.action !== "object") {
      throw new TaskOperationError("INVALID_ARGUMENT", "prepared action metadata is required");
    }
    command = { kind: "action-proposal", context, action: metadata.action as PreparedAction };
  } else if (options.introductionAgentId && options.introductionToken) {
    command = {
      kind: "agent-introduction",
      context,
      content: options.content,
      attachmentIds: options.attachmentIds,
      proof: { agentId: options.introductionAgentId, token: options.introductionToken },
    };
  } else if (options.senderType === "system") {
    command = { kind: "reminder", context, content: options.content };
  } else {
    command = {
      kind: "chat",
      context,
      content: options.content,
      attachmentIds: options.attachmentIds,
    };
  }
  return modules.messagePosting.post(command);
}


/** Target resolution: #name / dm:@name / thread #name:shortid or dm:@name:shortid.
 *  Thread suffix shortid = 8-char short id of the parent message → resolve/create the thread channel for that parent message (thread = standalone channel, unified for human/agent). */
// May this AGENT read/act in this channel? The agent-plane mirror of the human `canReadChannel` (socketio.ts):
// a channel member, OR a public channel in the agent's Space, OR a thread whose parent channel is accessible.
// Private / DM channels the agent was never added to are refused → private content stays isolated on the agent
// plane too (docs/kith-space/architecture-proposal.md §6). resolveTarget / resolveMessageId / findParent all gate on this,
// so every channel-touching /agent-api/* endpoint inherits the boundary at once.
export async function canAgentReadChannel(spaceId: string, channelId: string, agentId: string): Promise<boolean> {
  const db = dbForSpace(spaceId);
  const lifecycle = await channelLifecycleState(spaceId, channelId);
  if (lifecycle === "deleted" || lifecycle === "missing") return false;
  const member = (await db.select().from(schema.channelAgentMembers).where(and(eq(schema.channelAgentMembers.channelId, channelId), eq(schema.channelAgentMembers.agentId, agentId))))[0];
  if (member) return true;
  const ch = (await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)))[0];
  if (!ch || ch.spaceId !== spaceId || ch.deletedAt) return false;
  if (ch.type === "channel") return true;                                  // public: any agent in the Space may read
  if (ch.parentMessageId) {                                                // thread: visibility follows its parent message's channel
    const parent = (await db.select().from(schema.messages).where(eq(schema.messages.id, ch.parentMessageId)))[0];
    if (parent) return canAgentReadChannel(spaceId, parent.channelId, agentId); // depth 1 (a parent channel is never itself a thread)
  }
  return false;                                                            // private / DM the agent is not a member of
}

export async function resolveTarget(spaceId: string, target: string, selfAgentId: string): Promise<{ channelId: string; threadId: string | null } | null> {
  const db = dbForSpace(spaceId);
  let t = target.trim();
  if (t.startsWith("thread:")) {
    const short = t.slice("thread:".length).trim();
    if (!/^[0-9a-f]{6,}$/i.test(short)) return null;
    const parent = (await db.select().from(schema.messages).where(and(
      eq(schema.messages.spaceId, spaceId),
      like(schema.messages.id, short.toLowerCase() + "%"),
    )))[0];
    if (!parent || parent.senderType === "system") return null;
    const existing = (await db.select().from(schema.channels).where(and(
      eq(schema.channels.spaceId, spaceId),
      eq(schema.channels.type, "thread"),
      eq(schema.channels.parentMessageId, parent.id),
    )))[0];
    if (existing) {
      if (!(await canAgentReadChannel(spaceId, existing.id, selfAgentId))) return null;
      return { channelId: existing.id, threadId: null };
    }
    if (!(await canAgentReadChannel(spaceId, parent.channelId, selfAgentId))) return null;
    const th = await getOrCreateThread(spaceId, parent.id, { type: "agent", id: selfAgentId });
    return { channelId: th.id, threadId: null };
  }
  let threadShort: string | null = null;
  const colon = t.lastIndexOf(":");
  if (colon > 0 && !t.slice(colon + 1).includes("@") && /^[0-9a-f]{6,}$/i.test(t.slice(colon + 1))) {
    threadShort = t.slice(colon + 1); t = t.slice(0, colon);
  }
  // 1) Resolve base channel (DM or named channel)
  let baseChannelId: string | null = null;
  if (t.startsWith("dm:@")) {
    const peer = t.slice(4);
    const human = humanIdentityForHandle(peer);
    const a = (await db.select().from(schema.agents).where(and(eq(schema.agents.name, peer), eq(schema.agents.spaceId, spaceId))))[0];
    const peerId = human?.id ?? a?.id; const peerType = human ? "human" : a ? "agent" : null;
    if (!peerId || !peerType) return null;
    baseChannelId = await getOrCreateDM(spaceId, selfAgentId, "agent", peerId, peerType);
  } else {
    const ch = (await db.select().from(schema.channels).where(and(eq(schema.channels.spaceId, spaceId), eq(schema.channels.name, t.replace(/^#/, "")))))[0];
    baseChannelId = ch?.id ?? null;
  }
  if (!baseChannelId) return null;
  // 2) No thread suffix → base channel; has suffix → find parent message (short id prefix) → thread channel of that parent message
  if (!threadShort) {
    // Agent ACL: the agent may only resolve a base channel it can access (public, a DM it just got, or a private
    // it was added to). This gate intentionally happens only for non-thread targets; existing thread membership
    // is enough for the thread case below.
    if (!(await canAgentReadChannel(spaceId, baseChannelId, selfAgentId))) return null;
    return { channelId: baseChannelId, threadId: null };
  }
  const parent = (await db.select().from(schema.messages).where(and(eq(schema.messages.spaceId, spaceId), eq(schema.messages.channelId, baseChannelId), like(schema.messages.id, threadShort.toLowerCase() + "%"))))[0];
  // System messages ("X created task / claimed / moved …") are not real conversation anchors and have no
  // "open thread" affordance in the UI — threading onto one buries the reply where no one can reach it.
  // Reject so the caller surfaces a clear error instead of silently creating an unreachable thread.
  if (!parent || parent.senderType === "system") return null;
  const existing = (await db.select().from(schema.channels).where(and(
    eq(schema.channels.spaceId, spaceId),
    eq(schema.channels.type, "thread"),
    eq(schema.channels.parentMessageId, parent.id),
  )))[0];
  if (existing) {
    if (!(await canAgentReadChannel(spaceId, existing.id, selfAgentId))) return null;
    return { channelId: existing.id, threadId: null };
  }
  if (!(await canAgentReadChannel(spaceId, baseChannelId, selfAgentId))) return null;
  const th = await getOrCreateThread(spaceId, parent.id, { type: "agent", id: selfAgentId });
  return { channelId: th.id, threadId: null };
}

export async function getOrCreateDM(spaceId: string, aId: string, aType: string, bId: string, bType: string): Promise<string> {
  const db = dbForSpace(spaceId);
  // Simplified: DM channel name = dm:<sorted ids>
  const key = "dm:" + [aId, bId].sort().join(":");
  const existing = (await db.select().from(schema.channels).where(and(eq(schema.channels.spaceId, spaceId), eq(schema.channels.name, key))))[0];
  if (existing) {
    const humanPeerAgentId = aType === "human" && bType === "agent" ? bId : bType === "human" && aType === "agent" ? aId : null;
    if (humanPeerAgentId) await trackHumanDm(spaceId, existing.id, humanPeerAgentId);
    return existing.id;
  }
  // Atomic create: partitioned unique index (spaceId, name WHERE type=dm) ensures only one row under concurrency; losing insert returns empty → re-select to get that row.
  const [ch] = await db.insert(schema.channels).values({ spaceId, name: key, type: "dm" }).onConflictDoNothing().returning();
  const channel = ch ?? (await db.select().from(schema.channels).where(and(eq(schema.channels.spaceId, spaceId), eq(schema.channels.name, key))))[0]!;
  const agentIds = [aType === "agent" ? aId : null, bType === "agent" ? bId : null]
    .filter((id): id is string => Boolean(id));
  if (agentIds.length) {
    await addChannelMembers(spaceId, channel.id, agentIds.map((agentId) => ({ type: "agent", id: agentId })));
  }
  const humanPeerAgentId = aType === "human" && bType === "agent" ? bId : bType === "human" && aType === "agent" ? aId : null;
  if (humanPeerAgentId) await trackHumanDm(spaceId, channel.id, humanPeerAgentId);
  return channel.id;
}

/** Find/create thread channel (thread = channel with type=thread, carrying parentMessageId). Idempotent. creator added as member = auto follow. */
export async function getOrCreateThread(spaceId: string, parentMessageId: string, creator?: { type: "human" | "agent"; id: string }) {
  return threadModule.getOrCreateThread(spaceId, parentMessageId, creator);
}

type DispatchAuditContext = DispatchMessageContext & { messageId?: string };

// Lightweight system message: only insert + publish message, no wake/no task creation (otherwise every status change wakes all agents = noise)
async function sysTaskMsg(
  spaceId: string,
  channelId: string,
  content: string,
  actor?: { type: "human" | "agent"; id: string },
  dispatch?: DispatchAuditContext,
) {
  const db = dbForSpace(spaceId);
  const seq = await nextSeq(spaceId);
  const m = db.transaction((tx) => {
    const inserted = tx.insert(schema.messages).values({
      ...(dispatch?.messageId ? { id: dispatch.messageId } : {}),
      seq,
      spaceId,
      channelId,
      senderType: "system",
      senderId: actor?.id ?? null,
      senderName: "system",
      messageType: "system",
      content,
      memoryPolicy: "exclude",
      searchText: content,
      dispatchChainId: dispatch?.chainId ?? null,
      dispatchDepth: dispatch?.dispatchDepth ?? null,
    }).returning().get();
    new DeliveryJournal().persistChannelMessageInTransaction(tx, spaceId, inserted);
    tx.update(schema.channels).set({ lastMessageAt: new Date() }).where(eq(schema.channels.id, channelId)).run();
    return inserted;
  });
  await publishTaskSystemMessage(spaceId, m!, actor);
  await scheduleV2Turns(spaceId);
  return m!;
}

async function publishTaskSystemMessage(
  spaceId: string,
  message: typeof schema.messages.$inferSelect,
  actor?: { type: "human" | "agent"; id: string },
) {
  const db = dbForSpace(spaceId);
  const m = message;
  const channelId = m.channelId;
  const ch = (await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)))[0];
  await db.update(schema.channels).set({ lastMessageAt: new Date() }).where(eq(schema.channels.id, channelId));
  await publish(spaceId, { type: "message", channelId, message: { ...serializeMsg(m!, [], []), channelType: ch?.type ?? null } });
  await publishThreadUpdated(spaceId, ch, actor?.id ?? null, "system");
}

export async function convertMessageToTask(
  spaceId: string,
  messageId: string,
  by?: { type: "human" | "agent"; id: string },
  executionMode: TaskExecutionMode = "autopilot",
) {
  return taskLifecycle().convertMessage(spaceId, messageId, by, executionMode);
}

/** Claim a task → in_progress + assignee. */
/**
 * Resolve messageId: accepts full uuid or the 8-char short id from message headers (msg=<shortid>).
 * Agents see short ids and will use them directly for claim/update/reply → previously the endpoint queried the uuid column with a short id and threw 500.
 * Full uuid → verify existence; short id (6+ hex) → prefix match; neither → null (caller returns 404, never 500).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Single definition of the agent-facing id convention: full uuid → exact match; 6+ hex chars → spaceId-scoped
 *  prefix match; anything else (dashes in a partial, LIKE metachars, too short) → null — never a 500 from casting
 *  a non-uuid into the uuid column. Shared by messages (resolveMessageId) and attachments (attachment/view) so
 *  the convention cannot drift per-resource. Returns the resolved full id; the caller applies its own ACL. */
export async function resolveIdOrPrefix(
  table: typeof schema.messages | typeof schema.attachments,
  spaceId: string,
  idOrShort: string | undefined | null,
): Promise<string | null> {
  const db = dbForSpace(spaceId);
  const s = (idOrShort ?? "").trim().toLowerCase();
  if (!s) return null;
  let r: { id: string } | undefined;
  if (UUID_RE.test(s)) {
    r = (await db.select({ id: table.id }).from(table).where(and(eq(table.id, s), eq(table.spaceId, spaceId))))[0];
  } else if (/^[0-9a-f]{6,}$/.test(s)) {
    r = (await db.select({ id: table.id }).from(table).where(and(like(table.id, s + "%"), eq(table.spaceId, spaceId))).limit(1))[0];
  }
  return r?.id ?? null;
}
// Resolve a (short or full) message id within a server. ALWAYS pass `agentId` when called on the agent plane
// (/agent-api/*): without it the channel ACL is skipped, so an agent could resolve a message in a channel it
// cannot access. The optional default exists only for non-agent internal callers (there are none today).
export async function resolveMessageId(spaceId: string, idOrShort: string | undefined | null, agentId?: string): Promise<string | null> {
  const db = dbForSpace(spaceId);
  const id = await resolveIdOrPrefix(schema.messages, spaceId, idOrShort);
  if (!id) return null;
  const m = (await db.select({ id: schema.messages.id, channelId: schema.messages.channelId }).from(schema.messages).where(eq(schema.messages.id, id)))[0];
  if (!m) return null;
  // Agent ACL: on the agent plane (agentId passed), only resolve a message in a channel the agent can access —
  // otherwise an agent could probe/react/claim any message in the server by its (short) id.
  if (agentId && !(await canAgentReadChannel(spaceId, m.channelId, agentId))) return null;
  return m.id;
}

export async function claimTask(spaceId: string, messageId: string, assigneeType: "human" | "agent", assigneeId: string, expectedRevision?: number) {
  return taskLifecycle().claim(spaceId, messageId, assigneeType, assigneeId, expectedRevision);
}

export async function unclaimTask(spaceId: string, messageId: string, by?: { type: "human" | "agent"; id: string }, expectedRevision?: number) {
  return taskLifecycle().unclaim(spaceId, messageId, by, expectedRevision);
}

export async function assignTask(
  spaceId: string,
  messageId: string,
  assigneeId: string,
  by?: { type: "human" | "agent"; id: string },
  expectedRevision?: number,
) {
  return taskLifecycle().assign(spaceId, messageId, assigneeId, by, expectedRevision);
}

export async function setTaskExecutionMode(spaceId: string, messageId: string, mode: TaskExecutionMode) {
  return taskLifecycle().setExecutionMode(spaceId, messageId, mode);
}

/** Change status (todo|in_progress|in_review|done|closed); done/closed records completedAt; done auto-creates thread. */
export async function setTaskStatus(
  spaceId: string,
  messageId: string,
  status: string,
  by?: { type: "human" | "agent"; id: string },
  concurrency: { from?: TaskStatus; expectedRevision?: number } = {},
) {
  return taskLifecycle().setStatus(spaceId, messageId, status, by, concurrency);
}

/** Delete task: revert to regular message — clear task fields, source message retained; emit task:deleted. */
export async function deleteTask(spaceId: string, messageId: string) {
  return taskLifecycle().delete(spaceId, messageId);
}

// ── Agent lifecycle: start/stop/reset through the one installation-local runtime worker ──
async function publishAgentState(spaceId: string, agentId: string, detail = ""): Promise<void> {
  const db = dbForSpace(spaceId);
  const a = (await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)))[0];
  if (a) await publish(spaceId, { type: "agent", id: a.id, name: a.name, status: a.status, activity: a.activity, detail });
}
async function markAgentUnavailable(spaceId: string, agentId: string, reason: string): Promise<void> {
  const db = dbForSpace(spaceId);
  await db.update(schema.agents).set({ status: "inactive", activity: "offline" }).where(and(eq(schema.agents.id, agentId), eq(schema.agents.spaceId, spaceId)));
  await publishAgentState(spaceId, agentId, reason);
  log.warn("agent unavailable", { agentId, reason });
}
type AgentStartTarget = { ok: true; cfg: NonNullable<Awaited<ReturnType<typeof agentConfig>>> };
type AgentControlTarget = { ok: true; spaceId: string; workspaceRoot: string };

function sendAgentControl(_target: AgentControlTarget, msg: Record<string, unknown>): boolean {
  return sendToWorker(msg);
}

async function agentStartTarget(spaceId: string, agentId: string): Promise<AgentStartTarget | { ok: false; reason: string }> {
  const db = dbForSpace(spaceId);
  const agent = db.select().from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.spaceId, spaceId), isNull(schema.agents.deletedAt))).get();
  if (!agent) return { ok: false, reason: "agent not found" };
  if (new SessionModule(spaceId, db).harnessMode(agentId) !== "legacy") {
    return { ok: false, reason: "Agent is assigned to the v2 harness" };
  }
  if (!isWorkerConnected()) return { ok: false, reason: "local runtime worker offline" };
  const runtime = agent.runtime ?? "claude";
  if (!workerRuntimes().includes(runtime)) return { ok: false, reason: `runtime unavailable: ${runtime}` };
  const cfg = await agentConfigFromRow(agent);
  if (!cfg) return { ok: false, reason: "agent not found" };
  return { ok: true, cfg };
}

async function agentStartTargets(
  spaceId: string,
  agentIds: string[],
): Promise<ReadonlyMap<string, AgentStartTarget | { ok: false; reason: string }>> {
  const uniqueIds = [...new Set(agentIds)];
  const result = new Map<string, AgentStartTarget | { ok: false; reason: string }>();
  if (!uniqueIds.length) return result;
  const agents = dbForSpace(spaceId).select().from(schema.agents).where(and(
    inArray(schema.agents.id, uniqueIds),
    eq(schema.agents.spaceId, spaceId),
    isNull(schema.agents.deletedAt),
  )).all();
  const sessions = new SessionModule(spaceId);
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  for (const agentId of uniqueIds) {
    if (!agentById.has(agentId)) result.set(agentId, { ok: false, reason: "agent not found" });
  }
  if (!isWorkerConnected()) {
    for (const agentId of uniqueIds) {
      if (agentById.has(agentId)) result.set(agentId, { ok: false, reason: "local runtime worker offline" });
    }
    return result;
  }
  const runtimes = new Set(workerRuntimes());
  const availableAgents = agents.filter((agent) => {
    if (sessions.harnessMode(agent.id) !== "legacy") {
      result.set(agent.id, { ok: false, reason: "Agent is assigned to the v2 harness" });
      return false;
    }
    const runtime = agent.runtime ?? "claude";
    if (runtimes.has(runtime)) return true;
    result.set(agent.id, { ok: false, reason: `runtime unavailable: ${runtime}` });
    return false;
  });
  const configs = await agentConfigs(availableAgents);
  for (const agent of availableAgents) {
    const cfg = configs.get(agent.id);
    result.set(agent.id, cfg ? { ok: true, cfg } : { ok: false, reason: "agent not found" });
  }
  return result;
}
async function agentControlTarget(spaceId: string, agentId: string): Promise<AgentControlTarget | { ok: false; reason: string }> {
  const db = dbForSpace(spaceId);
  const a = (await db.select({ id: schema.agents.id }).from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.spaceId, spaceId), isNull(schema.agents.deletedAt))))[0];
  if (!a) return { ok: false, reason: "agent not found" };
  if (!isWorkerConnected()) return { ok: false, reason: "local runtime worker offline" };
  const space = spaceRecord(spaceId);
  if (!space) return { ok: false, reason: "space not found" };
  return { ok: true, spaceId, workspaceRoot: space.rootPath };
}
/** Start an agent (requires the installation-local runtime worker to be online). */
export async function startAgent(spaceId: string, agentId: string, reason: Exclude<AgentStartReason, "wake"> = "manual"): Promise<{ ok: boolean; reason?: string }> {
  const db = dbForSpace(spaceId);
  const harnessMode = new SessionModule(spaceId, db).harnessMode(agentId);
  if (harnessMode === "v2") {
    await db.update(schema.agents).set({ status: "active", activity: isWorkerConnected() ? "working" : "offline" })
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.spaceId, spaceId), isNull(schema.agents.deletedAt)));
    await publishAgentState(spaceId, agentId);
    await scheduleV2Turns(spaceId);
    return { ok: true };
  }
  if (harnessMode === "migrating") return { ok: false, reason: "Agent harness migration is incomplete" };
  const target = await agentStartTarget(spaceId, agentId);
  if (!target.ok) {
    if (target.reason !== "agent not found") await markAgentUnavailable(spaceId, agentId, target.reason);
    return { ok: false, reason: target.reason };
  }
  const commandId = randomUUID();
  const introductionToken = !target.cfg.introduced ? randomUUID() : null;
  setAgentIntroductionTurn(spaceId, agentId, introductionToken);
  let admission;
  try {
    admission = await runtimeWorkerPort.start({
      type: "agent:start",
      source: "manual",
      commandId,
      spaceId,
      agentId,
      config: { ...target.cfg, introductionToken: introductionToken ?? undefined },
      reason,
    });
  } catch (error) {
    setAgentIntroductionTurn(spaceId, agentId, null);
    await markAgentUnavailable(spaceId, agentId, "local runtime worker offline");
    return { ok: false, reason: error instanceof Error ? error.message : "local runtime worker offline" };
  }
  if (admission.status === "rejected") {
    setAgentIntroductionTurn(spaceId, agentId, null);
    return { ok: false, reason: admission.reason ?? "local runtime worker rejected start" };
  }
  if (admission.status === "admitted") {
    await db.update(schema.agents).set({ status: "active", activity: "working" }).where(eq(schema.agents.id, agentId));
    await publishAgentState(spaceId, agentId);
  }
  return { ok: true };
}
export async function stopAgent(spaceId: string, agentId: string): Promise<boolean> {
  const db = dbForSpace(spaceId);
  clearAgentIntroductionTurns(spaceId, agentId);
  if (new SessionModule(spaceId, db).harnessMode(agentId) === "v2") {
    await harnessTurnScheduler.cancelAgent(spaceId, agentId);
    try {
      if (isWorkerConnected()) await harnessTurnScheduler.closeAgentSessions(spaceId, agentId, "stop");
    } catch (error) {
      log.warn("v2 Agent session close was not acknowledged", { agentId, detail: String(error) });
    }
    await db.update(schema.agents).set({ status: "inactive", activity: "offline" }).where(and(eq(schema.agents.id, agentId), eq(schema.agents.spaceId, spaceId)));
    await publishAgentState(spaceId, agentId);
    return true;
  }
  const target = await agentControlTarget(spaceId, agentId);
  if (target.ok) {
    try {
      const admission = await runtimeWorkerPort.stop({ type: "agent:stop", source: "lifecycle", commandId: randomUUID(), spaceId, agentId });
      if (admission.status === "rejected") log.warn("agent stop rejected", { agentId, reason: admission.reason });
    } catch (error) { log.warn("agent stop target unavailable", { agentId, reason: String(error) }); }
  } else if (target.reason !== "agent not found") {
    log.warn("agent stop target unavailable", { agentId, reason: target.reason });
  }
  await db.update(schema.agents).set({ status: "inactive", activity: "offline" }).where(and(eq(schema.agents.id, agentId), eq(schema.agents.spaceId, spaceId)));
  await publishAgentState(spaceId, agentId);
  return true;
}
export async function resetAgent(spaceId: string, agentId: string, clearAgentMemory = false): Promise<boolean> {
  const db = dbForSpace(spaceId);
  clearAgentIntroductionTurns(spaceId, agentId);
  const sessions = new SessionModule(spaceId, db);
  if (sessions.harnessMode(agentId) === "v2") {
    await harnessTurnScheduler.cancelAgent(spaceId, agentId);
    try {
      if (isWorkerConnected()) await harnessTurnScheduler.closeAgentSessions(spaceId, agentId, "reset");
    } catch (error) {
      log.warn("v2 Agent reset close was not acknowledged", { agentId, detail: String(error) });
    }
    const sessionIds = db.select({ id: schema.runtimeSessions.id }).from(schema.runtimeSessions).where(and(
      eq(schema.runtimeSessions.agentId, agentId),
      isNull(schema.runtimeSessions.retiredAt),
    )).all();
    for (const session of sessionIds) turnCapabilityService(spaceId).closeSession(session.id);
    sessions.retireAgentSessions(agentId);
  }
  const target = await agentControlTarget(spaceId, agentId);
  if (target.ok) {
    try {
      const admission = await runtimeWorkerPort.reset({ type: "agent:reset", source: "lifecycle", commandId: randomUUID(), agentId, spaceId: target.spaceId, workspaceRoot: target.workspaceRoot, clearAgentMemory });
      if (admission.status === "rejected") log.warn("agent reset rejected", { agentId, reason: admission.reason });
    } catch (error) { log.warn("agent reset target unavailable", { agentId, reason: String(error) }); }
  } else if (target.reason !== "agent not found") {
    log.warn("agent reset target unavailable", { agentId, reason: target.reason });
  }
  await db.update(schema.agents).set({
    status: "inactive",
    activity: "offline",
    sessionId: null,
    ...(clearAgentMemory ? { introducedAt: null } : {}),
  }).where(and(eq(schema.agents.id, agentId), eq(schema.agents.spaceId, spaceId)));
  await publishAgentState(spaceId, agentId);
  return true;
}
/** Profile (displayName/description) changed → ask the daemon to sync the workspace MEMORY.md title + `## Role`.
 *  Pass the full current values (not just the changed field); the daemon rewrites only those, preserving the rest. */
export async function syncAgentProfile(spaceId: string, agentId: string, displayName: string, description?: string | null): Promise<void> {
  const target = await agentControlTarget(spaceId, agentId);
  if (target.ok) {
    if (!sendAgentControl(target, { type: "agent:profile", agentId, spaceId: target.spaceId, workspaceRoot: target.workspaceRoot, displayName, description: description ?? null })) log.warn("agent profile target unavailable", { agentId, reason: "local runtime worker offline" });
  } else if (target.reason !== "agent not found") {
    log.warn("agent profile target unavailable", { agentId, reason: target.reason });
  }
}
