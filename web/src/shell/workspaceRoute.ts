import { INITIAL_WORKSPACE_LAYOUT, type WorkspaceLayoutState, type WorkspaceModuleId } from "./workspaceLayout.ts";

export const SPACE_ROUTE_PATTERN = "/s/:slug";

export type WorkspaceRouteSection =
  | "channel"
  | "saved"
  | "showcase"
  | "inbox"
  | "tasks"
  | "agent"
  | "settings"
  | "search"
  | null;

export interface WorkspaceRouteMatch {
  section: WorkspaceRouteSection;
  resourceId: string | null;
  moduleId: WorkspaceModuleId | null;
  isChatRoute: boolean;
  isChannelRoute: boolean;
}

const MODULE_BY_SECTION: Partial<Record<Exclude<WorkspaceRouteSection, null>, WorkspaceModuleId>> = {
  inbox: "inbox",
  tasks: "tasks",
  agent: "agents",
  settings: "settings",
  search: "search",
};

const KNOWN_SECTIONS = new Set<Exclude<WorkspaceRouteSection, null>>([
  "channel",
  "saved",
  "showcase",
  "inbox",
  "tasks",
  "agent",
  "settings",
  "search",
]);

const MODULE_IDS = new Set<WorkspaceModuleId>([
  "inbox",
  "tasks",
  "agents",
  "settings",
  "search",
]);

const decodeSegment = (value: string | undefined) => {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export function parseWorkspaceRoute(pathname: string): WorkspaceRouteMatch {
  const match = pathname.match(/^\/s\/[^/]+(?:\/([^/?#]+))?(?:\/([^/?#]+))?/);
  const rawSection = decodeSegment(match?.[1]);
  const section = rawSection && KNOWN_SECTIONS.has(rawSection as Exclude<WorkspaceRouteSection, null>)
    ? rawSection as Exclude<WorkspaceRouteSection, null>
    : null;
  const resourceId = section ? decodeSegment(match?.[2]) : null;
  const moduleId = section ? MODULE_BY_SECTION[section] ?? null : null;
  const isChannelRoute = section === "channel";

  return {
    section,
    resourceId,
    moduleId,
    isChatRoute: isChannelRoute || section === "saved" || section === "showcase",
    isChannelRoute,
  };
}

export function workspaceLayoutFromRoute(route: WorkspaceRouteMatch, search: string): WorkspaceLayoutState {
  const params = new URLSearchParams(search);
  const requestedModule = params.get("module");
  const moduleId = requestedModule && MODULE_IDS.has(requestedModule as WorkspaceModuleId)
    ? requestedModule as WorkspaceModuleId
    : route.moduleId;
  if (moduleId === null) return INITIAL_WORKSPACE_LAYOUT;
  return {
    activeModule: moduleId,
    chatVisible: params.get("chat") !== "0",
  };
}

export function workspaceSearchForLayout(search: string, state: WorkspaceLayoutState) {
  const params = new URLSearchParams(search);
  params.delete("module");
  params.delete("chat");
  if (state.activeModule !== null) {
    params.set("module", state.activeModule);
    if (!state.chatVisible) params.set("chat", "0");
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function mergeWorkspaceSearch(target: string, preservedSearch: string) {
  if (!preservedSearch) return target;
  const queryIndex = target.indexOf("?");
  const pathname = queryIndex === -1 ? target : target.slice(0, queryIndex);
  const params = new URLSearchParams(queryIndex === -1 ? "" : target.slice(queryIndex));
  new URLSearchParams(preservedSearch).forEach((value, key) => params.set(key, value));
  const encoded = params.toString();
  return encoded ? `${pathname}?${encoded}` : pathname;
}
