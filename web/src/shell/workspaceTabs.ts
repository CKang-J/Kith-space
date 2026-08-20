import type { ContentModuleId } from "./workspaceLayout.ts";

/**
 * A Workspace tab is a durable view of one module resource. It intentionally
 * excludes Settings: Settings remains a transient dialog rather than a tab.
 */
export interface WorkspaceTab {
  id: string;
  moduleId: ContentModuleId;
  resourceId: string | null;
  title: string | null;
}

export interface WorkspaceTabTarget {
  moduleId: ContentModuleId;
  resourceId?: string | null;
  title?: string | null;
}

export interface WorkspaceTabState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}

export interface WorkspaceTabStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredWorkspaceTabs {
  version: number;
  state: WorkspaceTabState;
}

const CONTENT_MODULE_IDS = new Set<ContentModuleId>([
  "spaces",
  "inbox",
  "tasks",
  "agents",
  "canvas",
  "search",
]);
const MAX_TAB_TITLE_LENGTH = 160;

export const WORKSPACE_TABS_STORAGE_VERSION = 1;
export const WORKSPACE_TABS_STORAGE_PREFIX = `kith-space.workspace-tabs.v${WORKSPACE_TABS_STORAGE_VERSION}:`;
export const EMPTY_WORKSPACE_TAB_STATE: WorkspaceTabState = {
  tabs: [],
  activeTabId: null,
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const normalizeResourceId = (resourceId: string | null | undefined) => (
  resourceId === null || resourceId === undefined || resourceId.length === 0 ? null : resourceId
);

const normalizeTitle = (title: string | null | undefined) => {
  if (title === null || title === undefined) return null;
  const trimmed = title.trim();
  return trimmed ? trimmed.slice(0, MAX_TAB_TITLE_LENGTH) : null;
};

const isContentModuleId = (value: unknown): value is ContentModuleId => (
  typeof value === "string" && CONTENT_MODULE_IDS.has(value as ContentModuleId)
);

/** A stable identity for a module and, when present, the resource it displays. */
export function workspaceTabId(target: Pick<WorkspaceTabTarget, "moduleId" | "resourceId">) {
  const resourceId = normalizeResourceId(target.resourceId);
  return resourceId === null ? target.moduleId : `${target.moduleId}:${encodeURIComponent(resourceId)}`;
}

export function createWorkspaceTab(target: WorkspaceTabTarget): WorkspaceTab {
  const resourceId = normalizeResourceId(target.resourceId);
  return {
    id: workspaceTabId({ moduleId: target.moduleId, resourceId }),
    moduleId: target.moduleId,
    resourceId,
    title: normalizeTitle(target.title),
  };
}

/**
 * Removes stale, malformed, duplicate, or no-longer-tab-capable data from an
 * untrusted persisted payload. The most recently-opened surviving tab becomes
 * active when the stored active tab is unavailable.
 */
export function sanitizeWorkspaceTabState(value: unknown): WorkspaceTabState {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return EMPTY_WORKSPACE_TAB_STATE;

  const tabs: WorkspaceTab[] = [];
  const tabIds = new Set<string>();
  for (const candidate of value.tabs) {
    if (!isRecord(candidate) || !isContentModuleId(candidate.moduleId)) continue;
    if (candidate.resourceId !== undefined && candidate.resourceId !== null && typeof candidate.resourceId !== "string") continue;
    if (candidate.title !== undefined && candidate.title !== null && typeof candidate.title !== "string") continue;
    const tab = createWorkspaceTab({
      moduleId: candidate.moduleId,
      resourceId: candidate.resourceId as string | null | undefined,
      title: candidate.title as string | null | undefined,
    });
    if (tabIds.has(tab.id)) continue;
    tabIds.add(tab.id);
    tabs.push(tab);
  }

  const requestedActiveTabId = typeof value.activeTabId === "string" ? value.activeTabId : null;
  const activeTabId = requestedActiveTabId && tabIds.has(requestedActiveTabId)
    ? requestedActiveTabId
    : tabs.at(-1)?.id ?? null;
  return { tabs, activeTabId };
}

/** Opens a tab or focuses its existing stable module/resource tab. */
export function openWorkspaceTab(state: WorkspaceTabState, target: WorkspaceTabTarget): WorkspaceTabState {
  const current = sanitizeWorkspaceTabState(state);
  const nextTab = createWorkspaceTab(target);
  const existingIndex = current.tabs.findIndex((tab) => tab.id === nextTab.id);
  if (existingIndex === -1) {
    return { tabs: [...current.tabs, nextTab], activeTabId: nextTab.id };
  }

  const existing = current.tabs[existingIndex]!;
  const tab = nextTab.title === null ? existing : nextTab;
  const tabs = tab === existing
    ? current.tabs
    : current.tabs.map((candidate, index) => index === existingIndex ? tab : candidate);
  return { tabs, activeTabId: tab.id };
}

/**
 * Closes a tab and, when it was active, focuses its following neighbour or its
 * preceding neighbour when the closed tab was last.
 */
export function closeWorkspaceTab(state: WorkspaceTabState, tabId: string): WorkspaceTabState {
  const current = sanitizeWorkspaceTabState(state);
  const closedIndex = current.tabs.findIndex((tab) => tab.id === tabId);
  if (closedIndex === -1) return current;

  const tabs = current.tabs.filter((tab) => tab.id !== tabId);
  if (current.activeTabId !== tabId) return { tabs, activeTabId: current.activeTabId };
  const adjacent = current.tabs[closedIndex + 1] ?? current.tabs[closedIndex - 1] ?? null;
  return { tabs, activeTabId: adjacent?.id ?? null };
}

export function renameWorkspaceResourceTab(
  state: WorkspaceTabState,
  moduleId: ContentModuleId,
  resourceId: string,
  title: string,
): WorkspaceTabState {
  const current = sanitizeWorkspaceTabState(state);
  const id = workspaceTabId({ moduleId, resourceId });
  const normalized = normalizeTitle(title);
  if (normalized === null || !current.tabs.some((tab) => tab.id === id)) return current;
  return { ...current, tabs: current.tabs.map((tab) => tab.id === id ? { ...tab, title: normalized } : tab) };
}

export function removeWorkspaceResourceTab(
  state: WorkspaceTabState,
  moduleId: ContentModuleId,
  resourceId: string,
): WorkspaceTabState {
  return closeWorkspaceTab(state, workspaceTabId({ moduleId, resourceId }));
}

/** Returns the current tab only when it is still present in the state. */
export function activeWorkspaceTab(state: WorkspaceTabState): WorkspaceTab | null {
  return state.activeTabId === null
    ? null
    : state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

export function workspaceTabStorageKey(spaceId: string) {
  return `${WORKSPACE_TABS_STORAGE_PREFIX}${encodeURIComponent(spaceId)}`;
}

export function restoreWorkspaceTabState(storage: WorkspaceTabStorage | null | undefined, spaceId: string): WorkspaceTabState {
  if (!storage) return EMPTY_WORKSPACE_TAB_STATE;
  try {
    const raw = storage.getItem(workspaceTabStorageKey(spaceId));
    if (!raw) return EMPTY_WORKSPACE_TAB_STATE;
    const payload = JSON.parse(raw) as unknown;
    if (!isRecord(payload) || payload.version !== WORKSPACE_TABS_STORAGE_VERSION) return EMPTY_WORKSPACE_TAB_STATE;
    return sanitizeWorkspaceTabState(payload.state);
  } catch {
    return EMPTY_WORKSPACE_TAB_STATE;
  }
}

/** Persists the sanitized, versioned state under the current Space only. */
export function persistWorkspaceTabState(
  storage: WorkspaceTabStorage | null | undefined,
  spaceId: string,
  state: WorkspaceTabState,
) {
  if (!storage) return;
  const payload: StoredWorkspaceTabs = {
    version: WORKSPACE_TABS_STORAGE_VERSION,
    state: sanitizeWorkspaceTabState(state),
  };
  try {
    storage.setItem(workspaceTabStorageKey(spaceId), JSON.stringify(payload));
  } catch {
    // Storage can be disabled or quota-limited; workspace tabs remain usable in memory.
  }
}
