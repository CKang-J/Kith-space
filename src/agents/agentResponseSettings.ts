import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { dbForSpace, schema, type SpaceDb } from "../db/index.js";
import {
  isAgentResponseMode,
  type AgentResponseMode,
} from "./agentResponsePolicy.js";
import type { AgentScopes } from "./agentScopes.js";

export type AgentResponseModeSource = "agent_default" | "channel_override";

export interface ResolvedAgentResponseMode {
  agentId: string;
  channelId: string;
  defaultResponseMode: AgentResponseMode;
  responseModeOverride: AgentResponseMode | null;
  effectiveResponseMode: AgentResponseMode;
  responseModeSource: AgentResponseModeSource;
  ambientWakeAfterSeq: number;
  mentionWakeAfterSeq: number;
}

export interface ResolvedAgentDispatchSettings {
  responseMode: ResolvedAgentResponseMode;
  scopes: AgentScopes | null;
}

export type AgentResponseSettingsErrorCode =
  | "invalid_response_mode"
  | "agent_not_found"
  | "channel_not_found"
  | "channel_member_not_found"
  | "response_mode_not_applicable";

export class AgentResponseSettingsError extends Error {
  constructor(
    readonly code: AgentResponseSettingsErrorCode,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "AgentResponseSettingsError";
  }
}

type SpaceTransaction = Parameters<Parameters<SpaceDb["transaction"]>[0]>[0];
type ChannelRow = typeof schema.channels.$inferSelect;
type MemberRow = typeof schema.channelAgentMembers.$inferSelect;

function activeAgent(tx: SpaceTransaction, spaceId: string, agentId: string) {
  return tx.select().from(schema.agents).where(and(
    eq(schema.agents.id, agentId),
    eq(schema.agents.spaceId, spaceId),
    isNull(schema.agents.deletedAt),
  )).get();
}

function liveChannel(tx: SpaceTransaction, spaceId: string, channelId: string) {
  return tx.select().from(schema.channels).where(and(
    eq(schema.channels.id, channelId),
    eq(schema.channels.spaceId, spaceId),
    isNull(schema.channels.deletedAt),
  )).get();
}

function channelMember(tx: SpaceTransaction, channelId: string, agentId: string) {
  return tx.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, channelId),
    eq(schema.channelAgentMembers.agentId, agentId),
  )).get();
}

function parentChannelId(tx: SpaceTransaction, spaceId: string, channel: ChannelRow): string | null {
  if (channel.type !== "thread") return channel.id;
  if (!channel.parentMessageId) return null;
  return tx.select({ channelId: schema.messages.channelId }).from(schema.messages).where(and(
    eq(schema.messages.id, channel.parentMessageId),
    eq(schema.messages.spaceId, spaceId),
  )).get()?.channelId ?? null;
}

function currentSpaceSeq(tx: SpaceTransaction, spaceId: string): number {
  return tx.select({ seq: schema.messages.seq }).from(schema.messages)
    .where(eq(schema.messages.spaceId, spaceId))
    .orderBy(desc(schema.messages.seq))
    .limit(1)
    .get()?.seq ?? 0;
}

function ambientEnabled(mode: AgentResponseMode): boolean {
  return mode === "active";
}

function mentionEnabled(mode: AgentResponseMode): boolean {
  return mode !== "silent";
}

function transitionWakeWatermarks(
  oldMode: AgentResponseMode,
  newMode: AgentResponseMode,
  currentSeq: number,
  current: Pick<MemberRow, "ambientWakeAfterSeq" | "mentionWakeAfterSeq">,
  options: { includeAmbient: boolean },
): Pick<MemberRow, "ambientWakeAfterSeq" | "mentionWakeAfterSeq"> {
  return {
    ambientWakeAfterSeq: options.includeAmbient
      && !ambientEnabled(oldMode)
      && ambientEnabled(newMode)
      ? currentSeq
      : current.ambientWakeAfterSeq,
    mentionWakeAfterSeq: !mentionEnabled(oldMode) && mentionEnabled(newMode)
      ? currentSeq
      : current.mentionWakeAfterSeq,
  };
}

function resolveInTransaction(
  tx: SpaceTransaction,
  spaceId: string,
  channel: ChannelRow,
  member: MemberRow,
  agent: typeof schema.agents.$inferSelect,
): ResolvedAgentResponseMode {
  let responseModeOverride: AgentResponseMode | null = null;
  if (channel.type === "thread") {
    const parentId = parentChannelId(tx, spaceId, channel);
    responseModeOverride = parentId
      ? channelMember(tx, parentId, agent.id)?.responseModeOverride ?? null
      : null;
  } else if (channel.type !== "dm") {
    responseModeOverride = member.responseModeOverride;
  }
  return resolveFromRows(channel, member, agent, responseModeOverride);
}

function resolveFromRows(
  channel: ChannelRow,
  member: MemberRow,
  agent: typeof schema.agents.$inferSelect,
  responseModeOverride: AgentResponseMode | null,
): ResolvedAgentResponseMode {
  const effectiveResponseMode = responseModeOverride ?? agent.defaultResponseMode;
  return {
    agentId: agent.id,
    channelId: channel.id,
    defaultResponseMode: agent.defaultResponseMode,
    responseModeOverride,
    effectiveResponseMode,
    responseModeSource: responseModeOverride === null ? "agent_default" : "channel_override",
    ambientWakeAfterSeq: member.ambientWakeAfterSeq,
    mentionWakeAfterSeq: member.mentionWakeAfterSeq,
  };
}

function resolveManyInTransaction(
  tx: SpaceTransaction,
  spaceId: string,
  channel: ChannelRow,
  requestedAgentIds?: readonly string[],
): ResolvedAgentDispatchSettings[] {
  if (requestedAgentIds && !requestedAgentIds.length) return [];
  const memberFilter = requestedAgentIds
    ? and(
        eq(schema.channelAgentMembers.channelId, channel.id),
        inArray(schema.channelAgentMembers.agentId, [...requestedAgentIds]),
      )
    : eq(schema.channelAgentMembers.channelId, channel.id);
  const members = tx.select().from(schema.channelAgentMembers).where(memberFilter).all();
  if (!members.length) return [];
  const agentIds = members.map((member) => member.agentId);
  const agents = tx.select().from(schema.agents).where(and(
    inArray(schema.agents.id, agentIds),
    eq(schema.agents.spaceId, spaceId),
    isNull(schema.agents.deletedAt),
  )).all();
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  let parentMemberByAgentId = new Map<string, MemberRow>();
  if (channel.type === "thread") {
    const parentId = parentChannelId(tx, spaceId, channel);
    if (parentId) {
      const parentMembers = tx.select().from(schema.channelAgentMembers).where(and(
        eq(schema.channelAgentMembers.channelId, parentId),
        inArray(schema.channelAgentMembers.agentId, agentIds),
      )).all();
      parentMemberByAgentId = new Map(parentMembers.map((member) => [member.agentId, member]));
    }
  }

  return members.flatMap((member) => {
    const agent = agentById.get(member.agentId);
    if (!agent) return [];
    const responseModeOverride = channel.type === "thread"
      ? parentMemberByAgentId.get(agent.id)?.responseModeOverride ?? null
      : channel.type === "dm"
        ? null
        : member.responseModeOverride;
    return [{
      responseMode: resolveFromRows(channel, member, agent, responseModeOverride),
      scopes: agent.scopes,
    }];
  });
}

export function parseAgentResponseMode(value: unknown): AgentResponseMode {
  if (isAgentResponseMode(value)) return value;
  throw new AgentResponseSettingsError(
    "invalid_response_mode",
    "response mode must be active, mention_only, or silent",
    400,
  );
}

export function parseAgentResponseModeOverride(value: unknown): AgentResponseMode | null {
  if (value === null) return null;
  return parseAgentResponseMode(value);
}

export function initialAgentResponseWakeWatermarks(watermark: number): {
  ambientWakeAfterSeq: number;
  mentionWakeAfterSeq: number;
} {
  const normalized = Number.isFinite(watermark) ? Math.max(0, Math.trunc(watermark)) : 0;
  return { ambientWakeAfterSeq: normalized, mentionWakeAfterSeq: normalized };
}

export async function resolveAgentResponseMode(
  spaceId: string,
  channelId: string,
  agentId: string,
): Promise<ResolvedAgentResponseMode | null> {
  const db = dbForSpace(spaceId);
  return db.transaction((tx) => {
    const channel = liveChannel(tx, spaceId, channelId);
    const member = channelMember(tx, channelId, agentId);
    const agent = activeAgent(tx, spaceId, agentId);
    return channel && member && agent ? resolveInTransaction(tx, spaceId, channel, member, agent) : null;
  });
}

export async function listChannelAgentResponseModes(
  spaceId: string,
  channelId: string,
): Promise<ResolvedAgentResponseMode[]> {
  const db = dbForSpace(spaceId);
  return db.transaction((tx) => {
    const channel = liveChannel(tx, spaceId, channelId);
    if (!channel) return [];
    return resolveManyInTransaction(tx, spaceId, channel).map((settings) => settings.responseMode);
  });
}

export async function resolveAgentDispatchSettings(
  spaceId: string,
  channelId: string,
  agentIds: readonly string[],
): Promise<ResolvedAgentDispatchSettings[]> {
  if (!agentIds.length) return [];
  const db = dbForSpace(spaceId);
  return db.transaction((tx) => {
    const channel = liveChannel(tx, spaceId, channelId);
    return channel ? resolveManyInTransaction(tx, spaceId, channel, agentIds) : [];
  });
}

export function resolveAgentDispatchSettingsInTransaction(
  tx: SpaceTransaction,
  spaceId: string,
  channelId: string,
  agentIds: readonly string[],
): ResolvedAgentDispatchSettings[] {
  if (!agentIds.length) return [];
  const channel = liveChannel(tx, spaceId, channelId);
  return channel ? resolveManyInTransaction(tx, spaceId, channel, agentIds) : [];
}

export async function setAgentDefaultResponseMode(
  spaceId: string,
  agentId: string,
  value: unknown,
): Promise<{ changed: boolean; agentId: string; defaultResponseMode: AgentResponseMode }> {
  const defaultResponseMode = parseAgentResponseMode(value);
  const db = dbForSpace(spaceId);
  return db.transaction((tx) => {
    const agent = activeAgent(tx, spaceId, agentId);
    if (!agent) {
      throw new AgentResponseSettingsError("agent_not_found", "agent not found", 404);
    }
    if (agent.defaultResponseMode === defaultResponseMode) {
      return { changed: false, agentId, defaultResponseMode };
    }

    const seq = currentSpaceSeq(tx, spaceId);
    const members = tx.select().from(schema.channelAgentMembers)
      .where(eq(schema.channelAgentMembers.agentId, agentId)).all();
    const channelIds = members.map((member) => member.channelId);
    const channels = channelIds.length
      ? tx.select().from(schema.channels).where(and(
        inArray(schema.channels.id, channelIds),
        eq(schema.channels.spaceId, spaceId),
        isNull(schema.channels.deletedAt),
      )).all()
      : [];
    const channelById = new Map(channels.map((channel) => [channel.id, channel]));

    for (const member of members) {
      const channel = channelById.get(member.channelId);
      if (!channel || channel.type === "dm") continue;
      if (channel.type === "thread") {
        const parentId = parentChannelId(tx, spaceId, channel);
        const parentOverride = parentId
          ? channelMember(tx, parentId, agentId)?.responseModeOverride ?? null
          : null;
        if (parentOverride !== null) continue;
        const watermarks = transitionWakeWatermarks(
          agent.defaultResponseMode,
          defaultResponseMode,
          seq,
          member,
          { includeAmbient: false },
        );
        if (watermarks.mentionWakeAfterSeq !== member.mentionWakeAfterSeq) {
          tx.update(schema.channelAgentMembers).set({
            mentionWakeAfterSeq: watermarks.mentionWakeAfterSeq,
          }).where(and(
            eq(schema.channelAgentMembers.channelId, member.channelId),
            eq(schema.channelAgentMembers.agentId, agentId),
          )).run();
        }
        continue;
      }
      if (member.responseModeOverride !== null) continue;
      const watermarks = transitionWakeWatermarks(
        agent.defaultResponseMode,
        defaultResponseMode,
        seq,
        member,
        { includeAmbient: true },
      );
      if (
        watermarks.ambientWakeAfterSeq !== member.ambientWakeAfterSeq
        || watermarks.mentionWakeAfterSeq !== member.mentionWakeAfterSeq
      ) {
        tx.update(schema.channelAgentMembers).set(watermarks).where(and(
          eq(schema.channelAgentMembers.channelId, member.channelId),
          eq(schema.channelAgentMembers.agentId, agentId),
        )).run();
      }
    }

    tx.update(schema.agents).set({ defaultResponseMode }).where(and(
      eq(schema.agents.id, agentId),
      eq(schema.agents.spaceId, spaceId),
    )).run();
    return { changed: true, agentId, defaultResponseMode };
  });
}

export async function setChannelAgentResponseModeOverride(
  spaceId: string,
  channelId: string,
  agentId: string,
  value: unknown,
): Promise<{ changed: boolean; setting: ResolvedAgentResponseMode }> {
  const responseModeOverride = parseAgentResponseModeOverride(value);
  const db = dbForSpace(spaceId);
  return db.transaction((tx) => {
    const channel = liveChannel(tx, spaceId, channelId);
    if (!channel) {
      throw new AgentResponseSettingsError("channel_not_found", "channel not found", 404);
    }
    if (channel.type === "dm" || channel.type === "thread") {
      throw new AgentResponseSettingsError(
        "response_mode_not_applicable",
        "response mode overrides apply only to top-level channels",
        400,
      );
    }
    const agent = activeAgent(tx, spaceId, agentId);
    const member = channelMember(tx, channelId, agentId);
    if (!agent || !member) {
      throw new AgentResponseSettingsError("channel_member_not_found", "channel agent member not found", 404);
    }
    if (member.responseModeOverride === responseModeOverride) {
      return { changed: false, setting: resolveInTransaction(tx, spaceId, channel, member, agent) };
    }

    const seq = currentSpaceSeq(tx, spaceId);
    const oldMode = member.responseModeOverride ?? agent.defaultResponseMode;
    const newMode = responseModeOverride ?? agent.defaultResponseMode;
    const watermarks = transitionWakeWatermarks(oldMode, newMode, seq, member, { includeAmbient: true });
    tx.update(schema.channelAgentMembers).set({
      responseModeOverride,
      ...watermarks,
    }).where(and(
      eq(schema.channelAgentMembers.channelId, channelId),
      eq(schema.channelAgentMembers.agentId, agentId),
    )).run();

    if (!mentionEnabled(oldMode) && mentionEnabled(newMode)) {
      const threadMembers = tx.select({
        channelId: schema.channelAgentMembers.channelId,
        mentionWakeAfterSeq: schema.channelAgentMembers.mentionWakeAfterSeq,
      }).from(schema.channelAgentMembers)
        .innerJoin(schema.channels, eq(schema.channels.id, schema.channelAgentMembers.channelId))
        .innerJoin(schema.messages, eq(schema.messages.id, schema.channels.parentMessageId))
        .where(and(
          eq(schema.channelAgentMembers.agentId, agentId),
          eq(schema.channels.spaceId, spaceId),
          eq(schema.channels.type, "thread"),
          isNull(schema.channels.deletedAt),
          eq(schema.messages.channelId, channelId),
          eq(schema.messages.spaceId, spaceId),
        )).all();
      for (const threadMember of threadMembers) {
        if (threadMember.mentionWakeAfterSeq === seq) continue;
        tx.update(schema.channelAgentMembers).set({ mentionWakeAfterSeq: seq }).where(and(
          eq(schema.channelAgentMembers.channelId, threadMember.channelId),
          eq(schema.channelAgentMembers.agentId, agentId),
        )).run();
      }
    }

    const updated = channelMember(tx, channelId, agentId)!;
    return {
      changed: true,
      setting: resolveInTransaction(tx, spaceId, channel, updated, agent),
    };
  });
}
