import { Maximize2, Minimize2, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.tsx";
import { cn } from "../lib/utils.ts";
import { WORKSPACE_MODULES, workspaceLaunchModulesForSpace } from "./workspaceModules.tsx";
import { WorkspacePanelToggle } from "./WorkspacePanelToggle.tsx";
import type { ContentModuleId } from "./workspaceLayout.ts";
import type { WorkspaceTab } from "./workspaceTabs.ts";

interface WorkspaceTabsProps {
  activeTabId: string;
  children: React.ReactNode;
  isHome: boolean;
  tabs: WorkspaceTab[];
  onActivate(tab: WorkspaceTab): void;
  onClose(tabId: string): void;
  onOpenModule(moduleId: ContentModuleId): void;
  workspaceExpanded: boolean;
  onToggleWorkspaceExpanded(): void;
  workspacePanelOpen: boolean;
  onToggleWorkspacePanel(): void;
}

export function WorkspaceTabs({
  activeTabId,
  children,
  isHome,
  tabs,
  onActivate,
  onClose,
  onOpenModule,
  workspaceExpanded,
  onToggleWorkspaceExpanded,
  workspacePanelOpen,
  onToggleWorkspacePanel,
}: WorkspaceTabsProps) {
  const { t } = useTranslation();
  const availableModules = workspaceLaunchModulesForSpace(isHome);

  return (
    <Tabs
      value={activeTabId}
      className="shell-tab-workspace"
      onValueChange={(tabId) => {
        const tab = tabs.find((candidate) => candidate.id === tabId);
        if (tab) onActivate(tab);
      }}
    >
      <header className={cn(
        "shell-workspace-tabs",
        workspaceExpanded && "shell-workspace-tabs--expanded",
      )}>
        <TabsList variant="line" className="shell-workspace-tabs__list">
          {tabs.map((tab) => {
            const module = WORKSPACE_MODULES.find((candidate) => candidate.id === tab.moduleId);
            const title = tab.title ?? (module ? t(module.labelKey) : tab.moduleId);
            const TabIcon = module?.Icon;
            return (
              <div className="shell-workspace-tab" key={tab.id}>
                <TabsTrigger value={tab.id} title={title} className="shell-workspace-tab__trigger">
                  {TabIcon ? <TabIcon data-icon="inline-start" /> : null}
                  <span className="truncate">{title}</span>
                </TabsTrigger>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="shell-workspace-tab__close"
                  aria-label={`${title} · Close`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose(tab.id);
                  }}
                >
                  <X />
                </Button>
              </div>
            );
          })}
        </TabsList>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="打开工作区标签">
              <Plus />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56">
            <div className="flex flex-col gap-1">
              {availableModules.map((module) => {
                const ModuleIcon = module.Icon;
                return (
                  <Button
                    key={module.id}
                    type="button"
                    variant="ghost"
                    className="justify-start"
                    onClick={() => onOpenModule(module.id as ContentModuleId)}
                  >
                    <ModuleIcon data-icon="inline-start" />
                    {t(module.labelKey)}
                  </Button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={workspaceExpanded ? "恢复面板宽度" : "展开面板宽度"}
                aria-pressed={workspaceExpanded}
                onClick={onToggleWorkspaceExpanded}
              >
                {workspaceExpanded ? <Minimize2 /> : <Maximize2 />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {workspaceExpanded ? "恢复面板宽度" : "展开面板宽度"}
            </TooltipContent>
          </Tooltip>
          <div className="ml-1 border-l border-border/60 pl-1">
            <WorkspacePanelToggle
              open={workspacePanelOpen}
              onToggle={onToggleWorkspacePanel}
            />
          </div>
        </div>
      </header>
      <TabsContent value={activeTabId} className="shell-workspace-tab__content">
        {children}
      </TabsContent>
    </Tabs>
  );
}
