import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { sidebarModulesForSpace } from "./workspaceModules.tsx";
import type { SidebarModuleId, WorkspaceModuleId } from "./workspaceLayout.ts";

interface SidebarModuleNavigationProps {
  activeModule: WorkspaceModuleId | null;
  isHome: boolean;
  unreadCount: number;
  onSearch(): void;
  onModuleSelect(moduleId: SidebarModuleId): void;
}

export function SidebarModuleNavigation({
  activeModule,
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
      {sidebarModulesForSpace(isHome).map((module) => {
        const ModuleIcon = module.Icon;
        const active = activeModule === module.id;
        return (
          <button
            key={module.id}
            type="button"
            className={`sidebar-module-navigation__item${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
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
