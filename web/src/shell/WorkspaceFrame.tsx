import { useEffect, useRef, useState } from "react";
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
  type DockModuleId,
  type WorkspaceLayoutState,
  type WorkspaceModuleId,
} from "./workspaceLayout.ts";
import { parseWorkspaceRoute, workspaceLayoutFromRoute, workspaceSearchForLayout } from "./workspaceRoute.ts";

interface WorkspaceFrameProps {
  legacyHref: string;
}

export function WorkspaceFrame({ legacyHref }: WorkspaceFrameProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { channels, dms, slug, unread } = useStore();
  const { moduleRatio } = useShellStore();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(() => typeof window === "undefined" ? 1280 : window.innerWidth);
  const route = parseWorkspaceRoute(location.pathname);
  const layoutState: WorkspaceLayoutState = workspaceLayoutFromRoute(route, location.search);
  const { activeModule, chatVisible } = layoutState;
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
  const layoutSearch = workspaceSearchForLayout("", layoutState);
  const effectiveModuleRatio = openingModule ? DEFAULT_MODULE_RATIO : moduleRatio;
  const panes = activeModule ? paneConstraints(workspaceWidth, activeModule, effectiveModuleRatio) : null;
  const isNarrow = activeModule !== null && !panes?.canSplit;
  const mode = deriveWorkspaceMode(layoutState);
  const renderChat = activeModule === null || chatVisible;
  const renderModule = activeModule !== null && (!isNarrow || !chatVisible);
  const showDivider = activeModule !== null && chatVisible && !isNarrow;
  const visualMode = showDivider ? "split" : renderModule ? "module-only" : "chat-only";
  const effectiveModuleWidth = panes?.moduleWidth ?? 0;
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
      onChatToggle={toggleChatPane}
      onModuleSelect={(moduleId: DockModuleId) => selectModule(moduleId)}
    />
  );

  return (
    <main className="shell-workspace-frame" data-layout-mode={mode} data-visual-mode={visualMode}>
      <WorkspaceTopBar
        activeModule={activeModule}
        channelId={currentChannelId}
        layoutSearch={layoutSearch}
        legacyHref={legacyHref}
        onOpenSearch={() => selectModule("search")}
      />
      <div ref={workspaceRef} className="shell-workspace-canvas">
        {renderChat ? (
          <ChatWorkspace
            channelId={currentChannelId}
            compact={showDivider}
            layoutSearch={layoutSearch}
            dock={!showDivider ? dock : undefined}
          />
        ) : null}
        {showDivider ? (
          <DragDivider
            value={effectiveModuleWidth}
            min={panes!.moduleMin}
            max={panes!.moduleMax}
            onChange={(width) => shellActions.setModuleRatio(moduleRatioFromWidth(width, workspaceWidth))}
          />
        ) : null}
        {renderModule && activeModule ? (
          <ModuleWorkspace
            moduleId={activeModule}
            route={route}
            chatVisible={chatVisible}
            dock={dock}
            style={
              showDivider
                ? { width: effectiveModuleWidth, flex: `0 0 ${effectiveModuleWidth}px` }
                : undefined
            }
          />
        ) : null}
      </div>
    </main>
  );
}
