import { and, eq, isNull } from "drizzle-orm";
import { agentHasScope } from "../agents/agentScopes.js";
import { containsChannelAllMention } from "../channels/channelAllMention.js";
import { hasAgentSurfaceAccessInTransaction } from "../channels/agentSurfaceAccess.js";
import type { SpaceTransaction } from "../counters.js";
import { schema } from "../db/index.js";

export type ExecutionBindingSource = "dm_peer" | "explicit_picker" | "structured_mention";

export type MessageExecutionBindingInput = {
  executorAgentId: string;
  mode: "required";
};

export type StructuredAgentMention = {
  type: "agent";
  id: string;
};

export type ResolvedExecutionBinding = MessageExecutionBindingInput & {
  bindingSource: ExecutionBindingSource;
};

export class MessageExecutionBindingError extends Error {
  constructor(
    public readonly code: "INVALID_ARGUMENT" | "EXECUTOR_INELIGIBLE",
    message: string,
  ) {
    super(message);
    this.name = "MessageExecutionBindingError";
  }
}

export function isMessageExecutionBindingError(error: unknown): error is MessageExecutionBindingError {
  return error instanceof MessageExecutionBindingError;
}

export function parseExecutionBinding(value: unknown): MessageExecutionBindingInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const executorAgentId = typeof raw.executorAgentId === "string" ? raw.executorAgentId.trim() : "";
  if (!executorAgentId || executorAgentId.length > 128) return null;
  if (raw.mode !== undefined && raw.mode !== "required") return null;
  return { executorAgentId, mode: "required" };
}

export function parseStructuredAgentMentions(value: unknown): StructuredAgentMention[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new MessageExecutionBindingError("INVALID_ARGUMENT", "structuredMentions must be an array");
  }
  const parsed: StructuredAgentMention[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new MessageExecutionBindingError("INVALID_ARGUMENT", "structured mention is invalid");
    }
    const raw = item as Record<string, unknown>;
    if (raw.type !== "agent") {
      throw new MessageExecutionBindingError("INVALID_ARGUMENT", "only structured @Agent mentions can bind a Canvas executor");
    }
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id || id.length > 128) {
      throw new MessageExecutionBindingError("INVALID_ARGUMENT", "structured mention Agent id is invalid");
    }
    if (seen.has(id)) continue;
    seen.add(id);
    parsed.push({ type: "agent", id });
  }
  return parsed;
}

function ineligible(reason: string): never {
  throw new MessageExecutionBindingError("EXECUTOR_INELIGIBLE", reason);
}

export function deriveDmExecutorAgentId(
  tx: SpaceTransaction,
  spaceId: string,
  channelId: string,
): string {
  const state = tx.select({ dmAgentId: schema.humanChannelStates.dmAgentId })
    .from(schema.humanChannelStates)
    .where(eq(schema.humanChannelStates.channelId, channelId))
    .get();
  if (state?.dmAgentId) return state.dmAgentId;
  const members = tx.select({ agentId: schema.channelAgentMembers.agentId })
    .from(schema.channelAgentMembers)
    .where(eq(schema.channelAgentMembers.channelId, channelId))
    .all();
  if (members.length !== 1) {
    throw new MessageExecutionBindingError("INVALID_ARGUMENT", "DM executor cannot be derived from the current surface");
  }
  return members[0]!.agentId;
}

export function assertEligibleExecutorInTransaction(
  tx: SpaceTransaction,
  input: {
    spaceId: string;
    channelId: string;
    executorAgentId: string;
    now?: number;
  },
): typeof schema.agents.$inferSelect {
  const agent = tx.select().from(schema.agents).where(and(
    eq(schema.agents.id, input.executorAgentId),
    eq(schema.agents.spaceId, input.spaceId),
    isNull(schema.agents.deletedAt),
  )).get();
  if (!agent) ineligible("executor Agent is deleted or unavailable");
  const harness = tx.select({ mode: schema.agentHarnessState.mode })
    .from(schema.agentHarnessState)
    .where(eq(schema.agentHarnessState.agentId, agent.id))
    .get();
  if (harness?.mode !== "v2") ineligible("executor Agent must use harness v2");
  if (!hasAgentSurfaceAccessInTransaction(tx, {
    spaceId: input.spaceId,
    channelId: input.channelId,
    agentId: agent.id,
    now: input.now,
  })) {
    ineligible("executor Agent does not have current surface access");
  }
  if (!agentHasScope(agent.scopes, "message:send")) {
    ineligible("executor Agent does not have message:send");
  }
  return agent;
}

export function resolveExecutionBindingInTransaction(
  tx: SpaceTransaction,
  input: {
    spaceId: string;
    channel: typeof schema.channels.$inferSelect;
    requested: MessageExecutionBindingInput | null;
    structuredMentions?: StructuredAgentMention[];
    content?: string;
    now?: number;
  },
): ResolvedExecutionBinding {
  if (containsChannelAllMention(input.content ?? "")) {
    throw new MessageExecutionBindingError("INVALID_ARGUMENT", "@all cannot be a Canvas executor");
  }
  const structuredIds = [...new Set((input.structuredMentions ?? []).filter((item) => item.type === "agent").map((item) => item.id))];
  if (input.channel.type === "dm") {
    const executorAgentId = deriveDmExecutorAgentId(tx, input.spaceId, input.channel.id);
    if (input.requested && input.requested.executorAgentId !== executorAgentId) {
      throw new MessageExecutionBindingError(
        "INVALID_ARGUMENT",
        "DM executor is derived from the peer Agent and cannot be chosen by the caller",
      );
    }
    if (structuredIds.some((id) => id !== executorAgentId)) {
      throw new MessageExecutionBindingError(
        "INVALID_ARGUMENT",
        "DM executor is derived from the peer Agent and cannot be chosen by the caller",
      );
    }
    assertEligibleExecutorInTransaction(tx, {
      spaceId: input.spaceId,
      channelId: input.channel.id,
      executorAgentId,
      now: input.now,
    });
    return { executorAgentId, mode: "required", bindingSource: "dm_peer" };
  }
  if (input.channel.type !== "channel" && input.channel.type !== "private" && input.channel.type !== "thread") {
    throw new MessageExecutionBindingError("INVALID_ARGUMENT", "Canvas context can only be sent to a DM, channel, or thread");
  }
  if (structuredIds.length > 1) {
    throw new MessageExecutionBindingError("INVALID_ARGUMENT", "Canvas context requires exactly one structured @Agent mention");
  }
  const pickerId = input.requested?.executorAgentId ?? null;
  const mentionId = structuredIds[0] ?? null;
  if (pickerId && mentionId && pickerId !== mentionId) {
    throw new MessageExecutionBindingError(
      "INVALID_ARGUMENT",
      "Composer executor and structured @Agent mention do not match",
    );
  }
  const executorAgentId = pickerId ?? mentionId;
  if (!executorAgentId) {
    throw new MessageExecutionBindingError(
      "INVALID_ARGUMENT",
      "channel and thread Canvas context require an explicit executor Agent",
    );
  }
  assertEligibleExecutorInTransaction(tx, {
    spaceId: input.spaceId,
    channelId: input.channel.id,
    executorAgentId,
    now: input.now,
  });
  return {
    executorAgentId,
    mode: "required",
    bindingSource: pickerId ? "explicit_picker" : "structured_mention",
  };
}
