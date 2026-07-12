import type { AgentStartReason } from "../local-runtime/agentStart.js";
import { CREATION_NUDGE, STARTUP_NUDGE, WAKE_NUDGE } from "./prompt.js";

export interface AgentInitialTurn {
  kind: "introduction" | "startup" | "wake";
  prompt: string;
}

export function selectAgentInitialTurn(input: {
  introduced?: boolean;
  reason: AgentStartReason;
  hasPendingDelivery: boolean;
}): AgentInitialTurn {
  if (input.reason === "wake" || input.hasPendingDelivery) return { kind: "wake", prompt: WAKE_NUDGE };
  return input.introduced
    ? { kind: "startup", prompt: STARTUP_NUDGE }
    : { kind: "introduction", prompt: CREATION_NUDGE };
}
