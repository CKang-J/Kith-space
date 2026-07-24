import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useConfirm } from "../ConfirmModal.tsx";
import { QuickSwitcher } from "../QuickSwitcher.tsx";
import { useStore } from "../store.tsx";
import { ChannelSettingsPanel } from "../views/channel-settings/index.ts";
import { ConversationAggregatePanel } from "../views/conversation-aggregate/ConversationAggregatePanel.tsx";
import { LiveTrace } from "../views/LiveTrace.tsx";
import { ChatWorkspace } from "./ChatWorkspace.tsx";
import { ModuleWorkspace } from "./ModuleWorkspace.tsx";
import { SettingsDialog } from "./SettingsDialog.tsx";
import {
  WORKSPACE_NAVIGATION_RAIL_WIDTH,
  WorkspaceNavigationRail,
} from "./WorkspaceNavigationRail.tsx";
import {
  shellActions,
  storedChatLocation,
} from "./shellStore.ts";
import { aggregatePaneConstraints } from "./paneConstraints.ts";
import {
  INITIAL_WORKSPACE_LAYOUT,
  deriveWorkspaceMode,
  selectWorkspaceModule,
  workspaceLayoutForSpace,
  type ContentModuleId,
  type SidebarModuleId,
  type WorkspaceLayoutState,
  type WorkspaceModuleId,
} from "./workspaceLayout.ts";
import { parseWorkspaceRoute, workspaceLayoutFromRoute, workspaceLocationForModule, workspaceModuleResourceFromSearch, workspaceSearchForLayout, workspaceSearchForShellState } from "./workspaceRoute.ts";
import { useChannelSettingsScene } from "./useChannelSettingsScene.ts";

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
  const [workspaceWidth, setWorkspaceWidth] = useState(() => typeof window === "undefined" ? 1280 : window.innerWidth);
  const [aggregateOpen, setAggregateOpen] = useState(true);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [aggregateTransitioning, setAggregateTransitioning] = useState(false);
  const beginAggregateMotion = useCallback(() => {
    setAggregateTransitioning(true);
    if (aggregateMotionTimerRef.current !== null) window.clearTimeout(aggregateMotionTimerRef.current);
    aggregateMotionTimerRef.current = window.setTimeout(() => {
      setAggregateTransitioning(false);
      aggregateMotionTimerRef.current = null;
    }, 420);
  }, []);
  const route = parseWorkspaceRoute(location.pathname);
  const requestedLayoutState: WorkspaceLayoutState = workspaceLayoutFromRoute(route, location.search);
  const isHome = spaces.some((space) => space.id === spaceId && space.isHome);
  const layoutState = workspaceLayoutForSpace(requestedLayoutState, isHome);
  const { activeModule } = layoutState;
  const settingsOpen = activeModule === "settings";
  const contentModuleId = activeModule && activeModule !== "settings"
    ? activeModule as ContentModuleId
    : null;
  const chatVisible = contentModuleId === null;
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

  useEffect(() => {
    const node = workspaceRef.current;
    if (!node) return;
    const updateWidth = () => {
      const styles = window.getComputedStyle(node);
      const horizontalPadding = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
      setWorkspaceWidth(Math.max(0, node.clientWidth - horizontalPadding));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setAggregateOpen(true);
  }, [spaceId]);

  useEffect(() => {
    const openQuickSwitcher = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setQuickSwitcherOpen(true);
    };
    window.addEventListener("keydown", openQuickSwitcher);
    return () => window.removeEventListener("keydown", openQuickSwitcher);
  }, []);

  useEffect(() => () => {
    if (aggregateMotionTimerRef.current !== null) window.clearTimeout(aggregateMotionTimerRef.current);
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
  const layoutSearch = workspaceSearchForShellState(location.search, layoutState);
  const aggregateEligible = route.isChannelRoute && currentChannelId !== null;
  const mode = deriveWorkspaceMode(layoutState);
  const contentWorkspaceWidth = Math.max(0, workspaceWidth - WORKSPACE_NAVIGATION_RAIL_WIDTH);
  const aggregateConstraints = aggregatePaneConstraints(contentWorkspaceWidth);
  const aggregateAvailable = aggregateEligible && chatVisible && aggregateConstraints.canShow;
  const aggregateVisible = aggregateAvailable && aggregateOpen;
  const aggregateWidth = aggregateVisible ? aggregateConstraints.width : 0;
  const aggregateGap = aggregateVisible ? 10 : 0;
  const chatWidth = Math.max(0, contentWorkspaceWidth - aggregateWidth - aggregateGap);
  const paneStyle = (width: number): CSSProperties => ({
    width,
    flexBasis: width,
    flexGrow: 0,
    flexShrink: 0,
  });
  const unreadCount = Object.values(unread).reduce((total, count) => total + count, 0);
  const settingsChannel = settingsChannelId
    ? [...channels, ...archivedChannels].find((channel) => channel.id === settingsChannelId) ?? null
    : null;

  useEffect(() => {
    if (route.isChatRoute) return;
    if (retiredShowcaseRoute && !fallbackConversationId) return;
    const normalizationLayout: WorkspaceLayoutState = activeModule === null
      ? INITIAL_WORKSPACE_LAYOUT
      : { activeModule, chatVisible: activeModule === "settings" };
    const normalizationPathname = retiredShowcaseRoute ? fallbackChatPathname : rememberedChatPathname;
    navigate(`${normalizationPathname}${workspaceSearchForShellState(location.search, normalizationLayout)}`, { replace: true });
  }, [activeModule, fallbackChatPathname, fallbackConversationId, location.search, navigate, rememberedChatPathname, retiredShowcaseRoute, route.isChatRoute]);

  const navigateLayout = (next: WorkspaceLayoutState, options: { replace?: boolean } = {}) => {
    navigate(`${layoutPathname}${workspaceSearchForLayout(layoutBaseSearch, next)}`, options);
  };

  const selectModule = async (moduleId: WorkspaceModuleId) => {
    const next = selectWorkspaceModule(layoutState, moduleId);
    if (!(await requestSettingsExit(next.activeModule !== null && next.activeModule !== "settings"))) return;
    if (next.activeModule !== null && next.activeModule !== "settings") setAggregateOpen(false);
    navigateLayout(next);
  };

  const selectChat = async () => {
    if (!(await requestSettingsExit(false))) return;
    navigateLayout(INITIAL_WORKSPACE_LAYOUT);
  };

  const openConversationTasks = async (conversationId: string) => {
    if (!(await requestSettingsExit(true))) return;
    setAggregateOpen(false);
    navigate(workspaceLocationForModule(
      layoutPathname,
      layoutBaseSearch,
      { moduleId: "tasks", taskScope: conversationId },
      { chatVisible: false },
    ));
  };

  const leaveLifecycleChannel = () => {
    returnSettingsToContent();
    const all = channels.find((channel) => channel.name === "all");
    navigate(`/s/${slug}/channel${all ? `/${all.id}` : ""}`);
  };

  const requestConversationNavigation = async (target: string) => {
    const destination = new URL(target, window.location.origin);
    const targetRoute = parseWorkspaceRoute(destination.pathname);
    const changesConversation = !targetRoute.isChannelRoute || targetRoute.resourceId !== routeChannelId;
    if (!(await requestSettingsExit(changesConversation))) return;
    navigate(target);
  };

  const toggleAggregate = async () => {
    if (!(await beforeAggregateToggle())) return;
    beginAggregateMotion();
    setAggregateOpen((open) => !open);
  };

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
    if (aggregateVisible || !aggregatePanelRef.current?.contains(document.activeElement)) return;
    (settingsTriggerRef.current ?? aggregateToggleRef.current)?.focus();
  }, [aggregateVisible]);

  const settingsInDrawer = !!settingsChannel && !aggregateAvailable;
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

  return (
    <main
      className="shell-workspace-frame"
      data-layout-mode={mode}
      data-aggregate-transitioning={aggregateTransitioning ? "true" : undefined}
      data-visual-mode={mode}
    >
      <div ref={workspaceRef} className="shell-workspace-canvas">
        <WorkspaceNavigationRail
          activeModule={activeModule}
          isHome={isHome}
          layoutSearch={layoutSearch}
          unreadCount={unreadCount}
          onChatSelect={() => void selectChat()}
          onSearch={() => setQuickSwitcherOpen(true)}
          onModuleSelect={(moduleId: SidebarModuleId) => void selectModule(moduleId)}
        />
        {chatVisible ? (
          <ChatWorkspace
            channelId={currentChannelId}
            aggregateOpen={aggregateOpen}
            aggregateAvailable={aggregateAvailable}
            aggregateToggleRef={aggregateToggleRef}
            onToggleAggregate={toggleAggregate}
            onOpenTasks={openConversationTasks}
            onOpenChannelSettings={openChannelSettings}
            onNavigateConversation={(target) => void requestConversationNavigation(target)}
            settingsDrawer={settingsInDrawer ? channelSettings : undefined}
            settingsDrawerOpen={settingsInDrawer && aggregateOpen}
            style={paneStyle(chatWidth)}
          />
        ) : null}
        {aggregateEligible && chatVisible ? (
          <>
            <div className="shell-aggregate-gap" style={paneStyle(aggregateGap)} aria-hidden="true" />
            <aside
              ref={aggregatePanelRef}
              className="shell-work-panel shell-conversation-aggregate"
              style={paneStyle(aggregateWidth)}
              aria-label="当前会话聚合面板"
              aria-hidden={!aggregateVisible}
            >
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
            </aside>
          </>
        ) : null}
        {contentModuleId ? (
          <ModuleWorkspace
            moduleId={contentModuleId}
          />
        ) : null}
      </div>
      {settingsOpen ? (
        <SettingsDialog
          section={workspaceModuleResourceFromSearch(location.search, "settings")}
          onClose={() => navigateLayout(INITIAL_WORKSPACE_LAYOUT, { replace: true })}
        />
      ) : null}
      {quickSwitcherOpen ? <QuickSwitcher onClose={() => setQuickSwitcherOpen(false)} /> : null}
    </main>
  );
}
