import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore, type Channel, type Dm } from "@/store";
import { groupTraj, type TrajSource } from "@/trajBuffer";
import {
  activityRowsToTrajectory,
  type AgentActivityLogRow,
} from "./trajectoryActivityModel";
import { TrajectoryTimeline } from "./TrajectoryTimeline";

const MAX_ACTIVITY_ROWS = 400;

function sourceFromLiveScope(
  channelId: string | undefined,
  conversationId: string | undefined,
  channels: Channel[],
  archivedChannels: Channel[],
  dms: Dm[],
  humanName?: string,
): TrajSource | null {
  if (!channelId) return null;
  const baseId = conversationId || channelId;
  const dm = dms.find((item) => item.id === baseId);
  if (dm) {
    return {
      kind: "dm",
      channelId,
      conversationId: baseId,
      name: humanName || null,
      parentMessageId: null,
      parentPreview: null,
      unavailable: false,
    };
  }
  const channel = [...channels, ...archivedChannels].find((item) => item.id === baseId);
  if (channelId !== baseId) {
    return {
      kind: "thread",
      // Realtime scope does not carry the parent message id. Link to the base channel
      // until the persisted history response can provide the exact thread deep-link.
      channelId: baseId,
      conversationId: baseId,
      name: channel?.name || null,
      parentMessageId: null,
      parentPreview: null,
      unavailable: false,
    };
  }
  return {
    kind: channel ? "channel" : "unknown",
    channelId,
    conversationId: baseId,
    name: channel?.name || null,
    parentMessageId: null,
    parentPreview: null,
    unavailable: false,
  };
}

function appendRows(
  current: AgentActivityLogRow[],
  additions: AgentActivityLogRow[],
): AgentActivityLogRow[] {
  const next = [...current, ...additions];
  return next.length > MAX_ACTIVITY_ROWS ? next.slice(-MAX_ACTIVITY_ROWS) : next;
}

export function AgentActivityTimeline({
  activity,
  id,
  name,
  onOpenSource,
}: {
  activity?: string;
  id: string;
  name: string;
  onOpenSource?: (source: TrajSource) => void;
}) {
  const { t } = useTranslation();
  const {
    api,
    archivedChannels,
    channels,
    dms,
    me,
    onEvent,
  } = useStore();
  const [rows, setRows] = useState<AgentActivityLogRow[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stayPinnedRef = useRef(true);

  useEffect(() => {
    let active = true;
    setRows([]);
    void api("GET", `/api/agents/${id}/activity-log?limit=200`).then((data) => {
      if (active) {
        const history = Array.isArray(data) ? data : [];
        // Preserve realtime rows that arrived while the history request was in flight.
        setRows((current) => appendRows(history, current));
      }
    });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => onEvent((event) => {
    if (event.type === "agent" && event.id === id && event.activity) {
      const terminal = event.activity !== "working" && event.activity !== "thinking";
      if (event.eventKind !== "turn_started" && event.eventKind !== "activity" && !terminal) return;
      setRows((current) => appendRows(current, [{
        timestamp: Date.now(),
        streamId: event.streamId,
        source: sourceFromLiveScope(
          event.channelId,
          event.conversationId,
          channels,
          archivedChannels,
          dms,
          me?.name,
        ),
        entry: {
          kind: event.eventKind === "turn_started" ? "turn_started" : "status",
          activity: event.activity,
          detail: event.detail,
        },
      }]));
      return;
    }
    if (event.type !== "trajectory" || event.agentId !== id) return;
    setRows((current) => appendRows(
      current,
      (event.entries || []).map((entry: any) => ({
        timestamp: entry.createdAt || Date.now(),
        streamId: event.streamId,
        source: sourceFromLiveScope(
          event.channelId,
          event.conversationId,
          channels,
          archivedChannels,
          dms,
          me?.name,
        ),
        entry: {
          kind: entry.eventKind || entry.kind || (entry.toolName ? "tool_started" : "text"),
          text: entry.toolOutput || entry.text,
          toolName: entry.toolName,
          toolInput: entry.toolInput,
          detail: entry.toolCallId || entry.detail,
          activity: entry.activity,
        },
      })),
    ));
  }), [archivedChannels, channels, dms, id, me?.name]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element && stayPinnedRef.current) element.scrollTop = element.scrollHeight;
  }, [rows]);

  const groups = useMemo(
    () => groupTraj(activityRowsToTrajectory(rows, { agentId: id, name })),
    [id, name, rows],
  );

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
      onScroll={(event) => {
        const element = event.currentTarget;
        stayPinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
      }}
      ref={scrollRef}
    >
      {groups.length
        ? (
          <TrajectoryTimeline
            agents={[{ activity, id, name }]}
            groups={groups}
            onOpenSource={onOpenSource}
            variant="activity"
          />
        )
        : <div className="empty">{t("members.activityEmpty", { name })}</div>}
    </div>
  );
}
