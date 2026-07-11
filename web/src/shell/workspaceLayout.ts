export type WorkspaceModuleId =
  | "inbox"
  | "tasks"
  | "agents"
  | "settings"
  | "search";

export type DockModuleId = Exclude<WorkspaceModuleId, "search">;

export type WorkspaceMode = "chat-only" | "split" | "module-only";

export type WorkspaceLayoutState =
  | { activeModule: null; chatVisible: true }
  | { activeModule: WorkspaceModuleId; chatVisible: boolean };

export const INITIAL_WORKSPACE_LAYOUT: WorkspaceLayoutState = {
  activeModule: null,
  chatVisible: true,
};

export function deriveWorkspaceMode(state: WorkspaceLayoutState): WorkspaceMode {
  if (state.activeModule === null) return "chat-only";
  return state.chatVisible ? "split" : "module-only";
}

export function selectWorkspaceModule(
  state: WorkspaceLayoutState,
  moduleId: WorkspaceModuleId,
): WorkspaceLayoutState {
  if (state.activeModule === moduleId) return INITIAL_WORKSPACE_LAYOUT;
  return { activeModule: moduleId, chatVisible: state.chatVisible };
}

export function toggleChat(state: WorkspaceLayoutState): WorkspaceLayoutState {
  if (state.activeModule === null) return state;
  return { ...state, chatVisible: !state.chatVisible };
}

export function openRouteModule(
  moduleId: WorkspaceModuleId,
  options: { chatVisible: boolean },
): WorkspaceLayoutState {
  return { activeModule: moduleId, chatVisible: options.chatVisible };
}
