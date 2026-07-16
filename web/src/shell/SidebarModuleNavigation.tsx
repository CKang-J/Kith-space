import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { dockModulesForSpace } from "./workspaceModules.tsx";
import type { DockModuleId } from "./workspaceLayout.ts";

interface SidebarModuleNavigationProps {
  isHome: boolean;
  unreadCount: number;
  onSearch(): void;
  onModuleSelect(moduleId: DockModuleId): void;
}

export function SidebarModuleNavigation({
  isHome,
  unreadCount,
  onSearch,
  onModuleSelect,
}: SidebarModuleNavigationProps) {
  const { t } = useTranslation();

  return (
    <nav className="sidebar-module-navigation" aria-label={t("nav.workspaceModules")}>
      <button
        type="button"
        className="sidebar-module-navigation__item sidebar-search-trigger"
        onClick={onSearch}
      >
        <Search size={18} aria-hidden="true" />
        <span className="sidebar-module-navigation__label">{t("nav.search")}</span>
      </button>
      {dockModulesForSpace(isHome).map((module) => {
        const ModuleIcon = module.Icon;
        return (
          <button
            key={module.id}
            type="button"
            className="sidebar-module-navigation__item"
            onClick={() => onModuleSelect(module.id)}
          >
            <ModuleIcon size={18} aria-hidden="true" />
            <span className="sidebar-module-navigation__label">{t(module.labelKey)}</span>
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
