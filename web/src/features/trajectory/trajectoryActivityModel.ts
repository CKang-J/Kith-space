import type { TrajItem, TrajSource, TrajToolState } from "@/trajBuffer";

export interface AgentActivityLogRow {
  timestamp?: number;
  streamId?: string;
  source?: TrajSource | null;
  entry?: {
    kind?: string;
    activity?: string | null;
    detail?: string | null;
    text?: string | null;
    toolName?: string | null;
    toolInput?: string | null;
  };
}

export interface ConversationActivityLogRow extends AgentActivityLogRow {
  agentId: string;
  name: string;
}

function toolState(kind: string): TrajToolState {
  if (kind === "tool_failed") return "output-error";
  if (kind === "tool_completed") return "output-available";
  return "input-available";
}

export function activityRowsToTrajectory(
  rows: AgentActivityLogRow[],
  identity: { agentId: string; name: string },
): TrajItem[] {
  return rowsToTrajectory(rows, () => identity);
}

export function conversationActivityRowsToTrajectory(
  rows: ConversationActivityLogRow[],
): TrajItem[] {
  return rowsToTrajectory(rows, (row) => ({ agentId: row.agentId, name: row.name }));
}

function rowsToTrajectory<Row extends AgentActivityLogRow>(
  rows: Row[],
  identityFor: (row: Row) => { agentId: string; name: string },
): TrajItem[] {
  const turnSequenceByAgent = new Map<string, number>();
  return rows.flatMap<TrajItem>((row): TrajItem[] => {
    const entry = row.entry;
    if (!entry) return [];
    const identity = identityFor(row);
    const kind = entry.kind === "tool" || entry.kind === "tool_start"
      ? "tool_started"
      : entry.kind || "status";
    let turnSequence = turnSequenceByAgent.get(identity.agentId) ?? 0;
    if (kind === "turn_started") {
      turnSequence += 1;
      turnSequenceByAgent.set(identity.agentId, turnSequence);
    }
    const common = {
      ...identity,
      // The activity endpoint is a flat log. A stable derived stream id restores turn
      // boundaries without introducing UI-owned state or changing persisted history.
      streamId: row.streamId || `${identity.agentId}:turn:${turnSequence}`,
      createdAt: row.timestamp,
      source: row.source,
    };

    if (kind === "thinking_summary" || kind === "thinking") {
      return [{ ...common, kind: "thinking" as const, eventKind: kind, text: entry.text || "" }];
    }
    if (kind === "text_preview" || kind === "text") {
      return entry.text
        ? [{ ...common, kind: "text" as const, eventKind: kind, text: entry.text }]
        : [];
    }
    if (kind === "tool_started" || kind === "tool_completed" || kind === "tool_failed") {
      return [{
        ...common,
        kind: "tool" as const,
        eventKind: kind,
        text: "",
        tool: true,
        toolName: entry.toolName || "tool",
        toolCallId: entry.detail || undefined,
        toolInput: entry.toolInput || undefined,
        toolOutput: kind === "tool_started" ? undefined : entry.text || undefined,
        toolState: toolState(kind),
      }];
    }
    if (!entry.activity && !entry.detail) return [];
    return [{
      ...common,
      kind: "status" as const,
      eventKind: kind,
      text: "",
      activity: entry.activity || undefined,
      detail: entry.detail || undefined,
    }];
  });
}
