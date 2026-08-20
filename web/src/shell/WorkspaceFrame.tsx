import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useConfirm } from "../ConfirmModal.tsx";
import { QuickSwitcher } from "../QuickSwitcher.tsx";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "../components/ui/sidebar.tsx";
import { TooltipProvider } from "../components/ui/tooltip.tsx";
import { useStore } from "../store.tsx";
import { ChannelSettingsPanel } from "../views/channel-settings/index.ts";
import { ConversationAggregatePanel } from "../views/conversation-aggregate/ConversationAggregatePanel.tsx";
import { LiveTrace } from "../views/LiveTrace.tsx";
import { ChatWorkspace } from "./ChatWorkspace.tsx";
import { ModuleWorkspace } from "./ModuleWorkspace.tsx";
import { SettingsDialog } from "./SettingsDialog.tsx";
import { WorkspaceModuleLauncher } from "./WorkspaceModuleLauncher.tsx";
import { WorkspaceNavigationRail } from "./WorkspaceNavigationRail.tsx";
import { WorkspacePanelToggle } from "./WorkspacePanelToggle.tsx";
import { WorkspaceSplitPane } from "./WorkspaceSplitPane.tsx";
import { WorkspaceTabs } from "./WorkspaceTabs.tsx";
import { isSidebarToggleShortcut } from "./sidebarKeyboardShortcut.ts";
import {
  shellActions,
  storedChatLocation,
} from "./shellStore.ts";
import { aggregatePaneConstraints } from "./paneConstraints.ts";
import {
  INITIAL_WORKSPACE_LAYOUT,
  workspaceLayoutForSpace,
  type ContentModuleId,
  type SidebarModuleId,
  type WorkspaceLayoutState,
  type WorkspaceModuleId,
} from "./workspaceLayout.ts";
import {
  parseWorkspaceRoute,
  workspaceLayoutFromRoute,
  workspaceLocationForModule,
  workspaceModuleResourceFromSearch,
  workspaceSearchForLayout,
  workspaceSearchForShellState,
  type WorkspaceModuleTarget,
} from "./workspaceRoute.ts";
import {
  activeWorkspaceTab,
  closeWorkspaceTab,
  createWorkspaceTab,
  openWorkspaceTab,
  persistWorkspaceTabState,
  removeWorkspaceResourceTab,
  renameWorkspaceResourceTab,
  restoreWorkspaceTabState,
  type WorkspaceTab,
  type WorkspaceTabState,
} from "./workspaceTabs.ts";
import {
  useAutoCollapseSidebarForWorkspace,
  useSidebarEdgePreview,
} from "./useSidebarEdgePreview.ts";
import { useChannelSettingsScene } from "./useChannelSettingsScene.ts";

const SIDEBAR_OPEN_STORAGE_KEY = "kith-space.sidebar.open";
const SIDEBAR_LAYOUT_MOTION_MS = 420;
const WORKSPACE_WIDTH_SETTLE_MS = 80;
const CHAT_ONLY_PANE_STYLE: CSSProperties = {
  width: "auto",
  flexBasis: 0,
  flexGrow: 1,
  flexShrink: 1,
};

const localStorageOrNull = () => typeof window === "undefined" ? null : window.localStorage;

const targetForTab = (tab: WorkspaceTab): WorkspaceModuleTarget => {
  if (tab.moduleId === "tasks") return { moduleId: "tasks", taskScope: tab.resourceId };
  if (tab.moduleId === "agents") return { moduleId: "agents", agent: tab.resourceId };
  if (tab.moduleId === "canvas") return { moduleId: "canvas", canvas: tab.resourceId, canvasTitle: tab.title };
  return { moduleId: tab.moduleId };
};

export function WorkspaceFrame() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const location = useLocation();
  const navigate = useNavigate();
  const { channels, archivedChannels, dms, slug, spaceId, spaces, unread, visibleAgents, me, api, reload, attachmentUrl } = useStore();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const aggregatePanelRef = useRef<HTMLElement>(null);
  const aggregateToggleRef = useRef<HTMLButtonElement>(null);
  const aggregateMotionTimerRef = useRef<number | null>(null);
  const sidebarMotionTimerRef = useRef<number | null>(null);
  const workspaceStorageId = spaceId || slug;
  const restoredWorkspaceTabs = useMemo(
    () => restoreWorkspaceTabState(localStorageOrNull(), workspaceStorageId),
    [workspaceStorageId],
  );
  const [tabsBySpace, setTabsBySpace] = useState<Record<string, WorkspaceTabState>>({});
  const workspaceTabState = tabsBySpace[workspaceStorageId] ?? restoredWorkspaceTabs;
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY) !== "false";
  });
  const [workspaceWidth, setWorkspaceWidth] = useState(() => typeof window === "undefined" ? 1280 : window.innerWidth);
  const [aggregateOpen, setAggregateOpen] = useState(true);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [aggregateTransitioning, setAggregateTransitioning] = useState(false);
  const [sidebarTransitioning, setSidebarTransitioning] = useState(false);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
  const commitWorkspaceTabs = useCallback((
    update: (state: WorkspaceTabState) => WorkspaceTabState,
  ) => {
    setTabsBySpace((current) => {
      const state = current[workspaceStorageId]
        ?? restoreWorkspaceTabState(localStorageOrNull(), workspaceStorageId);
      const next = update(state);
      persistWorkspaceTabState(localStorageOrNull(), workspaceStorageId, next);
      return { ...current, [workspaceStorageId]: next };
    });
  }, [workspaceStorageId]);
  const beginSidebarMotion = useCallback(() => {
    setSidebarTransitioning(true);
    if (sidebarMotionTimerRef.current !== null) window.clearTimeout(sidebarMotionTimerRef.current);
    sidebarMotionTimerRef.current = window.setTimeout(() => {
      setSidebarTransitioning(false);
      sidebarMotionTimerRef.current = null;
    }, SIDEBAR_LAYOUT_MOTION_MS);
  }, []);
  const updateSidebarOpen = useCallback((open: boolean) => {
    if (open === sidebarOpen) return;
    beginSidebarMotion();
    setSidebarOpen(open);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(open));
    }
  }, [beginSidebarMotion, sidebarOpen]);
  const {
    previewState: sidebarPreviewState,
    openPreview: openSidebarPreview,
    retainPreview: retainSidebarPreview,
    schedulePreviewClose: scheduleSidebarPreviewClose,
    handlePreviewTransitionEnd: handleSidebarPreviewTransitionEnd,
  } = useSidebarEdgePreview({
    collapsed: !sidebarOpen,
    disabled: sidebarTransitioning,
  });
  const beginAggregateMotion = useCallback(() => {
    setAggregateTransitioning(true);
    if (aggregateMotionTimerRef.current !== null) window.clearTimeout(aggregateMotionTimerRef.current);
    aggregateMotionTimerRef.current = window.setTimeout(() => {
      setAggregateTransitioning(false);
      aggregateMotionTimerRef.current = null;
    }, 420);
  }, []);
  const route = parseWorkspaceRoute(location.pathname);
  const initialWorkspacePanelOpen = new URLSearchParams(location.search).get("module") !== null
    && new URLSearchParams(location.search).get("module") !== "settings";
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(initialWorkspacePanelOpen);
  const requestedLayoutState: WorkspaceLayoutState = workspaceLayoutFromRoute(route, location.search);
  const isHome = spaces.some((space) => space.id === spaceId && space.isHome);
  const layoutState = workspaceLayoutForSpace(requestedLayoutState, isHome);
  const { activeModule } = layoutState;
  const settingsOpen = activeModule === "settings";
  const routeContentModuleId = activeModule && activeModule !== "settings"
    ? activeModule as ContentModuleId
    : null;
  const routeResourceId = routeContentModuleId
    ? workspaceModuleResourceFromSearch(location.search, routeContentModuleId)
    : null;
  const workspaceTabTitle = useCallback((moduleId: ContentModuleId, resourceId: string | null) => {
    if (moduleId === "agents" && resourceId) {
      const agent = visibleAgents.find((candidate) => candidate.id === resourceId);
      return agent ? (agent.displayName || agent.name) : null;
    }
    if (moduleId === "tasks" && resourceId && resourceId !== "space") {
      const channel = [...channels, ...archivedChannels].find((candidate) => candidate.id === resourceId);
      return channel ? `${channel.name} · ${t("nav.tasks")}` : null;
    }
    if (moduleId === "canvas" && resourceId) {
      return new URLSearchParams(location.search).get("canvasTitle");
    }
    return null;
  }, [archivedChannels, channels, location.search, t, visibleAgents]);
  const routeTab = routeContentModuleId
    ? createWorkspaceTab({
      moduleId: routeContentModuleId,
      resourceId: routeResourceId,
      title: workspaceTabTitle(routeContentModuleId, routeResourceId),
    })
    : null;
  const visibleWorkspaceTabState = routeTab
    ? openWorkspaceTab(workspaceTabState, routeTab)
    : workspaceTabState;
  const activeTab = activeWorkspaceTab(visibleWorkspaceTabState);
  const contentModuleId = activeTab?.moduleId ?? null;
  const activeWorkspaceKey = activeTab ? `${workspaceStorageId}:${activeTab.id}` : null;
  const chatVisible = true;
  const routeChannelId = route.isChannelRoute ? route.resourceId : null;
  const confirmSettingsDiscard = useCallback(() => confirm({
    title: t("channelSettings.discardTitle"),
    message: t("channelSettings.discardDescription"),
    confirmLabel: t("channelSettings.discardChanges"),
  }), [confirm, t]);
  const settingsScene = useChannelSettingsScene({
    aggregateOpen,
    setAggregateOpen,
    beginAggregateMotion,
    routeChannelId,
    spaceId,
    chatVisible,
    confirmDiscard: confirmSettingsDiscard,
  });
  const {
    channelId: settingsChannelId,
    triggerRef: settingsTriggerRef,
    setDirty: setSettingsDirty,
    open: openChannelSettings,
    close: closeChannelSettings,
    returnToContent: returnSettingsToContent,
    requestExit: requestSettingsExit,
    beforeAggregateToggle,
  } = settingsScene;
  const collapseSidebar = useCallback(() => updateSidebarOpen(false), [updateSidebarOpen]);

  useAutoCollapseSidebarForWorkspace(
    activeWorkspaceKey,
    collapseSidebar,
  );

  useEffect(() => {
    if (!activeTab) setWorkspaceExpanded(false);
  }, [activeTab]);

  useEffect(() => {
    if (routeTab) setWorkspacePanelOpen(true);
  }, [routeTab?.id]);

  useEffect(() => {
    const node = workspaceRef.current;
    if (!node) return;
    let settleTimer: number | null = null;
    const updateWidth = () => {
      const styles = window.getComputedStyle(node);
      const horizontalPadding = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
      setWorkspaceWidth(Math.max(0, node.clientWidth - horizontalPadding));
    };
    const scheduleWidthUpdate = () => {
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        updateWidth();
        settleTimer = null;
      }, WORKSPACE_WIDTH_SETTLE_MS);
    };
    updateWidth();
    const observer = new ResizeObserver(scheduleWidthUpdate);
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (settleTimer !== null) window.clearTimeout(settleTimer);
    };
  }, []);

  useEffect(() => {
    setAggregateOpen(true);
  }, [spaceId]);

  useEffect(() => {
    if (!routeTab) return;
    commitWorkspaceTabs((state) => openWorkspaceTab(state, {
      moduleId: routeTab.moduleId,
      resourceId: routeTab.resourceId,
      title: routeTab.title,
    }));
  }, [commitWorkspaceTabs, routeTab?.id, routeTab?.title]);

  useEffect(() => {
    const renamed = (event: Event) => {
      const detail = (event as CustomEvent<{ canvasId?: unknown; title?: unknown }>).detail;
      if (typeof detail?.canvasId !== "string" || typeof detail.title !== "string") return;
      commitWorkspaceTabs((state) => renameWorkspaceResourceTab(state, "canvas", detail.canvasId as string, detail.title as string));
      if (routeContentModuleId === "canvas" && routeResourceId === detail.canvasId) {
        navigate(workspaceLocationForModule(location.pathname, location.search, {
          moduleId: "canvas", canvas: detail.canvasId, canvasTitle: detail.title,
        }), { replace: true });
      }
    };
    const deleted = (event: Event) => {
      const canvasId = (event as CustomEvent<{ canvasId?: unknown }>).detail?.canvasId;
      if (typeof canvasId !== "string") return;
      commitWorkspaceTabs((state) => removeWorkspaceResourceTab(state, "canvas", canvasId));
      if (routeContentModuleId === "canvas" && routeResourceId === canvasId) {
        navigate(workspaceLocationForModule(location.pathname, location.search, { moduleId: "canvas", canvas: null }), { replace: true });
      }
    };
    window.addEventListener("kith:canvas-renamed", renamed);
    window.addEventListener("kith:canvas-deleted", deleted);
    return () => {
      window.removeEventListener("kith:canvas-renamed", renamed);
      window.removeEventListener("kith:canvas-deleted", deleted);
    };
  }, [commitWorkspaceTabs, location.pathname, location.search, navigate, routeContentModuleId, routeResourceId]);

  useEffect(() => {
    const openQuickSwitcher = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setQuickSwitcherOpen(true);
    };
    window.addEventListener("keydown", openQuickSwitcher);
    return () => window.removeEventListener("keydown", openQuickSwitcher);
  }, []);

  useEffect(() => {
    const toggleSidebarFromShortcut = (event: KeyboardEvent) => {
      if (!isSidebarToggleShortcut(event)) return;
      event.preventDefault();
      updateSidebarOpen(!sidebarOpen);
    };
    window.addEventListener("keydown", toggleSidebarFromShortcut);
    return () => window.removeEventListener("keydown", toggleSidebarFromShortcut);
  }, [sidebarOpen, updateSidebarOpen]);

  useEffect(() => () => {
    if (aggregateMotionTimerRef.current !== null) window.clearTimeout(aggregateMotionTimerRef.current);
    if (sidebarMotionTimerRef.current !== null) window.clearTimeout(sidebarMotionTimerRef.current);
  }, []);

  useEffect(() => {
    workspaceRef.current?.toggleAttribute("inert", settingsOpen);
    return () => workspaceRef.current?.removeAttribute("inert");
  }, [settingsOpen]);

  useEffect(() => {
    if (route.isChannelRoute) {
      const conversationSearch = workspaceSearchForLayout(location.search, INITIAL_WORKSPACE_LAYOUT);
      shellActions.rememberChatLocation(`${location.pathname}${conversationSearch}`, routeChannelId ?? null);
    }
  }, [location.pathname, location.search, route.isChannelRoute, routeChannelId]);

  useEffect(() => {
    if (requestedLayoutState.activeModule !== "spaces" || isHome) return;
    navigate(`${location.pathname}${workspaceSearchForLayout(location.search, INITIAL_WORKSPACE_LAYOUT)}`, { replace: true });
  }, [isHome, location.pathname, location.search, navigate, requestedLayoutState.activeModule]);

  const rememberedChat = storedChatLocation(slug);
  const fallbackConversation = channels.find((channel) => channel.name === "all") ?? channels[0] ?? dms[0];
  const fallbackConversationId = fallbackConversation?.id ?? null;
  const fallbackChatPathname = `/s/${slug}/channel${fallbackConversationId ? `/${fallbackConversationId}` : ""}`;
  const currentChannelId = routeChannelId ?? rememberedChat?.channelId ?? fallbackConversationId;
  const chatPath = rememberedChat?.path ?? fallbackChatPathname;
  const chatQueryIndex = chatPath.indexOf("?");
  const rememberedChatPathname = chatQueryIndex === -1 ? chatPath : chatPath.slice(0, chatQueryIndex);
  const rememberedChatSearch = chatQueryIndex === -1 ? "" : chatPath.slice(chatQueryIndex);
  const retiredShowcaseRoute = /\/showcase\/?$/.test(location.pathname);
  const layoutPathname = route.isChatRoute ? location.pathname : rememberedChatPathname;
  const layoutBaseSearch = route.isChatRoute ? location.search : rememberedChatSearch;
  const activeTabLayout: WorkspaceLayoutState = activeTab
    ? { activeModule: activeTab.moduleId, chatVisible: true }
    : INITIAL_WORKSPACE_LAYOUT;
  const layoutSearch = workspaceSearchForShellState(location.search, activeTabLayout);
  const aggregateEligible = route.isChannelRoute && currentChannelId !== null;
  const mode = workspacePanelOpen ? "split" : "chat-only";
  const contentWorkspaceWidth = workspaceWidth;
  const aggregateConstraints = aggregatePaneConstraints(contentWorkspaceWidth);
  const aggregateAvailable = aggregateEligible && !workspacePanelOpen;
  const aggregateInlineAvailable = aggregateAvailable && aggregateConstraints.canShow;
  const aggregateVisible = aggregateInlineAvailable && aggregateOpen;
  const aggregateWidth = aggregateVisible ? aggregateConstraints.width : 0;
  const paneStyle = (width: number): CSSProperties => ({
    width,
    flexBasis: width,
    flexGrow: 0,
    flexShrink: 0,
  });
  const chatPaneStyle = workspacePanelOpen ? undefined : CHAT_ONLY_PANE_STYLE;
  const unreadCount = Object.values(unread).reduce((total, count) => total + count, 0);
  const settingsChannel = settingsChannelId
    ? [...channels, ...archivedChannels].find((channel) => channel.id === settingsChannelId) ?? null
    : null;
  const settingsInDrawer = !!settingsChannel && !aggregateInlineAvailable;
  const settingsDrawerOpen = settingsInDrawer && aggregateOpen;
  const aggregateDrawerOpen = aggregateAvailable && !aggregateInlineAvailable && aggregateOpen && !settingsDrawerOpen;
  const aggregatePanelOpen = aggregateVisible || aggregateDrawerOpen;

  useEffect(() => {
    if (settingsOpen || routeContentModuleId || !activeTab) return;
    navigate(workspaceLocationForModule(
      layoutPathname,
      layoutBaseSearch,
      targetForTab(activeTab),
      { chatVisible: true },
    ), { replace: true });
  }, [
    activeTab?.id,
    layoutBaseSearch,
    layoutPathname,
    navigate,
    routeContentModuleId,
    settingsOpen,
  ]);

  useEffect(() => {
    if (route.isChatRoute) return;
    if (retiredShowcaseRoute && !fallbackConversationId) return;
    const normalizationLayout: WorkspaceLayoutState = activeModule === null
      ? INITIAL_WORKSPACE_LAYOUT
      : { activeModule, chatVisible: activeModule === "settings" };
    const normalizationPathname = retiredShowcaseRoute ? fallbackChatPathname : rememberedChatPathname;
    navigate(`${normalizationPathname}${workspaceSearchForShellState(location.search, normalizationLayout)}`, { replace: true });
  }, [activeModule, fallbackChatPathname, fallbackConversationId, location.search, navigate, rememberedChatPathname, retiredShowcaseRoute, route.isChatRoute]);

  const navigateLayout = useCallback((next: WorkspaceLayoutState, options: { replace?: boolean } = {}) => {
    navigate(`${layoutPathname}${workspaceSearchForLayout(layoutBaseSearch, next)}`, options);
  }, [layoutBaseSearch, layoutPathname, navigate]);

  const navigateToTab = useCallback((tab: WorkspaceTab, options: { replace?: boolean } = {}) => {
    navigate(workspaceLocationForModule(
      layoutPathname,
      layoutBaseSearch,
      targetForTab(tab),
      { chatVisible: true },
    ), options);
  }, [layoutBaseSearch, layoutPathname, navigate]);

  const selectModule = useCallback(async (moduleId: WorkspaceModuleId) => {
    if (moduleId === "settings") {
      navigate(workspaceLocationForModule(
        layoutPathname,
        layoutBaseSearch,
        { moduleId: "settings", settings: "human" },
        { chatVisible: true },
      ));
      return;
    }
    if (!(await requestSettingsExit(true))) return;
    const contentModule = moduleId as ContentModuleId;
    const resourceId = contentModule === "tasks" ? "space" : null;
    const tab = createWorkspaceTab({
      moduleId: contentModule,
      resourceId,
      title: workspaceTabTitle(contentModule, resourceId),
    });
    setAggregateOpen(false);
    setWorkspacePanelOpen(true);
    commitWorkspaceTabs((state) => openWorkspaceTab(state, tab));
    navigateToTab(tab);
  }, [
    commitWorkspaceTabs,
    layoutBaseSearch,
    layoutPathname,
    navigate,
    navigateToTab,
    requestSettingsExit,
    workspaceTabTitle,
  ]);

  const openConversationTasks = useCallback(async (conversationId: string) => {
    if (!(await requestSettingsExit(true))) return;
    const tab = createWorkspaceTab({
      moduleId: "tasks",
      resourceId: conversationId,
      title: workspaceTabTitle("tasks", conversationId),
    });
    setAggregateOpen(false);
    setWorkspacePanelOpen(true);
    commitWorkspaceTabs((state) => openWorkspaceTab(state, tab));
    navigateToTab(tab);
  }, [commitWorkspaceTabs, navigateToTab, requestSettingsExit, workspaceTabTitle]);

  const activateTab = (tab: WorkspaceTab) => {
    setWorkspacePanelOpen(true);
    commitWorkspaceTabs((state) => openWorkspaceTab(state, tab));
    navigateToTab(tab);
  };

  const closeTab = (tabId: string) => {
    const next = closeWorkspaceTab(visibleWorkspaceTabState, tabId);
    const closedActiveTab = visibleWorkspaceTabState.activeTabId === tabId;
    commitWorkspaceTabs(() => next);
    if (!closedActiveTab) return;
    const nextTab = activeWorkspaceTab(next);
    if (nextTab) navigateToTab(nextTab);
    else navigateLayout(INITIAL_WORKSPACE_LAYOUT);
  };

  const leaveLifecycleChannel = () => {
    returnSettingsToContent();
    const all = channels.find((channel) => channel.name === "all");
    navigate(`/s/${slug}/channel${all ? `/${all.id}` : ""}`);
  };

  const requestConversationNavigation = useCallback(async (target: string) => {
    const destination = new URL(target, window.location.origin);
    const targetRoute = parseWorkspaceRoute(destination.pathname);
    const changesConversation = !targetRoute.isChannelRoute || targetRoute.resourceId !== routeChannelId;
    if (!(await requestSettingsExit(changesConversation))) return;
    navigate(target);
  }, [navigate, requestSettingsExit, routeChannelId]);

  const toggleAggregate = useCallback(async () => {
    if (!(await beforeAggregateToggle())) return;
    beginAggregateMotion();
    setAggregateOpen((open) => !open);
  }, [beforeAggregateToggle, beginAggregateMotion]);
  const navigateConversation = useCallback((target: string) => {
    void requestConversationNavigation(target);
  }, [requestConversationNavigation]);
  const openQuickSwitcher = useCallback(() => setQuickSwitcherOpen(true), []);
  const selectSidebarModule = useCallback((moduleId: SidebarModuleId) => {
    void selectModule(moduleId);
  }, [selectModule]);
  const toggleWorkspaceExpanded = useCallback(() => {
    setWorkspaceExpanded((expanded) => !expanded);
  }, []);
  const toggleWorkspacePanel = useCallback(() => {
    setWorkspaceExpanded(false);
    setWorkspacePanelOpen((open) => !open);
  }, []);

  const updateConversationFocus = (key: "thread" | "msg", value: string) => {
    const params = new URLSearchParams(location.search);
    params.delete(key === "thread" ? "msg" : "thread");
    params.delete("threadMsg");
    params.set(key, value);
    params.delete("chatTab");
    const encoded = params.toString();
    navigate(encoded ? `${location.pathname}?${encoded}` : location.pathname);
  };

  useEffect(() => {
    aggregatePanelRef.current?.toggleAttribute("inert", !aggregateVisible);
    if (aggregatePanelOpen || !aggregatePanelRef.current?.contains(document.activeElement)) return;
    (settingsTriggerRef.current ?? aggregateToggleRef.current)?.focus();
  }, [aggregatePanelOpen, aggregateVisible, settingsTriggerRef]);

  const channelSettings = settingsChannel ? (
    <ChannelSettingsPanel
      key={settingsChannel.id}
      channel={settingsChannel}
      agents={visibleAgents}
      human={me}
      attachmentUrl={attachmentUrl}
      api={api}
      reload={reload}
      onBackToContent={returnSettingsToContent}
      onClose={closeChannelSettings}
      onArchived={leaveLifecycleChannel}
      onDeleted={leaveLifecycleChannel}
      onDirtyChange={setSettingsDirty}
    />
  ) : null;
  const aggregatePanel = aggregateAvailable ? (
    <ConversationAggregatePanel
      key={spaceId}
      conversationId={currentChannelId!}
      trace={<div className="conversation-trace conversation-aggregate__scroll"><LiveTrace conversationId={currentChannelId!} showHeading={false} /></div>}
      settings={settingsInDrawer ? undefined : channelSettings}
      settingsOpen={!!settingsChannel && !settingsInDrawer}
      onClose={toggleAggregate}
      onOpenTopic={(parentMessageId) => updateConversationFocus("thread", parentMessageId)}
      onJumpToMessage={(messageId) => updateConversationFocus("msg", messageId)}
    />
  ) : null;
  const chatWorkspace = (
    <ChatWorkspace
      channelId={currentChannelId}
      aggregateOpen={aggregateOpen}
      aggregateAvailable={aggregateAvailable}
      aggregateToggleRef={aggregateToggleRef}
      onToggleAggregate={toggleAggregate}
      onOpenTasks={openConversationTasks}
      onOpenChannelSettings={openChannelSettings}
      onNavigateConversation={navigateConversation}
      aggregateDrawer={aggregateAvailable && !aggregateInlineAvailable ? aggregatePanel : undefined}
      aggregateDrawerOpen={aggregateDrawerOpen}
      settingsDrawer={settingsInDrawer ? channelSettings : undefined}
      settingsDrawerOpen={settingsDrawerOpen}
      style={chatPaneStyle}
    />
  );
  const workspaceContent = activeTab && contentModuleId ? (
    <WorkspaceTabs
      activeTabId={activeTab.id}
      isHome={isHome}
      tabs={visibleWorkspaceTabState.tabs}
      onActivate={activateTab}
      onClose={closeTab}
      onOpenModule={(moduleId) => void selectModule(moduleId)}
      workspaceExpanded={workspaceExpanded}
      onToggleWorkspaceExpanded={toggleWorkspaceExpanded}
    >
      <ModuleWorkspace moduleId={contentModuleId} />
    </WorkspaceTabs>
  ) : workspacePanelOpen ? (
    <WorkspaceModuleLauncher
      isHome={isHome}
      onOpenModule={(moduleId) => void selectModule(moduleId)}
    />
  ) : null;

  return (
    <TooltipProvider>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={updateSidebarOpen}
        className="shell-sidebar-provider"
        data-sidebar-preview={sidebarPreviewState}
        data-sidebar-transitioning={sidebarTransitioning ? "true" : undefined}
      >
        {!sidebarOpen && !sidebarTransitioning ? (
          <div
            aria-hidden="true"
            className="shell-sidebar-edge-trigger fixed inset-y-0 left-0 z-40"
            onPointerEnter={openSidebarPreview}
            onPointerLeave={scheduleSidebarPreviewClose}
          />
        ) : null}
        <WorkspaceNavigationRail
          activeModule={settingsOpen ? "settings" : activeTab?.moduleId ?? null}
          channelId={currentChannelId}
          isHome={isHome}
          layoutSearch={layoutSearch}
          unreadCount={unreadCount}
          onPreviewEnter={retainSidebarPreview}
          onPreviewLeave={scheduleSidebarPreviewClose}
          onPreviewTransitionEnd={handleSidebarPreviewTransitionEnd}
          onNavigateConversation={navigateConversation}
          onSearch={openQuickSwitcher}
          onModuleSelect={selectSidebarModule}
        />
        <SidebarInset className="shell-workspace-inset">
        <section
          className="shell-workspace-frame"
          data-layout-mode={mode}
          data-aggregate-transitioning={aggregateTransitioning ? "true" : undefined}
          data-visual-mode={mode}
        >
          <div ref={workspaceRef} className="shell-workspace-canvas">
            <SidebarTrigger className="shell-sidebar-trigger" />
            <WorkspacePanelToggle
              open={workspacePanelOpen}
              onToggle={toggleWorkspacePanel}
            />
            <WorkspaceSplitPane
              chat={(
                <>
                  {chatWorkspace}
                  {aggregateInlineAvailable ? (
                    <aside
                      ref={aggregatePanelRef}
                      className="shell-work-panel shell-conversation-aggregate"
                      style={paneStyle(aggregateWidth)}
                      aria-label="当前会话聚合面板"
                      aria-hidden={!aggregateVisible}
                    >
                      {aggregatePanel}
                    </aside>
                  ) : null}
                </>
              )}
              workspace={workspaceContent}
              workspaceOpen={workspacePanelOpen}
              keepWorkspaceMounted={!!activeTab}
              workspaceExpanded={workspaceExpanded}
            />
          </div>
          {settingsOpen ? (
            <SettingsDialog
              section={workspaceModuleResourceFromSearch(location.search, "settings")}
              onClose={() => {
                const tab = activeWorkspaceTab(workspaceTabState);
                if (tab) navigateToTab(tab, { replace: true });
                else navigateLayout(INITIAL_WORKSPACE_LAYOUT, { replace: true });
              }}
            />
          ) : null}
          {quickSwitcherOpen ? <QuickSwitcher onClose={() => setQuickSwitcherOpen(false)} /> : null}
        </section>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
