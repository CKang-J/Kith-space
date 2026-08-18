// Auto-extracted from the former routes-api.ts monolith — bodies are verbatim.
import type { SpaceCtx } from "./ctx.js";
import { and, asc, desc, eq, gt, like, inArray, lt, sql } from "drizzle-orm";
import { dbForSpace, schema } from "../../db/index.js";
import { addReaction, checkSaved, createMessage, listSaved, removeReaction, saveMessage, unsaveMessage } from "../core.js";
import { parseMsgPageParams } from "../messagePage.js";
import { escapeLikePattern, loadMessageSearchPresentation, messageSearchDisplay, messageSearchSnippet } from "../messageSearchPresentation.js";
import { publish } from "../realtime.js";
import { readJson, sendErr, sendJson } from "../util.js";
import { attachMentions, humanChannels } from "./shared.js";
import { canHumanReadChannel } from "../channelAccess.js";
import { humanIdentityForId } from "../../human/humanIdentity.js";
import { activeChannels, assertChannelWritable } from "../../channels/channelLifecycle.js";
import { sendTaskOperationError } from "../tasks/taskHttp.js";
import { isMessageExecutionBindingError } from "../../messages/messageExecutionBinding.js";
import { CanvasNotFoundError, CanvasValidationError } from "../../canvas/canvasCore.js";
import { inspectHumanMessagePost, validateHumanMessagePost } from "./messagePostValidation.js";

export async function handleMessages(ctx: SpaceCtx): Promise<boolean> {
  const { req, res, url, method, p, humanId, spaceId } = ctx;
  const db = dbForSpace(spaceId);
  if (p === "/api/mentions" && method === "GET") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 30), 100);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
    const activeChannelIds = (await activeChannels(spaceId, await db.select().from(schema.channels)
      .where(eq(schema.channels.spaceId, spaceId)))).map((channel) => channel.id);
    if (!activeChannelIds.length) return (sendJson(res, 200, { items: [], hasMore: false }), true);
    const rows = await db
      .select({
        messageId: schema.messages.id, seq: schema.messages.seq, content: schema.messages.content, createdAt: schema.messages.createdAt,
        senderType: schema.messages.senderType, senderId: schema.messages.senderId, senderName: schema.messages.senderName,
        channelId: schema.channels.id, channelName: schema.channels.name, channelType: schema.channels.type, parentMessageId: schema.channels.parentMessageId,
        lastReadSeq: schema.humanChannelStates.lastReadSeq,
      })
      .from(schema.messageMentions)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.messageMentions.messageId))
      .innerJoin(schema.channels, eq(schema.channels.id, schema.messages.channelId))
      .leftJoin(schema.humanChannelStates, eq(schema.humanChannelStates.channelId, schema.channels.id))
      .where(and(
        eq(schema.messageMentions.mentionType, "human"),
        eq(schema.messageMentions.mentionId, humanId),
        eq(schema.channels.spaceId, spaceId),
        inArray(schema.channels.id, activeChannelIds),
      ))
      .orderBy(desc(schema.messages.seq))
      .limit(limit + 1).offset(offset); // fetch one extra row to detect a next page without a second COUNT (Saved-style hasMore)
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    // Thread mentions: resolve the parent channel so a row can deep-link to the parent channel + open the thread panel.
    const parentMsgIds = [...new Set(page.filter((r) => r.channelType === "thread" && r.parentMessageId).map((r) => r.parentMessageId!))];
    const parentMsgs = parentMsgIds.length ? await db.select().from(schema.messages).where(inArray(schema.messages.id, parentMsgIds)) : [];
    const parentChs = parentMsgs.length ? await db.select().from(schema.channels).where(inArray(schema.channels.id, [...new Set(parentMsgs.map((m) => m.channelId))])) : [];
    const mitems = page.map((r) => {
      let parentChannelId: string | null = null, parentChannelName: string | null = null;
      if (r.channelType === "thread" && r.parentMessageId) {
        const pm = parentMsgs.find((m) => m.id === r.parentMessageId);
        if (pm) { parentChannelId = pm.channelId; parentChannelName = parentChs.find((c) => c.id === pm.channelId)?.name ?? null; }
      }
      // dm channel.name is an internal composite id; a DM mention always comes from the peer, so label it with the sender.
      const channelName = r.channelType === "dm" ? r.senderName : r.channelType === "thread" ? (parentChannelName ?? r.channelName) : r.channelName;
      return {
        messageId: r.messageId, channelId: r.channelId, channelName, channelType: r.channelType,
        parentMessageId: r.channelType === "thread" ? r.parentMessageId : null, parentChannelId, parentChannelName,
        senderType: r.senderType, senderId: r.senderId, senderName: r.senderName,
        preview: (r.content ?? "").slice(0, 140), createdAt: r.createdAt, seq: r.seq,
        read: r.seq <= (r.lastReadSeq ?? 0),
      };
    });
    return (sendJson(res, 200, { items: mitems, hasMore }), true);
  }
  // ── Saved messages / bookmarks (/channels/saved; envelope {saved[], hasMore}) ──
  // List: query {limit=20, offset}; envelope {saved[], hasMore}
  if (p === "/api/channels/saved" && method === "GET") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
    return (sendJson(res, 200, await listSaved(spaceId, limit, offset)), true);
  }
  // Save: body {messageId}; idempotent (unique index deduplicates).
  if (p === "/api/channels/saved" && method === "POST") {
    const b = await readJson(req).catch(() => ({}));
    const messageId = String(b.messageId ?? "").trim();
    if (!messageId) return (sendErr(res, 400, "messageId required"), true);
    const m = (await db.select().from(schema.messages).where(and(eq(schema.messages.id, messageId), eq(schema.messages.spaceId, spaceId))))[0];
    if (!m) return (sendErr(res, 404, "message not found"), true);
    if (!(await canHumanReadChannel(spaceId, m.channelId))) return (sendErr(res, 404, "message not found"), true);
    await saveMessage(spaceId, messageId);
    return (sendJson(res, 200, { ok: true }), true);
  }
  // Bulk saved check: body {messageIds[]} → {savedIds[]}
  if (p === "/api/channels/saved/check" && method === "POST") {
    const b = await readJson(req).catch(() => ({}));
    const ids = Array.isArray(b.messageIds) ? b.messageIds.map((x: unknown) => String(x)) : [];
    const savedIds = await checkSaved(spaceId, ids);
    return (sendJson(res, 200, { savedIds }), true);
  }
  // Unsave: DELETE /channels/saved/:messageId
  const cunsave = /^\/api\/channels\/saved\/([^/]+)$/.exec(p);
  if (cunsave && method === "DELETE") {
    await unsaveMessage(spaceId, cunsave[1]!);
    return (sendJson(res, 200, { ok: true }), true);
  }
  // Contract stub (returns empty response for unbuilt features): active announcements
  if (p === "/api/messages/search" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim();
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 50);
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
    if (!q) return (sendJson(res, 200, { hasMore: false, results: [] }), true);
    const chIds = (await activeChannels(spaceId, await humanChannels(spaceId))).map((channel) => channel.id);
    if (!chIds.length) return (sendJson(res, 200, { hasMore: false, results: [] }), true);
    const escapedQuery = escapeLikePattern(q);
    const rows = await db.select().from(schema.messages)
      .where(and(
        eq(schema.messages.spaceId, spaceId),
        inArray(schema.messages.channelId, chIds),
        sql`${schema.messages.content} LIKE ${`%${escapedQuery}%`} ESCAPE '\\'`,
      ))
      .orderBy(desc(schema.messages.seq)).limit(limit + 1).offset(offset);
    const hasMore = rows.length > limit;
    const presentation = await loadMessageSearchPresentation(spaceId, chIds);
    const serialized = await attachMentions(spaceId, rows.slice(0, limit));
    const results = serialized.map((m) => ({
        id: m.id, seq: m.seq, channelId: m.channelId,
        ...messageSearchDisplay(m, presentation),
        senderType: m.senderType, senderName: m.senderName, senderDeleted: m.senderDeleted,
        content: m.content, snippet: messageSearchSnippet(m.content, q), createdAt: m.createdAt,
      }));
    return (sendJson(res, 200, { hasMore, results }), true);
  }
  const cmsg = /^\/api\/messages\/channel\/([^/]+)$/.exec(p);
  if (cmsg && method === "GET") {
    if (!(await canHumanReadChannel(spaceId, cmsg[1]!))) return (sendErr(res, 403, "forbidden"), true);
    const { limit, before } = parseMsgPageParams(url.searchParams); // `before` = keyset cursor on seq → the older page (frontend scroll-to-top "load more")
    const conds = [eq(schema.messages.spaceId, spaceId), eq(schema.messages.channelId, cmsg[1]!)]; // spaceId scope: a foreign channel UUID must not read another Space's messages
    if (before != null) conds.push(lt(schema.messages.seq, before)); // hits messages_channel_idx (channelId, seq) — keyset, no offset drift
    const rows = await db.select().from(schema.messages).where(and(...conds)).orderBy(desc(schema.messages.seq)).limit(limit + 1); // +1 sentinel row: detect a further page without the exact-page-boundary false positive (mirrors the search/mentions routes)
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return (sendJson(res, 200, { messages: (await attachMentions(spaceId, page.reverse())), hasMore }), true);
  }
  if (p === "/api/messages" && method === "POST") {
    const b = await readJson(req);
    const invalid = validateHumanMessagePost(b);
    if (invalid) return (sendErr(res, 400, invalid), true);
    const { hasAtt, mode } = inspectHumanMessagePost(b);
    if (!(await canHumanReadChannel(spaceId, b.channelId))) return (sendErr(res, 403, "forbidden"), true);
    const human = humanIdentityForId(humanId);
    if (!human) return (sendErr(res, 403, "not the local Human"), true);
    try {
      const msg = await createMessage({
        spaceId,
        channelId: b.channelId,
        senderType: "human",
        senderId: humanId,
        senderName: human.displayName,
        content: b.content || "",
        asTask: !!b.asTask,
        taskExecutionMode: mode ?? undefined,
        attachmentIds: hasAtt ? b.attachmentIds : undefined,
        contextSnapshot: b.contextSnapshot,
        memoryPolicy: b.memoryPolicy ?? "eligible",
        canvasSelection: b.canvasSelection,
        canvasSelections: b.canvasSelections,
        executionBinding: b.executionBinding,
        structuredMentions: b.structuredMentions,
      });
      return (sendJson(res, 200, { ok: true, id: msg.id, seq: msg.seq }), true);
    } catch (error) {
      if (sendTaskOperationError(res, error)) return true;
      if (isMessageExecutionBindingError(error)) {
        return (sendErr(res, error.code === "INVALID_ARGUMENT" ? 400 : 409, error.message, { code: error.code }), true);
      }
      if (error instanceof CanvasNotFoundError) return (sendErr(res, 404, error.message, { code: "NOT_FOUND" }), true);
      if (error instanceof CanvasValidationError) return (sendErr(res, 400, error.message, { code: "INVALID_ARGUMENT" }), true);
      throw error;
    }
  }
  // Emoji reactions: POST to add / DELETE to remove, same path body {emoji}; both broadcast message:updated (full message including reactions[])
  const react = /^\/api\/messages\/([^/]+)\/reactions$/.exec(p);
  if (react && (method === "POST" || method === "DELETE")) {
    const b = await readJson(req).catch(() => ({}));
    const emoji = String(b.emoji ?? "").trim();
    if (!emoji) return (sendErr(res, 400, "emoji required"), true);
    const m = (await db.select().from(schema.messages).where(and(eq(schema.messages.id, react[1]!), eq(schema.messages.spaceId, spaceId))))[0];
    if (!m) return (sendErr(res, 404, "message not found"), true);
    // invariant 3: non-members must not react to messages in private/DM channels (IDOR-B2)
    if (!(await canHumanReadChannel(spaceId, m.channelId))) return (sendErr(res, 404, "message not found"), true);
    await assertChannelWritable(spaceId, m.channelId);
    const out = method === "POST" ? await addReaction(spaceId, react[1]!, "human", humanId, emoji) : await removeReaction(spaceId, react[1]!, "human", humanId, emoji);
    return (sendJson(res, 200, out), true);
  }
  // Mark action card as executed (POST /actions/:messageId/mark-executed).
  // Actual creation goes through existing POST /api/channels|/api/agents (as user); this endpoint only marks the card as executed and leaves an audit trail; no new privileged execution path.
  const amark = /^\/api\/actions\/([^/]+)\/mark-executed$/.exec(p);
  if (amark && method === "POST") {
    const b = await readJson(req).catch(() => ({}));
    const m = (await db.select().from(schema.messages).where(and(eq(schema.messages.id, amark[1]!), eq(schema.messages.spaceId, spaceId))))[0];
    if (!m) return (sendErr(res, 404, "action not found"), true);
    if (!(await canHumanReadChannel(spaceId, m.channelId))) return (sendErr(res, 404, "action not found"), true);
    await assertChannelWritable(spaceId, m.channelId);
    const meta = m.actionMetadata as any;
    if (!meta || meta.kind !== "action-card") return (sendErr(res, 400, "not an action card"), true);
    if (meta.state === "executed") return (sendJson(res, 200, { ok: true, already: true }), true); // idempotent
    const human = humanIdentityForId(humanId);
    const updated = { ...meta, state: "executed", executedAt: new Date().toISOString(), executedByUserId: humanId, executedByUserName: human?.displayName ?? "someone", result: b.result ?? null };
    await db.update(schema.messages).set({ actionMetadata: updated, updatedAt: new Date() }).where(eq(schema.messages.id, m.id));
    const [serialized] = await attachMentions(spaceId, [{ ...m, actionMetadata: updated }]);
    await publish(spaceId, { type: "message:updated", message: serialized });
    return (sendJson(res, 200, { ok: true }), true);
  }
  if (p === "/api/messages/sync" && method === "GET") {
    const since = Number(url.searchParams.get("since") ?? 0);
    const chIds = (await activeChannels(spaceId, await humanChannels(spaceId))).map((c) => c.id);
    if (!chIds.length) return (sendJson(res, 200, { messages: [], maxSeq: since }), true);
    const msgs = await db.select().from(schema.messages).where(and(eq(schema.messages.spaceId, spaceId), gt(schema.messages.seq, since), inArray(schema.messages.channelId, chIds))).orderBy(asc(schema.messages.seq)).limit(500);
    const withM = await attachMentions(spaceId, msgs);
    return (sendJson(res, 200, { messages: withM, maxSeq: msgs.length ? msgs[msgs.length - 1]!.seq : since }), true);
  }
  // Single message by id (serialized like the channel feed). Lets the client open a thread panel whose parent
  // message isn't in the loaded page (the "jump to unread thread" banner). Declared after /search and /sync so
  // the bare-id regex never shadows them. Space-scoped + channel-read gated (invariant 3).
  const cone = /^\/api\/messages\/([^/]+)$/.exec(p);
  if (cone && method === "GET") {
    const m = (await db.select().from(schema.messages).where(and(eq(schema.messages.id, cone[1]!), eq(schema.messages.spaceId, spaceId))))[0];
    if (!m) return (sendErr(res, 404, "message not found"), true);
    if (!(await canHumanReadChannel(spaceId, m.channelId))) return (sendErr(res, 404, "message not found"), true);
    const [serialized] = await attachMentions(spaceId, [m]);
    return (sendJson(res, 200, { message: serialized }), true);
  }
  return false;
}
