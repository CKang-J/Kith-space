import { Bell, MoreHorizontal, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useSystemAlerts } from "../alerts.tsx";
import { QuickSwitcher } from "../QuickSwitcher.tsx";
import { ServerSwitcher } from "../ServerSwitcher.tsx";
import { useStore } from "../store.tsx";
import { getWorkspaceModule } from "./workspaceModules.tsx";
import type { WorkspaceModuleId } from "./workspaceLayout.ts";
import { workspaceSearchForLayout } from "./workspaceRoute.ts";
import { storedChatLocation } from "./shellStore.ts";

interface WorkspaceTopBarProps {
  activeModule: WorkspaceModuleId | null;
  chatVisible: boolean;
  channelId: string | null;
  layoutSearch: string;
  legacyHref: string;
  onOpenSearch: () => void;
}

export function WorkspaceTopBar({ activeModule, chatVisible, channelId, layoutSearch, legacyHref, onOpenSearch }: WorkspaceTopBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { channels, dms, serverId, servers, slug } = useStore();
  const alerts = useSystemAlerts();
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const server = servers.find((item) => item.id === serverId);
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

  const firstActionableAlert = alerts.find((alert) => alert.machineId);

  return (
    <>
      <header className="shell-topbar">
        <div className="shell-topbar__space">
          <ServerSwitcher
            targetPathForSlug={(nextSlug) => {
              const remembered = storedChatLocation(nextSlug)?.path;
              const pathname = remembered?.split("?")[0] ?? `/s/${nextSlug}/channel`;
              return `${pathname}${layoutSearch}`;
            }}
          />
          <span className="shell-topbar__space-name">{server?.name ?? "Kith-space"}</span>
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
          <button
            type="button"
            className="shell-topbar__alert"
            title={alerts.length ? alerts[0]!.title : t("alerts.title")}
            aria-label={alerts.length ? t("alerts.count", { count: alerts.length }) : t("alerts.title")}
            disabled={!firstActionableAlert}
            onClick={() => firstActionableAlert?.machineId && navigate(
              `/s/${slug}/computer/${firstActionableAlert.machineId}${workspaceSearchForLayout("", { activeModule: "computers", chatVisible })}`,
            )}
          >
            <Bell size={17} />
            {alerts.length ? <span>{alerts.length > 9 ? "9+" : alerts.length}</span> : null}
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
