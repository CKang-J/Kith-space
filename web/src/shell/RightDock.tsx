import { Activity, CalendarDays, Files, ListTodo, Maximize2, PanelRightClose, PanelsTopLeft } from "lucide-react";
import { useState } from "react";
import { TaskBoard } from "../TaskBoard.tsx";
import { useStore } from "../store.tsx";
import { LiveTrace } from "../views/LiveTrace.tsx";
import { WorkspaceTab } from "../views/Members.tsx";
import { shellActions, useShellStore, type DockModule } from "./shellStore.ts";

const MODULES: Array<{ id: DockModule; label: string; description: string; Icon: typeof ListTodo }> = [
  { id: "tasks", label: "任务", description: "当前空间的全部任务。", Icon: ListTodo },
  { id: "calendar", label: "日历", description: "日历模块结构预留。", Icon: CalendarDays },
  { id: "files", label: "文件", description: "选择 Agent 查看其工作区文件。", Icon: Files },
  { id: "trace", label: "实时轨迹", description: "Agent 实时轨迹。", Icon: Activity },
  { id: "canvas", label: "画布", description: "画布模块结构预留。", Icon: PanelsTopLeft },
];

export const getDockModule = (id: DockModule) => MODULES.find((module) => module.id === id) ?? MODULES[0]!;

export function ModulePlaceholder({ moduleId, promoted = false }: { moduleId: DockModule; promoted?: boolean }) {
  const module = getDockModule(moduleId);
  const ModuleIcon = module.Icon;
  return (
    <div className={`shell-module-placeholder${promoted ? " shell-module-placeholder--promoted" : ""}`}>
      <ModuleIcon size={promoted ? 32 : 27} />
      <strong>{module.label}模块</strong>
      <p>{module.description}</p>
      {promoted && <span>已提升到中心工作区</span>}
    </div>
  );
}

function AgentWorkspaceFiles() {
  const { visibleAgents } = useStore();
  const [selectedId, setSelectedId] = useState("");
  const selected = visibleAgents.find((agent) => agent.id === selectedId) ?? visibleAgents[0];

  if (!selected) return <ModulePlaceholder moduleId="files" />;
  return (
    <div className="shell-agent-files">
      <label>
        <span>Agent</span>
        <select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>
          {visibleAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName || agent.name}</option>)}
        </select>
      </label>
      <WorkspaceTab id={selected.id} />
    </div>
  );
}

export function DockModuleContent({ moduleId, promoted = false }: { moduleId: DockModule; promoted?: boolean }) {
  if (moduleId === "tasks") return <TaskBoard channelId={null} />;
  if (moduleId === "files") return <AgentWorkspaceFiles />;
  if (moduleId === "trace") return <div className="shell-live-trace"><LiveTrace showHeading={false} /></div>;
  return <ModulePlaceholder moduleId={moduleId} promoted={promoted} />;
}

export function RightDock({ width }: { width: number }) {
  const { activeDockModule } = useShellStore();
  const active = getDockModule(activeDockModule);

  return (
    <aside className="shell-right-dock" style={{ width }} aria-label="右栏模块容器">
      <header>
        <div>
          <span className="shell-eyebrow">模块容器</span>
          <h2>{active.label}</h2>
        </div>
        <div className="shell-right-dock__actions">
          <button type="button" title="提升到中心" aria-label={`将${active.label}模块提升到中心`} onClick={() => shellActions.promoteModule(activeDockModule)}><Maximize2 size={17} /></button>
          <button type="button" title="隐藏右栏" aria-label="隐藏右栏" onClick={() => shellActions.setRightPanelHidden(true)}><PanelRightClose size={18} /></button>
        </div>
      </header>

      <div className={`shell-right-dock__content shell-right-dock__content--${activeDockModule}`}>
        <DockModuleContent moduleId={activeDockModule} />
      </div>

      <nav className="shell-dock" aria-label="模块切换">
        {MODULES.map((module) => {
          const ModuleIcon = module.Icon;
          return (
            <button
              key={module.id}
              type="button"
              className={module.id === activeDockModule ? "is-active" : ""}
              aria-pressed={module.id === activeDockModule}
              onClick={() => shellActions.setActiveDockModule(module.id)}
            >
              <ModuleIcon size={17} />
              <span>{module.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
