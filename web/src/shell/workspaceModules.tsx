import { FolderKanban, Inbox, ListTodo, Search, Settings, Users, type LucideIcon } from "lucide-react";
import type { SidebarModuleId, WorkspaceModuleId } from "./workspaceLayout.ts";

export interface WorkspaceModuleDefinition {
  id: WorkspaceModuleId;
  labelKey: string;
  Icon: LucideIcon;
  sidebar: boolean;
}

export const WORKSPACE_MODULES: readonly WorkspaceModuleDefinition[] = [
  { id: "spaces", labelKey: "nav.spaces", Icon: FolderKanban, sidebar: true },
  { id: "inbox", labelKey: "nav.inbox", Icon: Inbox, sidebar: true },
  { id: "tasks", labelKey: "nav.tasks", Icon: ListTodo, sidebar: true },
  { id: "agents", labelKey: "nav.agents", Icon: Users, sidebar: true },
  { id: "settings", labelKey: "nav.settings", Icon: Settings, sidebar: true },
  { id: "search", labelKey: "nav.search", Icon: Search, sidebar: false },
];

export const SIDEBAR_MODULES = WORKSPACE_MODULES.filter(
  (module): module is WorkspaceModuleDefinition & { id: SidebarModuleId } => module.sidebar && module.id !== "spaces",
);

export const HOME_SIDEBAR_MODULES = WORKSPACE_MODULES.filter(
  (module): module is WorkspaceModuleDefinition & { id: SidebarModuleId } => module.sidebar,
);

export const sidebarModulesForSpace = (isHome: boolean) => isHome ? HOME_SIDEBAR_MODULES : SIDEBAR_MODULES;

export function getWorkspaceModule(moduleId: WorkspaceModuleId) {
  return WORKSPACE_MODULES.find((module) => module.id === moduleId) ?? WORKSPACE_MODULES[0]!;
}
