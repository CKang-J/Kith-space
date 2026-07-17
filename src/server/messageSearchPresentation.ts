import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { dbForSpace, schema } from "../db/index.js";

type ChannelRow = typeof schema.channels.$inferSelect;

interface DmDisplay {
  name: string;
  avatarUrl: string | null;
}

interface ThreadParent {
  id: string;
  channelId: string;
  content: string;
}

export interface MessageSearchPresentationContext {
  channelById: Map<string, ChannelRow>;
  dmDisplayByChannel: Map<string, DmDisplay>;
  threadParentById: Map<string, ThreadParent>;
  replyCountByChannel: Map<string, number>;
}

export interface MessageSearchDisplay {
  channelName: string;
  channelType: ChannelRow["type"];
  conversationName: string | null;
  conversationAvatarUrl: string | null;
  parentMessageId: string | null;
  parentChannelId: string | null;
  parentChannelName: string | null;
  parentPreview: string | null;
  replyCount: number | null;
}

export function compactSearchText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function messageSearchSnippet(content: string, query: string): string {
  const text = compactSearchText(content);
  const matchAt = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  return matchAt < 0
    ? text.slice(0, 90)
    : `${matchAt > 24 ? "…" : ""}${text.slice(Math.max(0, matchAt - 24), matchAt + 66)}`;
}

export async function loadMessageSearchPresentation(
  spaceId: string,
  channelIds: string[],
): Promise<MessageSearchPresentationContext> {
  const db = dbForSpace(spaceId);
  const channels = await db.select().from(schema.channels).where(inArray(schema.channels.id, channelIds));
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const dmChannelIds = channels.filter((channel) => channel.type === "dm").map((channel) => channel.id);
  const [dmStates, dmMembers] = dmChannelIds.length ? await Promise.all([
    db.select({ channelId: schema.humanChannelStates.channelId, agentId: schema.humanChannelStates.dmAgentId })
      .from(schema.humanChannelStates).where(inArray(schema.humanChannelStates.channelId, dmChannelIds)),
    db.select({ channelId: schema.channelAgentMembers.channelId, agentId: schema.channelAgentMembers.agentId })
      .from(schema.channelAgentMembers).where(inArray(schema.channelAgentMembers.channelId, dmChannelIds)),
  ]) : [[], []];
  const directPeerByChannel = new Map(dmStates.flatMap((state) => state.agentId ? [[state.channelId, state.agentId] as const] : []));
  const memberIdsByChannel = new Map<string, string[]>();
  for (const member of dmMembers) {
    const ids = memberIdsByChannel.get(member.channelId) ?? [];
    ids.push(member.agentId);
    memberIdsByChannel.set(member.channelId, ids);
  }
  const dmAgentIds = [...new Set([
    ...directPeerByChannel.values(),
    ...dmMembers.map((member) => member.agentId),
  ])];
  const dmAgents = dmAgentIds.length ? await db.select({
    id: schema.agents.id,
    name: schema.agents.name,
    displayName: schema.agents.displayName,
    avatarUrl: schema.agents.avatarUrl,
  }).from(schema.agents).where(and(
    eq(schema.agents.spaceId, spaceId),
    isNull(schema.agents.deletedAt),
    inArray(schema.agents.id, dmAgentIds),
  )) : [];
  const dmAgentById = new Map(dmAgents.map((agent) => [agent.id, agent]));
  const dmDisplayByChannel = new Map(dmChannelIds.map((channelId) => {
    const directPeerId = directPeerByChannel.get(channelId);
    const participantIds = directPeerId ? [directPeerId] : memberIdsByChannel.get(channelId) ?? [];
    const participants = participantIds.flatMap((id) => {
      const agent = dmAgentById.get(id);
      return agent ? [agent] : [];
    });
    return [channelId, {
      name: participants.map((agent) => agent.displayName || agent.name).join(" ↔ "),
      avatarUrl: participants.length === 1 ? participants[0]!.avatarUrl : null,
    }] as const;
  }));

  const threadParentIds = [...new Set(channels
    .filter((channel) => channel.type === "thread" && channel.parentMessageId)
    .map((channel) => channel.parentMessageId!))];
  const threadParents = threadParentIds.length
    ? await db.select({ id: schema.messages.id, channelId: schema.messages.channelId, content: schema.messages.content })
      .from(schema.messages).where(inArray(schema.messages.id, threadParentIds))
    : [];
  const threadParentById = new Map(threadParents.map((message) => [message.id, message]));
  const threadChannelIds = channels.filter((channel) => channel.type === "thread").map((channel) => channel.id);
  const threadCounts = threadChannelIds.length ? await db.select({
    channelId: schema.messages.channelId,
    replyCount: count(),
  }).from(schema.messages).where(inArray(schema.messages.channelId, threadChannelIds)).groupBy(schema.messages.channelId) : [];
  const replyCountByChannel = new Map(threadCounts.map((row) => [row.channelId, Number(row.replyCount)]));

  return { channelById, dmDisplayByChannel, threadParentById, replyCountByChannel };
}

export function messageSearchDisplay(
  message: { channelId: string },
  context: MessageSearchPresentationContext,
): MessageSearchDisplay {
  const channel = context.channelById.get(message.channelId);
  const parent = channel?.parentMessageId ? context.threadParentById.get(channel.parentMessageId) : null;
  const parentChannel = parent ? context.channelById.get(parent.channelId) : null;
  const parentPreview = parent?.content ? compactSearchText(parent.content).slice(0, 72) : null;
  const dmDisplay = channel?.type === "dm" ? context.dmDisplayByChannel.get(channel.id) : null;
  const channelName = channel?.type === "thread"
    ? parentChannel?.name ?? ""
    : channel?.type === "dm"
      ? dmDisplay?.name ?? ""
      : channel?.name ?? "";

  return {
    channelName,
    channelType: channel?.type ?? "channel",
    conversationName: channel?.type === "thread" ? parentPreview : channelName,
    conversationAvatarUrl: dmDisplay?.avatarUrl ?? null,
    parentMessageId: channel?.type === "thread" ? channel.parentMessageId : null,
    parentChannelId: channel?.type === "thread" ? parent?.channelId ?? null : null,
    parentChannelName: channel?.type === "thread" ? parentChannel?.name ?? null : null,
    parentPreview: channel?.type === "thread" ? parentPreview : null,
    replyCount: channel?.type === "thread" ? context.replyCountByChannel.get(channel.id) ?? 0 : null,
  };
}
