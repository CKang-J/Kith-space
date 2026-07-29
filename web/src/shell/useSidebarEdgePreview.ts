import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type TransitionEvent,
} from "react";

const SIDEBAR_PREVIEW_INTENT_DELAY_MS = 85;
const SIDEBAR_PREVIEW_CLOSE_DELAY_MS = 180;
const SIDEBAR_PREVIEW_CLOSE_FALLBACK_MS = 240;

type SidebarPreviewState = "closed" | "intent" | "opening" | "open" | "closing";

interface SidebarEdgePreviewOptions {
  collapsed: boolean;
  disabled?: boolean;
}

export function useSidebarEdgePreview({
  collapsed,
  disabled = false,
}: SidebarEdgePreviewOptions) {
  const [previewState, setPreviewState] = useState<SidebarPreviewState>("closed");
  const previewStateRef = useRef<SidebarPreviewState>("closed");
  const intentTimerRef = useRef<number | null>(null);
  const openingFrameRef = useRef<number | null>(null);
  const closeDelayTimerRef = useRef<number | null>(null);
  const closeTransitionTimerRef = useRef<number | null>(null);

  const updatePreviewState = useCallback((next: SidebarPreviewState) => {
    if (previewStateRef.current === next) return;
    previewStateRef.current = next;
    setPreviewState(next);
  }, []);

  const cancelIntent = useCallback(() => {
    if (intentTimerRef.current === null) return;
    window.clearTimeout(intentTimerRef.current);
    intentTimerRef.current = null;
  }, []);

  const cancelOpeningFrame = useCallback(() => {
    if (openingFrameRef.current === null) return;
    window.cancelAnimationFrame(openingFrameRef.current);
    openingFrameRef.current = null;
  }, []);

  const cancelScheduledClose = useCallback(() => {
    if (closeDelayTimerRef.current === null) return;
    window.clearTimeout(closeDelayTimerRef.current);
    closeDelayTimerRef.current = null;
  }, []);

  const cancelCloseTransition = useCallback(() => {
    if (closeTransitionTimerRef.current === null) return;
    window.clearTimeout(closeTransitionTimerRef.current);
    closeTransitionTimerRef.current = null;
  }, []);

  const closePreviewImmediately = useCallback(() => {
    cancelIntent();
    cancelOpeningFrame();
    cancelScheduledClose();
    cancelCloseTransition();
    updatePreviewState("closed");
  }, [
    cancelCloseTransition,
    cancelIntent,
    cancelOpeningFrame,
    cancelScheduledClose,
    updatePreviewState,
  ]);

  const beginPreviewClose = useCallback(() => {
    cancelIntent();
    cancelOpeningFrame();
    cancelScheduledClose();
    cancelCloseTransition();
    if (previewStateRef.current === "closed") return;
    updatePreviewState("closing");
    closeTransitionTimerRef.current = window.setTimeout(() => {
      updatePreviewState("closed");
      closeTransitionTimerRef.current = null;
    }, SIDEBAR_PREVIEW_CLOSE_FALLBACK_MS);
  }, [
    cancelCloseTransition,
    cancelIntent,
    cancelOpeningFrame,
    cancelScheduledClose,
    updatePreviewState,
  ]);

  const finishPreviewClose = useCallback(() => {
    if (previewStateRef.current !== "closing") return;
    cancelCloseTransition();
    updatePreviewState("closed");
  }, [cancelCloseTransition, updatePreviewState]);

  const completePreviewOpenAfterPaint = useCallback(() => {
    cancelOpeningFrame();
    openingFrameRef.current = window.requestAnimationFrame(() => {
      openingFrameRef.current = window.requestAnimationFrame(() => {
        openingFrameRef.current = null;
        if (previewStateRef.current === "opening") updatePreviewState("open");
      });
    });
  }, [cancelOpeningFrame, updatePreviewState]);

  const openPreview = useCallback(() => {
    if (!collapsed || disabled) return;
    const current = previewStateRef.current;
    if (current === "closing") return;
    cancelScheduledClose();
    cancelCloseTransition();
    if (current === "closed") {
      updatePreviewState("intent");
      intentTimerRef.current = window.setTimeout(() => {
        intentTimerRef.current = null;
        if (previewStateRef.current !== "intent") return;
        updatePreviewState("opening");
        completePreviewOpenAfterPaint();
      }, SIDEBAR_PREVIEW_INTENT_DELAY_MS);
      return;
    }
    if (current === "opening") completePreviewOpenAfterPaint();
  }, [
    cancelCloseTransition,
    cancelScheduledClose,
    collapsed,
    completePreviewOpenAfterPaint,
    disabled,
    updatePreviewState,
  ]);

  const retainPreview = useCallback(() => {
    if (
      !collapsed
      || disabled
      || previewStateRef.current === "closed"
      || previewStateRef.current === "closing"
    ) return;
    cancelScheduledClose();
    cancelCloseTransition();
  }, [
    cancelCloseTransition,
    cancelScheduledClose,
    collapsed,
    disabled,
  ]);

  const schedulePreviewClose = useCallback(() => {
    if (disabled || previewStateRef.current === "closed") return;
    if (previewStateRef.current === "intent") {
      closePreviewImmediately();
      return;
    }
    cancelScheduledClose();
    closeDelayTimerRef.current = window.setTimeout(() => {
      beginPreviewClose();
      closeDelayTimerRef.current = null;
    }, SIDEBAR_PREVIEW_CLOSE_DELAY_MS);
  }, [
    beginPreviewClose,
    cancelScheduledClose,
    closePreviewImmediately,
    disabled,
  ]);

  useEffect(() => {
    if (!collapsed || disabled) closePreviewImmediately();
  }, [closePreviewImmediately, collapsed, disabled]);

  useEffect(() => {
    if (previewState === "closed") return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (previewStateRef.current === "intent") closePreviewImmediately();
      else beginPreviewClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [beginPreviewClose, closePreviewImmediately, previewState]);

  useEffect(() => () => {
    cancelIntent();
    cancelOpeningFrame();
    cancelScheduledClose();
    cancelCloseTransition();
  }, [
    cancelCloseTransition,
    cancelIntent,
    cancelOpeningFrame,
    cancelScheduledClose,
  ]);

  const handlePreviewTransitionEnd = useCallback((event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "transform") return;
    finishPreviewClose();
  }, [finishPreviewClose]);

  return {
    previewState,
    openPreview,
    retainPreview,
    schedulePreviewClose,
    handlePreviewTransitionEnd,
  };
}

export function useAutoCollapseSidebarForWorkspace(
  activeWorkspaceKey: string | null,
  collapseSidebar: () => void,
) {
  const previousWorkspaceKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const previousWorkspaceKey = previousWorkspaceKeyRef.current;
    previousWorkspaceKeyRef.current = activeWorkspaceKey;
    if (activeWorkspaceKey && activeWorkspaceKey !== previousWorkspaceKey) {
      collapseSidebar();
    }
  }, [activeWorkspaceKey, collapseSidebar]);
}
