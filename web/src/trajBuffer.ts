// Bounded trajectory buffers keyed by base conversation id. Agents stream entries continuously;
// every conversation independently keeps only its newest TRAJ_CAP entries in memory. Switching
// conversations selects another bucket without discarding it; switching Space clears the map.
// `boundary` is a structural marker (no visible content) pushed when an agent's activity leaves
// working/thinking — it forces the next fragment for that same agent to start a fresh group
// instead of being appended to a turn that already ended (see store.tsx agent:activity handler).
export interface TrajItem { agentId?: string; name?: string; streamId?: string; text: string; tool?: boolean; boundary?: boolean }
export type TrajectoryBuckets = Record<string, TrajItem[]>;

export const TRAJ_CAP = 300;

export function appendCapped(prev: TrajItem[], items: TrajItem[], cap: number = TRAJ_CAP): TrajItem[] {
  if (!items.length) return prev;
  const merged = [...prev, ...items];
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
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

export interface TrajGroupItem { kind: "text" | "tool"; text: string }
export interface TrajGroup { agentId?: string; name?: string; streamId?: string; items: TrajGroupItem[] }

function trajectoryStreamKey(item: Pick<TrajItem, "agentId" | "name" | "streamId">): string {
  return item.streamId ? `${item.agentId ?? item.name ?? ""}:${item.streamId}` : item.agentId ?? item.name ?? "";
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
      groups.push({ agentId: it.agentId, name: it.name, streamId: it.streamId, items: [] });
      boundaryPending.delete(key);
    }
    const gi = groups[groups.length - 1]!.items;
    if (it.tool) { gi.push({ kind: "tool", text: it.text }); continue; }
    const lastItem = gi[gi.length - 1];
    if (lastItem && lastItem.kind === "text") lastItem.text += it.text;
    else gi.push({ kind: "text", text: it.text });
  }
  return groups;
}
