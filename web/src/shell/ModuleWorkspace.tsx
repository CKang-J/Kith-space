import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Agents } from "../views/Members.tsx";
import { Inbox, Search, Settings, Tasks } from "../views/misc.tsx";
import { getWorkspaceModule } from "./workspaceModules.tsx";
import type { WorkspaceModuleId } from "./workspaceLayout.ts";
import { workspaceSearchForLayout, type WorkspaceRouteMatch } from "./workspaceRoute.ts";

interface ModuleWorkspaceProps {
  moduleId: WorkspaceModuleId;
  route: WorkspaceRouteMatch;
  chatVisible: boolean;
  dock: ReactNode;
  style?: CSSProperties;
}

function ModuleContent({ moduleId, route, chatVisible }: { moduleId: WorkspaceModuleId; route: WorkspaceRouteMatch; chatVisible: boolean }) {
  const moduleQuerySuffix = workspaceSearchForLayout("", { activeModule: moduleId, chatVisible });
  const discussionQuerySuffix = workspaceSearchForLayout("", { activeModule: moduleId, chatVisible: true });
  if (moduleId === "tasks") {
    const channelId = route.section === "tasks" && route.resourceId !== "space" ? route.resourceId : null;
    return <Tasks channelIdOverride={channelId} moduleQuerySuffix={moduleQuerySuffix} />;
  }
  if (moduleId === "agents") {
    return (
      <Agents
        agentIdOverride={route.section === "agent" ? route.resourceId ?? undefined : undefined}
        moduleQuerySuffix={moduleQuerySuffix}
        discussionQuerySuffix={discussionQuerySuffix}
      />
    );
  }
  if (moduleId === "settings") {
    const section = route.section === "settings" ? route.resourceId ?? undefined : undefined;
    return <Settings sectionOverride={section} moduleQuerySuffix={moduleQuerySuffix} />;
  }
  if (moduleId === "search") return <Search />;
  return <Inbox />;
}

export function ModuleWorkspace({ moduleId, route, chatVisible, dock, style }: ModuleWorkspaceProps) {
  const { t } = useTranslation();
  const module = getWorkspaceModule(moduleId);

  return (
    <section
      className="shell-work-panel shell-module-workspace"
      style={style}
      data-module={moduleId}
      aria-label={`${t(module.labelKey)}模块`}
    >
      <div className="shell-module-surface">
        <ModuleContent moduleId={moduleId} route={route} chatVisible={chatVisible} />
      </div>
      <footer className="shell-dock-zone">{dock}</footer>
    </section>
  );
}
