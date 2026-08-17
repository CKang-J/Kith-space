import { and, eq, isNull } from "drizzle-orm";
import { agentHasScope } from "../agents/agentScopes.js";
import { hasAgentSurfaceAccessInTransaction } from "../channels/agentSurfaceAccess.js";
import type { SpaceTransaction } from "../counters.js";
import { schema } from "../db/index.js";

export type MessageExecutionBindingInput = {
  executorAgentId: string;
  mode: "required";
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
    now?: number;
  },
): MessageExecutionBindingInput {
  if (input.channel.type === "dm") {
    const executorAgentId = deriveDmExecutorAgentId(tx, input.spaceId, input.channel.id);
    if (input.requested && input.requested.executorAgentId !== executorAgentId) {
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
    return { executorAgentId, mode: "required" };
  }
  if (input.channel.type !== "channel" && input.channel.type !== "private" && input.channel.type !== "thread") {
    throw new MessageExecutionBindingError("INVALID_ARGUMENT", "Canvas context can only be sent to a DM, channel, or thread");
  }
  if (!input.requested) {
    throw new MessageExecutionBindingError("INVALID_ARGUMENT", "channel and thread Canvas context require an explicit executor Agent");
  }
  assertEligibleExecutorInTransaction(tx, {
    spaceId: input.spaceId,
    channelId: input.channel.id,
    executorAgentId: input.requested.executorAgentId,
    now: input.now,
  });
  return input.requested;
}
