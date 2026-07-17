import { useTranslation } from "react-i18next";
import { SpaceSwitcher } from "../SpaceSwitcher.tsx";
import { useStore } from "../store.tsx";
import { storedChatLocation } from "./shellStore.ts";
import type { WorkspaceModuleId } from "./workspaceLayout.ts";
import { getWorkspaceModule } from "./workspaceModules.tsx";

interface WorkspaceContextRowProps {
  activeModule: WorkspaceModuleId | null;
  channelId: string | null;
  layoutSearch: string;
}

export function WorkspaceContextRow({ activeModule, channelId, layoutSearch }: WorkspaceContextRowProps) {
  const { t } = useTranslation();
  const { channels, dms, spaceId, spaces } = useStore();
  const space = spaces.find((item) => item.id === spaceId);
  const conversation = [...channels, ...dms].find((item) => item.id === channelId);
  const conversationLabel = conversation
    ? `${dms.some((item) => item.id === conversation.id) ? "@" : "#"} ${conversation.name}`
    : "Chat";
  const moduleLabel = activeModule ? t(getWorkspaceModule(activeModule).labelKey) : null;

  return (
    <div className="shell-sidebar-context">
      <SpaceSwitcher
        targetPathForSlug={(nextSlug) => {
          const remembered = storedChatLocation(nextSlug)?.path;
          const pathname = remembered?.split("?")[0] ?? `/s/${nextSlug}/channel`;
          return `${pathname}${layoutSearch}`;
        }}
      />
      <span className="shell-sidebar-context__space-name">{space?.name ?? "Kith-space"}</span>
      <span className="shell-sidebar-context__current">
        {conversationLabel}
        {moduleLabel ? <><span aria-hidden="true">/</span>{moduleLabel}</> : null}
      </span>
    </div>
  );
}
