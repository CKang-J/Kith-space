import { useEffect, useState } from "react";
import type { Agent } from "../../store.tsx";
import {
  getPendingCanvasChatContexts,
  isWholeCanvasChatContext,
  listOpenCanvasChatSources,
  pushCanvasChatSurface,
  removePendingCanvasChatContext,
  setPendingCanvasChatContext,
  subscribePendingCanvasChatContext,
  toggleOpenCanvasChatContext,
  toggleWholeCanvasChatContext,
  type PendingCanvasChatContext,
} from "@/features/canvas/host/canvasChatBridge";
import {
  buildCanvasComposerPayload,
  canvasComposerSendDisabled,
  parseCanvasExecutors,
  validateCanvasComposerSend,
  type CanvasComposerExecutor,
} from "./composerCanvasContext";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function useComposerCanvasContext(input: {
  channelId: string;
  api: (method: string, path: string, body?: unknown) => Promise<{ error?: unknown; agents?: unknown }>;
  dmAgent?: Agent;
  t: Translate;
}) {
  const { channelId, api, dmAgent, t } = input;
  const [canvasContexts, setCanvasContexts] = useState(() => getPendingCanvasChatContexts(channelId));
  const [openCanvases, setOpenCanvases] = useState(() => listOpenCanvasChatSources());
  const [executorAgentId, setExecutorAgentId] = useState("");
  const [canvasExecutors, setCanvasExecutors] = useState<CanvasComposerExecutor[]>([]);
  const [executorLoadError, setExecutorLoadError] = useState("");
  const selectionContexts = canvasContexts.filter((item) => !isWholeCanvasChatContext(item));
  const wholeCanvasContexts = canvasContexts.filter((item) => isWholeCanvasChatContext(item));
  const needsExecutorPicker = !dmAgent && canvasContexts.length > 0 && (Boolean(executorLoadError) || (!executorAgentId && canvasExecutors.length > 1));

  useEffect(() => subscribePendingCanvasChatContext(() => {
    setCanvasContexts(getPendingCanvasChatContexts(channelId));
    setOpenCanvases(listOpenCanvasChatSources());
  }), [channelId]);
  useEffect(() => {
    const release = pushCanvasChatSurface(channelId);
    setCanvasContexts(getPendingCanvasChatContexts(channelId));
    setOpenCanvases(listOpenCanvasChatSources());
    return () => {
      release();
    };
  }, [channelId]);
  useEffect(() => { setExecutorAgentId(""); setCanvasExecutors([]); setExecutorLoadError(""); }, [channelId]);
  useEffect(() => {
    if (!canvasContexts.length || dmAgent) return undefined;
    let live = true;
    api("GET", `/api/channels/${encodeURIComponent(channelId)}/canvas-executors`).then((result) => {
      if (!live) return;
      const parsed = parseCanvasExecutors(result);
      setCanvasExecutors(parsed.agents);
      if (parsed.error) {
        setExecutorLoadError(parsed.error);
        return;
      }
      if (!parsed.agents.length) setExecutorLoadError(t("chat.canvasExecutorUnavailable"));
      else {
        setExecutorLoadError("");
        if (parsed.agents.length === 1) setExecutorAgentId(parsed.agents[0]!.id);
      }
    }).catch((reason) => {
      if (!live) return;
      setCanvasExecutors([]);
      setExecutorLoadError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { live = false; };
  }, [api, canvasContexts.length, channelId, dmAgent, t]);

  return {
    canvasContexts,
    selectionContexts,
    wholeCanvasContexts,
    openCanvases,
    canvasAvailable: openCanvases.length > 0,
    canvasActive: wholeCanvasContexts.length > 0,
    executorAgentId,
    setExecutorAgentId,
    canvasExecutors,
    executorLoadError,
    canvasExpanded: selectionContexts.length > 0 || needsExecutorPicker,
    sendDisabled(sending: boolean, hasText: boolean, hasAttachments: boolean) {
      return canvasComposerSendDisabled({
        sending,
        hasText,
        hasAttachments,
        canvasContexts,
        dmAgent,
        executorAgentId,
        executorLoadError,
      });
    },
    validateSend(asTask: boolean): string | null {
      return validateCanvasComposerSend({
        canvasContexts,
        asTask,
        dmAgent,
        executorAgentId,
        executorLoadError,
        canvasCannotBeTask: t("chat.canvasCannotBeTask"),
        executorRequired: t("chat.canvasExecutorRequired"),
      });
    },
    buildSendPayload() {
      return buildCanvasComposerPayload({ canvasContexts, dmAgent, executorAgentId });
    },
    removeContext(pendingId: string) {
      removePendingCanvasChatContext(pendingId, channelId);
      if (canvasContexts.length <= 1) setExecutorAgentId("");
    },
    toggleCanvasAuthorization() {
      toggleOpenCanvasChatContext(channelId);
    },
    toggleCanvas(canvasId: string) {
      toggleWholeCanvasChatContext(canvasId, channelId);
    },
    clearAfterSend() {
      setPendingCanvasChatContext(null, channelId);
      setExecutorAgentId("");
    },
  };
}

export type ComposerCanvasContext = ReturnType<typeof useComposerCanvasContext> & {
  canvasContexts: PendingCanvasChatContext[];
};
