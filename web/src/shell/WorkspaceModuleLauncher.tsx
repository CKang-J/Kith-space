import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button.tsx";
import { workspaceLaunchModulesForSpace } from "./workspaceModules.tsx";
import type { ContentModuleId } from "./workspaceLayout.ts";

interface WorkspaceModuleLauncherProps {
  isHome: boolean;
  onOpenModule(moduleId: ContentModuleId): void;
}

export function WorkspaceModuleLauncher({ isHome, onOpenModule }: WorkspaceModuleLauncherProps) {
  const { t } = useTranslation();
  const modules = workspaceLaunchModulesForSpace(isHome);

  return (
    <section className="flex h-full min-w-0 items-center justify-center p-6" aria-label="打开模块">
      <h2 className="sr-only">打开模块</h2>
      <div className="flex w-full max-w-md flex-col gap-2">
        {modules.map((module) => {
          const ModuleIcon = module.Icon;
          return (
            <Button
              key={module.id}
              type="button"
              variant="ghost"
              className="h-12 justify-start gap-3 px-4"
              onClick={() => onOpenModule(module.id as ContentModuleId)}
            >
              <ModuleIcon className="size-5" />
              {t(module.labelKey)}
            </Button>
          );
        })}
      </div>
    </section>
  );
}
