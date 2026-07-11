// Message core: seq assignment, @mention parsing, DB write, SSE broadcast (human), wake delivery (agent), target resolution.
import { randomUUID } from "node:crypto";
import { and, eq, ne, desc, gt, inArray, like, or, isNull, isNotNull, sql } from "drizzle-orm";
import { dbFor, schema } from "../db/index.js";
import { createWorkspace } from "../db/workspace.js";
import { nextSeq, publish } from "./realtime.js";
import { broadcastToDaemons, daemonCount, isMachineConnected, sendToMachine } from "./daemonHub.js";
import { agentHasScope } from "./scopes.js";
import { newKey, hashToken } from "./auth.js";
import { createLogger } from "../log.js";
import { getHumanIdentity, humanIdentityForHandle, humanIdentityForId } from "../human/humanIdentity.js";
import { canHumanReadChannel } from "./channelAccess.js";
import { canAutoJoinMentionedMembers, isWakeable } from "./agentWakePolicy.js";
import { SqliteDispatchState, normalizeTaskExecutionMode, type DispatchMessageContext, type TaskExecutionMode, type WakeReservation } from "./dispatchGuard.js";
import { assignTaskRecord, claimTaskRecord, convertMessageRecord, createTaskRecord, transitionTaskRecord, unclaimTaskRecord } from "./tasks/taskRepository.js";
import { TASK_STATUSES, TaskOperationError, isTaskStatus, type TaskStatus } from "./tasks/taskTypes.js";

export { TASK_STATUSES } from "./tasks/taskTypes.js";

const log = createLogger("server:core");
const PORT = Number(process.env.PORT ?? 7777);
const SELF_URL = `http://localhost:${PORT}`;
// Per-agent raw token cache (server process memory; DB stores hash only). Injected into agent process at spawn; resolveAgent looks up by hash. See slice10.
const agentRawTokens = new Map<string, string>();

// Member description (bio) length limit (HumanDetailPanel/AgentDetailPanel both maxLength=3000 + "Description must be at most 3000 characters"). Shared by human+agent.
export const MAX_DESCRIPTION = 3000;
export const DESC_TOO_LONG = `Description must be at most ${MAX_DESCRIPTION} characters`;
export const descTooLong = (s: unknown): boolean => typeof s === "string" && s.length > MAX_DESCRIPTION;

// Agent name is the @mention handle: used directly as @<name> (parseMentions re, CLI, web) and as the
// dm:@<name> lookup key (resolveTarget). It must be a machine-safe identifier — spaces / punctuation /
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

/** Create one folder-rooted workspace DB, then seed its owner and default #all channel. */
export async function createServer(
  name: string,
  slug: string,
  ownerId: string,
  options: { rootPath?: string; owner?: typeof schema.users.$inferInsert } = {},
) {
  return createWorkspace(name, slug, ownerId, options);
}

export interface Member { type: "user" | "agent"; id: string; name: string; displayName: string; }

export async function channelMembers(serverId: string, channelId: string): Promise<Member[]> {
  const db = dbFor(serverId);
  const channel = (await db.select({ id: schema.channels.id }).from(schema.channels).where(and(
    eq(schema.channels.id, channelId),
    eq(schema.channels.serverId, serverId),
    isNull(schema.channels.deletedAt),
  )))[0];
  if (!channel) return [];
  const rows = await db.select().from(schema.channelMembers).where(eq(schema.channelMembers.channelId, channelId));
  const out: Member[] = [];
  const human = getHumanIdentity();
  if (human) out.push({ type: "user", id: human.id, name: human.handle, displayName: human.displayName });
  for (const r of rows) {
    if (r.memberType === "agent") {
      const a = (await db.select().from(schema.agents).where(eq(schema.agents.id, r.memberId)))[0];
      if (a) out.push({ type: "agent", id: a.id, name: a.name, displayName: a.displayName });
    }
  }
  return out;
}

/** Highest message seq currently in a channel (0 if empty). seq is monotonic within the workspace, so this is
 *  the channel's read "watermark" at this instant — any message that arrives later has a strictly higher seq. */
export async function channelMaxSeq(serverId: string, channelId: string): Promise<number> {
  const db = dbFor(serverId);
  const [r] = await db.select({ seq: schema.messages.seq }).from(schema.messages)
    .where(eq(schema.messages.channelId, channelId)).orderBy(desc(schema.messages.seq)).limit(1);
  return r?.seq ?? 0;
}

/** Add channel members. An AGENT joins "caught up" at the channel watermark (its lastReadSeq starts at the
 *  channel's current max seq), so its first `kith-space message check` surfaces only messages sent AFTER it
 *  joined — not the channel's pre-join backlog (which it can still pull on demand via `message read`). Without
 *  this, a fresh member's lastReadSeq=0 makes every prior message "unread", flooding a newly created or newly
 *  invited agent with the whole channel history it never needed. A raw USER row is temporary Human cursor/follow
 *  state and keeps lastReadSeq=0. Pass `watermark` to override
 *  the agent watermark (the @-mention path passes triggeringSeq-1 so the triggering message stays unread);
 *  `watermark` is a no-op for an all-user batch (users are always pinned to 0). Idempotent via
 *  onConflictDoNothing: re-adding an existing member never rewinds or fast-forwards a real read cursor. */
export async function addChannelMembers(serverId: string, channelId: string, members: { type: "user" | "agent"; id: string }[], opts?: { watermark?: number }): Promise<void> {
  if (!members.length) return;
  const db = dbFor(serverId);
  const wm = members.some((m) => m.type === "agent") ? (opts?.watermark ?? await channelMaxSeq(serverId, channelId)) : 0;
  await db.insert(schema.channelMembers)
    .values(members.map((m) => ({ channelId, memberType: m.type, memberId: m.id, lastReadSeq: m.type === "agent" ? wm : 0 })))
    .onConflictDoNothing();
}

export function parseMentions(content: string, members: Member[]) {
  const found = new Map<string, Member>();
  const re = /@([A-Za-z0-9_\u4e00-\u9fa5-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const name = m[1]!;
    const hit = members.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (hit) found.set(hit.id, hit);
  }
  return [...found.values()];
}

/** All @-addressable members of a workspace: its live agents + the one local Human. */
export async function workspaceMembers(serverId: string): Promise<Member[]> {
  const db = dbFor(serverId);
  const out: Member[] = [];
  const human = getHumanIdentity();
  if (human) out.push({ type: "user", id: human.id, name: human.handle, displayName: human.displayName });
  // Exclude system-seeded showcase demo agents (creatorType="system"): they are display-only props for the
  // read-only #showcase channel, NOT @-reachable members. This pool feeds @-mention auto-join in public
  // channels — without the filter, @-ing a word that happens to match a prop's name (e.g. "Pat") would
  // auto-join it into a real channel and fire a no-op wake (it has no machine). Message rendering resolves a
  // sender by id elsewhere, so props still render correctly in #showcase history.
  const ags = await db.select().from(schema.agents).where(and(eq(schema.agents.serverId, serverId), isNull(schema.agents.deletedAt), ne(schema.agents.creatorType, "system")));
  for (const a of ags) out.push({ type: "agent", id: a.id, name: a.name, displayName: a.displayName });
  return out;
}

/** Pure decision for Slack-style auto-join: of the workspace members @-referenced in `content`, which are
 *  not yet members of the channel (`current`) and therefore need to be added. Reuses parseMentions so the
 *  matching can never drift from how mentions are actually recorded. */
export function membersToAutoJoin(content: string, workspace: Member[], current: Member[]): Member[] {
  const have = new Set(current.map((m) => m.type + ":" + m.id));
  return parseMentions(content, workspace).filter((r) => !have.has(r.type + ":" + r.id));
}

/** The member set an @-mention in this channel may pull in (auto-join) — who already has access to the space,
 *  so adding them leaks nothing. A thread inherits its PARENT channel's reach, the same parent-channel
 *  inheritance `canReadChannel` (socketio.ts) uses for read access: a public channel's thread reaches the
 *  whole workspace, a private channel's thread only its parent's members, a DM's thread only the two parties.
 *  A top-level public `channel` reaches the workspace; `private`/`dm` reach only their current members, so an
 *  @ to a non-member there stays a no-op (unchanged behaviour). */
async function mentionAutoJoinPool(serverId: string, ch: typeof schema.channels.$inferSelect): Promise<Member[]> {
  const db = dbFor(serverId);
  let target = ch;
  if (ch.type === "thread" && ch.parentMessageId) {
    const parent = (await db.select().from(schema.messages).where(eq(schema.messages.id, ch.parentMessageId)))[0];
    const pch = parent ? (await db.select().from(schema.channels).where(eq(schema.channels.id, parent.channelId)))[0] : undefined;
    if (pch) target = pch; // depth 1: a parent channel is never itself a thread
    // Orphaned thread (parent message/channel deleted): fall back to the thread's own members — a conservative
    // no-op for @-ing a non-member (the pre-fix behaviour), but log it so a silently-dropped @ is debuggable.
    else log.warn("thread parent channel unresolved; @-mention reach falls back to thread members", { channelId: ch.id, parentMessageId: ch.parentMessageId });
  }
  return target.type === "channel" ? await workspaceMembers(serverId) : await channelMembers(serverId, target.id);
}

/** Add @-mentioned non-members to a channel, drawn from `pool` (its @-reach — see mentionAutoJoinPool); returns
 *  those added. Idempotent via onConflictDoNothing; broadcasts a membership update so every client refreshes. */
async function autoJoinMentioned(serverId: string, channelId: string, content: string, current: Member[], pool: Member[], watermark: number): Promise<Member[]> {
  const toAdd = membersToAutoJoin(content, pool, current);
  if (!toAdd.length) return [];
  // watermark = triggeringSeq-1: the @ message that pulled them in stays unread (the agent must see the @), but
  // the channel's prior backlog is marked read so an auto-joined agent isn't flooded with history on first check.
  await addChannelMembers(serverId, channelId, toAdd.map((m) => ({ type: m.type, id: m.id })), { watermark });
  await publish(serverId, { type: "channel:members-updated", channelId });
  return toAdd;
}

// Message serialization shape for message:new socket event (omits internal searchVector/agentSendKey).
export interface ReactionAgg { emoji: string; count: number; reactorIds: string[]; reactorNames: string[]; }
export function serializeMsg(msg: typeof schema.messages.$inferSelect, mentions: Member[], atts: (typeof schema.attachments.$inferSelect)[] = [], reactions: ReactionAgg[] = []) {
  return {
    id: msg.id, seq: msg.seq, channelId: msg.channelId, threadId: msg.threadId,
    senderType: msg.senderType, senderId: msg.senderId, senderName: msg.senderName, senderMembershipStatus: "active",
    messageType: msg.messageType, content: msg.content, actionMetadata: msg.actionMetadata ?? null,
    taskStatus: msg.taskStatus, taskNumber: msg.taskNumber,
    taskAssigneeType: msg.taskAssigneeType, taskAssigneeId: msg.taskAssigneeId,
    taskClaimedAt: msg.taskClaimedAt, taskCompletedAt: msg.taskCompletedAt,
    taskParentId: msg.taskParentId, taskRevision: msg.taskRevision,
    taskExecutionMode: msg.taskExecutionMode,
    dispatchChainId: msg.dispatchChainId, dispatchDepth: msg.dispatchDepth,
    attachments: atts.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes })),
    mentions: mentions.map((x) => ({ type: x.type, id: x.id, name: x.name })),
    reactions,
    createdAt: msg.createdAt, updatedAt: msg.updatedAt,
  };
}

export function agentReplyStreamId(messageId: string, agentId: string): string {
  return `${messageId}:${agentId}`;
}

type AllowedWakeReservation = Extract<WakeReservation, { allowed: true }>;
type BlockedWakeReservation = Extract<WakeReservation, { allowed: false }>;

async function taskMessageIdForChannel(
  serverId: string,
  ch: typeof schema.channels.$inferSelect | undefined,
): Promise<string | null> {
  if (ch?.type !== "thread" || !ch.parentMessageId) return null;
  const db = dbFor(serverId);
  const parent = db.select({ id: schema.messages.id, taskStatus: schema.messages.taskStatus })
    .from(schema.messages).where(and(eq(schema.messages.id, ch.parentMessageId), eq(schema.messages.serverId, serverId))).get();
  return parent?.taskStatus ? parent.id : null;
}

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
    const task = dbFor(o.state.serverId).select({ threadId: schema.messages.threadId }).from(schema.messages)
      .where(eq(schema.messages.id, o.dispatch.taskMessageId)).get();
    noticeChannelId = task?.threadId ?? noticeChannelId;
  }
  await sysTaskMsg(
    o.state.serverId,
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
  const reservation = await o.state.reserveWake({
    ...o.dispatch,
    messageId: o.messageId,
    targetAgentId: o.targetAgentId,
  });
  if (reservation.allowed) return reservation;
  await reportDispatchRejection({ ...o, rejection: reservation });
  return null;
}

async function publishThreadUpdated(
  serverId: string,
  ch: typeof schema.channels.$inferSelect | undefined,
  senderId: string | null,
  senderType: "user" | "agent" | "system",
) {
  if (ch?.type !== "thread" || !ch.parentMessageId) return;
  const db = dbFor(serverId);
  const replies = await db.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.channelId, ch.id));
  const parts = await db.select().from(schema.channelMembers).where(eq(schema.channelMembers.channelId, ch.id));
  const parent = (await db.select({ channelId: schema.messages.channelId }).from(schema.messages).where(eq(schema.messages.id, ch.parentMessageId)))[0];
  await publish(serverId, {
    type: "thread:updated",
    threadChannelId: ch.id,
    parentMessageId: ch.parentMessageId,
    parentChannelId: parent?.channelId ?? null,
    replyCount: replies.length,
    participantIds: parts.map((p) => p.memberId),
    senderId,
    senderType,
  });
}

/** Aggregate message reactions into grouped shape: one entry per emoji {emoji,count,reactorIds,reactorNames}. */
export async function aggregateReactions(serverId: string, messageIds: string[]): Promise<Map<string, ReactionAgg[]>> {
  const out = new Map<string, ReactionAgg[]>();
  if (!messageIds.length) return out;
  const db = dbFor(serverId);
  const rows = await db.select().from(schema.reactions).where(inArray(schema.reactions.messageId, messageIds));
  if (!rows.length) return out;
  const aIds = [...new Set(rows.filter((r) => r.memberType === "agent").map((r) => r.memberId))];
  const agents = aIds.length ? await db.select().from(schema.agents).where(inArray(schema.agents.id, aIds)) : [];
  const nameOf = (t: string, id: string) => t === "user"
    ? (humanIdentityForId(id)?.displayName ?? "?")
    : (agents.find((a) => a.id === id)?.displayName || agents.find((a) => a.id === id)?.name || "?");
  for (const r of rows) {
    const list = out.get(r.messageId) ?? [];
    let e = list.find((x) => x.emoji === r.emoji);
    if (!e) { e = { emoji: r.emoji, count: 0, reactorIds: [], reactorNames: [] }; list.push(e); }
    e.count++; e.reactorIds.push(r.memberId); e.reactorNames.push(nameOf(r.memberType, r.memberId));
    out.set(r.messageId, list);
  }
  return out;
}

async function serializeMessageById(serverId: string, messageId: string) {
  const db = dbFor(serverId);
  const msg = (await db.select().from(schema.messages).where(eq(schema.messages.id, messageId)))[0];
  if (!msg) return null;
  const mts = await db.select().from(schema.messageMentions).where(eq(schema.messageMentions.messageId, messageId));
  const mentions: Member[] = mts.map((x) => ({ type: x.mentionType as "user" | "agent", id: x.mentionId, name: x.mentionName, displayName: x.mentionName }));
  const atts = await db.select().from(schema.attachments).where(eq(schema.attachments.messageId, messageId));
  const reactions = (await aggregateReactions(serverId, [messageId])).get(messageId) ?? [];
  return serializeMsg(msg, mentions, atts, reactions);
}

/** Add reaction (add-or-noop): unique index deduplication, broadcast message:updated. */
export async function addReaction(serverId: string, messageId: string, memberType: "user" | "agent", memberId: string, emoji: string) {
  const db = dbFor(serverId);
  await db.insert(schema.reactions).values({ messageId, memberType, memberId, emoji }).onConflictDoNothing();
  const m = await serializeMessageById(serverId, messageId);
  if (m) await publish(serverId, { type: "message:updated", message: m });
  return m;
}
export async function removeReaction(serverId: string, messageId: string, memberType: "user" | "agent", memberId: string, emoji: string) {
  const db = dbFor(serverId);
  await db.delete(schema.reactions).where(and(eq(schema.reactions.messageId, messageId), eq(schema.reactions.memberType, memberType), eq(schema.reactions.memberId, memberId), eq(schema.reactions.emoji, emoji)));
  const m = await serializeMessageById(serverId, messageId);
  if (m) await publish(serverId, { type: "message:updated", message: m });
  return m;
}

// ── Saved messages / bookmarks (/channels/saved) ──
// Private bookmarks: deduplicated per member (unique index), no broadcast. save is idempotent (onConflictDoNothing).
export async function saveMessage(serverId: string, messageId: string, memberType: "user" | "agent", memberId: string) {
  const db = dbFor(serverId);
  await db.insert(schema.savedMessages).values({ serverId, messageId, memberType, memberId }).onConflictDoNothing();
}
export async function unsaveMessage(serverId: string, messageId: string, memberType: "user" | "agent", memberId: string) {
  const db = dbFor(serverId);
  await db.delete(schema.savedMessages).where(and(
    eq(schema.savedMessages.serverId, serverId), eq(schema.savedMessages.messageId, messageId),
    eq(schema.savedMessages.memberType, memberType), eq(schema.savedMessages.memberId, memberId)));
}
/** Bulk check which messageIds have been saved by this member (POST /channels/saved/check → {savedIds[]}). */
export async function checkSaved(serverId: string, memberType: "user" | "agent", memberId: string, messageIds: string[]): Promise<string[]> {
  if (!messageIds.length) return [];
  const db = dbFor(serverId);
  const rows = await db.select({ messageId: schema.savedMessages.messageId }).from(schema.savedMessages).where(and(
    eq(schema.savedMessages.serverId, serverId), eq(schema.savedMessages.memberType, memberType),
    eq(schema.savedMessages.memberId, memberId), inArray(schema.savedMessages.messageId, messageIds)));
  return rows.map((r) => r.messageId);
}
/** List saved messages (GET /channels/saved):
 * envelope {saved[], hasMore}; item is flat, uses messageId, inlines channel + thread parent context; no savedAt/attachments/reactions.
 * Ordered by savedAt (saved row createdAt) descending, limit+offset pagination (limit+1 probe for hasMore). */
export async function listSaved(serverId: string, memberType: "user" | "agent", memberId: string, limit: number, offset: number) {
  const db = dbFor(serverId);
  const rows = await db.select().from(schema.savedMessages).where(and(
    eq(schema.savedMessages.serverId, serverId), eq(schema.savedMessages.memberType, memberType),
    eq(schema.savedMessages.memberId, memberId))).orderBy(desc(schema.savedMessages.createdAt)).limit(limit + 1).offset(offset);
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
      async (cid) => [cid, memberType === "user"
        ? await canHumanReadChannel(serverId, cid)
        : await canAgentReadChannel(serverId, cid, memberId)] as const)),
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

export async function agentConfig(serverId: string, agentId: string) {
  const db = dbFor(serverId);
  // Skip soft-deleted agents (treated as non-existent → null, which every caller already handles): otherwise the
  // mint branch below would re-set `agentTokenHash` on a deleted row, reverting the clear done on delete (C4).
  const a = (await db.select().from(schema.agents).where(and(eq(schema.agents.id, agentId), isNull(schema.agents.deletedAt))))[0];
  if (!a) return null;
  const workspace = (await db.select({ rootPath: schema.servers.rootPath }).from(schema.servers).where(eq(schema.servers.id, a.serverId)))[0];
  if (!workspace) return null;
  // Per-agent independent token (sk_agent_* prefix, slice10):
  // cache hit → reuse; first time → mint + store hash + cache raw; agent already running (cache lost after server restart but agent still running) → do not re-mint or send new token (daemon ignores agent:start for running agents, agent continues using old token, server verifies via DB hash) → zero desync.
  let token = agentRawTokens.get(a.id);
  if (!token && !(a.status === "active" && a.agentTokenHash)) {
    token = newKey("sk_agent_");
    agentRawTokens.set(a.id, token);
    await db.update(schema.agents).set({ agentTokenHash: hashToken(token) }).where(eq(schema.agents.id, a.id));
  }
  return {
    name: a.name, displayName: a.displayName, description: a.description,
    model: a.model, runtime: a.runtime, runtimeConfig: a.runtimeConfig, sessionId: a.sessionId ?? undefined,
    serverUrl: SELF_URL, serverId: a.serverId, workspaceRoot: workspace.rootPath, agentId: a.id, agentToken: token,
  };
}

export async function createMessage(opts: {
  serverId: string; channelId: string;
  senderType: "user" | "agent" | "system"; senderId: string | null; senderName: string;
  content: string; messageType?: string; threadId?: string | null; asTask?: boolean; attachmentIds?: string[];
  taskExecutionMode?: TaskExecutionMode;
  taskParentId?: string | null;
  actionMetadata?: unknown; // action-card and other platform action payloads (slice09)
}) {
  const db = dbFor(opts.serverId);
  const messageId = randomUUID();
  const seq = await nextSeq(opts.serverId);
  // Channel row fetched once; its type drives task-number scope (per-DM vs per-server), thread auto-follow, mention auto-join, and wake routing below.
  const ch = (await db.select().from(schema.channels).where(eq(schema.channels.id, opts.channelId)))[0];
  if (opts.asTask && !ch) throw new TaskOperationError("NOT_FOUND", "task channel not found");
  const dispatchState = new SqliteDispatchState(opts.serverId);
  const taskMessageId = opts.asTask ? messageId : await taskMessageIdForChannel(opts.serverId, ch);
  const dispatch = await dispatchState.resolveMessageContext({
    messageId,
    channelId: opts.channelId,
    senderType: opts.senderType,
    senderId: opts.senderId,
    taskMessageId,
  });
  const messageValues = {
    id: messageId,
    seq, serverId: opts.serverId, channelId: opts.channelId,
    senderType: opts.senderType, senderId: opts.senderId, senderName: opts.senderName,
    messageType: opts.messageType ?? "chat", content: opts.content,
    actionMetadata: opts.actionMetadata ?? null,
    threadId: opts.threadId ?? null, searchText: opts.content,
    taskStatus: null, taskNumber: null,
    taskExecutionMode: normalizeTaskExecutionMode(opts.taskExecutionMode) ?? "autopilot",
    dispatchChainId: dispatch.chainId,
    dispatchDepth: dispatch.dispatchDepth,
  } satisfies typeof schema.messages.$inferInsert;
  const msg = opts.asTask
    ? createTaskRecord({
        serverId: opts.serverId,
        channel: ch!,
        message: messageValues,
        parentTaskId: opts.taskParentId,
      })
    : (await db.insert(schema.messages).values(messageValues).returning())[0]!;
  await dispatchState.ensureChain({ ...dispatch, rootMessageId: messageId, channelId: opts.channelId });

  // auto-follow: reply to thread → sender auto-joins; replying after done clears done and brings thread back to inbox
  if (opts.senderId && opts.senderType !== "system" && ch?.type === "thread") {
    await db.insert(schema.channelMembers).values({ channelId: opts.channelId, memberType: opts.senderType, memberId: opts.senderId }).onConflictDoNothing();
    await db.update(schema.channelMembers).set({ threadDoneAt: null }).where(eq(schema.channelMembers.channelId, opts.channelId)); // new reply → reset done for thread followers (thread becomes active again in inbox)
  }

  // Attachments: backfill messageId/channelId onto the attachment uploaded earlier, so it appears in the channel Files list
  let atts: (typeof schema.attachments.$inferSelect)[] = [];
  if (opts.attachmentIds?.length) {
    await db.update(schema.attachments).set({ messageId: msg.id, channelId: opts.channelId }).where(inArray(schema.attachments.id, opts.attachmentIds));
    atts = await db.select().from(schema.attachments).where(inArray(schema.attachments.id, opts.attachmentIds));
  }

  let members = await channelMembers(opts.serverId, opts.channelId);
  // Human-authored Slack-style mention auto-join: @-mentioning someone who isn't in this channel yet pulls them in, so the
  // mention is recorded + delivered (wake / inbox) instead of being silently dropped. A thread inherits its
  // parent channel's @-reach (mentionAutoJoinPool — the same parent-channel inheritance canReadChannel uses),
  // so @-ing a teammate who hasn't replied in the thread yet still wakes them. Public channel → whole
  // workspace; private/dm (and their threads) → existing members only, so an @ to a non-member stays a no-op.
  // Agent-authored text must not mutate channel membership: a model casually mentioning @Reviewer should not
  // pull that agent into a channel and start a reply loop.
  if (ch && canAutoJoinMentionedMembers(opts.senderType) && opts.content.includes("@")) {
    const joined = await autoJoinMentioned(opts.serverId, opts.channelId, opts.content, members, await mentionAutoJoinPool(opts.serverId, ch), seq - 1);
    if (joined.length) members = [...members, ...joined];
  }
  const mentions = parseMentions(opts.content, members);
  if (mentions.length) {
    await db.insert(schema.messageMentions).values(
      mentions.map((x) => ({ messageId: msg.id, mentionType: x.type, mentionId: x.id, mentionName: x.name })),
    );
  }
  await db.update(schema.channels).set({ lastMessageAt: new Date() }).where(eq(schema.channels.id, opts.channelId));

  // Task message + number + owning thread are committed together by createTaskRecord.
  // Human-side realtime
  await publish(opts.serverId, { type: "message", channelId: opts.channelId, message: { ...serializeMsg(msg, mentions, atts), channelType: ch?.type ?? null } });
  if (opts.asTask) {
    await publish(opts.serverId, { type: "task", op: "created", task: serializeMsg(msg, mentions, atts) });
    const actor = (opts.senderType === "user" || opts.senderType === "agent") && opts.senderId ? { type: opts.senderType, id: opts.senderId } : undefined;
    await sysTaskMsg(opts.serverId, opts.channelId, `${opts.senderName} created task #${msg.taskNumber} "${taskTitle(opts.content)}"`, actor); // audit trail (task system messages)
  }

  // Agent-side wake: only wake agents @-mentioned (in channel), or agent members in a DM.
  const isDm = ch?.type === "dm";
  // Message in thread channel → broadcast thread:updated (parentMessageId + replyCount + participantIds)
  await publishThreadUpdated(opts.serverId, ch, opts.senderId, opts.senderType);
  const mentionedAgents = new Set(mentions.filter((m) => m.type === "agent").map((m) => m.id));
  // inbox notice uses human-readable target (#name / dm:@sender), not uuid. threads use channel name.
  const targetName = isDm ? `dm:@${opts.senderName}` : `#${ch?.name ?? opts.channelId}`;
  const msgShort = msg.id.slice(0, 8);
  const woken: string[] = [];
  for (const mem of members) {
    if (mem.type !== "agent" || mem.id === opts.senderId) continue;
    const mentioned = mentionedAgents.has(mem.id);
    // Channel messages delivered to all agent members (not limited to @; wake even without @, model decides whether to reply).
    // Ambient wake without @ requires inbox:receive scope; @-mentioned or DM always delivers.
    if (!isDm && !mentioned) {
      const a0 = (await db.select({ scopes: schema.agents.scopes }).from(schema.agents).where(eq(schema.agents.id, mem.id)))[0];
      if (!isWakeable({ channelType: ch?.type ?? "channel", mentioned, hasInboxScope: agentHasScope(a0?.scopes, "inbox:receive"), senderType: opts.senderType })) continue;
    }
    const reservation = await reserveDispatchWake({
      state: dispatchState,
      dispatch,
      messageId: msg.id,
      targetAgentId: mem.id,
      targetAgentName: mem.name,
      fallbackChannelId: opts.channelId,
    });
    if (!reservation) continue;
    const target = await agentStartTarget(opts.serverId, mem.id);
    if (!target.ok) {
      await dispatchState.releaseWake(reservation.reservationId);
      if (target.reason !== "agent not found") await markAgentUnavailable(opts.serverId, mem.id, target.reason);
      continue;
    }
    const replyStreamId = agentReplyStreamId(msg!.id, mem.id);
    await publish(opts.serverId, { type: "agent:reply", agentId: mem.id, channelId: opts.channelId, streamId: replyStreamId, name: mem.displayName || mem.name, triggerMessageId: msg.id, op: "start" });
    const startSent = sendAgentStart(opts.serverId, target, mem.id);
    const deliverSent = startSent && sendAgentDeliver(opts.serverId, target, { agentId: mem.id, seq, from: opts.senderName, target: opts.channelId, targetName, msgShort, isTask: !!opts.asTask, message: { content: opts.content }, mentioned, streamId: replyStreamId });
    if (!deliverSent) {
      await dispatchState.releaseWake(reservation.reservationId);
      await publish(opts.serverId, { type: "agent:reply", agentId: mem.id, channelId: opts.channelId, streamId: replyStreamId, name: mem.displayName || mem.name, op: "error", text: "machine offline" });
      await markAgentUnavailable(opts.serverId, mem.id, "machine offline");
      continue;
    }
    await dispatchState.commitWake(reservation.reservationId, {
      agentId: mem.id,
      channelId: msg.threadId ?? opts.channelId,
      chainId: dispatch.chainId,
      dispatchDepth: dispatch.dispatchDepth,
    });
    woken.push(mem.name + (mentioned ? "(@)" : ""));
  }
  log.info("message created", {
    seq, channel: opts.channelId, from: opts.senderName, kind: opts.senderType,
    mentions: mentions.map((x) => x.name),
    wakeAgents: woken,
  });
  return msg;
}

/** Target resolution: #name / dm:@name / thread #name:shortid or dm:@name:shortid.
 *  Thread suffix shortid = 8-char short id of the parent message → resolve/create the thread channel for that parent message (thread = standalone channel, unified for human/agent). */
// May this AGENT read/act in this channel? The agent-plane mirror of the human `canReadChannel` (socketio.ts):
// a channel member, OR a public channel in the agent's server, OR a thread whose parent channel is accessible.
// Private / DM channels the agent was never added to are refused → private content stays isolated on the agent
// plane too (docs/authorization.md invariant 4). resolveTarget / resolveMessageId / findParent all gate on this,
// so every channel-touching /agent-api/* endpoint inherits the boundary at once.
export async function canAgentReadChannel(serverId: string, channelId: string, agentId: string): Promise<boolean> {
  const db = dbFor(serverId);
  const member = (await db.select().from(schema.channelMembers).where(and(eq(schema.channelMembers.channelId, channelId), eq(schema.channelMembers.memberType, "agent"), eq(schema.channelMembers.memberId, agentId))))[0];
  if (member) return true;
  const ch = (await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)))[0];
  if (!ch || ch.serverId !== serverId || ch.deletedAt) return false;
  if (ch.type === "channel") return true;                                  // public: any agent in the server may read
  if (ch.parentMessageId) {                                                // thread: visibility follows its parent message's channel
    const parent = (await db.select().from(schema.messages).where(eq(schema.messages.id, ch.parentMessageId)))[0];
    if (parent) return canAgentReadChannel(serverId, parent.channelId, agentId); // depth 1 (a parent channel is never itself a thread)
  }
  return false;                                                            // private / DM the agent is not a member of
}

export async function resolveTarget(serverId: string, target: string, selfAgentId: string): Promise<{ channelId: string; threadId: string | null } | null> {
  const db = dbFor(serverId);
  let t = target.trim();
  if (t.startsWith("thread:")) {
    const short = t.slice("thread:".length).trim();
    if (!/^[0-9a-f]{6,}$/i.test(short)) return null;
    const parent = (await db.select().from(schema.messages).where(and(
      eq(schema.messages.serverId, serverId),
      like(schema.messages.id, short.toLowerCase() + "%"),
    )))[0];
    if (!parent || parent.senderType === "system") return null;
    const existing = (await db.select().from(schema.channels).where(and(
      eq(schema.channels.serverId, serverId),
      eq(schema.channels.type, "thread"),
      eq(schema.channels.parentMessageId, parent.id),
    )))[0];
    if (existing) {
      if (!(await canAgentReadChannel(serverId, existing.id, selfAgentId))) return null;
      return { channelId: existing.id, threadId: null };
    }
    if (!(await canAgentReadChannel(serverId, parent.channelId, selfAgentId))) return null;
    const th = await getOrCreateThread(serverId, parent.id, { type: "agent", id: selfAgentId });
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
    const a = (await db.select().from(schema.agents).where(and(eq(schema.agents.name, peer), eq(schema.agents.serverId, serverId))))[0];
    const peerId = human?.id ?? a?.id; const peerType = human ? "user" : a ? "agent" : null;
    if (!peerId || !peerType) return null;
    baseChannelId = await getOrCreateDM(serverId, selfAgentId, "agent", peerId, peerType);
  } else {
    const ch = (await db.select().from(schema.channels).where(and(eq(schema.channels.serverId, serverId), eq(schema.channels.name, t.replace(/^#/, "")))))[0];
    baseChannelId = ch?.id ?? null;
  }
  if (!baseChannelId) return null;
  // 2) No thread suffix → base channel; has suffix → find parent message (short id prefix) → thread channel of that parent message
  if (!threadShort) {
    // Agent ACL: the agent may only resolve a base channel it can access (public, a DM it just got, or a private
    // it was added to). This gate intentionally happens only for non-thread targets; existing thread membership
    // is enough for the thread case below.
    if (!(await canAgentReadChannel(serverId, baseChannelId, selfAgentId))) return null;
    return { channelId: baseChannelId, threadId: null };
  }
  const parent = (await db.select().from(schema.messages).where(and(eq(schema.messages.serverId, serverId), eq(schema.messages.channelId, baseChannelId), like(schema.messages.id, threadShort.toLowerCase() + "%"))))[0];
  // System messages ("X created task / claimed / moved …") are not real conversation anchors and have no
  // "open thread" affordance in the UI — threading onto one buries the reply where no one can reach it.
  // Reject so the caller surfaces a clear error instead of silently creating an unreachable thread.
  if (!parent || parent.senderType === "system") return null;
  const existing = (await db.select().from(schema.channels).where(and(
    eq(schema.channels.serverId, serverId),
    eq(schema.channels.type, "thread"),
    eq(schema.channels.parentMessageId, parent.id),
  )))[0];
  if (existing) {
    if (!(await canAgentReadChannel(serverId, existing.id, selfAgentId))) return null;
    return { channelId: existing.id, threadId: null };
  }
  if (!(await canAgentReadChannel(serverId, baseChannelId, selfAgentId))) return null;
  const th = await getOrCreateThread(serverId, parent.id, { type: "agent", id: selfAgentId });
  return { channelId: th.id, threadId: null };
}

export async function getOrCreateDM(serverId: string, aId: string, aType: string, bId: string, bType: string): Promise<string> {
  const db = dbFor(serverId);
  // Simplified: DM channel name = dm:<sorted ids>
  const key = "dm:" + [aId, bId].sort().join(":");
  const existing = (await db.select().from(schema.channels).where(and(eq(schema.channels.serverId, serverId), eq(schema.channels.name, key))))[0];
  if (existing) return existing.id;
  // Atomic create: partitioned unique index (serverId, name WHERE type=dm) ensures only one row under concurrency; losing insert returns empty → re-select to get that row.
  const [ch] = await db.insert(schema.channels).values({ serverId, name: key, type: "dm" }).onConflictDoNothing().returning();
  if (!ch) return (await db.select().from(schema.channels).where(and(eq(schema.channels.serverId, serverId), eq(schema.channels.name, key))))[0]!.id;
  await db.insert(schema.channelMembers).values([
    { channelId: ch.id, memberType: aType, memberId: aId },
    { channelId: ch.id, memberType: bType, memberId: bId },
  ]).onConflictDoNothing();
  return ch.id;
}

/** Find/create thread channel (thread = channel with type=thread, carrying parentMessageId). Idempotent. creator added as member = auto follow. */
export async function getOrCreateThread(serverId: string, parentMessageId: string, creator?: { type: "user" | "agent"; id: string }) {
  const db = dbFor(serverId);
  let thread = (await db.select().from(schema.channels).where(and(eq(schema.channels.serverId, serverId), eq(schema.channels.type, "thread"), eq(schema.channels.parentMessageId, parentMessageId))))[0];
  if (!thread) {
    // Atomic create: partitioned unique index (serverId, parentMessageId WHERE type=thread) ensures only one row under concurrency; losing insert returns empty → re-select.
    const [ch] = await db.insert(schema.channels).values({ serverId, type: "thread", parentMessageId, name: `thread-${parentMessageId.slice(0, 8)}` }).onConflictDoNothing().returning();
    thread = ch ?? (await db.select().from(schema.channels).where(and(eq(schema.channels.serverId, serverId), eq(schema.channels.type, "thread"), eq(schema.channels.parentMessageId, parentMessageId))))[0]!;
    if (ch) { // only add thread root member on the actual new creation (skip for the losing insert)
      const parent = (await db.select().from(schema.messages).where(eq(schema.messages.id, parentMessageId)))[0];
      if (parent?.senderId) await db.insert(schema.channelMembers).values({ channelId: thread.id, memberType: parent.senderType as "user" | "agent", memberId: parent.senderId }).onConflictDoNothing();
    }
  }
  if (creator) await db.insert(schema.channelMembers).values({ channelId: thread.id, memberType: creator.type, memberId: creator.id }).onConflictDoNothing();
  return thread;
}

// ── Tasks (message-as-task): convert / claim / unclaim / status, all emit task:updated ──────
async function taskMentions(serverId: string, messageId: string): Promise<Member[]> {
  const db = dbFor(serverId);
  const mts = await db.select().from(schema.messageMentions).where(eq(schema.messageMentions.messageId, messageId));
  return mts.map((x) => ({ type: x.mentionType as "user" | "agent", id: x.mentionId, name: x.mentionName, displayName: x.mentionName }));
}
async function emitTaskUpdated(serverId: string, msg: typeof schema.messages.$inferSelect): Promise<void> {
  await publish(serverId, { type: "task", op: "updated", task: serializeMsg(msg, await taskMentions(serverId, msg.id)) });
}

/** Mark an existing message as a task (open + assign taskNumber). */
// ── Task lifecycle system messages (convert/claim/unclaim/status each emit one messageType:system audit entry) ──
const taskTitle = (s: string) => { const t = ((s || "").split("\n")[0] ?? "").trim(); return t.length > 40 ? t.slice(0, 40) + "…" : t; };
// Task status system message copy (Title-Case + status emoji prefix). Emojis confirmed for in_progress 🔄 / in_review 👁; todo/done/closed pending confirmation, no guessing.
const STATUS_LABEL: Record<string, string> = { todo: "Todo", in_progress: "In Progress", in_review: "In Review", done: "Done", closed: "Closed" };
const STATUS_EMOJI: Record<string, string> = { in_progress: "🔄", in_review: "👁" };
async function actorName(serverId: string, type: "user" | "agent", id: string): Promise<string> {
  const db = dbFor(serverId);
  if (type === "agent") { const a = (await db.select().from(schema.agents).where(eq(schema.agents.id, id)))[0]; return a?.displayName || a?.name || "agent"; }
  return humanIdentityForId(id)?.displayName ?? "someone";
}
type DispatchAuditContext = DispatchMessageContext & { messageId?: string };

async function prepareTaskActionDispatch(
  serverId: string,
  taskMessageId: string,
  channelId: string,
  by?: { type: "user" | "agent"; id: string },
) {
  const messageId = randomUUID();
  const state = new SqliteDispatchState(serverId);
  const dispatch = await state.resolveMessageContext({
    messageId,
    channelId,
    senderType: by?.type ?? "system",
    senderId: by?.id ?? null,
    taskMessageId,
  });
  await state.ensureChain({ ...dispatch, rootMessageId: messageId, channelId });
  return { messageId, state, dispatch };
}

// Lightweight system message: only insert + publish message, no wake/no task creation (otherwise every status change wakes all agents = noise)
async function sysTaskMsg(
  serverId: string,
  channelId: string,
  content: string,
  actor?: { type: "user" | "agent"; id: string },
  dispatch?: DispatchAuditContext,
) {
  const db = dbFor(serverId);
  const seq = await nextSeq(serverId);
  const [m] = await db.insert(schema.messages).values({
    ...(dispatch?.messageId ? { id: dispatch.messageId } : {}),
    seq,
    serverId,
    channelId,
    senderType: "system",
    senderId: actor?.id ?? null,
    senderName: "system",
    messageType: "system",
    content,
    searchText: content,
    dispatchChainId: dispatch?.chainId ?? null,
    dispatchDepth: dispatch?.dispatchDepth ?? null,
  }).returning();
  await publishTaskSystemMessage(serverId, m!, actor);
  return m!;
}

async function publishTaskSystemMessage(
  serverId: string,
  message: typeof schema.messages.$inferSelect,
  actor?: { type: "user" | "agent"; id: string },
) {
  const db = dbFor(serverId);
  const m = message;
  const channelId = m.channelId;
  const ch = (await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)))[0];
  await db.update(schema.channels).set({ lastMessageAt: new Date() }).where(eq(schema.channels.id, channelId));
  await publish(serverId, { type: "message", channelId, message: { ...serializeMsg(m!, [], []), channelType: ch?.type ?? null } });
  await publishThreadUpdated(serverId, ch, actor?.id ?? null, "system");
}

export async function convertMessageToTask(
  serverId: string,
  messageId: string,
  by?: { type: "user" | "agent"; id: string },
  executionMode: TaskExecutionMode = "autopilot",
) {
  const result = convertMessageRecord({ serverId, messageId, executionMode });
  if (!result) return null;
  if (!result.changed) return result.task;
  const upd = result.task;
  await publish(serverId, { type: "task", op: "created", task: serializeMsg(upd, await taskMentions(serverId, messageId)) });
  const an = by ? await actorName(serverId, by.type, by.id) : "Someone";
  await sysTaskMsg(serverId, upd.channelId, `${an} converted a message to task #${upd.taskNumber} "${taskTitle(upd.content)}"`, by);
  return upd;
}

/** Claim a task → in_progress + assignee. */
/**
 * Resolve messageId: accepts full uuid or the 8-char short id from message headers (msg=<shortid>).
 * Agents see short ids and will use them directly for claim/update/reply → previously the endpoint queried the uuid column with a short id and threw 500.
 * Full uuid → verify existence; short id (6+ hex) → prefix match; neither → null (caller returns 404, never 500).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Single definition of the agent-facing id convention: full uuid → exact match; 6+ hex chars → serverId-scoped
 *  prefix match; anything else (dashes in a partial, LIKE metachars, too short) → null — never a 500 from casting
 *  a non-uuid into the uuid column. Shared by messages (resolveMessageId) and attachments (attachment/view) so
 *  the convention cannot drift per-resource. Returns the resolved full id; the caller applies its own ACL. */
export async function resolveIdOrPrefix(
  table: typeof schema.messages | typeof schema.attachments,
  serverId: string,
  idOrShort: string | undefined | null,
): Promise<string | null> {
  const db = dbFor(serverId);
  const s = (idOrShort ?? "").trim().toLowerCase();
  if (!s) return null;
  let r: { id: string } | undefined;
  if (UUID_RE.test(s)) {
    r = (await db.select({ id: table.id }).from(table).where(and(eq(table.id, s), eq(table.serverId, serverId))))[0];
  } else if (/^[0-9a-f]{6,}$/.test(s)) {
    r = (await db.select({ id: table.id }).from(table).where(and(like(table.id, s + "%"), eq(table.serverId, serverId))).limit(1))[0];
  }
  return r?.id ?? null;
}
// Resolve a (short or full) message id within a server. ALWAYS pass `agentId` when called on the agent plane
// (/agent-api/*): without it the channel ACL is skipped, so an agent could resolve a message in a channel it
// cannot access. The optional default exists only for non-agent internal callers (there are none today).
export async function resolveMessageId(serverId: string, idOrShort: string | undefined | null, agentId?: string): Promise<string | null> {
  const db = dbFor(serverId);
  const id = await resolveIdOrPrefix(schema.messages, serverId, idOrShort);
  if (!id) return null;
  const m = (await db.select({ id: schema.messages.id, channelId: schema.messages.channelId }).from(schema.messages).where(eq(schema.messages.id, id)))[0];
  if (!m) return null;
  // Agent ACL: on the agent plane (agentId passed), only resolve a message in a channel the agent can access —
  // otherwise an agent could probe/react/claim any message in the server by its (short) id.
  if (agentId && !(await canAgentReadChannel(serverId, m.channelId, agentId))) return null;
  return m.id;
}

export async function claimTask(serverId: string, messageId: string, assigneeType: "user" | "agent", assigneeId: string, expectedRevision?: number) {
  const result = claimTaskRecord({ serverId, messageId, assigneeType, assigneeId, expectedRevision });
  if (!result) return null;
  const upd = result.task;
  if (!result.changed) return upd;
  await emitTaskUpdated(serverId, upd);
  await sysTaskMsg(serverId, upd.channelId, `${await actorName(serverId, assigneeType, assigneeId)} claimed #${upd.taskNumber} "${taskTitle(upd.content)}"`, { type: assigneeType, id: assigneeId });
  return upd;
}

export async function unclaimTask(serverId: string, messageId: string, by?: { type: "user" | "agent"; id: string }, expectedRevision?: number) {
  const result = unclaimTaskRecord({ serverId, messageId, by, expectedRevision });
  if (!result) return null;
  const upd = result.task;
  if (!result.changed) return upd;
  await emitTaskUpdated(serverId, upd);
  await sysTaskMsg(serverId, upd.channelId, `${by ? await actorName(serverId, by.type, by.id) : "Someone"} released #${upd.taskNumber} "${taskTitle(upd.content)}"`, by);
  return upd;
}

export async function assignTask(
  serverId: string,
  messageId: string,
  assigneeId: string,
  by?: { type: "user" | "agent"; id: string },
  expectedRevision?: number,
) {
  const db = dbFor(serverId);
  const target = (await db.select().from(schema.agents).where(and(
    eq(schema.agents.id, assigneeId),
    eq(schema.agents.serverId, serverId),
    isNull(schema.agents.deletedAt),
  )))[0];
  if (!target) return null;

  const result = assignTaskRecord({ serverId, messageId, assigneeId, by, expectedRevision });
  if (!result) return null;
  const upd = result.task;
  if (!result.changed) return upd;

  await emitTaskUpdated(serverId, upd);
  const th = await getOrCreateThread(serverId, upd.id);
  const threadCh = th.id;
  if (!upd.threadId) {
    await db.update(schema.messages).set({ threadId: threadCh }).where(eq(schema.messages.id, upd.id));
    upd.threadId = threadCh;
  }
  await db.insert(schema.channelMembers).values({ channelId: threadCh, memberType: "agent", memberId: assigneeId }).onConflictDoNothing();

  const actor = by ? await actorName(serverId, by.type, by.id) : "Someone";
  const assigneeName = target.displayName || target.name;
  const action = await prepareTaskActionDispatch(serverId, upd.id, threadCh, by);
  const sysMsg = await sysTaskMsg(
    serverId,
    threadCh,
    `${actor} assigned #${upd.taskNumber} "${taskTitle(upd.content)}" to ${assigneeName}`,
    by,
    { ...action.dispatch, messageId: action.messageId },
  );

  const reservation = await reserveDispatchWake({
    state: action.state,
    dispatch: action.dispatch,
    messageId: sysMsg.id,
    targetAgentId: assigneeId,
    targetAgentName: target.name,
    fallbackChannelId: threadCh,
  });
  if (!reservation) return upd;
  const startTarget = await agentStartTarget(serverId, assigneeId);
  if (startTarget.ok) {
    const startSent = sendAgentStart(serverId, startTarget, assigneeId);
    const deliverSent = startSent && sendAgentDeliver(serverId, startTarget, {
      agentId: assigneeId,
      seq: sysMsg.seq,
      from: actor,
      target: threadCh,
      targetName: `task #${upd.taskNumber}`,
      msgShort: sysMsg.id.slice(0, 8),
      isTask: true,
      message: { content: `#${upd.taskNumber} assigned to you` },
      mentioned: true,
    });
    if (!deliverSent) {
      await action.state.releaseWake(reservation.reservationId);
      await markAgentUnavailable(serverId, assigneeId, "machine offline");
    } else {
      await action.state.commitWake(reservation.reservationId, {
        agentId: assigneeId,
        channelId: threadCh,
        chainId: action.dispatch.chainId,
        dispatchDepth: action.dispatch.dispatchDepth,
      });
    }
  } else if (startTarget.reason !== "agent not found") {
    await action.state.releaseWake(reservation.reservationId);
    await markAgentUnavailable(serverId, assigneeId, startTarget.reason);
  } else {
    await action.state.releaseWake(reservation.reservationId);
  }

  return upd;
}

export async function setTaskExecutionMode(serverId: string, messageId: string, mode: TaskExecutionMode) {
  const db = dbFor(serverId);
  const [upd] = await db.update(schema.messages).set({ taskExecutionMode: mode, taskRevision: sql`${schema.messages.taskRevision} + 1`, updatedAt: new Date() }).where(and(
    eq(schema.messages.id, messageId),
    eq(schema.messages.serverId, serverId),
    isNotNull(schema.messages.taskStatus),
  )).returning();
  if (!upd) return null;
  await emitTaskUpdated(serverId, upd);
  return upd;
}

/** Change status (todo|in_progress|in_review|done|closed); done/closed records completedAt; done auto-creates thread. */
export async function setTaskStatus(
  serverId: string,
  messageId: string,
  status: string,
  by?: { type: "user" | "agent"; id: string },
  concurrency: { from?: TaskStatus; expectedRevision?: number } = {},
) {
  if (!isTaskStatus(status)) throw new TaskOperationError("INVALID_TRANSITION", `invalid task status: ${status}`);
  const db = dbFor(serverId);
  const current = db.select().from(schema.messages).where(and(
    eq(schema.messages.id, messageId),
    eq(schema.messages.serverId, serverId),
    isNotNull(schema.messages.taskStatus),
  )).get();
  if (!current) return null;
  if (current.taskStatus === status) return current;
  const th = await getOrCreateThread(serverId, current.id);
  const threadCh = th.id;
  if (!current.threadId) await db.update(schema.messages).set({ threadId: threadCh }).where(eq(schema.messages.id, current.id));
  const actor = by ? await actorName(serverId, by.type, by.id) : "Someone";
  const label = STATUS_LABEL[status] ?? status;
  const emoji = STATUS_EMOJI[status] ? STATUS_EMOJI[status] + " " : ""; // confirmed for in_progress/in_review; others pending confirmation, no guessing
  const content = `${emoji}${actor} moved #${current.taskNumber} "${taskTitle(current.content)}" to ${label}`;
  const action = await prepareTaskActionDispatch(serverId, current.id, threadCh, by);
  const auditSeq = await nextSeq(serverId);
  const result = transitionTaskRecord({
    serverId,
    messageId,
    to: status,
    ...concurrency,
    audit: {
      id: action.messageId,
      seq: auditSeq,
      serverId,
      channelId: threadCh,
      senderType: "system",
      senderId: by?.id ?? null,
      senderName: "system",
      messageType: "system",
      content,
      searchText: content,
      dispatchChainId: action.dispatch.chainId,
      dispatchDepth: action.dispatch.dispatchDepth,
    },
  });
  if (!result) return null;
  const upd = result.task;
  if (!result.changed) return upd;
  await emitTaskUpdated(serverId, upd); // task message itself updated (taskStatus) → lands in CHANNEL, updates badge + board in channel (verified: message:updated and task:updated both land in the channel)
  upd.threadId = threadCh;
  const sysMsg = result.audit!;
  await publishTaskSystemMessage(serverId, sysMsg, by);
  // Wake the assigned agent (only when changed by someone else). Verified: human changes status → assignee agent fires agent:activity working detail="Message received".
  if (upd.taskAssigneeType === "agent" && upd.taskAssigneeId && by?.id !== upd.taskAssigneeId) {
    await db.insert(schema.channelMembers).values({ channelId: threadCh, memberType: "agent", memberId: upd.taskAssigneeId }).onConflictDoNothing(); // ensure assignee is a thread member, otherwise message check cannot see this system message
    const assignee = db.select({ name: schema.agents.name }).from(schema.agents).where(eq(schema.agents.id, upd.taskAssigneeId)).get();
    const reservation = await reserveDispatchWake({
      state: action.state,
      dispatch: action.dispatch,
      messageId: sysMsg.id,
      targetAgentId: upd.taskAssigneeId,
      targetAgentName: assignee?.name ?? upd.taskAssigneeId,
      fallbackChannelId: threadCh,
    });
    if (!reservation) return upd;
    const target = await agentStartTarget(serverId, upd.taskAssigneeId);
    if (target.ok) {
      const startSent = sendAgentStart(serverId, target, upd.taskAssigneeId);
      const deliverSent = startSent && sendAgentDeliver(serverId, target, { type: "agent:deliver", agentId: upd.taskAssigneeId, seq: sysMsg.seq, from: actor, target: threadCh, targetName: `task #${upd.taskNumber}`, msgShort: sysMsg.id.slice(0, 8), isTask: true, message: { content: `#${upd.taskNumber} → ${label}` }, mentioned: true });
      if (!deliverSent) {
        await action.state.releaseWake(reservation.reservationId);
        await markAgentUnavailable(serverId, upd.taskAssigneeId, "machine offline");
      } else {
        await action.state.commitWake(reservation.reservationId, {
          agentId: upd.taskAssigneeId,
          channelId: threadCh,
          chainId: action.dispatch.chainId,
          dispatchDepth: action.dispatch.dispatchDepth,
        });
      }
    } else if (target.reason !== "agent not found") {
      await action.state.releaseWake(reservation.reservationId);
      await markAgentUnavailable(serverId, upd.taskAssigneeId, target.reason);
    } else {
      await action.state.releaseWake(reservation.reservationId);
    }
  }
  return upd;
}

/** Delete task: revert to regular message — clear task fields, source message retained; emit task:deleted. */
export async function deleteTask(serverId: string, messageId: string) {
  const db = dbFor(serverId);
  const [upd] = await db.update(schema.messages)
    .set({ taskStatus: null, taskNumber: null, taskAssigneeType: null, taskAssigneeId: null, taskClaimedAt: null, taskCompletedAt: null, taskParentId: null, taskRevision: 0, updatedAt: new Date() })
    .where(and(eq(schema.messages.id, messageId), eq(schema.messages.serverId, serverId), isNotNull(schema.messages.taskStatus))).returning();
  if (!upd) return null;
  await publish(serverId, { type: "task", op: "deleted", channelId: upd.channelId, taskId: upd.id });
  return upd;
}

// ── Agent lifecycle: start/stop/reset (target bound machine + update status + emit socket events) ──
async function publishAgentState(serverId: string, agentId: string, detail = ""): Promise<void> {
  const db = dbFor(serverId);
  const a = (await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)))[0];
  if (a) await publish(serverId, { type: "agent", id: a.id, name: a.name, status: a.status, activity: a.activity, detail });
}
async function markAgentUnavailable(serverId: string, agentId: string, reason: string): Promise<void> {
  const db = dbFor(serverId);
  await db.update(schema.agents).set({ status: "inactive", activity: "offline" }).where(and(eq(schema.agents.id, agentId), eq(schema.agents.serverId, serverId)));
  await publishAgentState(serverId, agentId, reason);
  log.warn("agent unavailable", { agentId, reason });
}
type AgentStartTarget = { ok: true; machineId: string | null; cfg: NonNullable<Awaited<ReturnType<typeof agentConfig>>> };
type AgentControlTarget = { ok: true; machineId: string | null };

function sendAgentStart(serverId: string, target: AgentStartTarget, agentId: string): boolean {
  const msg = { type: "agent:start", agentId, config: target.cfg };
  if (target.machineId) return sendToMachine(target.machineId, msg);
  if (daemonCount(serverId) === 0) return false;
  broadcastToDaemons(serverId, msg);
  return true;
}

function sendAgentDeliver(serverId: string, target: AgentStartTarget, msg: Record<string, unknown>): boolean {
  if (target.machineId) return sendToMachine(target.machineId, { type: "agent:deliver", ...msg });
  if (daemonCount(serverId) === 0) return false;
  broadcastToDaemons(serverId, { type: "agent:deliver", ...msg });
  return true;
}

function sendAgentControl(serverId: string, target: AgentControlTarget, msg: Record<string, unknown>): boolean {
  if (target.machineId) return sendToMachine(target.machineId, msg);
  if (daemonCount(serverId) === 0) return false;
  broadcastToDaemons(serverId, msg);
  return true;
}

async function agentStartTarget(serverId: string, agentId: string): Promise<AgentStartTarget | { ok: false; reason: string }> {
  const db = dbFor(serverId);
  const a = (await db.select({
    machineId: schema.agents.machineId,
    runtime: schema.agents.runtime,
    machineStatus: schema.machines.status,
    machineRuntimes: schema.machines.runtimes,
  }).from(schema.agents)
    .leftJoin(schema.machines, eq(schema.agents.machineId, schema.machines.id))
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.serverId, serverId), isNull(schema.agents.deletedAt))))[0];
  if (!a) return { ok: false, reason: "agent not found" };
  if (!a.machineId) {
    if (daemonCount(serverId) === 0) return { ok: false, reason: "no daemon online" };
    const cfg = await agentConfig(serverId, agentId);
    if (!cfg) return { ok: false, reason: "agent not found" };
    return { ok: true, machineId: null, cfg };
  }
  if (a.machineStatus !== "online" || !isMachineConnected(a.machineId)) return { ok: false, reason: "machine offline" };
  const runtime = a.runtime ?? "claude";
  const runtimes = Array.isArray(a.machineRuntimes) ? a.machineRuntimes : [];
  if (!runtimes.includes(runtime)) return { ok: false, reason: `runtime unavailable: ${runtime}` };
  const cfg = await agentConfig(serverId, agentId);
  if (!cfg) return { ok: false, reason: "agent not found" };
  return { ok: true, machineId: a.machineId, cfg };
}
async function agentControlTarget(serverId: string, agentId: string): Promise<AgentControlTarget | { ok: false; reason: string }> {
  const db = dbFor(serverId);
  const a = (await db.select({
    machineId: schema.agents.machineId,
    machineStatus: schema.machines.status,
  }).from(schema.agents)
    .leftJoin(schema.machines, eq(schema.agents.machineId, schema.machines.id))
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.serverId, serverId), isNull(schema.agents.deletedAt))))[0];
  if (!a) return { ok: false, reason: "agent not found" };
  if (!a.machineId) {
    if (daemonCount(serverId) === 0) return { ok: false, reason: "no daemon online" };
    return { ok: true, machineId: null };
  }
  if (a.machineStatus !== "online" || !isMachineConnected(a.machineId)) return { ok: false, reason: "machine offline" };
  return { ok: true, machineId: a.machineId };
}
/** Start an agent (requires local daemon to be online). */
export async function startAgent(serverId: string, agentId: string): Promise<{ ok: boolean; reason?: string }> {
  const db = dbFor(serverId);
  const target = await agentStartTarget(serverId, agentId);
  if (!target.ok) {
    if (target.reason !== "agent not found") await markAgentUnavailable(serverId, agentId, target.reason);
    return { ok: false, reason: target.reason };
  }
  if (!sendAgentStart(serverId, target, agentId)) {
    await markAgentUnavailable(serverId, agentId, "machine offline");
    return { ok: false, reason: "machine offline" };
  }
  await db.update(schema.agents).set({ status: "active", activity: "working" }).where(eq(schema.agents.id, agentId));
  await publishAgentState(serverId, agentId);
  return { ok: true };
}
export async function stopAgent(serverId: string, agentId: string): Promise<boolean> {
  const db = dbFor(serverId);
  const target = await agentControlTarget(serverId, agentId);
  if (target.ok) {
    if (!sendAgentControl(serverId, target, { type: "agent:stop", agentId })) log.warn("agent stop target unavailable", { agentId, reason: "machine offline" });
  } else if (target.reason !== "agent not found") {
    log.warn("agent stop target unavailable", { agentId, reason: target.reason });
  }
  await db.update(schema.agents).set({ status: "inactive", activity: "offline" }).where(and(eq(schema.agents.id, agentId), eq(schema.agents.serverId, serverId)));
  await publishAgentState(serverId, agentId);
  return true;
}
export async function resetAgent(serverId: string, agentId: string, wipeWorkspace = false, clearMemory = false): Promise<boolean> {
  const db = dbFor(serverId);
  const target = await agentControlTarget(serverId, agentId);
  if (target.ok) {
    if (!sendAgentControl(serverId, target, { type: "agent:reset", agentId, wipeWorkspace, clearMemory })) log.warn("agent reset target unavailable", { agentId, reason: "machine offline" });
  } else if (target.reason !== "agent not found") {
    log.warn("agent reset target unavailable", { agentId, reason: target.reason });
  }
  await db.update(schema.agents).set({ status: "inactive", activity: "offline", sessionId: null }).where(and(eq(schema.agents.id, agentId), eq(schema.agents.serverId, serverId)));
  await publishAgentState(serverId, agentId);
  return true;
}
/** Profile (displayName/description) changed → ask the daemon to sync the workspace MEMORY.md title + `## Role`.
 *  Pass the full current values (not just the changed field); the daemon rewrites only those, preserving the rest. */
export async function syncAgentProfile(serverId: string, agentId: string, displayName: string, description?: string | null): Promise<void> {
  const target = await agentControlTarget(serverId, agentId);
  if (target.ok) {
    if (!sendAgentControl(serverId, target, { type: "agent:profile", agentId, displayName, description: description ?? null })) log.warn("agent profile target unavailable", { agentId, reason: "machine offline" });
  } else if (target.reason !== "agent not found") {
    log.warn("agent profile target unavailable", { agentId, reason: target.reason });
  }
}
