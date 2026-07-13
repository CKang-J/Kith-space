import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { SpacesModule } from "../spaces/SpacesModule.tsx";
import { Agents } from "../views/Members.tsx";
import { Inbox, Search, Settings, Tasks } from "../views/misc.tsx";
import { getWorkspaceModule } from "./workspaceModules.tsx";
import type { WorkspaceModuleId } from "./workspaceLayout.ts";
import { workspaceModuleResourceFromSearch } from "./workspaceRoute.ts";

interface ModuleWorkspaceProps {
  moduleId: WorkspaceModuleId;
  dock?: ReactNode;
  style?: CSSProperties;
}

function ModuleContent({ moduleId }: { moduleId: WorkspaceModuleId }) {
  const location = useLocation();
  const resourceId = workspaceModuleResourceFromSearch(location.search, moduleId);
  if (moduleId === "spaces") return <SpacesModule />;
  if (moduleId === "tasks") {
    return <Tasks channelIdOverride={resourceId && resourceId !== "space" ? resourceId : null} />;
  }
  if (moduleId === "agents") {
    return <Agents agentIdOverride={resourceId ?? undefined} />;
  }
  if (moduleId === "settings") {
    return <Settings sectionOverride={resourceId ?? "human"} />;
  }
  if (moduleId === "search") return <Search />;
  return <Inbox />;
}

export function ModuleWorkspace({ moduleId, dock, style }: ModuleWorkspaceProps) {
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
        <ModuleContent moduleId={moduleId} />
      </div>
      {dock ? <footer className="shell-dock-zone">{dock}</footer> : null}
    </section>
  );
}
