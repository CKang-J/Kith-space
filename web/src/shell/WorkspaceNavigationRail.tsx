import { useStore } from "../store.tsx";
import { SpaceSwitcher } from "../SpaceSwitcher.tsx";
import { SidebarModuleNavigation } from "./SidebarModuleNavigation.tsx";
import { storedChatLocation } from "./shellStore.ts";
import type { SidebarModuleId, WorkspaceModuleId } from "./workspaceLayout.ts";

export const WORKSPACE_NAVIGATION_RAIL_WIDTH = 68;

interface WorkspaceNavigationRailProps {
  activeModule: WorkspaceModuleId | null;
  isHome: boolean;
  layoutSearch: string;
  unreadCount: number;
  onChatSelect(): void;
  onSearch(): void;
  onModuleSelect(moduleId: SidebarModuleId): void;
}

export function WorkspaceNavigationRail({
  activeModule,
  isHome,
  layoutSearch,
  unreadCount,
  onChatSelect,
  onSearch,
  onModuleSelect,
}: WorkspaceNavigationRailProps) {
  const { slug, spaces } = useStore();
  const currentSpace = spaces.find((space) => space.slug === slug);

  return (
    <aside
      className="workspace-navigation-rail"
      style={{ width: WORKSPACE_NAVIGATION_RAIL_WIDTH, flexBasis: WORKSPACE_NAVIGATION_RAIL_WIDTH }}
      aria-label="主导航"
    >
      <div className="workspace-navigation-rail__space" data-tooltip={currentSpace?.name ?? "Kith-space"}>
        <SpaceSwitcher
          targetPathForSlug={(nextSlug) => {
            const remembered = storedChatLocation(nextSlug)?.path;
            const pathname = remembered?.split("?")[0] ?? `/s/${nextSlug}/channel`;
            return `${pathname}${layoutSearch}`;
          }}
        />
      </div>
      <SidebarModuleNavigation
        activeModule={activeModule}
        isHome={isHome}
        unreadCount={unreadCount}
        onChatSelect={onChatSelect}
        onSearch={onSearch}
        onModuleSelect={onModuleSelect}
      />
    </aside>
  );
}
