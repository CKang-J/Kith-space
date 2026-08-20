import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TrajectoryTimeline } from "../features/trajectory/TrajectoryTimeline.tsx";
import {
  conversationActivityRowsToTrajectory,
  selectAggregateTrajectory,
  type ConversationActivityLogRow,
} from "../features/trajectory/trajectoryActivityModel.ts";
import { useStore } from "../store.tsx";
import { groupTraj, mergeTrajectoryHistory, type TrajItem } from "../trajBuffer.ts";

const EMPTY_TRAJECTORY: TrajItem[] = [];

export function LiveTrace({ conversationId, showHeading = true }: { conversationId?: string; showHeading?: boolean }) {
  const { t } = useTranslation();
  const { agents, api, trajByConversation, attachmentUrl } = useStore();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [history, setHistory] = useState<TrajItem[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const live = conversationId ? trajByConversation[conversationId] ?? EMPTY_TRAJECTORY : EMPTY_TRAJECTORY;

  useEffect(() => {
    let active = true;
    setHistory([]);
    setHistoryLoaded(false);
    if (!conversationId) {
      setHistoryLoaded(true);
      return () => { active = false; };
    }
    void apiRef.current("GET", `/api/channels/${encodeURIComponent(conversationId)}/activity-log?limit=300`)
      .then((data) => {
        if (!active) return;
        const rows = Array.isArray(data) ? data as ConversationActivityLogRow[] : [];
        setHistory(conversationActivityRowsToTrajectory(rows));
      })
      .catch(() => {
        if (active) setHistory([]);
      })
      .finally(() => {
        if (active) setHistoryLoaded(true);
      });
    return () => { active = false; };
  }, [conversationId]);

  const traj = useMemo(
    () => selectAggregateTrajectory(mergeTrajectoryHistory(history, live)),
    [history, live],
  );
  const trajGroups = useMemo(() => groupTraj(traj), [traj]);

  return (
    <>
      {showHeading && <h2>{t("chat.agentLiveTrace")}</h2>}
      {historyLoaded && trajGroups.length === 0
        ? <div className="hint">{t("chat.agentTraceHint")}</div>
        : (
          <TrajectoryTimeline
            agents={agents}
            attachmentUrl={attachmentUrl}
            groups={trajGroups}
          />
        )}
    </>
  );
}
