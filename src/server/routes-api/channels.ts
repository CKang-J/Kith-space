// Auto-extracted from the former routes-api.ts monolith — bodies are verbatim.
import type { SpaceCtx } from "./ctx.js";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { dbForSpace, schema } from "../../db/index.js";
import { getHumanIdentity } from "../../human/humanIdentity.js";
import {
  followHumanThread,
  humanChannelState,
  humanContainerStates,
  humanDmStates,
  markHumanChannelRead,
  humanChannelNotificationLevel,
  setHumanChannelNotificationLevel,
  setHumanThreadDone,
  unfollowHumanThread,
  type HumanChannelState,
} from "../../human/humanChannelState.js";
import { addChannelMembers, getOrCreateDM, getOrCreateThread } from "../core.js";
import { publish } from "../realtime.js";
import { readJson, sendErr, sendJson } from "../util.js";
import { canHumanReadChannel } from "../channelAccess.js";
import { listThreadSummaries } from "../../channels/threadSummaries.js";
import { activeChannels, assertChannelWritable, isRequiredChannel } from "../../channels/channelLifecycle.js";
import { deletedAgentIds, humanChannels } from "./shared.js";
import {
  AgentResponseSettingsError,
  listChannelAgentResponseModes,
  setChannelAgentResponseModeOverride,
} from "../../agents/agentResponseSettings.js";
import { revokeChannelAgentAccess } from "../channelAccessRevocation.js";
import { listConversationActivityHistory } from "../conversationActivityHistory.js";

const notSentBy = (humanId: string) => or(isNull(schema.messages.senderId), ne(schema.messages.senderId, humanId));

async function unreadRowsForMember(spaceId: string, member: HumanChannelState, humanId: string) {
  if (member.threadDoneAt) return [];
  const db = dbForSpace(spaceId);
  return db.select({ id: schema.messages.id, seq: schema.messages.seq }).from(schema.messages)
    .where(and(eq(schema.messages.channelId, member.channelId), gt(schema.messages.seq, member.lastReadSeq), notSentBy(humanId)))
    .orderBy(asc(schema.messages.seq));
}

async function parentChannelIdForThread(spaceId: string, thread: typeof schema.channels.$inferSelect): Promise<string | null> {
  if (thread.type !== "thread" || !thread.parentMessageId) return thread.id;
  const db = dbForSpace(spaceId);
  const parent = (await db.select({ channelId: schema.messages.channelId }).from(schema.messages).where(eq(schema.messages.id, thread.parentMessageId)))[0];
  return parent?.channelId ?? null;
}

// The sidebar/inbox unread badge for a channel aggregates the channel's OWN timeline unread plus the unread of
// every followed (not-done) thread under it — each thread's unread is rolled onto its parent channel id. Read
// cursors clear each source independently (read the channel → channel-own portion; open the thread → that
// thread's portion). Single source of truth shared by GET /channels/unread and POST /:id/read.
async function unreadMapForHuman(spaceId: string, humanId: string): Promise<Record<string, number>> {
  const db = dbForSpace(spaceId);
  const { states: myMems, channels: chs } = await humanContainerStates(spaceId);
  const map: Record<string, number> = {};
  const byId = new Map(chs.map((c) => [c.id, c]));
  for (const m of myMems) {
    const ch = byId.get(m.channelId);
    if (!ch || ch.deletedAt) continue;
    if (ch.type === "thread" && m.threadDoneAt) continue;
    const [r] = await db.select({ n: count() }).from(schema.messages).where(and(eq(schema.messages.channelId, m.channelId), gt(schema.messages.seq, m.lastReadSeq), notSentBy(humanId)));
    const n = Number(r?.n ?? 0);
    if (n <= 0) continue;
    const targetId = ch.type === "thread" ? await parentChannelIdForThread(spaceId, ch) : ch.id;
    if (targetId) map[targetId] = (map[targetId] ?? 0) + n;
  }
  return map;
}

export async function handleChannels(ctx: SpaceCtx): Promise<boolean> {
  const { req, res, url, method, p, humanId, spaceId } = ctx;
  const db = dbForSpace(spaceId);
  const activityLog = /^\/api\/channels\/([^/]+)\/activity-log$/.exec(p);
  if (activityLog && method === "GET") {
    const conversationId = activityLog[1]!;
    if (!(await canHumanReadChannel(spaceId, conversationId))) {
      return (sendErr(res, 404, "channel not found"), true);
    }
    const requestedLimit = Number(url.searchParams.get("limit") ?? 300);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 300)
      : 300;
    const rows = await listConversationActivityHistory(db, spaceId, conversationId, limit);
    return (sendJson(res, 200, rows), true);
  }
  // ── Threads: a thread is a channel with type=thread (and a parentMessageId); there is no separate /api/threads endpoint ──
  if (p === "/api/channels/threads/followed" && method === "GET") {
    const cms = await db.select().from(schema.humanChannelStates).where(isNotNull(schema.humanChannelStates.threadFollowedAt));
    const chIds = cms.map((c) => c.channelId);
    const threads = chIds.length ? await activeChannels(spaceId, await db.select().from(schema.channels).where(and(eq(schema.channels.spaceId, spaceId), eq(schema.channels.type, "thread"), inArray(schema.channels.id, chIds)))) : [];
    const out = [];
    for (const th of threads) {
      const myCm = cms.find((c) => c.channelId === th.id);
      if (myCm?.threadDoneAt) continue; // remove done threads from active inbox (thread stays until explicitly marked done)
      const replies = await db.select({ seq: schema.messages.seq, createdAt: schema.messages.createdAt }).from(schema.messages).where(eq(schema.messages.channelId, th.id)).orderBy(asc(schema.messages.seq));
      const parent = th.parentMessageId ? (await db.select().from(schema.messages).where(eq(schema.messages.id, th.parentMessageId)))[0] : null;
      const pch = parent ? (await db.select().from(schema.channels).where(eq(schema.channels.id, parent.channelId)))[0] : null;
      const unread = myCm ? await unreadRowsForMember(spaceId, myCm, humanId) : [];
      out.push({ threadChannelId: th.id, parentMessageId: th.parentMessageId, parentChannelId: parent?.channelId ?? null, parentChannelName: pch?.name ?? null, parentPreview: (parent?.content ?? "").slice(0, 80), replyCount: replies.length, unreadCount: unread.length, lastReplyAt: replies.length ? replies[replies.length - 1]!.createdAt : null });
    }
    return (sendJson(res, 200, { threads: out }), true);
  }
  // Thread follow/unfollow/done/undone is stored in the single Human's channel state, separate from agent membership.
  if (p === "/api/channels/threads/follow" && method === "POST") {
    const tid = (await readJson(req).catch(() => ({})))?.threadChannelId;
    if (tid) {
      await assertChannelWritable(spaceId, String(tid));
      await followHumanThread(spaceId, String(tid));
    }
    return (sendJson(res, 200, { ok: true }), true);
  }
  if (p === "/api/channels/threads/unfollow" && method === "POST") {
    const tid = (await readJson(req).catch(() => ({})))?.threadChannelId;
    if (tid) {
      await assertChannelWritable(spaceId, String(tid));
      await unfollowHumanThread(spaceId, String(tid));
    }
    return (sendJson(res, 200, { ok: true }), true);
  }
  if ((p === "/api/channels/threads/done" || p === "/api/channels/threads/undone") && method === "POST") {
    const tid = (await readJson(req).catch(() => ({})))?.threadChannelId;
    if (tid) {
      await assertChannelWritable(spaceId, String(tid));
      await setHumanThreadDone(spaceId, String(tid), p.endsWith("/done"));
    }
    return (sendJson(res, 200, { ok: true }), true);
  }
  const cthreads = /^\/api\/channels\/([^/]+)\/threads$/.exec(p);
  if (cthreads && method === "POST") {
    const b = await readJson(req);
    if (!b.parentMessageId) return (sendErr(res, 400, "parentMessageId required"), true);
    const parent = (await db.select().from(schema.messages).where(and(eq(schema.messages.id, b.parentMessageId), eq(schema.messages.spaceId, spaceId))))[0];
    if (!parent) return (sendErr(res, 404, "parent message not found"), true);
    // Channel visibility gate — non-members must not create threads on private/DM channels (IDOR-B3)
    if (!(await canHumanReadChannel(spaceId, parent.channelId))) return (sendErr(res, 403, "forbidden"), true);
    const th = await getOrCreateThread(spaceId, b.parentMessageId, { type: "human", id: humanId });
    const replies = await db.select({ createdAt: schema.messages.createdAt }).from(schema.messages).where(eq(schema.messages.channelId, th.id));
    const parts = await db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, th.id));
    return (sendJson(res, 200, { threadChannelId: th.id, parentMessageId: b.parentMessageId, replyCount: replies.length, lastReplyAt: replies.at(-1)?.createdAt ?? null, participantIds: [humanId, ...parts.map((participant) => participant.agentId)] }), true);
  }
  if (cthreads && method === "GET") {
    // Channel visibility gate — non-members must not enumerate thread metadata on private/DM channels (IDOR-B3)
    if (!(await canHumanReadChannel(spaceId, cthreads[1]!))) return (sendErr(res, 403, "forbidden"), true);
    const pids = (url.searchParams.get("parentMessageIds") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!pids.length) return (sendJson(res, 200, {}), true);
    const threads = await db.select().from(schema.channels).where(and(eq(schema.channels.spaceId, spaceId), eq(schema.channels.type, "thread"), inArray(schema.channels.parentMessageId, pids)));
    const map: Record<string, any> = {};
    const deletedSenderIds = deletedAgentIds(spaceId);
    for (const th of threads) {
      const replies = await db.select({
        id: schema.messages.id,
        seq: schema.messages.seq,
        senderType: schema.messages.senderType,
        senderId: schema.messages.senderId,
        senderName: schema.messages.senderName,
        content: schema.messages.content,
        createdAt: schema.messages.createdAt,
      }).from(schema.messages).where(eq(schema.messages.channelId, th.id)).orderBy(asc(schema.messages.seq));
      const myCm = await humanChannelState(spaceId, th.id);
      const unread = myCm ? await unreadRowsForMember(spaceId, myCm, humanId) : [];
      const previewReplies = replies.filter((reply) => reply.senderType !== "system").slice(-3);
      map[th.parentMessageId!] = {
        threadChannelId: th.id,
        replyCount: replies.length,
        unreadCount: unread.length,
        followed: Boolean(myCm?.threadFollowedAt),
        lastReplyAt: replies.length ? replies[replies.length - 1]!.createdAt : null,
        previews: previewReplies.map(({ id, senderType, senderId, senderName, content, createdAt }) => ({
          id, senderType, senderId, senderName, content, createdAt,
          senderDeleted: senderType === "agent" && !!senderId && deletedSenderIds.has(senderId),
        })),
      };
    }
    return (sendJson(res, 200, map), true);
  }
  const threadSummaries = /^\/api\/channels\/([^/]+)\/thread-summaries$/.exec(p);
  if (threadSummaries && method === "GET") {
    const parentChannelId = threadSummaries[1]!;
    if (!(await canHumanReadChannel(spaceId, parentChannelId))) return (sendErr(res, 404, "channel not found"), true);
    const threads = await listThreadSummaries({ spaceId, parentChannelId, humanId });
    return (sendJson(res, 200, { threads }), true);
  }
  // /channels only lists regular/private channels (bare array, no unread); DMs go through /channels/dm; unread counts through /channels/unread
  if (p === "/api/channels" && method === "GET") {
    const chs = await humanChannels(spaceId);
    const archived = url.searchParams.get("archived");
    const list = chs.filter((c) => !c.deletedAt
      && (archived === "only" ? !!c.archivedAt : archived === "include" || !c.archivedAt)
      && (c.type === "channel" || c.type === "private"));
    return (sendJson(res, 200, list.map((c) => ({
      id: c.id, spaceId: c.spaceId, name: c.name, description: c.description, type: c.type,
      parentMessageId: c.parentMessageId, createdAt: c.createdAt, archivedAt: c.archivedAt, deletedAt: c.deletedAt,
      lastMessageAt: c.lastMessageAt,
    }))), true);
  }
  if (p === "/api/channels/dm" && method === "GET") {
    const myMems = await humanDmStates(spaceId);
    const myIds = new Set(myMems.map((m) => m.channelId));
    const dms = (await db.select().from(schema.channels).where(and(eq(schema.channels.spaceId, spaceId), eq(schema.channels.type, "dm")))).filter((c) => !c.deletedAt && myIds.has(c.id));
    if (!dms.length) return (sendJson(res, 200, []), true);
    const agentsAll = await db.select().from(schema.agents).where(and(
      eq(schema.agents.spaceId, spaceId),
      isNull(schema.agents.deletedAt),
    ));
    const out = dms.map((c) => {
      const state = myMems.find((member) => member.channelId === c.id);
      const src = state?.dmAgentId ? agentsAll.find((agent) => agent.id === state.dmAgentId) : null;
      return {
        id: c.id, name: src?.name ?? c.name, type: "dm", description: c.description, createdAt: c.createdAt, lastMessageAt: c.lastMessageAt,
        peerId: state?.dmAgentId ?? null, peerName: src?.name ?? null, peerDisplayName: src?.displayName ?? null, peerType: state?.dmAgentId ? "agent" : null, peerAvatarUrl: src?.avatarUrl ?? null,
      };
    }).filter((item) => item.peerId && item.peerName); // A missing/deleted peer is excluded from the Human's DM list.
    return (sendJson(res, 200, out), true);
  }
  if (p === "/api/channels/unread" && method === "GET") {
    return (sendJson(res, 200, await unreadMapForHuman(spaceId, humanId)), true);
  }
  // Unified inbox: regular/private channels are implicit Human containers;
  // DMs and threads appear once they have Human cursor/follow state.
  if (p === "/api/channels/inbox" && method === "GET") {
    const filter = url.searchParams.get("filter") ?? "all";
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 30), 100);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
    const { states: myMems, channels: chs } = await humanContainerStates(spaceId);
    if (!myMems.length) return (sendJson(res, 200, { items: [] }), true);
    if (!chs.length) return (sendJson(res, 200, { items: [] }), true);
    const agentsAll = await db.select().from(schema.agents).where(and(
      eq(schema.agents.spaceId, spaceId),
      isNull(schema.agents.deletedAt),
    ));
    const items: any[] = [];
    for (const c of chs) {
      const cm = myMems.find((m) => m.channelId === c.id)!;
      const last = (await db.select().from(schema.messages).where(eq(schema.messages.channelId, c.id)).orderBy(desc(schema.messages.seq)).limit(1))[0];
      if (!last) continue; // empty channels are excluded from the inbox
      const [ur] = cm.threadDoneAt ? [] : await db.select({ n: count() }).from(schema.messages).where(and(eq(schema.messages.channelId, c.id), gt(schema.messages.seq, cm.lastReadSeq), notSentBy(humanId)));
      const unreadCount = Number(ur?.n ?? 0);
      let firstUnreadMessageId: string | null = null;
      let hasMention = false;
      if (unreadCount > 0) {
        const unread = await db.select({ id: schema.messages.id }).from(schema.messages).where(and(eq(schema.messages.channelId, c.id), gt(schema.messages.seq, cm.lastReadSeq), notSentBy(humanId))).orderBy(asc(schema.messages.seq));
        firstUnreadMessageId = unread[0]?.id ?? null;
        const [mc] = await db.select({ n: count() }).from(schema.messageMentions).where(and(inArray(schema.messageMentions.messageId, unread.map((u) => u.id)), eq(schema.messageMentions.mentionType, "human"), eq(schema.messageMentions.mentionId, humanId)));
        hasMention = Number(mc?.n ?? 0) > 0;
      }
      const kind = c.type === "dm" ? "dm" : c.type === "thread" ? "thread" : "channel";
      let channelName = c.name;
      // Thread entry: populate parent message/channel info so the frontend can navigate to the parent channel and expand the thread panel
      let parentMessageId: string | null = null, parentChannelId: string | null = null, parentChannelName: string | null = null;
      if (c.type === "dm") {
        const peerId = cm.dmAgentId;
        if (!peerId) continue;
        const src = agentsAll.find((agent) => agent.id === peerId);
        if (!src) continue;
        channelName = src.name;
      } else if (c.type === "thread" && c.parentMessageId) {
        parentMessageId = c.parentMessageId;
        const pm = (await db.select().from(schema.messages).where(eq(schema.messages.id, c.parentMessageId)))[0];
        if (pm) { parentChannelId = pm.channelId; const pch = (await db.select().from(schema.channels).where(eq(schema.channels.id, pm.channelId)))[0]; parentChannelName = pch?.name ?? null; }
      }
      items.push({
        kind, channelId: c.id, channelName, channelType: c.type,
        parentMessageId, parentChannelId, parentChannelName,
        lastMessageId: last.id, firstUnreadMessageId,
        lastMessageAt: last.createdAt, lastMessagePreview: (last.content ?? "").slice(0, 140),
        lastMessageSenderType: last.senderType, lastMessageSenderId: last.senderId, lastMessageSenderName: last.senderName,
        unreadCount, hasMention,
      });
    }
    items.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
    let filtered = items;
    if (filter === "unread") filtered = items.filter((i) => i.unreadCount > 0);
    // The Mentions tab is its own message-grained stream (GET /api/mentions below — every @ of me, read or
    // not), not a channel aggregate. hasMention above still drives the per-row @ badge on the all/unread tabs.
    return (sendJson(res, 200, { items: filtered.slice(offset, offset + limit) }), true);
  }
  // Mentions activity stream (GET /api/mentions?limit=&offset=): every message that @-mentions the current
  // Human — message-grained, read AND unread alike. The channel-aggregated inbox above only surfaces an @ that
  // still sits in an unread channel (hasMention is computed inside `if (unreadCount > 0)`), so a mention you've
  // already read vanishes from it. This is the canonical "who pinged me" history (Slack/Tag "Mentions &
  // reactions"), backed by mentions_target_idx (mention_type, mention_id). Human access is Space-authoritative;
  // human_channel_states supplies the personal read cursor separately.
  if (p === "/api/announcements/active" && method === "GET") return (sendJson(res, 200, { announcements: [] }), true);
  const cmem = /^\/api\/channels\/([^/]+)\/members$/.exec(p);
  if (cmem && method === "GET") {
    // Confirm the channel belongs to this Space before enumerating its agent roster.
    const own = (await db.select({ id: schema.channels.id }).from(schema.channels).where(and(eq(schema.channels.id, cmem[1]!), eq(schema.channels.spaceId, spaceId))))[0];
    if (!own) return (sendErr(res, 404, "channel not found"), true);
    // invariant 3: private/DM channel member list must not be accessible to non-members (IDOR-B2)
    if (!(await canHumanReadChannel(spaceId, cmem[1]!))) return (sendErr(res, 404, "channel not found"), true);
    const settings = await listChannelAgentResponseModes(spaceId, cmem[1]!);
    const settingByAgent = new Map(settings.map((setting) => [setting.agentId, setting]));
    const aIds = settings.map((setting) => setting.agentId);
    const ags = aIds.length ? await db.select().from(schema.agents).where(and(
      inArray(schema.agents.id, aIds),
      eq(schema.agents.spaceId, spaceId),
      isNull(schema.agents.deletedAt),
    )) : [];
    return (sendJson(res, 200, {
      agents: ags.map((a) => {
        const setting = settingByAgent.get(a.id)!;
        return {
          id: a.id,
          name: a.name,
          displayName: a.displayName,
          status: a.status,
          activity: a.activity,
          avatarUrl: a.avatarUrl,
          defaultResponseMode: setting.defaultResponseMode,
          responseModeOverride: setting.responseModeOverride,
          effectiveResponseMode: setting.effectiveResponseMode,
          responseModeSource: setting.responseModeSource,
        };
      }),
    }), true);
  }
  if (cmem && method === "POST") { // add an agent or the local Human to a channel
    const own = (await db.select({ id: schema.channels.id }).from(schema.channels).where(and(eq(schema.channels.id, cmem[1]!), eq(schema.channels.spaceId, spaceId))))[0];
    if (!own) return (sendErr(res, 404, "channel not found"), true); // and only this Space's channels
    await assertChannelWritable(spaceId, cmem[1]!);
    const b = await readJson(req);
    if (b.humanId !== undefined) return (sendErr(res, 400, "Human channel membership is not configurable"), true);
    const agentId = String(b.agentId ?? "").trim();
    if (!agentId) return (sendErr(res, 400, "agentId required"), true);
    const agent = (await db.select({ id: schema.agents.id }).from(schema.agents).where(and(
      eq(schema.agents.id, agentId),
      eq(schema.agents.spaceId, spaceId),
      isNull(schema.agents.deletedAt),
    )))[0];
    if (!agent) return (sendErr(res, 404, "agent not found"), true);
    await addChannelMembers(spaceId, cmem[1]!, [{ type: "agent", id: agent.id }]);
    await publish(spaceId, { type: "channel:members-updated", channelId: cmem[1]! }); // realtime: membership change → all clients refresh member/channel list and new member joins the room (G-E)
    return (sendJson(res, 200, { ok: true }), true);
  }
  if (cmem && method === "DELETE") { // remove an agent or the local Human from a channel
    const own = (await db.select({ id: schema.channels.id }).from(schema.channels).where(and(eq(schema.channels.id, cmem[1]!), eq(schema.channels.spaceId, spaceId))))[0];
    if (!own) return (sendErr(res, 404, "channel not found"), true);
    await assertChannelWritable(spaceId, cmem[1]!);
    const b = await readJson(req).catch(() => ({}));
    if (b.humanId !== undefined) return (sendErr(res, 400, "Human channel membership is not configurable"), true);
    const agentId = String(b.agentId ?? "").trim();
    if (!agentId) return (sendErr(res, 400, "agentId required"), true);
    await revokeChannelAgentAccess(spaceId, cmem[1]!, agentId);
    await publish(spaceId, { type: "channel:members-updated", channelId: cmem[1]! });
    return (sendJson(res, 200, { ok: true }), true);
  }
  const responseModeMember = /^\/api\/channels\/([^/]+)\/members\/([^/]+)$/.exec(p);
  if (responseModeMember && method === "PATCH") {
    const [, channelId, agentId] = responseModeMember;
    const channel = (await db.select().from(schema.channels).where(and(
      eq(schema.channels.id, channelId!),
      eq(schema.channels.spaceId, spaceId),
      isNull(schema.channels.deletedAt),
    )))[0];
    if (!channel || !(await canHumanReadChannel(spaceId, channelId!))) {
      return (sendErr(res, 404, "channel not found"), true);
    }
    if (channel.type === "dm" || channel.type === "thread") {
      return (sendErr(res, 400, "response mode overrides apply only to top-level channels", {
        code: "response_mode_not_applicable",
      }), true);
    }
    await assertChannelWritable(spaceId, channelId!);
    const body = await readJson(req).catch(() => ({}));
    try {
      const result = await setChannelAgentResponseModeOverride(
        spaceId,
        channelId!,
        agentId!,
        body?.responseModeOverride,
      );
      if (result.changed) {
        await publish(spaceId, {
          type: "agent:response-mode-updated",
          agentId: agentId!,
          channelId: channelId!,
        });
      }
      return (sendJson(res, 200, result.setting), true);
    } catch (error) {
      if (error instanceof AgentResponseSettingsError) {
        return (sendErr(res, error.statusCode, error.message, { code: error.code }), true);
      }
      throw error;
    }
  }
  // Attachment upload (multipart, fields: files + channelId) → save to disk + insert attachment row (messageId is backfilled when the message is sent)
  const cfiles = /^\/api\/channels\/([^/]+)\/files$/.exec(p);
  if (cfiles && method === "GET") {
    // invariant 3: private/DM channel file list must not be accessible to non-members (IDOR-B2)
    if (!(await canHumanReadChannel(spaceId, cfiles[1]!))) return (sendErr(res, 404, "channel not found"), true);
    const rows = await db.select({
      id: schema.attachments.id,
      messageId: schema.attachments.messageId,
      channelId: schema.attachments.channelId,
      uploaderType: schema.attachments.uploaderType,
      uploaderId: schema.attachments.uploaderId,
      filename: schema.attachments.filename,
      mimeType: schema.attachments.mimeType,
      sizeBytes: schema.attachments.sizeBytes,
      createdAt: schema.attachments.createdAt,
      sourceMessageText: schema.messages.content,
    }).from(schema.attachments)
      .innerJoin(schema.messages, and(
        eq(schema.attachments.messageId, schema.messages.id),
        eq(schema.messages.spaceId, spaceId),
        eq(schema.messages.channelId, cfiles[1]!),
      ))
      .where(and(eq(schema.attachments.channelId, cfiles[1]!), eq(schema.attachments.spaceId, spaceId), isNotNull(schema.attachments.messageId)))
      .orderBy(desc(schema.attachments.createdAt)).limit(100); // spaceId scope: don't list another Space's channel files by raw channel UUID
    const aIds = rows.filter((r) => r.uploaderType === "agent" && r.uploaderId).map((r) => r.uploaderId!) as string[];
    const ags = aIds.length ? await db.select().from(schema.agents).where(inArray(schema.agents.id, aIds)) : [];
    const human = getHumanIdentity();
    const who = (t: string | null, id: string | null) => t === "agent"
      ? ags.find((a) => a.id === id)
      : human?.id === id ? { name: human.handle, displayName: human.displayName } : null;
    return (sendJson(res, 200, {
      files: rows.map((a) => {
        const src: any = who(a.uploaderType, a.uploaderId);
        return { id: a.id, messageId: a.messageId, channelId: a.channelId, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes, width: null, height: null, thumbnailUrl: null, createdAt: a.createdAt, sourceMessageText: a.sourceMessageText, uploader: { type: a.uploaderType, id: a.uploaderId, name: src?.name ?? null, displayName: src?.displayName ?? null }, source: { type: "channel", channelId: a.channelId, parentMessageId: null } };
      }), nextCursor: null,
    }), true);
  }
  if (p === "/api/channels" && method === "POST") {
    const b = await readJson(req);
    if (Object.prototype.hasOwnProperty.call(b, "userIds")) {
      return (sendErr(res, 400, "Human channel membership is not configurable"), true);
    }
    if (Object.prototype.hasOwnProperty.call(b, "type")) {
      return (sendErr(res, 400, "channel type is retired; use visibility"), true);
    }
    const name = String(b.name ?? "").trim().replace(/^#/, "").toLowerCase().replace(/\s+/g, "-");
    if (!name) return (sendErr(res, 400, "name required"), true);
    const dup = (await db.select().from(schema.channels).where(and(eq(schema.channels.spaceId, spaceId), eq(schema.channels.name, name))))[0];
    if (dup && !dup.deletedAt) return (sendErr(res, 409, "channel name exists"), true);
    // Product input uses visibility; the database type remains the internal channel-kind discriminator.
    const type = b.visibility === "private" ? "private" : "channel";
    const [ch] = await db.insert(schema.channels).values({ spaceId, name, description: b.description ?? null, type }).returning();
    const agentIds = Array.isArray(b.agentIds) ? b.agentIds.filter(Boolean) : [];
    const members: { type: "agent"; id: string }[] = [];
    if (agentIds.length) {
      const valid = await db.select().from(schema.agents).where(and(eq(schema.agents.spaceId, spaceId), inArray(schema.agents.id, agentIds), isNull(schema.agents.deletedAt)));
      for (const agent of valid) members.push({ type: "agent", id: agent.id });
    }
    // Channel is brand-new (no messages yet → watermark is 0), but route through the same helper so every
    // agent membership insert shares one watermark-aware path instead of a raw insert that could drift.
    // Pass watermark:0 explicitly (it IS 0 on an empty channel) to skip a pointless channelMaxSeq roundtrip.
    await addChannelMembers(spaceId, ch!.id, members, { watermark: 0 });
    return (sendJson(res, 200, { id: ch!.id, name: ch!.name, type: ch!.type }), true);
  }
  if (p === "/api/channels/dm" && method === "POST") {
    const b = await readJson(req);
    if (b.humanId !== undefined) return (sendErr(res, 400, "Human-Human DM is not supported"), true);
    const agentId = String(b.agentId ?? "").trim();
    if (!agentId) return (sendErr(res, 400, "agentId required"), true);
    const agent = (await db.select({ id: schema.agents.id }).from(schema.agents).where(and(
      eq(schema.agents.id, agentId),
      eq(schema.agents.spaceId, spaceId),
      isNull(schema.agents.deletedAt),
    )))[0];
    if (!agent) return (sendErr(res, 404, "agent not found"), true);
    const channelId = await getOrCreateDM(spaceId, humanId, "human", agent.id, "agent");
    await publish(spaceId, { type: "dm:new", channelId, participantHumanIds: [humanId] });
    return (sendJson(res, 200, { id: channelId }), true);
  }
  const cnotification = /^\/api\/channels\/([^/]+)\/notification$/.exec(p);
  if (cnotification && (method === "GET" || method === "PATCH")) {
    const channelId = cnotification[1]!;
    const target = (await db.select({ id: schema.channels.id, deletedAt: schema.channels.deletedAt }).from(schema.channels)
      .where(and(eq(schema.channels.id, channelId), eq(schema.channels.spaceId, spaceId))))[0];
    if (!target || target.deletedAt || !(await canHumanReadChannel(spaceId, channelId))) {
      return (sendErr(res, 404, "channel not found"), true);
    }
    if (method === "GET") {
      return (sendJson(res, 200, { notificationLevel: await humanChannelNotificationLevel(spaceId, channelId) }), true);
    }
    await assertChannelWritable(spaceId, channelId);
    const b = await readJson(req).catch(() => ({}));
    const notificationLevel = String(b.notificationLevel ?? "");
    if (notificationLevel !== "all" && notificationLevel !== "mentions" && notificationLevel !== "none") {
      return (sendErr(res, 400, "notificationLevel must be all, mentions, or none"), true);
    }
    await setHumanChannelNotificationLevel(spaceId, channelId, notificationLevel);
    return (sendJson(res, 200, { notificationLevel }), true);
  }
  // Channel lifecycle: archive/unarchive/rename+description+visibility/delete. All gated by manageChannels.
  const cops = /^\/api\/channels\/([^/]+)\/(archive|unarchive)$/.exec(p);
  if (cops && method === "POST") {
    // Thread channels follow their parent message's lifecycle; direct archive/unarchive is not allowed.
    const archTarget = (await db.select().from(schema.channels)
      .where(and(eq(schema.channels.id, cops[1]!), eq(schema.channels.spaceId, spaceId))))[0];
    if (!archTarget || archTarget.deletedAt) return (sendErr(res, 404, "channel not found"), true);
    if (archTarget?.type === "thread") return (sendErr(res, 403, "thread channels cannot be archived directly"), true);
    if (cops[2] === "archive" && isRequiredChannel(archTarget)) {
      return (sendErr(res, 409, "# all is a required channel", { code: "required_channel" }), true);
    }
    await db.update(schema.channels).set({ archivedAt: cops[2] === "archive" ? new Date() : null }).where(and(eq(schema.channels.id, cops[1]!), eq(schema.channels.spaceId, spaceId)));
    await publish(spaceId, { type: "channel:updated", channelId: cops[1]! });
    return (sendJson(res, 200, { ok: true }), true);
  }
  const cone = /^\/api\/channels\/([^/]+)$/.exec(p);
  if (cone && (method === "PATCH" || method === "DELETE")) {
    // Fetch the channel first: thread channels must not be modified via this endpoint — their
    // lifecycle is managed by their parent message (getOrCreateThread / thread follow API).
    const targetCh = (await db.select().from(schema.channels)
      .where(and(eq(schema.channels.id, cone[1]!), eq(schema.channels.spaceId, spaceId))))[0];
    if (!targetCh || targetCh.deletedAt) return (sendErr(res, 404, "channel not found"), true);
    if (targetCh?.type === "thread") return (sendErr(res, 403, "thread channels cannot be modified directly"), true);
    if (method === "DELETE") {
      if (isRequiredChannel(targetCh)) return (sendErr(res, 409, "# all is a required channel", { code: "required_channel" }), true);
      await db.update(schema.channels).set({ deletedAt: new Date() }).where(and(eq(schema.channels.id, cone[1]!), eq(schema.channels.spaceId, spaceId))); // soft delete
      await publish(spaceId, { type: "channel:deleted", channelId: cone[1]! });
      return (sendJson(res, 200, { ok: true }), true);
    }
    const b = await readJson(req).catch(() => ({})); const patch: Record<string, unknown> = {};
    if (isRequiredChannel(targetCh) && (b.name !== undefined || b.visibility !== undefined)) {
      return (sendErr(res, 409, "# all is a required channel", { code: "required_channel" }), true);
    }
    await assertChannelWritable(spaceId, targetCh.id);
    if (b.name) patch.name = String(b.name).trim().replace(/^#/, "").toLowerCase().replace(/\s+/g, "-");
    if (b.description !== undefined) patch.description = b.description;
    if (b.visibility) patch.type = b.visibility === "private" ? "private" : "channel";
    if (Object.keys(patch).length) await db.update(schema.channels).set(patch).where(and(eq(schema.channels.id, cone[1]!), eq(schema.channels.spaceId, spaceId)));
    await publish(spaceId, { type: "channel:updated", channelId: cone[1]! });
    return (sendJson(res, 200, { ok: true }), true);
  }
  const cread = /^\/api\/channels\/([^/]+)\/read$/.exec(p);
  if (cread && method === "POST") {
    const chId = cread[1]!;
    const ch = (await db.select().from(schema.channels).where(and(eq(schema.channels.id, chId!), eq(schema.channels.spaceId, spaceId))))[0];
    if (!ch) return (sendErr(res, 404, "channel not found"), true);
    const b = await readJson(req).catch(() => ({}));
    let seq = Number(b?.seq ?? 0);
    if (!seq) { const [m] = await db.select({ s: schema.messages.seq }).from(schema.messages).where(eq(schema.messages.channelId, chId)).orderBy(desc(schema.messages.seq)).limit(1); seq = Number(m?.s ?? 0); }
    await markHumanChannelRead(spaceId, chId, seq);
    const parentId = ch.type === "thread" ? await parentChannelIdForThread(spaceId, ch) : chId;
    const remaining = parentId ? ((await unreadMapForHuman(spaceId, humanId))[parentId] ?? 0) : 0;
    return (sendJson(res, 200, { ok: true, channelId: parentId, unread: remaining }), true);
  }
  return false;
}
