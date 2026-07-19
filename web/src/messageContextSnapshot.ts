export interface MessageContextSnapshot {
  spaceId: string;
  module: "chat";
  routeId: "chat.channel" | "chat.thread";
  openObjectRefs: Array<{ type: "channel" | "thread"; id: string }>;
  focusedRef: { type: "channel" | "thread"; id: string; field: "composer" };
  capturedAt: number;
}

/** Captures product identifiers only; it intentionally never reads location, DOM, draft text, or local paths. */
export function messageContextSnapshot(
  spaceId: string,
  channelId: string,
  isThread: boolean,
  capturedAt = Date.now(),
): MessageContextSnapshot {
  const type = isThread ? "thread" : "channel";
  return {
    spaceId,
    module: "chat",
    routeId: isThread ? "chat.thread" : "chat.channel",
    openObjectRefs: [{ type, id: channelId }],
    focusedRef: { type, id: channelId, field: "composer" },
    capturedAt,
  };
}
