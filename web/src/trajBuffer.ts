// Bounded trajectory buffers keyed by base conversation id. Agents stream entries continuously;
// every conversation independently keeps only its newest TRAJ_CAP entries in memory. Switching
// conversations selects another bucket without discarding it; switching Space clears the map.
// `boundary` is a structural marker (no visible content) pushed when an agent's activity leaves
// working/thinking — it forces the next fragment for that same agent to start a fresh group
// instead of being appended to a turn that already ended (see store.tsx agent:activity handler).
export type TrajToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

export interface TrajSource {
  kind: "channel" | "dm" | "thread" | "unknown";
  channelId: string | null;
  conversationId: string | null;
  name: string | null;
  parentMessageId: string | null;
  parentPreview: string | null;
  unavailable: boolean;
}

export interface TrajItem {
  agentId?: string;
  name?: string;
  streamId?: string;
  source?: TrajSource | null;
  text: string;
  kind?: "text" | "thinking" | "tool" | "status";
  eventKind?: string;
  createdAt?: number;
  tool?: boolean;
  toolName?: string;
  toolCallId?: string;
  toolInput?: string;
  toolOutput?: string;
  toolState?: TrajToolState;
  activity?: string;
  detail?: string;
  boundary?: boolean;
}
export type TrajectoryBuckets = Record<string, TrajItem[]>;

export const TRAJ_CAP = 300;

export function appendCapped(prev: TrajItem[], items: TrajItem[], cap: number = TRAJ_CAP): TrajItem[] {
  if (!items.length) return prev;
  const merged = [...prev, ...items];
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

function trajectoryFingerprint(item: TrajItem): string {
  return JSON.stringify({
    agentId: item.agentId,
    name: item.name,
    streamId: item.streamId,
    kind: item.kind,
    eventKind: item.eventKind,
    text: item.text,
    toolName: item.toolName,
    toolCallId: item.toolCallId,
    toolInput: item.toolInput,
    toolOutput: item.toolOutput,
    toolState: item.toolState,
    activity: item.activity,
    detail: item.detail,
    boundary: item.boundary,
  });
}

/**
 * Combines a persisted snapshot with entries already received over WebSocket.
 * The activity write and the history read can overlap, so matching entries are
 * consumed as a multiset instead of being rendered twice.
 */
export function mergeTrajectoryHistory(
  history: TrajItem[],
  live: TrajItem[],
  cap: number = TRAJ_CAP,
): TrajItem[] {
  const remainingHistoryMatches = new Map<string, number>();
  for (const item of history) {
    const key = trajectoryFingerprint(item);
    remainingHistoryMatches.set(key, (remainingHistoryMatches.get(key) ?? 0) + 1);
  }
  const liveOnly = live.filter((item) => {
    const key = trajectoryFingerprint(item);
    const remaining = remainingHistoryMatches.get(key) ?? 0;
    if (!remaining) return true;
    if (remaining === 1) remainingHistoryMatches.delete(key);
    else remainingHistoryMatches.set(key, remaining - 1);
    return false;
  });
  return appendCapped(history, liveOnly, cap);
}

export function appendConversationTrajectory(
  prev: TrajectoryBuckets,
  conversationId: string,
  items: TrajItem[],
  cap: number = TRAJ_CAP,
): TrajectoryBuckets {
  if (!conversationId || items.length === 0) return prev;
  return { ...prev, [conversationId]: appendCapped(prev[conversationId] ?? [], items, cap) };
}

function sameTrajectoryStream(item: TrajItem, identity: Pick<TrajItem, "agentId" | "name" | "streamId">): boolean {
  if (identity.streamId) return item.streamId === identity.streamId && (!identity.agentId || item.agentId === identity.agentId);
  if (identity.agentId) return item.agentId === identity.agentId;
  return item.name === identity.name;
}

export function appendConversationBoundary(
  prev: TrajectoryBuckets,
  conversationId: string,
  identity: Pick<TrajItem, "agentId" | "name" | "streamId">,
  cap: number = TRAJ_CAP,
): TrajectoryBuckets {
  const items = prev[conversationId];
  if (!conversationId || !items?.length) return prev;
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!;
    if (!sameTrajectoryStream(item, identity)) continue;
    if (item.boundary) return prev;
    return appendConversationTrajectory(prev, conversationId, [{ ...identity, text: "", boundary: true }], cap);
  }
  return prev;
}

export type TrajGroupItem =
  | { kind: "text"; text: string; createdAt?: number }
  | { kind: "thinking"; text: string; createdAt?: number }
  | { kind: "status"; text: string; activity?: string; createdAt?: number }
  | {
    kind: "tool";
    text: string;
    toolName: string;
    toolCallId?: string;
    toolInput?: string;
    toolOutput?: string;
    toolState: TrajToolState;
    createdAt?: number;
  };
export interface TrajGroup {
  agentId?: string;
  name?: string;
  streamId?: string;
  source?: TrajSource | null;
  items: TrajGroupItem[];
}

function trajectoryStreamKey(
  item: Pick<TrajItem, "agentId" | "name" | "streamId" | "source">,
): string {
  const identity = item.streamId
    ? `${item.agentId ?? item.name ?? ""}:${item.streamId}`
    : item.agentId ?? item.name ?? "";
  return `${identity}:${item.source?.channelId ?? ""}`;
}

// Turns the flat, one-fragment-per-line buffer into message-bar-like groups: consecutive text
// fragments from the same agent/turn merge into one running block (so the panel reads as
// continuous prose, not a scrolling log); tool calls stay as their own discrete step; a different
// agent, or a boundary marker for the same agent, always starts a new group.
export function groupTraj(items: TrajItem[]): TrajGroup[] {
  const groups: TrajGroup[] = [];
  const boundaryPending = new Set<string>();
  for (const it of items) {
    const key = trajectoryStreamKey(it);
    if (it.boundary) { boundaryPending.add(key); continue; }
    const last = groups[groups.length - 1];
    const lastKey = last ? trajectoryStreamKey(last) : "";
    if (!last || lastKey !== key || boundaryPending.has(key)) {
      groups.push({
        agentId: it.agentId,
        name: it.name,
        streamId: it.streamId,
        source: it.source,
        items: [],
      });
      boundaryPending.delete(key);
    } else if (!last.source && it.source) {
      last.source = it.source;
    }
    const gi = groups[groups.length - 1]!.items;
    const kind = it.kind ?? (it.tool || it.toolName ? "tool" : "text");
    if (kind === "status") {
      gi.push({
        kind: "status",
        text: it.detail || it.text,
        activity: it.activity,
        createdAt: it.createdAt,
      });
      continue;
    }
    if (kind === "tool") {
      const toolName = it.toolName || it.text || "tool";
      const toolState = it.toolState ?? (it.eventKind === "tool_failed"
        ? "output-error"
        : it.eventKind === "tool_completed"
          ? "output-available"
          : "input-available");
      let matchingIndex = -1;
      if (it.toolCallId) {
        for (let index = gi.length - 1; index >= 0; index -= 1) {
          const item = gi[index]!;
          if (item.kind === "tool" && item.toolCallId === it.toolCallId) {
            matchingIndex = index;
            break;
          }
        }
      }
      if (matchingIndex >= 0) {
        const previous = gi[matchingIndex]!;
        if (previous.kind === "tool") {
          gi[matchingIndex] = {
            ...previous,
            text: it.text || previous.text,
            toolName,
            toolInput: it.toolInput || previous.toolInput,
            toolOutput: it.toolOutput || previous.toolOutput,
            toolState,
            // Keep the start timestamp stable so a completion update does not remount
            // an expanded tool row or make its displayed time jump.
            createdAt: previous.createdAt ?? it.createdAt,
          };
        }
      } else {
        gi.push({
          kind: "tool",
          text: it.text,
          toolName,
          toolCallId: it.toolCallId,
          toolInput: it.toolInput,
          toolOutput: it.toolOutput,
          toolState,
          createdAt: it.createdAt,
        });
      }
      continue;
    }
    const lastItem = gi[gi.length - 1];
    if (lastItem && lastItem.kind === kind) lastItem.text += it.text;
    else gi.push({
      kind,
      text: it.text,
      ...(it.createdAt !== undefined ? { createdAt: it.createdAt } : {}),
    });
  }
  return groups;
}
