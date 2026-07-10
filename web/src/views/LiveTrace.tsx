import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, resolveAvatar } from "../Avatar.tsx";
import { IconWrench } from "../icons.tsx";
import { useStore } from "../store.tsx";
import { groupTraj } from "../trajBuffer.ts";

export function LiveTrace({ showHeading = true }: { showHeading?: boolean }) {
  const { t } = useTranslation();
  const { agents, traj, attachmentUrl } = useStore();
  const trajGroups = useMemo(() => groupTraj(traj), [traj]);

  return (
    <>
      {showHeading && <h2>{t("chat.agentLiveTrace")}</h2>}
      {trajGroups.length === 0
        ? <div className="hint">{t("chat.agentTraceHint")}</div>
        : trajGroups.map((group, index) => {
            const agent = agents.find((item) => (item.displayName || item.name) === group.name);
            const isTail = index === trajGroups.length - 1;
            const isLive = isTail && (agent?.activity === "working" || agent?.activity === "thinking");
            return (
              <div className="traj-grp" key={index}>
                <span className="traj-av">
                  <Avatar seed={group.name || "agent"} url={resolveAvatar(agent?.avatarUrl, attachmentUrl)} size={26} />
                </span>
                <div className="traj-body">
                  {group.name ? <div className="traj-head">@{group.name}</div> : null}
                  {group.items.map((item, itemIndex) => item.kind === "tool"
                    ? <div className="traj-tool" key={itemIndex}><IconWrench size={12} />{item.text}</div>
                    : <div className="traj-text" key={itemIndex}>{item.text}{isLive && itemIndex === group.items.length - 1 ? <span className="traj-cursor" /> : null}</div>)}
                </div>
              </div>
            );
          })}
    </>
  );
}
