import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useStore } from "../store.tsx";
import { ChatWorkspace } from "./ChatWorkspace.tsx";
import { DragDivider } from "./DragDivider.tsx";
import { ModuleWorkspace } from "./ModuleWorkspace.tsx";
import { WorkspaceDock } from "./WorkspaceDock.tsx";
import { WorkspaceTopBar } from "./WorkspaceTopBar.tsx";
import {
  shellActions,
  storedChatLocation,
  useShellStore,
} from "./shellStore.ts";
import {
  DEFAULT_MODULE_RATIO,
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
import { useWorkspacePaneTransition, workspacePaneWidths } from "./workspacePaneTransition.ts";
import { parseWorkspaceRoute, workspaceLayoutFromRoute, workspaceSearchForLayout, workspaceSearchForShellState } from "./workspaceRoute.ts";

export function WorkspaceFrame() {
  const location = useLocation();
  const navigate = useNavigate();
  const { channels, dms, slug, spaceId, spaces, unread } = useStore();
  const { moduleRatio } = useShellStore();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(() => typeof window === "undefined" ? 1280 : window.innerWidth);
  const route = parseWorkspaceRoute(location.pathname);
  const requestedLayoutState: WorkspaceLayoutState = workspaceLayoutFromRoute(route, location.search);
  const isHome = spaces.some((space) => space.id === spaceId && space.isHome);
  const layoutState = workspaceLayoutForSpace(requestedLayoutState, isHome);
  const { activeModule, chatVisible } = layoutState;
  const { animatedLayout, isTransitioning, previousLayout } = useWorkspacePaneTransition(layoutState);
  const routeChannelId = route.isChannelRoute ? route.resourceId : null;
  const previousActiveModuleRef = useRef<WorkspaceModuleId | null>(activeModule);
  const openingModule = previousActiveModuleRef.current === null && activeModule !== null;

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
  const currentChannelId = routeChannelId ?? rememberedChat?.channelId ?? fallbackConversation?.id ?? null;
  const chatPath = rememberedChat?.path ?? `/s/${slug}/channel${currentChannelId ? `/${currentChannelId}` : ""}`;
  const chatQueryIndex = chatPath.indexOf("?");
  const rememberedChatPathname = chatQueryIndex === -1 ? chatPath : chatPath.slice(0, chatQueryIndex);
  const rememberedChatSearch = chatQueryIndex === -1 ? "" : chatPath.slice(chatQueryIndex);
  const layoutPathname = route.isChatRoute ? location.pathname : rememberedChatPathname;
  const layoutBaseSearch = route.isChatRoute ? location.search : rememberedChatSearch;
  const layoutSearch = workspaceSearchForShellState(location.search, layoutState);
  const effectiveModuleRatio = openingModule ? DEFAULT_MODULE_RATIO : moduleRatio;
  const panes = activeModule ? paneConstraints(workspaceWidth, activeModule, effectiveModuleRatio) : null;
  const mode = deriveWorkspaceMode(layoutState);
  const animatedRatio = animatedLayout.activeModule === activeModule ? effectiveModuleRatio : moduleRatio;
  const animatedWidths = workspacePaneWidths(animatedLayout, workspaceWidth, animatedRatio);
  const previousWidths = workspacePaneWidths(previousLayout, workspaceWidth, moduleRatio);
  const targetWidths = workspacePaneWidths(layoutState, workspaceWidth, effectiveModuleRatio);
  const visibleModuleId = activeModule ?? previousLayout.activeModule;
  const renderChat = animatedWidths.chat > 0 || previousWidths.chat > 0 || targetWidths.chat > 0;
  const renderModule = visibleModuleId !== null
    && (animatedWidths.module > 0 || previousWidths.module > 0 || targetWidths.module > 0);
  const renderDivider = Math.max(previousWidths.divider, targetWidths.divider) > 0;
  const showSplitChat = animatedWidths.chat > 0 && animatedWidths.module > 0;
  const visualMode = showSplitChat ? "split" : animatedWidths.module > 0 ? "module-only" : "chat-only";
  const paneStyle = (width: number): CSSProperties => ({
    width,
    flexBasis: width,
    flexGrow: 0,
    flexShrink: 0,
  });
  const unreadCount = Object.values(unread).reduce((total, count) => total + count, 0);

  const navigateLayout = (next: WorkspaceLayoutState) => {
    navigate(`${layoutPathname}${workspaceSearchForLayout(layoutBaseSearch, next)}`);
  };

  const selectModule = (moduleId: WorkspaceModuleId) => {
    const next = selectWorkspaceModule(layoutState, moduleId);
    if (next.activeModule === null) return navigateLayout(next);
    const openingNextModule = activeModule === null;
    const nextRatio = openingNextModule ? DEFAULT_MODULE_RATIO : moduleRatio;
    const nextPanes = paneConstraints(workspaceWidth, next.activeModule, nextRatio);
    navigateLayout({ ...next, chatVisible: nextPanes.canSplit ? next.chatVisible : false });
  };

  const toggleChatPane = () => {
    const next = toggleChat(layoutState);
    if (next.activeModule === null) return;
    if (!chatVisible && next.chatVisible) shellActions.resetModuleRatio();
    navigateLayout(next);
  };

  const dock = (
    <WorkspaceDock
      activeModule={activeModule}
      chatVisible={chatVisible}
      unreadCount={unreadCount}
      isHome={isHome}
      onChatToggle={toggleChatPane}
      onModuleSelect={(moduleId: DockModuleId) => selectModule(moduleId)}
    />
  );

  return (
    <main
      className="shell-workspace-frame"
      data-layout-mode={mode}
      data-pane-transitioning={isTransitioning ? "true" : undefined}
      data-visual-mode={visualMode}
    >
      <WorkspaceTopBar
        activeModule={activeModule}
        channelId={currentChannelId}
        layoutSearch={layoutSearch}
        onOpenSearch={() => selectModule("search")}
      />
      <div ref={workspaceRef} className="shell-workspace-canvas">
        {renderChat ? (
          <ChatWorkspace
            channelId={currentChannelId}
            compact={showSplitChat}
            threadOnly={activeModule !== null}
            layoutSearch={layoutSearch}
            dock={animatedLayout.activeModule === null ? dock : undefined}
            style={paneStyle(animatedWidths.chat)}
          />
        ) : null}
        {renderDivider ? (
          <DragDivider
            disabled={isTransitioning || !panes?.canSplit}
            value={animatedWidths.module}
            min={panes?.moduleMin ?? 0}
            max={panes?.moduleMax ?? workspaceWidth}
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
    </main>
  );
}
