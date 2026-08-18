export interface CanvasSelectionSummaryParts {
  canvasTitle: string;
  wholeCanvas: boolean;
  elementCount: number;
  frameCount: number;
  truncated: boolean;
  documentRevision: number;
}

export function pendingSelectionSummaryParts(
  canvasTitle: string,
  selectedIds: string[],
  documentRevision = 0,
): CanvasSelectionSummaryParts {
  const frameCount = selectedIds.filter((id) => id.startsWith("frame:")).length;
  return {
    canvasTitle: canvasTitle.trim(),
    wholeCanvas: selectedIds.length === 0,
    elementCount: selectedIds.length - frameCount,
    frameCount,
    truncated: false,
    documentRevision,
  };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function formatCanvasSelectionSummaryI18n(parts: CanvasSelectionSummaryParts, t: Translate): string {
  const title = parts.canvasTitle.trim() || t("chat.canvasUntitled");
  if (parts.wholeCanvas) {
    const elementsKey = parts.elementCount === 1 ? "chat.canvasSummaryElement" : "chat.canvasSummaryElements";
    return `${title} · ${t("chat.canvasSummaryWhole")} · ${t(elementsKey, { count: parts.elementCount })} · ${t("chat.canvasRevision", { revision: parts.documentRevision })}`;
  }
  const segments = [title];
  if (parts.frameCount) {
    const framesKey = parts.frameCount === 1 ? "chat.canvasSummaryFrame" : "chat.canvasSummaryFrames";
    segments.push(t(framesKey, { count: parts.frameCount }));
  }
  if (parts.elementCount) {
    const elementsKey = parts.elementCount === 1 ? "chat.canvasSummaryElement" : "chat.canvasSummaryElements";
    segments.push(t(elementsKey, { count: parts.elementCount }));
  }
  if (parts.truncated) segments.push(t("chat.canvasSummaryTruncated"));
  if (parts.documentRevision != null) segments.push(t("chat.canvasRevision", { revision: parts.documentRevision }));
  return segments.join(" · ");
}
