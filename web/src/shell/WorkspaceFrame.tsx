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
import { DragDivider } from "./DragDivider.tsx";
import { ModuleWorkspace } from "./ModuleWorkspace.tsx";
import { SidebarModuleNavigation } from "./SidebarModuleNavigation.tsx";
import { WorkspaceDock } from "./WorkspaceDock.tsx";
import { WorkspaceTopBar } from "./WorkspaceTopBar.tsx";
import {
  shellActions,
  storedChatLocation,
  useShellStore,
} from "./shellStore.ts";
import {
  DEFAULT_MODULE_RATIO,
  aggregatePaneConstraints,
  moduleRatioFromWidth,
  paneConstraints,
} from "./paneConstraints.ts";
import {
  INITIAL_WORKSPACE_LAYOUT,
  deriveWorkspaceMode,
  selectWorkspaceModule,
  toggleChat,
  workspaceLayoutForSpace,
  type DockModuleId,
  type WorkspaceLayoutState,
  type WorkspaceModuleId,
} from "./workspaceLayout.ts";
import { useWorkspacePaneTransition, workspacePaneWidthsWithAggregate } from "./workspacePaneTransition.ts";
import { parseWorkspaceRoute, workspaceLayoutFromRoute, workspaceLocationForModule, workspaceSearchForLayout, workspaceSearchForShellState } from "./workspaceRoute.ts";
import { useChannelSettingsScene } from "./useChannelSettingsScene.ts";

export function WorkspaceFrame() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const location = useLocation();
  const navigate = useNavigate();
  const { channels, archivedChannels, dms, slug, spaceId, spaces, unread, visibleAgents, me, api, reload, attachmentUrl } = useStore();
  const { moduleRatio } = useShellStore();
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
  const { activeModule, chatVisible } = layoutState;
  const { animatedLayout, isTransitioning, previousLayout } = useWorkspacePaneTransition(layoutState);
  const routeChannelId = route.isChannelRoute ? route.resourceId : null;
  const previousActiveModuleRef = useRef<WorkspaceModuleId | null>(activeModule);
  const openingModule = previousActiveModuleRef.current === null && activeModule !== null;
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
    if (route.isChannelRoute) {
      const conversationSearch = workspaceSearchForLayout(location.search, INITIAL_WORKSPACE_LAYOUT);
      shellActions.rememberChatLocation(`${location.pathname}${conversationSearch}`, routeChannelId ?? null);
    }
  }, [location.pathname, location.search, route.isChannelRoute, routeChannelId]);

  useEffect(() => {
    if (requestedLayoutState.activeModule !== "spaces" || isHome) return;
    navigate(`${location.pathname}${workspaceSearchForLayout(location.search, INITIAL_WORKSPACE_LAYOUT)}`, { replace: true });
  }, [isHome, location.pathname, location.search, navigate, requestedLayoutState.activeModule]);

  useEffect(() => {
    const previousModule = previousActiveModuleRef.current;
    previousActiveModuleRef.current = activeModule;
    if (previousModule === null && activeModule !== null) shellActions.resetModuleRatio();
  }, [activeModule]);

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
  const aggregateRequested = aggregateEligible && aggregateOpen;
  const effectiveModuleRatio = openingModule ? DEFAULT_MODULE_RATIO : moduleRatio;
  const panes = activeModule ? paneConstraints(workspaceWidth, activeModule, effectiveModuleRatio) : null;
  const mode = deriveWorkspaceMode(layoutState);
  const animatedRatio = animatedLayout.activeModule === activeModule ? effectiveModuleRatio : moduleRatio;
  const animatedWidths = workspacePaneWidthsWithAggregate(animatedLayout, workspaceWidth, animatedRatio, aggregateRequested);
  const previousWidths = workspacePaneWidthsWithAggregate(previousLayout, workspaceWidth, moduleRatio, aggregateRequested);
  const targetWidths = workspacePaneWidthsWithAggregate(layoutState, workspaceWidth, effectiveModuleRatio, aggregateRequested);
  const availableWidths = workspacePaneWidthsWithAggregate(layoutState, workspaceWidth, effectiveModuleRatio, aggregateEligible);
  const visibleModuleId = activeModule ?? previousLayout.activeModule;
  const renderChat = animatedWidths.chat > 0 || previousWidths.chat > 0 || targetWidths.chat > 0;
  const renderModule = visibleModuleId !== null
    && (animatedWidths.module > 0 || previousWidths.module > 0 || targetWidths.module > 0);
  const renderDivider = Math.max(previousWidths.divider, targetWidths.divider) > 0;
  const showSplitChat = animatedWidths.chat > 0 && animatedWidths.module > 0;
  const aggregateAvailable = aggregateEligible && chatVisible && availableWidths.aggregateAvailable;
  const aggregateVisible = animatedWidths.aggregate > 0;
  const visualMode = showSplitChat ? "split" : animatedWidths.module > 0 ? "module-only" : "chat-only";
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
      : { activeModule, chatVisible };
    const normalizationPathname = retiredShowcaseRoute ? fallbackChatPathname : rememberedChatPathname;
    navigate(`${normalizationPathname}${workspaceSearchForShellState(location.search, normalizationLayout)}`, { replace: true });
  }, [activeModule, chatVisible, fallbackChatPathname, fallbackConversationId, location.search, navigate, rememberedChatPathname, retiredShowcaseRoute, route.isChatRoute]);

  const navigateLayout = (next: WorkspaceLayoutState) => {
    navigate(`${layoutPathname}${workspaceSearchForLayout(layoutBaseSearch, next)}`);
  };

  const selectModule = async (moduleId: WorkspaceModuleId) => {
    const next = selectWorkspaceModule(layoutState, moduleId);
    if (next.activeModule === null) return navigateLayout(next);
    const openingNextModule = activeModule === null;
    const nextRatio = openingNextModule ? DEFAULT_MODULE_RATIO : moduleRatio;
    const nextPanes = paneConstraints(workspaceWidth, next.activeModule, nextRatio);
    const target = { ...next, chatVisible: nextPanes.canSplit ? next.chatVisible : false };
    if (!(await requestSettingsExit(!target.chatVisible))) return;
    navigateLayout(target);
  };

  const openConversationTasks = async (conversationId: string) => {
    const nextRatio = activeModule === null ? DEFAULT_MODULE_RATIO : moduleRatio;
    const nextPanes = paneConstraints(workspaceWidth, "tasks", nextRatio);
    if (!(await requestSettingsExit(!nextPanes.canSplit))) return;
    navigate(workspaceLocationForModule(
      layoutPathname,
      layoutBaseSearch,
      { moduleId: "tasks", taskScope: conversationId },
      { chatVisible: nextPanes.canSplit },
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

  const toggleChatPane = async () => {
    const next = toggleChat(layoutState);
    if (next.activeModule === null) return;
    if (!(await requestSettingsExit(!next.chatVisible))) return;
    if (!chatVisible && next.chatVisible) shellActions.resetModuleRatio();
    navigateLayout(next);
  };

  const dock = (
    <WorkspaceDock
      activeModule={activeModule}
      chatVisible={chatVisible}
      unreadCount={unreadCount}
      isHome={isHome}
      onChatToggle={() => void toggleChatPane()}
      onModuleSelect={(moduleId: DockModuleId) => void selectModule(moduleId)}
    />
  );
  const sidebarModuleNavigation = (
    <SidebarModuleNavigation
      isHome={isHome}
      unreadCount={unreadCount}
      onSearch={() => setQuickSwitcherOpen(true)}
      onModuleSelect={(moduleId: DockModuleId) => void selectModule(moduleId)}
    />
  );

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
      data-pane-transitioning={isTransitioning ? "true" : undefined}
      data-aggregate-transitioning={aggregateTransitioning ? "true" : undefined}
      data-visual-mode={visualMode}
    >
      <WorkspaceTopBar
        activeModule={activeModule}
        channelId={currentChannelId}
        layoutSearch={layoutSearch}
      />
      <div ref={workspaceRef} className="shell-workspace-canvas">
        {renderChat ? (
          <ChatWorkspace
            channelId={currentChannelId}
            compact={showSplitChat}
            threadOnly={activeModule !== null}
            layoutSearch={layoutSearch}
            aggregateOpen={aggregateOpen}
            aggregateAvailable={aggregateAvailable}
            aggregateToggleRef={aggregateToggleRef}
            onToggleAggregate={toggleAggregate}
            onOpenTasks={openConversationTasks}
            onOpenChannelSettings={openChannelSettings}
            onNavigateConversation={(target) => void requestConversationNavigation(target)}
            settingsDrawer={settingsInDrawer ? channelSettings : undefined}
            settingsDrawerOpen={settingsInDrawer && aggregateOpen}
            moduleNavigation={sidebarModuleNavigation}
            style={paneStyle(animatedWidths.chat)}
          />
        ) : null}
        {aggregateEligible ? (
          <>
            <div className="shell-aggregate-gap" style={paneStyle(animatedWidths.aggregateGap)} aria-hidden="true" />
            <aside
              ref={aggregatePanelRef}
              className="shell-work-panel shell-conversation-aggregate"
              style={paneStyle(animatedWidths.aggregate)}
              aria-label="当前会话聚合面板"
              aria-hidden={!aggregateVisible}
            >
              <ConversationAggregatePanel
                key={spaceId}
                conversationId={currentChannelId!}
                trace={<div className="conversation-trace conversation-aggregate__scroll"><LiveTrace conversationId={currentChannelId!} showHeading={false} /></div>}
                settings={settingsInDrawer ? undefined : channelSettings}
                settingsOpen={!!settingsChannel && !settingsInDrawer}
                onOpenTopic={(parentMessageId) => updateConversationFocus("thread", parentMessageId)}
                onJumpToMessage={(messageId) => updateConversationFocus("msg", messageId)}
              />
            </aside>
          </>
        ) : null}
        {renderDivider ? (
          <DragDivider
            disabled={isTransitioning || !panes?.canSplit}
            value={animatedWidths.module}
            min={panes?.moduleMin ?? 0}
            max={aggregateVisible && activeModule
              ? aggregatePaneConstraints(workspaceWidth, activeModule, true).moduleMax
              : panes?.moduleMax ?? workspaceWidth}
            style={paneStyle(animatedWidths.divider)}
            onChange={(width) => shellActions.setModuleRatio(moduleRatioFromWidth(width, workspaceWidth))}
          />
        ) : null}
        {renderModule && visibleModuleId ? (
          <ModuleWorkspace
            moduleId={visibleModuleId}
            dock={animatedLayout.activeModule !== null ? dock : undefined}
            style={paneStyle(animatedWidths.module)}
          />
        ) : null}
      </div>
      {quickSwitcherOpen ? <QuickSwitcher onClose={() => setQuickSwitcherOpen(false)} /> : null}
    </main>
  );
}
