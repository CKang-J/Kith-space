import { MoreHorizontal, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { QuickSwitcher } from "../QuickSwitcher.tsx";
import { SpaceSwitcher } from "../SpaceSwitcher.tsx";
import { useStore } from "../store.tsx";
import { getWorkspaceModule } from "./workspaceModules.tsx";
import type { WorkspaceModuleId } from "./workspaceLayout.ts";
import { storedChatLocation } from "./shellStore.ts";

interface WorkspaceTopBarProps {
  activeModule: WorkspaceModuleId | null;
  channelId: string | null;
  layoutSearch: string;
  legacyHref: string;
  onOpenSearch: () => void;
}

export function WorkspaceTopBar({ activeModule, channelId, layoutSearch, legacyHref, onOpenSearch }: WorkspaceTopBarProps) {
  const { t } = useTranslation();
  const { channels, dms, spaceId, spaces } = useStore();
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const space = spaces.find((item) => item.id === spaceId);
  const conversation = [...channels, ...dms].find((item) => item.id === channelId);
  const conversationLabel = conversation ? `${dms.some((item) => item.id === conversation.id) ? "@" : "#"} ${conversation.name}` : "Chat";
  const moduleLabel = activeModule ? t(getWorkspaceModule(activeModule).labelKey) : null;

  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setShowQuickSwitcher(true);
    };
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, []);

  return (
    <>
      <header className="shell-topbar">
        <div className="shell-topbar__space">
          <SpaceSwitcher
            targetPathForSlug={(nextSlug) => {
              const remembered = storedChatLocation(nextSlug)?.path;
              const pathname = remembered?.split("?")[0] ?? `/s/${nextSlug}/channel`;
              return `${pathname}${layoutSearch}`;
            }}
          />
          <span className="shell-topbar__space-name">{space?.name ?? "Kith-space"}</span>
        </div>
        <span className="shell-topbar__context">
          {conversationLabel}
          {moduleLabel ? <><span aria-hidden="true">/</span>{moduleLabel}</> : null}
        </span>
        <div className="shell-topbar__spacer" />
        <div className="shell-topbar__tools" aria-label="工作区工具">
          <button type="button" title={`${t("nav.search")} (Ctrl/Command + K)`} aria-label={t("nav.search")} onClick={onOpenSearch}>
            <Search size={17} />
          </button>
          <a href={legacyHref} title="打开现有界面" aria-label="打开现有界面">
            <MoreHorizontal size={17} />
          </a>
        </div>
      </header>
      {showQuickSwitcher ? <QuickSwitcher onClose={() => setShowQuickSwitcher(false)} /> : null}
    </>
  );
}
