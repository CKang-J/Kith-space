import { and, asc, desc, eq, gt, inArray, like, lt } from "drizzle-orm";
import { decideAgentMessageResponse } from "../../agents/agentResponseDelivery.js";
import { resolveAgentResponseMode } from "../../agents/agentResponseSettings.js";
import { activeChannels, assertChannelWritable, channelLifecycleState } from "../../channels/channelLifecycle.js";
import { dbForSpace, schema } from "../../db/index.js";
import { agentIntroductionTokenStatus } from "../agentIntroduction.js";
import {
  AgentIntroductionTokenRejectedError,
  addReaction,
  canAgentReadChannel,
  createMessage,
  removeReaction,
  resolveMessageId,
  resolveTarget,
} from "../core.js";
import { agentIntroductionTokenHeader, readJson, sendErr, sendJson } from "../util.js";
import {
  addressableTarget,
  agentChannels,
  formatAgentMessage,
  serializeAgentMessage,
  type AgentHttpContext,
} from "./context.js";

const drafts = new Map<string, { content: string; attachmentIds: string[] }>();

export async function handleMessagesContextModule(context: AgentHttpContext): Promise<boolean> {
  const { req, res, url, method, path, agent, spaceId } = context;
  const db = dbForSpace(spaceId);

  if (path === "/agent-api/message/check" && method === "GET") {
    const memberships = await agentChannels(spaceId, agent.id);
    const messages: unknown[] = [];
    for (const membership of memberships) {
      const channel = db.select().from(schema.channels)
        .where(eq(schema.channels.id, membership.channelId)).get();
      if (!channel || await channelLifecycleState(spaceId, channel.id) !== "active") continue;
      const unread = db.select().from(schema.messages).where(and(
        eq(schema.messages.channelId, membership.channelId),
        gt(schema.messages.seq, membership.lastReadSeq),
      )).orderBy(asc(schema.messages.seq)).limit(100).all();
      const fresh = unread.filter((message) => message.senderId !== agent.id);
      if (fresh.length) {
        const target = await addressableTarget(spaceId, channel, agent.id);
        const responseMode = await resolveAgentResponseMode(spaceId, channel.id, agent.id);
        const mentionRows = db.select({ messageId: schema.messageMentions.messageId })
          .from(schema.messageMentions).where(and(
            inArray(schema.messageMentions.messageId, fresh.map((message) => message.id)),
            eq(schema.messageMentions.mentionType, "agent"),
            eq(schema.messageMentions.mentionId, agent.id),
          )).all();
        const mentionedMessages = new Set(mentionRows.map((row) => row.messageId));
        const parentTask = channel.type === "thread" && channel.parentMessageId
          ? db.select({ taskAssigneeId: schema.messages.taskAssigneeId }).from(schema.messages)
              .where(eq(schema.messages.id, channel.parentMessageId)).get()
          : null;
        const attachments = db.select().from(schema.attachments)
          .where(inArray(schema.attachments.messageId, fresh.map((message) => message.id))).all();
        const attachmentsByMessage = new Map<string, { filename: string; id: string }[]>();
        for (const attachment of attachments) {
          const rows = attachmentsByMessage.get(attachment.messageId!) ?? [];
          rows.push({ filename: attachment.filename, id: attachment.id });
          attachmentsByMessage.set(attachment.messageId!, rows);
        }
        messages.push(...fresh.map((message) => {
          const decision = decideAgentMessageResponse({
            agentId: agent.id,
            channelType: channel.type as "channel" | "private" | "dm" | "thread",
            senderType: message.senderType as "human" | "agent" | "system",
            effectiveMode: responseMode?.effectiveResponseMode ?? "active",
            messageSeq: message.seq,
            mentioned: mentionedMessages.has(message.id),
            taskAssigneeId: message.taskStatus ? message.taskAssigneeId : null,
            parentTaskAssigneeId: parentTask?.taskAssigneeId ?? null,
            isTask: Boolean(message.taskStatus),
            ambientWakeAfterSeq: responseMode?.ambientWakeAfterSeq ?? membership.ambientWakeAfterSeq,
            mentionWakeAfterSeq: responseMode?.mentionWakeAfterSeq ?? membership.mentionWakeAfterSeq,
          });
          return {
            ...serializeAgentMessage(message),
            responseDirective: decision.directive,
            responseReason: decision.reason,
            text: formatAgentMessage(message, target, attachmentsByMessage.get(message.id) ?? [], decision.directive),
          };
        }));
      }
      if (unread.length) {
        db.update(schema.channelAgentMembers).set({ lastReadSeq: unread[unread.length - 1]!.seq }).where(and(
          eq(schema.channelAgentMembers.channelId, membership.channelId),
          eq(schema.channelAgentMembers.agentId, agent.id),
        )).run();
      }
    }
    sendJson(res, 200, { messages });
    return true;
  }

  if (path === "/agent-api/message/send" && method === "POST") {
    const body = await readJson(req);
    const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.filter(Boolean) : [];
    if (!body.target) return (sendErr(res, 400, "target required"), true);
    const target = await resolveTarget(spaceId, body.target, agent.id);
    if (!target) return (sendErr(res, 404, "target not found", { code: "TARGET_FAILED" }), true);
    const draftKey = `${agent.id}:${target.channelId}`;
    const post = async (content: string, ids: string[]) => {
      drafts.delete(draftKey);
      const humanDm = target.threadId == null && Boolean(db.select({ dmAgentId: schema.humanChannelStates.dmAgentId })
        .from(schema.humanChannelStates).where(and(
          eq(schema.humanChannelStates.channelId, target.channelId),
          eq(schema.humanChannelStates.dmAgentId, agent.id),
        )).limit(1).get());
      const introductionToken = agentIntroductionTokenHeader(req);
      const introductionStatus = introductionToken
        ? agentIntroductionTokenStatus(spaceId, agent.id, introductionToken)
        : null;
      if (introductionToken && (introductionStatus !== "active" || !humanDm)) {
        sendErr(res, 409, "introduction turn is no longer active; restart the agent to retry");
        return true;
      }
      try {
        const message = await createMessage({
          spaceId,
          channelId: target.channelId,
          senderType: "agent",
          senderId: agent.id,
          senderName: agent.name,
          content,
          threadId: target.threadId,
          attachmentIds: ids.length ? ids : undefined,
          introductionAgentId: humanDm && introductionStatus === "active" ? agent.id : undefined,
          introductionToken: humanDm && introductionStatus === "active" ? introductionToken! : undefined,
        });
        sendJson(res, 200, { ok: true, id: message.id, seq: message.seq, target: body.target });
        return true;
      } catch (error) {
        if (error instanceof AgentIntroductionTokenRejectedError) {
          sendErr(res, 409, "introduction turn is no longer active; restart the agent to retry");
          return true;
        }
        throw error;
      }
    };
    if (body.sendDraft) {
      const draft = drafts.get(draftKey);
      const content = draft?.content ?? body.content ?? "";
      const ids = draft?.attachmentIds?.length ? draft.attachmentIds : attachmentIds;
      if (!content && !ids.length) return (sendErr(res, 400, "no draft to send"), true);
      return post(content, ids);
    }
    if (!body.content && !attachmentIds.length) {
      return (sendErr(res, 400, "target + content (or attachmentIds) required"), true);
    }
    const membership = db.select().from(schema.channelAgentMembers).where(and(
      eq(schema.channelAgentMembers.channelId, target.channelId),
      eq(schema.channelAgentMembers.agentId, agent.id),
    )).get();
    const newer = db.select().from(schema.messages).where(and(
      eq(schema.messages.channelId, target.channelId),
      gt(schema.messages.seq, membership?.lastReadSeq ?? 0),
    )).orderBy(asc(schema.messages.seq)).limit(20).all()
      .filter((message) => message.senderId !== agent.id && message.senderType !== "system");
    if (newer.length && membership) {
      drafts.set(draftKey, { content: body.content || "", attachmentIds });
      db.update(schema.channelAgentMembers).set({ lastReadSeq: newer[newer.length - 1]!.seq }).where(and(
        eq(schema.channelAgentMembers.channelId, target.channelId),
        eq(schema.channelAgentMembers.agentId, agent.id),
      )).run();
      const channel = db.select().from(schema.channels).where(eq(schema.channels.id, target.channelId)).get()!;
      const targetName = await addressableTarget(spaceId, channel, agent.id);
      const count = newer.length;
      const plural = count > 1 ? "s" : "";
      const history = newer.map((message) => formatAgentMessage(message, targetName)).join("\n");
      const text = `Freshness hold: showing latest ${count} of ${count} newer message${plural}.\nYour message has been saved as a draft. Review the bounded context shown here, then choose one path.\n\n## Message History for ${targetName} (${count} message${plural})\n\n${history}\n\nTo update the draft, send revised content normally:\n  kith-space message send --target "${body.target}" <<'MSG'\n  revised message\n  MSG\nTo send the current draft unchanged:\n  kith-space message send --send-draft --target "${body.target}"`;
      sendJson(res, 200, {
        held: true,
        draft: true,
        newerCount: count,
        messages: newer.map((message) => ({
          ...serializeAgentMessage(message),
          text: formatAgentMessage(message, targetName),
        })),
        text,
      });
      return true;
    }
    return post(body.content || "", attachmentIds);
  }

  if (path === "/agent-api/message/react" && method === "POST") {
    const body = await readJson(req);
    const emoji = String(body.emoji ?? "").trim();
    if (!body.messageId || !emoji) return (sendErr(res, 400, "messageId + emoji required"), true);
    const messageId = await resolveMessageId(spaceId, body.messageId, agent.id);
    if (!messageId) return (sendErr(res, 404, "message not found"), true);
    const message = db.select({ channelId: schema.messages.channelId }).from(schema.messages)
      .where(eq(schema.messages.id, messageId)).get();
    if (!message) return (sendErr(res, 404, "message not found"), true);
    await assertChannelWritable(spaceId, message.channelId);
    const result = body.remove
      ? await removeReaction(spaceId, messageId, "agent", agent.id, emoji)
      : await addReaction(spaceId, messageId, "agent", agent.id, emoji);
    sendJson(res, 200, { ok: true, reactions: result?.reactions ?? [] });
    return true;
  }

  if (path === "/agent-api/message/read" && method === "GET") {
    const rawTarget = url.searchParams.get("channel") ?? "";
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);
    const target = await resolveTarget(spaceId, rawTarget, agent.id);
    if (!target) return (sendErr(res, 404, "channel not found"), true);
    const channel = db.select().from(schema.channels).where(eq(schema.channels.id, target.channelId)).get();
    const targetName = channel ? await addressableTarget(spaceId, channel, agent.id) : rawTarget;
    const anchorParam = url.searchParams.get("around") ?? url.searchParams.get("before") ?? url.searchParams.get("after");
    const channelCondition = eq(schema.messages.channelId, target.channelId);
    let rows: (typeof schema.messages.$inferSelect)[];
    if (anchorParam) {
      let anchorSeq = /^\d+$/.test(anchorParam) ? Number(anchorParam) : null;
      if (anchorSeq == null) {
        const anchorId = await resolveMessageId(spaceId, anchorParam, agent.id);
        anchorSeq = anchorId
          ? db.select({ seq: schema.messages.seq }).from(schema.messages)
              .where(eq(schema.messages.id, anchorId)).get()?.seq ?? null
          : null;
      }
      if (anchorSeq == null) return (sendErr(res, 404, "anchor message not found"), true);
      if (url.searchParams.get("after")) {
        rows = db.select().from(schema.messages).where(and(channelCondition, gt(schema.messages.seq, anchorSeq)))
          .orderBy(asc(schema.messages.seq)).limit(limit).all();
      } else if (url.searchParams.get("before")) {
        rows = db.select().from(schema.messages).where(and(channelCondition, lt(schema.messages.seq, anchorSeq)))
          .orderBy(desc(schema.messages.seq)).limit(limit).all().reverse();
      } else {
        const half = Math.max(1, Math.floor(limit / 2));
        const before = db.select().from(schema.messages).where(and(channelCondition, lt(schema.messages.seq, anchorSeq)))
          .orderBy(desc(schema.messages.seq)).limit(half).all().reverse();
        const fromAnchor = db.select().from(schema.messages).where(and(channelCondition, gt(schema.messages.seq, anchorSeq - 1)))
          .orderBy(asc(schema.messages.seq)).limit(limit - before.length).all();
        rows = [...before, ...fromAnchor];
      }
    } else {
      rows = db.select().from(schema.messages).where(channelCondition)
        .orderBy(desc(schema.messages.seq)).limit(limit).all().reverse();
    }
    sendJson(res, 200, {
      messages: rows.map((message) => ({
        ...serializeAgentMessage(message),
        text: formatAgentMessage(message, targetName),
      })),
    });
    return true;
  }

  if (path === "/agent-api/search" && method === "GET") {
    const query = (url.searchParams.get("q") || url.searchParams.get("query") || "").trim();
    if (!query) return (sendErr(res, 400, "q required"), true);
    const joined = (await agentChannels(spaceId, agent.id)).map((membership) => membership.channelId);
    if (!joined.length) return (sendJson(res, 200, { results: [] }), true);
    const active = new Set((await activeChannels(spaceId, db.select().from(schema.channels).where(and(
      eq(schema.channels.spaceId, spaceId),
      inArray(schema.channels.id, joined),
    )).all())).map((channel) => channel.id));
    if (!active.size) return (sendJson(res, 200, { results: [] }), true);
    const rows = db.select().from(schema.messages).where(and(
      eq(schema.messages.spaceId, spaceId),
      inArray(schema.messages.channelId, [...active]),
      like(schema.messages.content, `%${query}%`),
    )).orderBy(desc(schema.messages.seq)).limit(20).all();
    sendJson(res, 200, {
      results: rows.map((message) => ({
        id: message.id,
        channelId: message.channelId,
        senderType: message.senderType,
        senderName: message.senderName,
        content: message.content,
        createdAt: message.createdAt,
      })),
    });
    return true;
  }

  if (path === "/agent-api/message/resolve" && method === "GET") {
    const raw = (url.searchParams.get("id") || "").trim();
    if (!raw) return (sendErr(res, 400, "id required"), true);
    const message = db.select().from(schema.messages).where(and(
      eq(schema.messages.spaceId, spaceId),
      raw.length >= 32 ? eq(schema.messages.id, raw) : like(schema.messages.id, `${raw.toLowerCase()}%`),
    )).get();
    if (!message || !(await canAgentReadChannel(spaceId, message.channelId, agent.id))) {
      return (sendErr(res, 404, "message not found", { code: "RESOLVE_FAILED" }), true);
    }
    const channel = db.select().from(schema.channels).where(eq(schema.channels.id, message.channelId)).get();
    sendJson(res, 200, {
      ...serializeAgentMessage(message),
      text: formatAgentMessage(
        message,
        channel ? await addressableTarget(spaceId, channel, agent.id) : message.channelId,
      ),
    });
    return true;
  }

  return false;
}
