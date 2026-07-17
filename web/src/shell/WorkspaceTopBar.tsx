import { useTranslation } from "react-i18next";
import { SpaceSwitcher } from "../SpaceSwitcher.tsx";
import { useStore } from "../store.tsx";
import { getWorkspaceModule } from "./workspaceModules.tsx";
import type { WorkspaceModuleId } from "./workspaceLayout.ts";
import { storedChatLocation } from "./shellStore.ts";

interface WorkspaceTopBarProps {
  activeModule: WorkspaceModuleId | null;
  channelId: string | null;
  layoutSearch: string;
}

export function WorkspaceTopBar({ activeModule, channelId, layoutSearch }: WorkspaceTopBarProps) {
  const { t } = useTranslation();
  const { channels, dms, spaceId, spaces } = useStore();
  const space = spaces.find((item) => item.id === spaceId);
  const conversation = [...channels, ...dms].find((item) => item.id === channelId);
  const conversationLabel = conversation ? `${dms.some((item) => item.id === conversation.id) ? "@" : "#"} ${conversation.name}` : "Chat";
  const moduleLabel = activeModule ? t(getWorkspaceModule(activeModule).labelKey) : null;

  return (
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
      </header>
  );
}
