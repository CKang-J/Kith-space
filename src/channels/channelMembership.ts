import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { initialAgentResponseWakeWatermarks } from "../agents/agentResponseSettings.js";
import { dbForSpace, schema } from "../db/index.js";
import { getHumanIdentity } from "../human/humanIdentity.js";
import { humanChannelState } from "../human/humanChannelState.js";

export interface ConversationMember {
  type: "human" | "agent";
  id: string;
  name: string;
  displayName: string;
}

export type ConversationChannel = Pick<typeof schema.channels.$inferSelect, "id" | "type">;

export async function channelMembers(spaceId: string, channelId: string): Promise<ConversationMember[]> {
  const db = dbForSpace(spaceId);
  const channel = db.select({ id: schema.channels.id, type: schema.channels.type }).from(schema.channels).where(and(
    eq(schema.channels.id, channelId),
    eq(schema.channels.spaceId, spaceId),
    isNull(schema.channels.deletedAt),
  )).get();
  if (!channel) return [];
  return channelMembersForChannel(spaceId, channel);
}

export async function channelMembersForChannel(
  spaceId: string,
  channel: ConversationChannel,
): Promise<ConversationMember[]> {
  const db = dbForSpace(spaceId);
  const rows = db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, channel.id)).all();
  const out: ConversationMember[] = [];
  const human = getHumanIdentity();
  const state = await humanChannelState(spaceId, channel.id);
  const includesHuman = channel.type === "channel" || channel.type === "private"
    || (channel.type === "dm" && Boolean(state?.dmAgentId))
    || (channel.type === "thread" && Boolean(state?.threadFollowedAt));
  if (human && includesHuman) {
    out.push({ type: "human", id: human.id, name: human.handle, displayName: human.displayName });
  }
  if (rows.length) {
    const agents = db.select().from(schema.agents).where(and(
      inArray(schema.agents.id, rows.map((row) => row.agentId)),
      eq(schema.agents.spaceId, spaceId),
      isNull(schema.agents.deletedAt),
    )).all();
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    for (const row of rows) {
      const agent = agentById.get(row.agentId);
      if (agent) out.push({ type: "agent", id: agent.id, name: agent.name, displayName: agent.displayName });
    }
  }
  return out;
}

export async function channelMaxSeq(spaceId: string, channelId: string): Promise<number> {
  const row = dbForSpace(spaceId).select({ seq: schema.messages.seq }).from(schema.messages)
    .where(eq(schema.messages.channelId, channelId)).orderBy(desc(schema.messages.seq)).limit(1).get();
  return row?.seq ?? 0;
}

export async function addChannelMembers(
  spaceId: string,
  channelId: string,
  members: { type: "human" | "agent"; id: string }[],
  options?: { watermark?: number },
): Promise<void> {
  const agents = members.filter((member): member is { type: "agent"; id: string } => member.type === "agent");
  if (!agents.length) return;
  const watermark = options?.watermark ?? await channelMaxSeq(spaceId, channelId);
  const wakeWatermarks = initialAgentResponseWakeWatermarks(watermark);
  dbForSpace(spaceId).insert(schema.channelAgentMembers).values(agents.map((member) => ({
    channelId,
    agentId: member.id,
    lastReadSeq: watermark,
    ...wakeWatermarks,
  }))).onConflictDoNothing().run();
}

export function parseMentions(content: string, members: ConversationMember[]): ConversationMember[] {
  const found = new Map<string, ConversationMember>();
  const re = /@([A-Za-z0-9_\u4e00-\u9fa5-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    const name = match[1]!;
    const member = members.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (member) found.set(member.id, member);
  }
  return [...found.values()];
}

export async function spaceMembers(spaceId: string): Promise<ConversationMember[]> {
  const db = dbForSpace(spaceId);
  const out: ConversationMember[] = [];
  const human = getHumanIdentity();
  if (human) out.push({ type: "human", id: human.id, name: human.handle, displayName: human.displayName });
  const agents = db.select().from(schema.agents).where(and(
    eq(schema.agents.spaceId, spaceId),
    isNull(schema.agents.deletedAt),
    ne(schema.agents.creatorType, "system"),
  )).all();
  for (const agent of agents) {
    out.push({ type: "agent", id: agent.id, name: agent.name, displayName: agent.displayName });
  }
  return out;
}

export function membersToAutoJoin(
  content: string,
  space: ConversationMember[],
  current: ConversationMember[],
): ConversationMember[] {
  const existing = new Set(current.map((member) => `${member.type}:${member.id}`));
  return parseMentions(content, space).filter((member) => !existing.has(`${member.type}:${member.id}`));
}
