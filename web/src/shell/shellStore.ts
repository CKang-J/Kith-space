import { useSyncExternalStore } from "react";

export type ShellView = "overview" | "space";
export type DockModule = "tasks" | "calendar" | "files" | "trace" | "canvas";

export interface ShellState {
  view: ShellView;
  currentSpaceId: string | null;
  rightPanelWidth: number;
  isRightPanelHidden: boolean;
  activeDockModule: DockModule;
  promotedModule: DockModule | null;
}

export const RIGHT_PANEL_MIN = 280;
export const RIGHT_PANEL_MAX = 640;

const clampRightPanelWidth = (width: number) =>
  Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, Math.round(width)));

const defaultRightPanelWidth = () => {
  if (typeof window === "undefined") return 360;
  return clampRightPanelWidth(Math.min(480, Math.max(320, window.innerWidth * 0.32)));
};

let state: ShellState = {
  view: "overview",
  currentSpaceId: null,
  rightPanelWidth: defaultRightPanelWidth(),
  isRightPanelHidden: false,
  activeDockModule: "tasks",
  promotedModule: null,
};

const listeners = new Set<() => void>();

const update = (patch: Partial<ShellState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const shellActions = {
  enterSpace: (spaceId: string) => update({ view: "space", currentSpaceId: spaceId }),
  returnToOverview: () => update({ view: "overview", currentSpaceId: null, promotedModule: null }),
  setRightPanelWidth: (width: number) => update({ rightPanelWidth: clampRightPanelWidth(width) }),
  setRightPanelHidden: (hidden: boolean) => update({ isRightPanelHidden: hidden }),
  setActiveDockModule: (activeDockModule: DockModule) => update({ activeDockModule }),
  promoteModule: (promotedModule: DockModule) =>
    update({ promotedModule, activeDockModule: promotedModule, isRightPanelHidden: false }),
  restoreModule: () => update({ promotedModule: null }),
};

export function useShellStore() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
