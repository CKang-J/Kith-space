export interface CanvasSelectionSummaryParts {
  canvasTitle: string;
  wholeCanvas: boolean;
  elementCount: number;
  frameCount: number;
  truncated: boolean;
  documentRevision: number;
}

export interface CanvasSelectionCopy {
  unnamedCanvas: string;
  wholeCanvas: string;
  frames: (count: number) => string;
  elements: (count: number) => string;
  truncated: string;
  revision: (revision: number) => string;
}

/** Locale-neutral English copy used for persisted snapshot summary and Agent/turn fallback. */
export const ENGLISH_CANVAS_SELECTION_COPY: CanvasSelectionCopy = {
  unnamedCanvas: "Untitled Canvas",
  wholeCanvas: "entire canvas",
  frames: (count) => `${count} Frame${count === 1 ? "" : "s"}`,
  elements: (count) => `${count} element${count === 1 ? "" : "s"}`,
  truncated: "truncated",
  revision: (revision) => `rev ${revision}`,
};

export function canvasSelectionSummaryParts(input: {
  canvasTitle: string;
  wholeCanvas: boolean;
  elementCount: number;
  frameCount: number;
  truncated?: boolean;
  documentRevision?: number;
}): CanvasSelectionSummaryParts {
  return {
    canvasTitle: input.canvasTitle.trim() || ENGLISH_CANVAS_SELECTION_COPY.unnamedCanvas,
    wholeCanvas: input.wholeCanvas,
    elementCount: input.elementCount,
    frameCount: input.frameCount,
    truncated: Boolean(input.truncated),
    documentRevision: input.documentRevision ?? 0,
  };
}

export function formatCanvasSelectionSummary(
  parts: CanvasSelectionSummaryParts,
  copy: CanvasSelectionCopy = ENGLISH_CANVAS_SELECTION_COPY,
): string {
  const title = parts.canvasTitle.trim() || copy.unnamedCanvas;
  const revision = copy.revision(parts.documentRevision);
  if (parts.wholeCanvas) {
    return `${title} · ${copy.wholeCanvas} · ${copy.elements(parts.elementCount)} · ${revision}`;
  }
  const segments = [title];
  if (parts.frameCount) segments.push(copy.frames(parts.frameCount));
  if (parts.elementCount) segments.push(copy.elements(parts.elementCount));
  if (parts.truncated) segments.push(copy.truncated);
  if (!parts.frameCount && !parts.elementCount) segments.push(copy.wholeCanvas);
  segments.push(revision);
  return segments.join(" · ");
}

export function pendingSelectionSummaryParts(
  canvasTitle: string,
  selectedIds: string[],
  documentRevision = 0,
): CanvasSelectionSummaryParts {
  const frameCount = selectedIds.filter((id) => id.startsWith("frame:")).length;
  const elementCount = selectedIds.length - frameCount;
  return canvasSelectionSummaryParts({
    canvasTitle,
    wholeCanvas: selectedIds.length === 0,
    elementCount,
    frameCount,
    documentRevision,
  });
}
