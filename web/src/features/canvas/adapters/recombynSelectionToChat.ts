export const CANVAS_SELECTION_TO_CHAT_EVENT = "kith:canvas-selection-to-chat";

export type CanvasSelectionToChatTarget = string | string[];

export interface CanvasMarkedRegionInput {
  nodeId: string;
  label: string;
  kind: string;
  nx: number;
  ny: number;
  nw: number;
  nh: number;
}

export interface CanvasSelectionToChatDetail {
  canvasId: string;
  target: CanvasSelectionToChatTarget;
  canvasTitle?: string;
  documentRevision?: number;
  previewDocument?: unknown;
  markedRegions?: CanvasMarkedRegionInput[];
}

export function requestCanvasSelectionToChat(
  target: CanvasSelectionToChatTarget,
  source?: {
    canvasId: string;
    canvasTitle?: string;
    documentRevision?: number;
    previewDocument?: unknown;
    markedRegions?: CanvasMarkedRegionInput[];
  },
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
        markedRegions: source?.markedRegions,
      } satisfies CanvasSelectionToChatDetail,
    }),
  );
}
