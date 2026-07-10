import { Minimize2, PanelRightOpen } from "lucide-react";
import { ChatSlot } from "./ChatSlot.tsx";
import { DragDivider } from "./DragDivider.tsx";
import { IconRail } from "./IconRail.tsx";
import { DockModuleContent, getDockModule, RightDock } from "./RightDock.tsx";
import { RIGHT_PANEL_MAX, RIGHT_PANEL_MIN, shellActions, useShellStore } from "./shellStore.ts";

interface SpaceShellProps {
  legacyHref: string;
}

export function SpaceShell({ legacyHref }: SpaceShellProps) {
  const { currentSpaceId, rightPanelWidth, isRightPanelHidden, promotedModule } = useShellStore();

  if (promotedModule) {
    const module = getDockModule(promotedModule);
    return (
      <main className="shell-space shell-space--promoted">
        <IconRail legacyHref={legacyHref} />
        <section className="shell-promoted-module" aria-label={`${module.label}中心工作区`}>
          <header>
            <div>
              <span className="shell-eyebrow">中心工作区 · {currentSpaceId}</span>
              <h1>{module.label}模块</h1>
            </div>
            <button type="button" onClick={shellActions.restoreModule}><Minimize2 size={17} />恢复三区布局</button>
          </header>
          <DockModuleContent moduleId={promotedModule} promoted />
        </section>
        <ChatSlot compact />
      </main>
    );
  }

  return (
    <main className="shell-space">
      <IconRail legacyHref={legacyHref} />
      <div className="shell-space__workspace">
        <ChatSlot />
        {!isRightPanelHidden && (
          <>
            <DragDivider
              value={rightPanelWidth}
              min={RIGHT_PANEL_MIN}
              max={RIGHT_PANEL_MAX}
              onChange={shellActions.setRightPanelWidth}
            />
            <RightDock width={rightPanelWidth} />
          </>
        )}
        {isRightPanelHidden && (
          <button className="shell-show-right" type="button" onClick={() => shellActions.setRightPanelHidden(false)}>
            <PanelRightOpen size={17} />显示右栏
          </button>
        )}
      </div>
    </main>
  );
}
