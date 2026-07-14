export const AGENT_RESPONSE_MODES = ["active", "mention_only", "silent"] as const;

export type AgentResponseMode = typeof AGENT_RESPONSE_MODES[number];
export type ResponseModeSource = "agent_default" | "channel_override";

export interface ChannelAgentResponseMode {
  agentId: string;
  defaultResponseMode: AgentResponseMode;
  responseModeOverride: AgentResponseMode | null;
  effectiveResponseMode: AgentResponseMode;
  responseModeSource: ResponseModeSource;
}

export type ChannelAgentResponseModes = Record<string, ChannelAgentResponseMode>;

export function isAgentResponseMode(value: unknown): value is AgentResponseMode {
  return typeof value === "string" && (AGENT_RESPONSE_MODES as readonly string[]).includes(value);
}

export function normalizeAgentResponseMode(value: unknown): AgentResponseMode {
  return isAgentResponseMode(value) ? value : "active";
}

export function normalizeChannelAgentResponseMode(raw: unknown): ChannelAgentResponseMode | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const agentId = typeof input.id === "string" ? input.id : typeof input.agentId === "string" ? input.agentId : "";
  if (!agentId) return null;

  const defaultResponseMode = normalizeAgentResponseMode(input.defaultResponseMode);
  const responseModeOverride = isAgentResponseMode(input.responseModeOverride) ? input.responseModeOverride : null;
  const effectiveResponseMode = isAgentResponseMode(input.effectiveResponseMode)
    ? input.effectiveResponseMode
    : responseModeOverride ?? defaultResponseMode;
  const responseModeSource: ResponseModeSource = input.responseModeSource === "channel_override" || responseModeOverride
    ? "channel_override"
    : "agent_default";

  return {
    agentId,
    defaultResponseMode,
    responseModeOverride,
    effectiveResponseMode,
    responseModeSource,
  };
}

export function normalizeChannelAgentResponseModes(rawAgents: unknown): ChannelAgentResponseModes {
  if (!Array.isArray(rawAgents)) return {};
  const result: ChannelAgentResponseModes = {};
  for (const raw of rawAgents) {
    const mode = normalizeChannelAgentResponseMode(raw);
    if (mode) result[mode.agentId] = mode;
  }
  return result;
}

export function withResponseModeOverride(
  current: ChannelAgentResponseMode,
  responseModeOverride: AgentResponseMode | null,
): ChannelAgentResponseMode {
  return {
    ...current,
    responseModeOverride,
    effectiveResponseMode: responseModeOverride ?? current.defaultResponseMode,
    responseModeSource: responseModeOverride ? "channel_override" : "agent_default",
  };
}

export function withDefaultResponseMode(
  current: ChannelAgentResponseMode,
  defaultResponseMode: AgentResponseMode,
): ChannelAgentResponseMode {
  return {
    ...current,
    defaultResponseMode,
    effectiveResponseMode: current.responseModeOverride ?? defaultResponseMode,
  };
}
