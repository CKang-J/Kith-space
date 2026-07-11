import { Inbox, ListTodo, Search, Settings, Users, type LucideIcon } from "lucide-react";
import type { DockModuleId, WorkspaceModuleId } from "./workspaceLayout.ts";

export interface WorkspaceModuleDefinition {
  id: WorkspaceModuleId;
  labelKey: string;
  Icon: LucideIcon;
  dock: boolean;
}

export const WORKSPACE_MODULES: readonly WorkspaceModuleDefinition[] = [
  { id: "inbox", labelKey: "nav.inbox", Icon: Inbox, dock: true },
  { id: "tasks", labelKey: "nav.tasks", Icon: ListTodo, dock: true },
  { id: "agents", labelKey: "nav.agents", Icon: Users, dock: true },
  { id: "settings", labelKey: "nav.settings", Icon: Settings, dock: true },
  { id: "search", labelKey: "nav.search", Icon: Search, dock: false },
];

export const DOCK_MODULES = WORKSPACE_MODULES.filter(
  (module): module is WorkspaceModuleDefinition & { id: DockModuleId } => module.dock,
);

export function getWorkspaceModule(moduleId: WorkspaceModuleId) {
  return WORKSPACE_MODULES.find((module) => module.id === moduleId) ?? WORKSPACE_MODULES[0]!;
}
