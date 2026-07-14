export const AGENT_RESPONSE_MODES = ["active", "mention_only", "silent"] as const;

export type AgentResponseMode = (typeof AGENT_RESPONSE_MODES)[number];
export type ResponseDirective = "required" | "optional" | "observe";
export type ResponseDeliveryClass = "direct" | "mention" | "ambient" | "observe";
export type AgentResponseReason =
  | "explicit_task_assignment"
  | "direct_message"
  | "explicit_mention"
  | "silent_mention"
  | "participating_thread_follow_up"
  | "silent_thread_follow_up"
  | "human_ambient_message"
  | "human_unassigned_task"
  | "response_mode_observe"
  | "before_ambient_wake_watermark"
  | "before_mention_wake_watermark"
  | "agent_ambient_suppressed"
  | "unsupported_event";

export interface AgentResponsePolicyInput {
  channelType: "channel" | "private" | "dm" | "thread";
  senderType: "human" | "agent" | "system";
  effectiveMode: AgentResponseMode;
  mentioned?: boolean;
  explicitTaskAssignment?: boolean;
  unassignedTask?: boolean;
  participatingThreadHumanFollowUp?: boolean;
}

export interface AgentResponseDecision {
  wake: boolean;
  directive: ResponseDirective;
  deliveryClass: ResponseDeliveryClass;
  reason: AgentResponseReason;
}

export function isAgentResponseMode(value: unknown): value is AgentResponseMode {
  return typeof value === "string" && AGENT_RESPONSE_MODES.includes(value as AgentResponseMode);
}

export function decideAgentResponse(input: AgentResponsePolicyInput): AgentResponseDecision {
  if (input.explicitTaskAssignment) {
    return {
      wake: true,
      directive: "required",
      deliveryClass: "direct",
      reason: "explicit_task_assignment",
    };
  }
  if (input.channelType === "dm" && input.senderType !== "system") {
    return {
      wake: true,
      directive: "required",
      deliveryClass: "direct",
      reason: "direct_message",
    };
  }
  if (input.mentioned) {
    if (input.effectiveMode === "silent") {
      return {
        wake: false,
        directive: "observe",
        deliveryClass: "observe",
        reason: "silent_mention",
      };
    }
    return {
      wake: true,
      directive: "required",
      deliveryClass: "mention",
      reason: "explicit_mention",
    };
  }
  if (
    input.channelType === "thread"
    && input.senderType === "human"
    && input.participatingThreadHumanFollowUp
  ) {
    if (input.effectiveMode === "silent") {
      return {
        wake: false,
        directive: "observe",
        deliveryClass: "observe",
        reason: "silent_thread_follow_up",
      };
    }
    return {
      wake: true,
      directive: "optional",
      deliveryClass: "mention",
      reason: "participating_thread_follow_up",
    };
  }
  if (
    input.senderType === "human"
    && (input.channelType === "channel" || input.channelType === "private")
  ) {
    if (input.effectiveMode === "active") {
      return {
        wake: true,
        directive: "optional",
        deliveryClass: "ambient",
        reason: input.unassignedTask ? "human_unassigned_task" : "human_ambient_message",
      };
    }
    return {
      wake: false,
      directive: "observe",
      deliveryClass: "observe",
      reason: "response_mode_observe",
    };
  }
  if (input.senderType === "agent") {
    return {
      wake: false,
      directive: "observe",
      deliveryClass: "observe",
      reason: "agent_ambient_suppressed",
    };
  }
  return {
    wake: false,
    directive: "observe",
    deliveryClass: "observe",
    reason: "unsupported_event",
  };
}

export function applyAgentResponseWakeWatermark(
  decision: AgentResponseDecision,
  messageSeq: number,
  watermarks: { ambientWakeAfterSeq: number; mentionWakeAfterSeq: number },
): AgentResponseDecision {
  if (!decision.wake || decision.deliveryClass === "direct") return decision;
  if (decision.deliveryClass === "ambient" && messageSeq <= watermarks.ambientWakeAfterSeq) {
    return {
      wake: false,
      directive: "observe",
      deliveryClass: "observe",
      reason: "before_ambient_wake_watermark",
    };
  }
  if (decision.deliveryClass === "mention" && messageSeq <= watermarks.mentionWakeAfterSeq) {
    return {
      wake: false,
      directive: "observe",
      deliveryClass: "observe",
      reason: "before_mention_wake_watermark",
    };
  }
  return decision;
}
