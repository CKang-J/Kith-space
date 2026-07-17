import type { AgentResponseMode, ChannelAgentResponseMode } from "../agent-response-mode/responseModeModel.ts";

export function shouldUpdateChannelResponseMode(
  member: ChannelAgentResponseMode,
  mode: AgentResponseMode,
): boolean {
  return member.responseModeOverride !== mode;
}
