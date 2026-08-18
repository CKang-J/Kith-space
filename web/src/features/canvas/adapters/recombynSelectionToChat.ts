import { playCanvasFlyToChat } from "./canvasFlyToChat";

export const CANVAS_SELECTION_TO_CHAT_EVENT = "kith:canvas-selection-to-chat";

export type CanvasSelectionToChatTarget = string | string[];

export interface CanvasSelectionToChatDetail {
  canvasId: string;
  target: CanvasSelectionToChatTarget;
  canvasTitle?: string;
  documentRevision?: number;
  previewDocument?: unknown;
}

export function requestCanvasSelectionToChat(
  target: CanvasSelectionToChatTarget,
  label = "Chat",
  source?: { canvasId: string; canvasTitle?: string; documentRevision?: number; previewDocument?: unknown },
): void {
  const canvasId = source?.canvasId?.trim() ?? "";
  window.dispatchEvent(
    new CustomEvent(CANVAS_SELECTION_TO_CHAT_EVENT, {
      detail: {
        target,
        canvasId,
        canvasTitle: source?.canvasTitle,
        documentRevision: source?.documentRevision,
        previewDocument: source?.previewDocument,
      } satisfies CanvasSelectionToChatDetail,
    }),
  );
  void playCanvasFlyToChat({ label });
}
