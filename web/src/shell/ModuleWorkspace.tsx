import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { SpacesModule } from "../spaces/SpacesModule.tsx";
import { Agents } from "../views/Members.tsx";
import { Inbox, Search, Tasks } from "../views/misc.tsx";
import { getWorkspaceModule } from "./workspaceModules.tsx";
import type { ContentModuleId } from "./workspaceLayout.ts";
import { workspaceModuleResourceFromSearch } from "./workspaceRoute.ts";

interface ModuleWorkspaceProps {
  moduleId: ContentModuleId;
  style?: CSSProperties;
}

function ModuleContent({ moduleId }: { moduleId: ContentModuleId }) {
  const location = useLocation();
  const resourceId = workspaceModuleResourceFromSearch(location.search, moduleId);
  if (moduleId === "spaces") return <SpacesModule />;
  if (moduleId === "tasks") {
    return <Tasks channelIdOverride={resourceId && resourceId !== "space" ? resourceId : null} />;
  }
  if (moduleId === "agents") {
    return <Agents agentIdOverride={resourceId ?? undefined} />;
  }
  if (moduleId === "search") return <Search />;
  return <Inbox />;
}

export function ModuleWorkspace({ moduleId, style }: ModuleWorkspaceProps) {
  const { t } = useTranslation();
  const module = getWorkspaceModule(moduleId);

  return (
    <section
      className="shell-work-panel shell-primary-workspace-card shell-module-workspace"
      style={style}
      data-module={moduleId}
      aria-label={`${t(module.labelKey)}模块`}
    >
      <div className="shell-module-surface">
        <ModuleContent moduleId={moduleId} />
      </div>
    </section>
  );
}
