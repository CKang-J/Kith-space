import { and, eq, isNull } from "drizzle-orm";
import { schema, type SpaceDb } from "../db/index.js";

export type TrajectoryScopeKind = "scoped" | "unscoped" | "ambiguous";

export interface WorkerTrajectoryScope {
  scope?: unknown;
  channelId?: unknown;
  streamId?: unknown;
}

export interface ResolvedTrajectoryScope {
  scope: TrajectoryScopeKind;
  channelId?: string;
  conversationId?: string;
  streamId?: string;
}

export interface TrajectoryConversationLookup {
  channelById(channelId: string): Promise<{ id: string; type: string; parentMessageId: string | null } | null>;
  messageChannelId(messageId: string): Promise<string | null>;
}

function workerScopeKind(input: WorkerTrajectoryScope): TrajectoryScopeKind {
  if (input.scope === "scoped" || input.scope === "unscoped" || input.scope === "ambiguous") return input.scope;
  return typeof input.channelId === "string" && input.channelId.trim() ? "scoped" : "unscoped";
}

export async function normalizeTrajectoryScope(
  input: WorkerTrajectoryScope,
  lookup: TrajectoryConversationLookup,
): Promise<ResolvedTrajectoryScope> {
  const kind = workerScopeKind(input);
  if (kind !== "scoped") return { scope: kind };
  const rawChannelId = typeof input.channelId === "string" ? input.channelId.trim() : "";
  if (!rawChannelId) return { scope: "unscoped" };

  let conversationId = rawChannelId;
  const visited = new Set<string>();
  while (true) {
    if (visited.has(conversationId)) return { scope: "unscoped" };
    visited.add(conversationId);
    const channel = await lookup.channelById(conversationId);
    if (!channel) return { scope: "unscoped" };
    if (channel.type !== "thread") break;
    if (!channel.parentMessageId) return { scope: "unscoped" };
    const parentChannelId = await lookup.messageChannelId(channel.parentMessageId);
    if (!parentChannelId) return { scope: "unscoped" };
    conversationId = parentChannelId;
  }

  const streamId = typeof input.streamId === "string" && input.streamId ? input.streamId : undefined;
  return {
    scope: "scoped",
    channelId: rawChannelId,
    conversationId,
    ...(streamId ? { streamId } : {}),
  };
}

export async function resolveTrajectoryScope(db: SpaceDb, input: WorkerTrajectoryScope): Promise<ResolvedTrajectoryScope> {
  return normalizeTrajectoryScope(input, {
    async channelById(channelId) {
      return db.select({ id: schema.channels.id, type: schema.channels.type, parentMessageId: schema.channels.parentMessageId })
        .from(schema.channels)
        .where(and(eq(schema.channels.id, channelId), isNull(schema.channels.deletedAt)))
        .get() ?? null;
    },
    async messageChannelId(messageId) {
      return db.select({ channelId: schema.messages.channelId }).from(schema.messages)
        .where(eq(schema.messages.id, messageId)).get()?.channelId ?? null;
    },
  });
}
