export type WorkspaceModuleId =
  | "spaces"
  | "inbox"
  | "tasks"
  | "agents"
  | "settings"
  | "search";

export type SidebarModuleId = Exclude<WorkspaceModuleId, "search">;
export type ContentModuleId = Exclude<WorkspaceModuleId, "settings">;

export type WorkspaceMode = "chat-only" | "module-only";

export type WorkspaceLayoutState =
  | { activeModule: null; chatVisible: true }
  | { activeModule: WorkspaceModuleId; chatVisible: boolean };

export const INITIAL_WORKSPACE_LAYOUT: WorkspaceLayoutState = {
  activeModule: null,
  chatVisible: true,
};

export function workspaceLayoutForSpace(state: WorkspaceLayoutState, isHome: boolean): WorkspaceLayoutState {
  return state.activeModule === "spaces" && !isHome ? INITIAL_WORKSPACE_LAYOUT : state;
}

export function deriveWorkspaceMode(state: WorkspaceLayoutState): WorkspaceMode {
  return state.activeModule === null || state.activeModule === "settings"
    ? "chat-only"
    : "module-only";
}

export function selectWorkspaceModule(
  state: WorkspaceLayoutState,
  moduleId: WorkspaceModuleId,
): WorkspaceLayoutState {
  if (state.activeModule === moduleId) return INITIAL_WORKSPACE_LAYOUT;
  return { activeModule: moduleId, chatVisible: moduleId === "settings" };
}

export function openRouteModule(
  moduleId: WorkspaceModuleId,
  options: { chatVisible: boolean },
): WorkspaceLayoutState {
  return { activeModule: moduleId, chatVisible: options.chatVisible };
}
