import { useEffect, useState } from "react";
import { paneConstraints, WORKSPACE_PANE_GAP } from "./paneConstraints.ts";
import type { WorkspaceLayoutState } from "./workspaceLayout.ts";

export const WORKSPACE_PANE_TRANSITION_MS = 420;

export type WorkspacePaneTransition =
  | "none"
  | "open-module"
  | "close-module"
  | "show-chat"
  | "hide-chat";

export interface WorkspacePaneWidths {
  chat: number;
  divider: number;
  module: number;
}

const layoutsMatch = (left: WorkspaceLayoutState, right: WorkspaceLayoutState) => (
  left.activeModule === right.activeModule && left.chatVisible === right.chatVisible
);

export function workspacePaneTransition(
  previous: WorkspaceLayoutState,
  next: WorkspaceLayoutState,
): WorkspacePaneTransition {
  const previousHasModule = previous.activeModule !== null;
  const nextHasModule = next.activeModule !== null;

  if (!previousHasModule && nextHasModule) return "open-module";
  if (previousHasModule && !nextHasModule) return "close-module";
  if (previous.chatVisible && !next.chatVisible) return "hide-chat";
  if (!previous.chatVisible && next.chatVisible) return "show-chat";
  return "none";
}

export function workspacePaneWidths(
  layout: WorkspaceLayoutState,
  workspaceWidth: number,
  moduleRatio: number,
): WorkspacePaneWidths {
  const width = Math.max(0, Math.round(workspaceWidth));
  if (layout.activeModule === null) return { chat: width, divider: 0, module: 0 };
  if (!layout.chatVisible) return { chat: 0, divider: 0, module: width };

  const panes = paneConstraints(width, layout.activeModule, moduleRatio);
  if (!panes.canSplit) return { chat: width, divider: 0, module: 0 };
  return {
    chat: Math.max(0, width - WORKSPACE_PANE_GAP - panes.moduleWidth),
    divider: WORKSPACE_PANE_GAP,
    module: panes.moduleWidth,
  };
}

/** Keep both endpoint layouts mounted while their shared boundary moves. */
export function useWorkspacePaneTransition(layout: WorkspaceLayoutState) {
  const [settledLayout, setSettledLayout] = useState(layout);
  const [startedLayoutKey, setStartedLayoutKey] = useState<string | null>(null);
  const transition = workspacePaneTransition(settledLayout, layout);
  const layoutKey = `${layout.activeModule ?? "chat"}:${layout.chatVisible}`;
  const settledLayoutKey = `${settledLayout.activeModule ?? "chat"}:${settledLayout.chatVisible}`;
  const isTransitioning = transition !== "none";
  const transitionStarted = isTransitioning && startedLayoutKey === layoutKey;

  useEffect(() => {
    if (layoutsMatch(settledLayout, layout)) return;
    if (transition === "none") {
      setSettledLayout(layout);
      return;
    }

    let timeout: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      setStartedLayoutKey(layoutKey);
      timeout = window.setTimeout(() => {
        setSettledLayout(layout);
        setStartedLayoutKey(null);
      }, WORKSPACE_PANE_TRANSITION_MS);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [layoutKey, settledLayoutKey, transition]);

  return {
    animatedLayout: transitionStarted ? layout : settledLayout,
    isTransitioning,
    previousLayout: settledLayout,
    transition,
  };
}
