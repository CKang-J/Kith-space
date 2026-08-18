export const CANVAS_SELECTION_TO_CHAT_EVENT = "kith:canvas-selection-to-chat";

export type CanvasSelectionToChatTarget = string | string[];

/** Stage 1 host seam only: later Kith chat integration can subscribe without importing Recombyn chat. */
export function requestCanvasSelectionToChat(target: CanvasSelectionToChatTarget, label = "Chat"): void {
  window.dispatchEvent(
    new CustomEvent(CANVAS_SELECTION_TO_CHAT_EVENT, {
      detail: { target },
    }),
  );
  void playSelectionFlyToChat(label);
}

async function playSelectionFlyToChat(label: string): Promise<void> {
  const { playFlyChipToChat, takeCanvasFlyOrigin } = await import(
    "@recombyn-native/components/editor/panels/agent/flyToChat"
  );
  const origin = takeCanvasFlyOrigin() ?? {
    x: Math.max(120, window.innerWidth * 0.45),
    y: Math.max(96, window.innerHeight * 0.38),
  };
  await playFlyChipToChat({ from: origin, label });
}
