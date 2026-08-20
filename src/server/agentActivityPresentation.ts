import { inArray } from "drizzle-orm";
import { schema, type SpaceDb } from "../db/index.js";
import { getHumanIdentity } from "../human/humanIdentity.js";

type ActivityRow = Pick<
  typeof schema.agentActivityLog.$inferSelect,
  "id" | "agentId" | "channelId" | "conversationId"
>;

export interface AgentActivitySource {
  kind: "channel" | "dm" | "thread" | "unknown";
  channelId: string | null;
  conversationId: string | null;
  name: string | null;
  parentMessageId: string | null;
  parentPreview: string | null;
  unavailable: boolean;
}

function compactPreview(value: string | null | undefined): string | null {
  const compacted = value?.replace(/\s+/g, " ").trim();
  if (!compacted) return null;
  return compacted.length > 48 ? `${compacted.slice(0, 48)}…` : compacted;
}

export async function loadAgentActivitySources(
  db: SpaceDb,
  rows: ActivityRow[],
): Promise<Map<string, AgentActivitySource>> {
  const ids = [...new Set(rows.flatMap((row) => (
    [row.channelId, row.conversationId].filter((id): id is string => Boolean(id))
  )))];
  if (!ids.length) return new Map();

  const channels = db.select().from(schema.channels).where(inArray(schema.channels.id, ids)).all();
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const threadParentIds = [...new Set(channels.flatMap((channel) => (
    channel.type === "thread" && channel.parentMessageId ? [channel.parentMessageId] : []
  )))];
  const threadParents = threadParentIds.length
    ? db.select({
      id: schema.messages.id,
      channelId: schema.messages.channelId,
      content: schema.messages.content,
    }).from(schema.messages).where(inArray(schema.messages.id, threadParentIds)).all()
    : [];
  const threadParentById = new Map(threadParents.map((message) => [message.id, message]));

  const dmIds = channels.filter((channel) => channel.type === "dm").map((channel) => channel.id);
  const dmMembers = dmIds.length
    ? db.select().from(schema.channelAgentMembers)
      .where(inArray(schema.channelAgentMembers.channelId, dmIds)).all()
    : [];
  const dmHumanStates = dmIds.length
    ? db.select({ channelId: schema.humanChannelStates.channelId }).from(schema.humanChannelStates)
      .where(inArray(schema.humanChannelStates.channelId, dmIds)).all()
    : [];
  const dmAgentIds = [...new Set(dmMembers.map((member) => member.agentId))];
  const dmAgents = dmAgentIds.length
    ? db.select({
      id: schema.agents.id,
      name: schema.agents.name,
      displayName: schema.agents.displayName,
    }).from(schema.agents).where(inArray(schema.agents.id, dmAgentIds)).all()
    : [];
  const dmAgentById = new Map(dmAgents.map((agent) => [agent.id, agent]));
  const dmMembersByChannel = new Map<string, string[]>();
  for (const member of dmMembers) {
    const members = dmMembersByChannel.get(member.channelId) ?? [];
    members.push(member.agentId);
    dmMembersByChannel.set(member.channelId, members);
  }
  const dmHasHuman = new Set(dmHumanStates.map((state) => state.channelId));
  const human = getHumanIdentity();

  const sources = new Map<string, AgentActivitySource>();
  for (const row of rows) {
    if (!row.channelId) continue;
    const channel = channelById.get(row.channelId);
    if (!channel) {
      sources.set(row.id, {
        kind: "unknown",
        channelId: row.channelId,
        conversationId: row.conversationId,
        name: null,
        parentMessageId: null,
        parentPreview: null,
        unavailable: true,
      });
      continue;
    }

    if (channel.type === "dm") {
      const peerNames = (dmMembersByChannel.get(channel.id) ?? [])
        .filter((agentId) => agentId !== row.agentId)
        .flatMap((agentId) => {
          const agent = dmAgentById.get(agentId);
          return agent ? [agent.displayName || agent.name] : [];
        });
      if (dmHasHuman.has(channel.id) && human) peerNames.unshift(human.displayName);
      sources.set(row.id, {
        kind: "dm",
        channelId: channel.id,
        conversationId: row.conversationId ?? channel.id,
        name: peerNames.join("、") || null,
        parentMessageId: null,
        parentPreview: null,
        unavailable: Boolean(channel.deletedAt),
      });
      continue;
    }

    if (channel.type === "thread") {
      const parent = channel.parentMessageId ? threadParentById.get(channel.parentMessageId) : null;
      const parentChannel = channelById.get(row.conversationId ?? parent?.channelId ?? "");
      sources.set(row.id, {
        kind: "thread",
        channelId: channel.id,
        conversationId: parentChannel?.id ?? row.conversationId,
        name: parentChannel?.name ?? null,
        parentMessageId: channel.parentMessageId,
        parentPreview: compactPreview(parent?.content),
        unavailable: Boolean(channel.deletedAt || parentChannel?.deletedAt),
      });
      continue;
    }

    sources.set(row.id, {
      kind: "channel",
      channelId: channel.id,
      conversationId: row.conversationId ?? channel.id,
      name: channel.name,
      parentMessageId: null,
      parentPreview: null,
      unavailable: Boolean(channel.deletedAt),
    });
  }
  return sources;
}
