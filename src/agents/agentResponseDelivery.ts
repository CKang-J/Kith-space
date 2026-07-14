import {
  applyAgentResponseWakeWatermark,
  decideAgentResponse,
  type AgentResponseDecision,
  type AgentResponseMode,
} from "./agentResponsePolicy.js";

export type AgentResponseDeliveryDecision = AgentResponseDecision;

export interface AgentMessageResponseInput {
  agentId: string;
  channelType: "channel" | "private" | "dm" | "thread";
  senderType: "human" | "agent" | "system";
  effectiveMode: AgentResponseMode;
  messageSeq: number;
  mentioned?: boolean;
  explicitTaskAssignment?: boolean;
  taskAssigneeId?: string | null;
  parentTaskAssigneeId?: string | null;
  isTask?: boolean;
  ambientWakeAfterSeq?: number;
  mentionWakeAfterSeq?: number;
}

/**
 * Applies the persisted response mode and the member's non-retroactive wake boundaries to one message.
 * Membership/lifecycle/dispatch guards stay with the caller; every delivery surface shares this decision.
 */
export function decideAgentMessageResponse(input: AgentMessageResponseInput): AgentResponseDeliveryDecision {
  const explicitTaskAssignment = Boolean(input.explicitTaskAssignment)
    || input.taskAssigneeId === input.agentId
    || (input.channelType === "thread"
      && input.senderType === "system"
      && input.parentTaskAssigneeId === input.agentId);
  const decision = decideAgentResponse({
    channelType: input.channelType,
    senderType: input.senderType,
    effectiveMode: input.effectiveMode,
    mentioned: input.mentioned,
    explicitTaskAssignment,
    unassignedTask: Boolean(input.isTask && !input.taskAssigneeId),
    participatingThreadHumanFollowUp: input.channelType === "thread" && input.senderType === "human",
  });

  return applyAgentResponseWakeWatermark(decision, input.messageSeq, {
    ambientWakeAfterSeq: input.ambientWakeAfterSeq ?? 0,
    mentionWakeAfterSeq: input.mentionWakeAfterSeq ?? 0,
  });
}
