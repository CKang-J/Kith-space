import { MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DOCK_MODULES } from "./workspaceModules.tsx";
import type { DockModuleId, WorkspaceModuleId } from "./workspaceLayout.ts";

interface WorkspaceDockProps {
  activeModule: WorkspaceModuleId | null;
  chatVisible: boolean;
  unreadCount: number;
  onChatToggle: () => void;
  onModuleSelect: (moduleId: DockModuleId) => void;
}

export function WorkspaceDock({
  activeModule,
  chatVisible,
  unreadCount,
  onChatToggle,
  onModuleSelect,
}: WorkspaceDockProps) {
  const { t } = useTranslation();
  const chatLocked = activeModule === null;

  return (
    <nav className="workspace-dock" aria-label="工作区模块">
      <button
        type="button"
        className={`workspace-dock__item workspace-dock__chat${chatVisible ? " is-active" : ""}`}
        aria-label={chatLocked ? "Chat 已是唯一工作面" : chatVisible ? "隐藏 Chat" : "显示 Chat"}
        aria-pressed={chatVisible}
        aria-disabled={chatLocked}
        onClick={onChatToggle}
      >
        <MessageCircle size={18} />
      </button>
      {DOCK_MODULES.map((module) => {
        const active = activeModule === module.id;
        const ModuleIcon = module.Icon;
        return (
          <button
            key={module.id}
            type="button"
            className={`workspace-dock__item${active ? " is-active" : ""}`}
            aria-label={t(module.labelKey)}
            aria-pressed={active}
            onClick={() => onModuleSelect(module.id)}
          >
            <ModuleIcon size={18} />
            <span className="workspace-dock__label">{t(module.labelKey)}</span>
            {module.id === "inbox" && unreadCount > 0 ? (
              <span className="workspace-dock__badge" aria-label={`${unreadCount} 条未读`}>
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
