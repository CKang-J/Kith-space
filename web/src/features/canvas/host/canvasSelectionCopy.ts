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

export function formatCanvasSelectionDetailI18n(parts: CanvasSelectionSummaryParts, t: Translate): string {
  if (parts.wholeCanvas) {
    const elementsKey = parts.elementCount === 1 ? "chat.canvasSummaryElement" : "chat.canvasSummaryElements";
    return t("chat.canvasSummaryWhole") + " · " + t(elementsKey, { count: parts.elementCount });
  }
  const segments: string[] = [];
  if (parts.frameCount) {
    const framesKey = parts.frameCount === 1 ? "chat.canvasSummaryFrame" : "chat.canvasSummaryFrames";
    segments.push(t(framesKey, { count: parts.frameCount }));
  }
  if (parts.elementCount) {
    const elementsKey = parts.elementCount === 1 ? "chat.canvasSummaryElement" : "chat.canvasSummaryElements";
    segments.push(t(elementsKey, { count: parts.elementCount }));
  }
  if (parts.truncated) segments.push(t("chat.canvasSummaryTruncated"));
  if (!segments.length) segments.push(t("chat.canvasSummaryWhole"));
  return segments.join(" · ");
}

export function formatCanvasSelectionSummaryI18n(parts: CanvasSelectionSummaryParts, t: Translate): string {
  const title = parts.canvasTitle.trim() || t("chat.canvasUntitled");
  const detail = formatCanvasSelectionDetailI18n(parts, t);
  const revision = t("chat.canvasRevision", { revision: parts.documentRevision });
  return `${title} · ${detail} · ${revision}`;
}
