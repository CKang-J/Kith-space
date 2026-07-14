import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

const PANEL_TRANSITION_MS = 420;

export function historyTraversalDelta(originIndex: unknown, targetIndex: unknown): number {
  return typeof originIndex === "number" && typeof targetIndex === "number"
    ? originIndex - targetIndex
    : 1;
}

interface ChannelSettingsSceneOptions {
  aggregateOpen: boolean;
  setAggregateOpen: Dispatch<SetStateAction<boolean>>;
  beginAggregateMotion(): void;
  routeChannelId: string | null;
  spaceId: string;
  chatVisible: boolean;
  confirmDiscard(): Promise<boolean>;
}

export function useChannelSettingsScene({
  aggregateOpen,
  setAggregateOpen,
  beginAggregateMotion,
  routeChannelId,
  spaceId,
  chatVisible,
  confirmDiscard,
}: ChannelSettingsSceneOptions) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const clearTimer = useCallback(() => {
    if (clearTimerRef.current === null) return;
    window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = null;
  }, []);

  const restoreFocus = useCallback(() => {
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger?.isConnected) trigger.focus();
  }, []);

  const returnToContent = useCallback(() => {
    clearTimer();
    setDirty(false);
    setChannelId(null);
    window.requestAnimationFrame(restoreFocus);
  }, [clearTimer, restoreFocus]);

  const open = useCallback((nextChannelId: string, trigger?: HTMLButtonElement) => {
    clearTimer();
    triggerRef.current = trigger ?? null;
    setDirty(false);
    setChannelId(nextChannelId);
    if (!aggregateOpen) beginAggregateMotion();
    setAggregateOpen(true);
  }, [aggregateOpen, beginAggregateMotion, clearTimer, setAggregateOpen]);

  const close = useCallback(() => {
    clearTimer();
    setDirty(false);
    if (aggregateOpen) beginAggregateMotion();
    setAggregateOpen(false);
    clearTimerRef.current = window.setTimeout(() => {
      setChannelId(null);
      clearTimerRef.current = null;
      restoreFocus();
    }, PANEL_TRANSITION_MS);
  }, [aggregateOpen, beginAggregateMotion, clearTimer, restoreFocus, setAggregateOpen]);

  const requestExit = useCallback(async (shouldExit: boolean) => {
    if (!shouldExit || !channelId) return true;
    if (dirty && !(await confirmDiscard())) return false;
    returnToContent();
    return true;
  }, [channelId, confirmDiscard, dirty, returnToContent]);

  const beforeAggregateToggle = useCallback(async () => {
    if (!aggregateOpen || !channelId) return true;
    if (dirty && !(await confirmDiscard())) return false;
    setDirty(false);
    clearTimer();
    clearTimerRef.current = window.setTimeout(() => {
      setChannelId(null);
      clearTimerRef.current = null;
    }, PANEL_TRANSITION_MS);
    return true;
  }, [aggregateOpen, channelId, clearTimer, confirmDiscard, dirty]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  useEffect(() => {
    if (dirty) return;
    clearTimer();
    triggerRef.current = null;
    setChannelId(null);
  }, [clearTimer, dirty, routeChannelId, spaceId]);

  useEffect(() => {
    if (chatVisible || dirty) return;
    clearTimer();
    triggerRef.current = null;
    setChannelId(null);
  }, [chatVisible, clearTimer, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const preventDiscard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventDiscard);
    return () => window.removeEventListener("beforeunload", preventDiscard);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const originIndex = window.history.state?.idx;
    let restoring: (() => void) | null = null;
    let promptPending = false;

    const onPopState = (event: PopStateEvent) => {
      if (restoring) {
        const restored = restoring;
        restoring = null;
        restored();
        return;
      }
      if (promptPending) return;
      const delta = historyTraversalDelta(originIndex, event.state?.idx);
      if (!delta) return;
      promptPending = true;
      const restored = new Promise<void>((resolve) => { restoring = resolve; });
      // A nested history traversal can be ignored while the current popstate
      // dispatch is still being committed. Defer the restoring traversal so
      // the settings form remains mounted before asking whether to discard it.
      window.setTimeout(() => window.history.go(delta), 0);
      void restored.then(async () => {
        const discard = await confirmDiscard();
        promptPending = false;
        if (!discard) return;
        returnToContent();
        window.setTimeout(() => window.history.go(-delta), 0);
      });
    };

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      restoring?.();
    };
  }, [confirmDiscard, dirty, returnToContent]);

  return {
    channelId,
    dirty,
    triggerRef,
    setDirty,
    open,
    close,
    returnToContent,
    requestExit,
    beforeAggregateToggle,
  };
}
