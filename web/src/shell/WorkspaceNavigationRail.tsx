import { MessageCircleMore, Search } from "lucide-react";
import { memo, type TransitionEventHandler } from "react";
import { useTranslation } from "react-i18next";
import { SpaceSwitcher } from "../SpaceSwitcher.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "../components/ui/sidebar.tsx";
import { ConversationListContent } from "../views/ConversationListContent.tsx";
import { useStore } from "../store.tsx";
import { storedChatLocation } from "./shellStore.ts";
import { sidebarModulesForSpace } from "./workspaceModules.tsx";
import type { SidebarModuleId, WorkspaceModuleId } from "./workspaceLayout.ts";

interface WorkspaceNavigationRailProps {
  activeModule: WorkspaceModuleId | null;
  channelId: string | null;
  isHome: boolean;
  layoutSearch: string;
  unreadCount: number;
  onPreviewEnter(): void;
  onPreviewLeave(): void;
  onPreviewTransitionEnd: TransitionEventHandler<HTMLDivElement>;
  onNavigateConversation(target: string): void;
  onSearch(): void;
  onModuleSelect(moduleId: SidebarModuleId): void;
}

export const WorkspaceNavigationRail = memo(function WorkspaceNavigationRail({
  activeModule,
  channelId,
  isHome,
  layoutSearch,
  unreadCount,
  onPreviewEnter,
  onPreviewLeave,
  onPreviewTransitionEnd,
  onNavigateConversation,
  onSearch,
  onModuleSelect,
}: WorkspaceNavigationRailProps) {
  const { t } = useTranslation();
  const { slug, spaces } = useStore();
  const currentSpace = spaces.find((space) => space.slug === slug);
  const primaryModules = sidebarModulesForSpace(isHome).filter((module) => module.id !== "settings");
  const settingsModule = sidebarModulesForSpace(isHome).find((module) => module.id === "settings");
  const SettingsIcon = settingsModule?.Icon;

  return (
    <Sidebar
      collapsible="offcanvas"
      className="border-r-0"
      onPointerEnter={onPreviewEnter}
      onPointerLeave={onPreviewLeave}
      onTransitionEnd={onPreviewTransitionEnd}
    >
      <SidebarHeader className="workspace-sidebar__header">
        <div className="workspace-sidebar__space">
          <SpaceSwitcher
            targetPathForSlug={(nextSlug) => {
              const remembered = storedChatLocation(nextSlug)?.path;
              return remembered ?? `/s/${nextSlug}/channel`;
            }}
          />
          <div className="min-w-0">
            <div className="truncate font-medium text-sidebar-foreground">
              {currentSpace?.name ?? "Kith-space"}
            </div>
            <div className="truncate text-xs text-muted-foreground">{t("nav.workspaceModules")}</div>
          </div>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onSearch}>
              <Search />
              <span>{t("nav.search")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {primaryModules.map((module) => {
            const ModuleIcon = module.Icon;
            const active = activeModule === module.id;
            const label = t(module.labelKey);
            return (
              <SidebarMenuItem key={module.id}>
                <SidebarMenuButton
                  isActive={active}
                  onClick={() => onModuleSelect(module.id)}
                >
                  <ModuleIcon />
                  <span>{label}</span>
                </SidebarMenuButton>
                {module.id === "inbox" && unreadCount > 0 ? (
                  <SidebarMenuBadge>{unreadCount > 99 ? "99+" : unreadCount}</SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="min-h-0 flex-1">
          <SidebarGroupLabel>
            <MessageCircleMore />
            <span>{t("nav.messages")}</span>
          </SidebarGroupLabel>
          <SidebarGroupContent className="workspace-sidebar__conversations">
            <ConversationListContent
              channelIdOverride={channelId ?? undefined}
              preserveSearch={layoutSearch}
              onNavigate={onNavigateConversation}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {settingsModule && SettingsIcon ? (
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeModule === "settings"}
                onClick={() => onModuleSelect("settings")}
              >
                <SettingsIcon />
                <span>{t(settingsModule.labelKey)}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      ) : null}
      <SidebarRail />
    </Sidebar>
  );
});
