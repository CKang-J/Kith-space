import { and, asc, eq } from "drizzle-orm";
import { assertChannelWritable } from "../../channels/channelLifecycle.js";
import { dbForSpace, schema } from "../../db/index.js";
import {
  addChannelMembers,
  channelMembers,
  createMessage,
  resolveTarget,
} from "../core.js";
import { threadModule } from "../threadModuleAdapter.js";
import { readJson, sendErr, sendJson } from "../util.js";
import {
  findParentMessage,
  formatAgentMessage,
  serializeAgentMessage,
  type AgentHttpContext,
} from "./context.js";

export async function handleChannelsThreadsModule(context: AgentHttpContext): Promise<boolean> {
  const { req, res, url, method, path, agent, spaceId } = context;
  const db = dbForSpace(spaceId);

  if (path === "/agent-api/channel/join" && method === "POST") {
    const body = await readJson(req);
    const name = String(body.target ?? "").replace(/^#/, "");
    const channel = db.select().from(schema.channels).where(and(
      eq(schema.channels.spaceId, spaceId),
      eq(schema.channels.name, name),
    )).get();
    if (!channel) return (sendErr(res, 404, "channel not found"), true);
    if (channel.type !== "channel") {
      return (sendErr(res, 403, "private channels, DMs, and threads cannot be self-joined"), true);
    }
    await assertChannelWritable(spaceId, channel.id);
    await addChannelMembers(spaceId, channel.id, [{ type: "agent", id: agent.id }]);
    sendJson(res, 200, { ok: true, joined: name });
    return true;
  }

  if (path === "/agent-api/thread/reply" && method === "POST") {
    const body = await readJson(req);
    if (!body.parent || !body.content) return (sendErr(res, 400, "parent + content required"), true);
    const parent = await findParentMessage(context, body.parent, body.channel ?? body.target ?? null);
    if (!parent) return (sendErr(res, 404, "parent message not found"), true);
    const thread = await threadModule.getOrCreateThread(spaceId, parent.id, { type: "agent", id: agent.id });
    const message = await createMessage({
      spaceId,
      channelId: thread.id,
      senderType: "agent",
      senderId: agent.id,
      senderName: agent.name,
      content: body.content,
    });
    sendJson(res, 200, { ok: true, threadChannelId: thread.id, id: message.id, seq: message.seq });
    return true;
  }

  if (path === "/agent-api/thread/read" && method === "GET") {
    const parent = await findParentMessage(
      context,
      url.searchParams.get("parent") ?? "",
      url.searchParams.get("channel"),
    );
    if (!parent) return (sendErr(res, 404, "parent message not found"), true);
    const thread = db.select().from(schema.channels).where(and(
      eq(schema.channels.spaceId, spaceId),
      eq(schema.channels.type, "thread"),
      eq(schema.channels.parentMessageId, parent.id),
    )).get();
    const target = `thread:${parent.id.slice(0, 8)}`;
    if (!thread) {
      sendJson(res, 200, {
        parent: { senderName: parent.senderName, content: parent.content },
        messages: [],
      });
      return true;
    }
    const messages = db.select().from(schema.messages)
      .where(eq(schema.messages.channelId, thread.id))
      .orderBy(asc(schema.messages.seq)).limit(100).all();
    sendJson(res, 200, {
      parent: { senderName: parent.senderName, content: parent.content },
      messages: messages.map((message) => ({
        ...serializeAgentMessage(message),
        text: formatAgentMessage(message, target),
      })),
    });
    return true;
  }

  if (path === "/agent-api/channel/members" && method === "GET") {
    const target = await resolveTarget(spaceId, url.searchParams.get("channel") ?? "", agent.id);
    if (!target) return (sendErr(res, 404, "channel not found"), true);
    const members = await channelMembers(spaceId, target.channelId);
    sendJson(res, 200, {
      members: members.map((member) => ({
        type: member.type,
        name: member.name,
        displayName: member.displayName,
      })),
    });
    return true;
  }

  if (path === "/agent-api/channel/leave" && method === "POST") {
    const body = await readJson(req);
    const target = await resolveTarget(spaceId, body.target ?? body.channel ?? "", agent.id);
    if (!target) return (sendErr(res, 404, "channel not found"), true);
    db.delete(schema.channelAgentMembers).where(and(
      eq(schema.channelAgentMembers.channelId, target.channelId),
      eq(schema.channelAgentMembers.agentId, agent.id),
    )).run();
    sendJson(res, 200, { ok: true, left: body.target ?? body.channel });
    return true;
  }

  if (path === "/agent-api/thread/unfollow" && method === "POST") {
    const body = await readJson(req);
    const target = await resolveTarget(spaceId, body.target ?? body.channel ?? "", agent.id);
    if (!target) return (sendErr(res, 404, "thread not found"), true);
    db.delete(schema.channelAgentMembers).where(and(
      eq(schema.channelAgentMembers.channelId, target.channelId),
      eq(schema.channelAgentMembers.agentId, agent.id),
    )).run();
    sendJson(res, 200, { ok: true, unfollowed: body.target ?? body.channel });
    return true;
  }

  return false;
}
