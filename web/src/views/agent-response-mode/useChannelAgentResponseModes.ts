import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../../store.tsx";
import {
  normalizeChannelAgentResponseMode,
  normalizeChannelAgentResponseModes,
  withResponseModeOverride,
  type AgentResponseMode,
  type ChannelAgentResponseMode,
  type ChannelAgentResponseModes,
} from "./responseModeModel.ts";

interface ResponseModeState {
  channelId: string;
  modes: ChannelAgentResponseModes;
  loading: boolean;
  error: boolean;
}

const EMPTY_MODES: ChannelAgentResponseModes = {};

export interface ChannelAgentResponseModesResult {
  modes: ChannelAgentResponseModes;
  loading: boolean;
  error: boolean;
  setResponseModeOverride(agentId: string, value: AgentResponseMode | null): Promise<ChannelAgentResponseMode>;
}

export function useChannelAgentResponseModes(
  channelId: string | undefined,
  enabled = true,
): ChannelAgentResponseModesResult {
  const { api, onEvent } = useStore();
  const apiRef = useRef(api);
  apiRef.current = api;
  const activeChannelIdRef = useRef(channelId);
  activeChannelIdRef.current = channelId;
  const requestIdRef = useRef(0);
  const mutationVersionRef = useRef<Record<string, number>>({});
  const [state, setState] = useState<ResponseModeState>({ channelId: "", modes: EMPTY_MODES, loading: false, error: false });
  const stateRef = useRef(state);
  stateRef.current = state;

  const load = useCallback(async () => {
    if (!enabled || !channelId) return;
    const requestId = ++requestIdRef.current;
    setState((current) => ({
      channelId,
      modes: current.channelId === channelId ? current.modes : EMPTY_MODES,
      loading: true,
      error: false,
    }));
    try {
      const response = await apiRef.current("GET", `/api/channels/${encodeURIComponent(channelId)}/members`);
      if (requestIdRef.current !== requestId || activeChannelIdRef.current !== channelId) return;
      if (response?.error) throw new Error(String(response.error));
      setState({ channelId, modes: normalizeChannelAgentResponseModes(response?.agents), loading: false, error: false });
    } catch {
      if (requestIdRef.current !== requestId || activeChannelIdRef.current !== channelId) return;
      setState((current) => ({
        channelId,
        modes: current.channelId === channelId ? current.modes : EMPTY_MODES,
        loading: false,
        error: true,
      }));
    }
  }, [channelId, enabled]);

  useEffect(() => {
    if (!enabled || !channelId) {
      requestIdRef.current += 1;
      return;
    }
    void load();
  }, [channelId, enabled, load]);

  useEffect(() => onEvent((event) => {
    if (!enabled || !channelId) return;
    if (event.type === "channel:members-updated" && event.channelId === channelId) {
      void load();
      return;
    }
    if (event.type !== "agent:response-mode-updated" || typeof event.agentId !== "string") return;
    if (event.channelId && event.channelId !== channelId) return;
    const current = stateRef.current;
    if (!event.channelId && current.channelId === channelId && !current.loading && !current.modes[event.agentId]) return;
    void load();
  }), [channelId, enabled, load, onEvent]);

  const setResponseModeOverride = useCallback(async (agentId: string, value: AgentResponseMode | null) => {
    if (!enabled || !channelId) throw new Error("response_mode_not_applicable");
    const current = stateRef.current.channelId === channelId ? stateRef.current.modes[agentId] : undefined;
    if (!current) throw new Error("agent_not_a_channel_member");
    if (current.responseModeOverride === value) return current;
    const mutationVersion = (mutationVersionRef.current[agentId] ?? 0) + 1;
    mutationVersionRef.current[agentId] = mutationVersion;
    const requestVersion = requestIdRef.current;

    const optimistic = withResponseModeOverride(current, value);
    setState((previous) => ({
      ...previous,
      modes: { ...previous.modes, [agentId]: optimistic },
    }));

    try {
      const response = await apiRef.current(
        "PATCH",
        `/api/channels/${encodeURIComponent(channelId)}/members/${encodeURIComponent(agentId)}`,
        { responseModeOverride: value },
      );
      if (response?.error) throw new Error(String(response.error));
      const saved = normalizeChannelAgentResponseMode(response?.agent ?? response) ?? optimistic;
      const isCurrentMutation = mutationVersionRef.current[agentId] === mutationVersion;
      if (activeChannelIdRef.current === channelId && isCurrentMutation && requestIdRef.current === requestVersion) {
        setState((previous) => ({
          ...previous,
          modes: { ...previous.modes, [agentId]: saved },
          error: false,
        }));
      } else if (activeChannelIdRef.current === channelId && isCurrentMutation) {
        await load();
      }
      return saved;
    } catch (error) {
      if (activeChannelIdRef.current === channelId && mutationVersionRef.current[agentId] === mutationVersion) {
        setState((previous) => ({
          ...previous,
          modes: { ...previous.modes, [agentId]: current },
          error: true,
        }));
        await load();
      }
      throw error;
    }
  }, [channelId, enabled, load]);

  const currentState = enabled && channelId && state.channelId === channelId
    ? state
    : { channelId: channelId ?? "", modes: EMPTY_MODES, loading: false, error: false };

  return {
    modes: currentState.modes,
    loading: currentState.loading,
    error: currentState.error,
    setResponseModeOverride,
  };
}
