import type { WorkspaceModuleId } from "./workspaceLayout.ts";

export const CHAT_PANE_ABSOLUTE_MIN = 360;
export const CHAT_PANE_MIN_RATIO = 0.25;
export const DEFAULT_MODULE_RATIO = 0.75;
export const WORKSPACE_PANE_GAP = 10;
export const AGGREGATE_PANE_WIDTH = 300;

const MODULE_PANE_MIN: Record<WorkspaceModuleId, number> = {
  spaces: 640,
  inbox: 640,
  tasks: 560,
  agents: 640,
  settings: 640,
  search: 560,
};

export interface PaneConstraints {
  chatMin: number;
  moduleMin: number;
  moduleMax: number;
  moduleWidth: number;
  canSplit: boolean;
}

export interface AggregatePaneConstraints {
  width: number;
  moduleMax: number;
  canShow: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const normalizeModuleRatio = (ratio: number) => {
  if (!Number.isFinite(ratio)) return DEFAULT_MODULE_RATIO;
  return clamp(ratio, 0, 1);
};

export const chatPaneMin = (workspaceWidth: number) => Math.max(
  CHAT_PANE_ABSOLUTE_MIN,
  Math.round(Math.max(0, workspaceWidth) * CHAT_PANE_MIN_RATIO),
);

export const modulePaneMin = (moduleId: WorkspaceModuleId) => MODULE_PANE_MIN[moduleId];

export function paneConstraints(
  workspaceWidth: number,
  moduleId: WorkspaceModuleId,
  moduleRatio: number,
): PaneConstraints {
  const width = Math.max(0, Math.round(workspaceWidth));
  const chatMin = chatPaneMin(width);
  const moduleMin = modulePaneMin(moduleId);
  const moduleMax = Math.max(0, width - chatMin - WORKSPACE_PANE_GAP);
  const canSplit = moduleMax >= moduleMin;
  const preferredWidth = Math.round(width * normalizeModuleRatio(moduleRatio));
  const moduleWidth = canSplit
    ? clamp(preferredWidth, moduleMin, moduleMax)
    : moduleMax;

  return { chatMin, moduleMin, moduleMax, moduleWidth, canSplit };
}

export function aggregatePaneConstraints(
  workspaceWidth: number,
  moduleId: WorkspaceModuleId | null,
  chatVisible: boolean,
): AggregatePaneConstraints {
  const width = Math.max(0, Math.round(workspaceWidth));
  if (!chatVisible) return { width: AGGREGATE_PANE_WIDTH, moduleMax: 0, canShow: false };

  const chatMin = chatPaneMin(width);
  const moduleMin = moduleId ? modulePaneMin(moduleId) : 0;
  const gapCount = moduleId ? 2 : 1;
  const moduleMax = moduleId
    ? Math.max(0, width - chatMin - AGGREGATE_PANE_WIDTH - gapCount * WORKSPACE_PANE_GAP)
    : 0;
  const requiredWidth = chatMin + AGGREGATE_PANE_WIDTH + gapCount * WORKSPACE_PANE_GAP + moduleMin;

  return {
    width: AGGREGATE_PANE_WIDTH,
    moduleMax,
    canShow: width >= requiredWidth,
  };
}

export const moduleRatioFromWidth = (moduleWidth: number, workspaceWidth: number) => {
  if (workspaceWidth <= 0) return DEFAULT_MODULE_RATIO;
  return normalizeModuleRatio(moduleWidth / workspaceWidth);
};
