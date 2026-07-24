export const CHAT_PANE_ABSOLUTE_MIN = 568;
export const CHAT_PANE_MIN_RATIO = 0.25;
export const WORKSPACE_PANE_GAP = 10;
export const AGGREGATE_PANE_WIDTH = 300;

export interface AggregatePaneConstraints {
  width: number;
  canShow: boolean;
}

export const chatPaneMin = (workspaceWidth: number) => Math.max(
  CHAT_PANE_ABSOLUTE_MIN,
  Math.round(Math.max(0, workspaceWidth) * CHAT_PANE_MIN_RATIO),
);

export function aggregatePaneConstraints(workspaceWidth: number): AggregatePaneConstraints {
  const width = Math.max(0, Math.round(workspaceWidth));
  const chatMin = chatPaneMin(width);
  return {
    width: AGGREGATE_PANE_WIDTH,
    canShow: width >= chatMin + AGGREGATE_PANE_WIDTH + WORKSPACE_PANE_GAP,
  };
}
