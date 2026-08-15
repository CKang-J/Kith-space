export const CANVAS_SELECTION_TO_CHAT_EVENT = "kith:canvas-selection-to-chat";

export type CanvasSelectionToChatTarget = string | string[];

/** Stage 1 host seam only: later Kith chat integration can subscribe without importing Recombyn chat. */
export function requestCanvasSelectionToChat(target: CanvasSelectionToChatTarget): void {
  window.dispatchEvent(
    new CustomEvent(CANVAS_SELECTION_TO_CHAT_EVENT, {
      detail: { target },
    }),
  );
}
