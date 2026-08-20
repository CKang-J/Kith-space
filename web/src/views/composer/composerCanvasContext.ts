import type { PendingCanvasChatContext } from "@/features/canvas/host/canvasChatBridge";

export type CanvasComposerExecutor = { id: string; name: string; displayName: string };

export function canvasComposerSendDisabled(input: {
  sending: boolean;
  hasText: boolean;
  hasAttachments: boolean;
  canvasContexts: readonly unknown[];
  dmAgent?: unknown;
  executorAgentId: string;
  executorLoadError: string;
}): boolean {
  if (input.sending) return true;
  if (!input.hasText && !input.hasAttachments && !input.canvasContexts.length) return true;
  return Boolean(input.canvasContexts.length && !input.dmAgent && (!input.executorAgentId || input.executorLoadError));
}

export function validateCanvasComposerSend(input: {
  canvasContexts: readonly unknown[];
  asTask: boolean;
  dmAgent?: unknown;
  executorAgentId: string;
  executorLoadError: string;
  canvasCannotBeTask: string;
  executorRequired: string;
}): string | null {
  if (!input.canvasContexts.length) return null;
  if (input.asTask) return input.canvasCannotBeTask;
  if (!input.dmAgent && (!input.executorAgentId || input.executorLoadError)) {
    return input.executorLoadError || input.executorRequired;
  }
  return null;
}

export function buildCanvasComposerPayload(input: {
  canvasContexts: PendingCanvasChatContext[];
  dmAgent?: { id: string } | null;
  executorAgentId: string;
}): { canvasSelections: Array<{ canvasId: string; selectedIds: string[]; markedRegions?: PendingCanvasChatContext["markedRegions"] }>; executionBinding?: { executorAgentId: string; mode: "required" } } | Record<string, never> {
  if (!input.canvasContexts.length) return {};
  return {
    canvasSelections: input.canvasContexts.map((item) => ({
      canvasId: item.canvasId,
      selectedIds: item.selectedIds,
      ...(item.markedRegions?.length ? { markedRegions: item.markedRegions } : {}),
    })),
    ...(input.dmAgent ? {} : { executionBinding: { executorAgentId: input.executorAgentId, mode: "required" as const } }),
  };
}

export function parseCanvasExecutors(result: { error?: unknown; agents?: unknown } | null | undefined): {
  agents: CanvasComposerExecutor[];
  error: string | null;
} {
  if (result?.error) return { agents: [], error: String(result.error) };
  const agents = Array.isArray(result?.agents)
    ? (result.agents as CanvasComposerExecutor[]).filter((agent) => agent && typeof agent.id === "string")
    : [];
  return { agents, error: null };
}
