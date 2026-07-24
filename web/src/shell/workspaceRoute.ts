import { INITIAL_WORKSPACE_LAYOUT, type WorkspaceLayoutState, type WorkspaceModuleId } from "./workspaceLayout.ts";

export const SPACE_ROUTE_PATTERN = "/s/:slug/*";

export type WorkspaceRouteSection =
  | "channel"
  | "saved"
  | null;

export interface WorkspaceRouteMatch {
  section: WorkspaceRouteSection;
  resourceId: string | null;
  moduleId: WorkspaceModuleId | null;
  isChatRoute: boolean;
  isChannelRoute: boolean;
}

const KNOWN_SECTIONS = new Set<Exclude<WorkspaceRouteSection, null>>([
  "channel",
  "saved",
]);

const MODULE_IDS = new Set<WorkspaceModuleId>([
  "spaces",
  "inbox",
  "tasks",
  "agents",
  "settings",
  "search",
]);

type WorkspaceResourceModuleId = "tasks" | "agents" | "settings";
type WorkspaceModuleResourceParam = "taskScope" | "agent" | "settings";

const RESOURCE_PARAM_BY_MODULE: Record<WorkspaceResourceModuleId, WorkspaceModuleResourceParam> = {
  tasks: "taskScope",
  agents: "agent",
  settings: "settings",
};

const RESOURCE_PARAMS_BY_MODULE: Partial<Record<WorkspaceModuleId, readonly string[]>> = {
  tasks: ["taskScope"],
  agents: ["agent", "agentTab"],
  settings: ["settings"],
};

const ALL_MODULE_RESOURCE_PARAMS = Object.values(RESOURCE_PARAMS_BY_MODULE).flat();

export type WorkspaceModuleTarget =
  | { moduleId: "spaces" | "inbox" | "search" }
  | { moduleId: "tasks"; taskScope?: string | null }
  | { moduleId: "agents"; agent?: string | null; agentTab?: string | null }
  | { moduleId: "settings"; settings?: string | null };

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
  const isChannelRoute = section === "channel";

  return {
    section,
    resourceId,
    moduleId: null,
    isChatRoute: isChannelRoute || section === "saved",
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
    chatVisible: moduleId === "settings",
  };
}

export function workspaceSearchForLayout(search: string, state: WorkspaceLayoutState) {
  const params = new URLSearchParams(search);
  params.delete("module");
  params.delete("chat");
  const ownedResourceParams = state.activeModule === null
    ? []
    : RESOURCE_PARAMS_BY_MODULE[state.activeModule] ?? [];
  ALL_MODULE_RESOURCE_PARAMS.forEach((param) => {
    if (!ownedResourceParams.includes(param)) params.delete(param);
  });
  if (state.activeModule !== null) {
    params.set("module", state.activeModule);
    if (state.activeModule !== "settings") params.set("chat", "0");
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

/** Keep only durable workspace layout and the active module's resource while changing conversations. */
export function workspaceSearchForShellState(search: string, state: WorkspaceLayoutState) {
  const source = new URLSearchParams(search);
  const params = new URLSearchParams(workspaceSearchForLayout("", state));
  if (state.activeModule !== null) {
    for (const key of RESOURCE_PARAMS_BY_MODULE[state.activeModule] ?? []) {
      const value = source.get(key);
      if (value) params.set(key, value);
    }
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function workspaceModuleResourceFromSearch(search: string, moduleId: WorkspaceModuleId) {
  if (moduleId !== "tasks" && moduleId !== "agents" && moduleId !== "settings") return null;
  return new URLSearchParams(search).get(RESOURCE_PARAM_BY_MODULE[moduleId]);
}

const setOptionalParam = (params: URLSearchParams, key: string, value: string | null | undefined) => {
  params.delete(key);
  if (value) params.set(key, value);
};

const normalizeSettingsResource = (value: string | null | undefined) => {
  if (value === null || value === undefined) return value;
  return value === "human" || value === "space" || value === "models" || value === "runtimes"
    || value === "advisor" || value === "desktop" ? value : "human";
};

export function workspaceLocationForModule(
  pathname: string,
  search: string,
  target: WorkspaceModuleTarget,
  options: { chatVisible?: boolean } = {},
) {
  const nextSearch = workspaceSearchForLayout(search, {
    activeModule: target.moduleId,
    chatVisible: options.chatVisible ?? target.moduleId === "settings",
  });
  const params = new URLSearchParams(nextSearch);

  if (target.moduleId === "tasks") {
    setOptionalParam(params, "taskScope", target.taskScope);
  } else if (target.moduleId === "agents") {
    setOptionalParam(params, "agent", target.agent);
    setOptionalParam(params, "agentTab", target.agentTab);
  } else if (target.moduleId === "settings") {
    setOptionalParam(params, "settings", normalizeSettingsResource(target.settings));
  }

  const encoded = params.toString();
  return encoded ? `${pathname}?${encoded}` : pathname;
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

/** Change the active conversation without closing or resetting the current module workspace. */
export function workspaceLocationForConversation(
  target: string,
  currentPathname: string,
  currentSearch: string,
) {
  const layout = workspaceLayoutFromRoute(parseWorkspaceRoute(currentPathname), currentSearch);
  return mergeWorkspaceSearch(target, workspaceSearchForShellState(currentSearch, layout));
}
