import { MessageCircleMore, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { sidebarModulesForSpace } from "./workspaceModules.tsx";
import type { SidebarModuleId, WorkspaceModuleId } from "./workspaceLayout.ts";

interface SidebarModuleNavigationProps {
  activeModule: WorkspaceModuleId | null;
  isHome: boolean;
  unreadCount: number;
  onChatSelect(): void;
  onSearch(): void;
  onModuleSelect(moduleId: SidebarModuleId): void;
}

export function SidebarModuleNavigation({
  activeModule,
  isHome,
  unreadCount,
  onChatSelect,
  onSearch,
  onModuleSelect,
}: SidebarModuleNavigationProps) {
  const { t } = useTranslation();

  return (
    <nav className="sidebar-module-navigation" aria-label={t("nav.workspaceModules")}>
      <button
        type="button"
        className={`sidebar-module-navigation__item${activeModule === null ? " is-active" : ""}`}
        aria-label={t("nav.messages")}
        aria-current={activeModule === null ? "page" : undefined}
        data-tooltip={t("nav.messages")}
        onClick={onChatSelect}
      >
        <MessageCircleMore size={21} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="sidebar-module-navigation__item sidebar-search-trigger"
        aria-label={t("nav.search")}
        data-tooltip={t("nav.search")}
        onClick={onSearch}
      >
        <Search size={21} aria-hidden="true" />
      </button>
      {sidebarModulesForSpace(isHome).map((module) => {
        const ModuleIcon = module.Icon;
        const active = activeModule === module.id;
        const label = t(module.labelKey);
        const accessibleLabel = module.id === "inbox" && unreadCount > 0
          ? t("nav.inboxUnread", { count: unreadCount })
          : label;
        return (
          <button
            key={module.id}
            type="button"
            className={`sidebar-module-navigation__item${active ? " is-active" : ""}`}
            aria-label={accessibleLabel}
            aria-current={active ? "page" : undefined}
            data-tooltip={label}
            onClick={() => onModuleSelect(module.id)}
          >
            <ModuleIcon size={21} aria-hidden="true" />
            {module.id === "inbox" && unreadCount > 0 ? (
              <span className="sidebar-module-navigation__badge">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
