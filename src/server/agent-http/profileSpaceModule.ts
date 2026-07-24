import { and, eq, isNull, ne } from "drizzle-orm";
import { dbForSpace, schema } from "../../db/index.js";
import { getHumanIdentity, humanIdentityForHandle } from "../../human/humanIdentity.js";
import { descTooLong, DESC_TOO_LONG } from "../core.js";
import { readJson, sendErr, sendJson } from "../util.js";
import { agentChannels, type AgentHttpContext } from "./context.js";

export async function handleProfileSpaceModule(context: AgentHttpContext): Promise<boolean> {
  const { req, res, url, method, path, agent, spaceId } = context;
  const db = dbForSpace(spaceId);

  if (path === "/agent-api/space/info" && method === "GET") {
    const channels = db.select().from(schema.channels).where(eq(schema.channels.spaceId, spaceId)).all();
    const joined = new Set((await agentChannels(spaceId, agent.id)).map((membership) => membership.channelId));
    const agents = db.select().from(schema.agents).where(and(
      eq(schema.agents.spaceId, spaceId),
      isNull(schema.agents.deletedAt),
      ne(schema.agents.creatorType, "system"),
    )).all();
    const human = getHumanIdentity();
    sendJson(res, 200, {
      channels: channels
        .filter((channel) => channel.type !== "dm"
          && channel.type !== "thread"
          && !channel.deletedAt
          && !channel.archivedAt
          && (channel.type === "channel" || joined.has(channel.id)))
        .map((channel) => ({
          name: channel.name,
          description: channel.description,
          joined: joined.has(channel.id),
          type: channel.type,
        })),
      agents: agents.map((candidate) => ({
        name: candidate.name,
        status: candidate.status,
        description: candidate.description ?? null,
      })),
      human: human
        ? { name: human.handle, displayName: human.displayName, description: human.description }
        : null,
    });
    return true;
  }

  if (path === "/agent-api/profile/show" && method === "GET") {
    const handle = (url.searchParams.get("handle") || "").replace(/^@/, "");
    const human = humanIdentityForHandle(handle);
    if (human) {
      sendJson(res, 200, {
        type: "human",
        name: human.handle,
        displayName: human.displayName,
        description: human.description,
      });
      return true;
    }
    const profile = handle
      ? db.select().from(schema.agents).where(and(
          eq(schema.agents.spaceId, spaceId),
          eq(schema.agents.name, handle),
        )).get()
      : db.select().from(schema.agents).where(eq(schema.agents.id, agent.id)).get();
    if (!profile) return (sendErr(res, 404, "profile not found"), true);
    sendJson(res, 200, {
      type: "agent",
      name: profile.name,
      displayName: profile.displayName,
      description: profile.description,
      runtime: profile.runtime,
      model: profile.model,
      status: profile.status,
    });
    return true;
  }

  if (path === "/agent-api/profile/update" && method === "POST") {
    const body = await readJson(req);
    const patch: Record<string, string> = {};
    if (body.displayName) patch.displayName = String(body.displayName);
    if (body.description !== undefined) {
      if (descTooLong(body.description)) return (sendErr(res, 400, DESC_TOO_LONG), true);
      patch.description = String(body.description);
    }
    if (body.avatarUrl) patch.avatarUrl = String(body.avatarUrl);
    if (!Object.keys(patch).length) {
      return (sendErr(res, 400, "provide at least one of displayName/description/avatarUrl"), true);
    }
    db.update(schema.agents).set(patch).where(eq(schema.agents.id, agent.id)).run();
    sendJson(res, 200, { ok: true, ...patch });
    return true;
  }

  return false;
}
