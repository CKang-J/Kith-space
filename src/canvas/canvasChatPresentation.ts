import type { FrozenCanvasSelectionSnapshot } from "./canvasTypes.js";
import { canvasSelectionSummaryParts, type CanvasSelectionSummaryParts } from "./canvasSelectionSummary.js";

export interface CanvasMessageContext {
  snapshotId: string;
  canvasId: string;
  canvasTitle: string;
  documentRevision: number;
  structureRevision: number | null;
  selectedElements: Array<{ id: string; revision: number }>;
  selectedFrames: Array<{ id: string; revision: number }>;
  selectedIds: string[];
  summary: string;
  summaryParts: CanvasSelectionSummaryParts;
  projection: FrozenCanvasSelectionSnapshot["projection"];
  canvasAvailable: boolean;
  deepLink: FrozenCanvasSelectionSnapshot["deepLink"];
}

export function presentCanvasContexts(
  snapshots: FrozenCanvasSelectionSnapshot[] | null | undefined,
): CanvasMessageContext[] {
  return (snapshots ?? []).flatMap((snapshot) => {
    const presented = presentCanvasContext(snapshot);
    return presented ? [presented] : [];
  });
}

export function presentCanvasContext(
  snapshot: FrozenCanvasSelectionSnapshot | null | undefined,
): CanvasMessageContext | null {
  if (!snapshot) return null;
  const summaryParts = canvasSelectionSummaryParts({
    canvasTitle: snapshot.canvasTitle,
    wholeCanvas: snapshot.projection.wholeCanvas,
    elementCount: snapshot.selectedElements.length,
    frameCount: snapshot.selectedFrames.length,
    truncated: snapshot.projection.truncated,
    documentRevision: snapshot.documentRevision,
  });
  return {
    snapshotId: snapshot.snapshotId,
    canvasId: snapshot.canvasId,
    canvasTitle: snapshot.canvasTitle,
    documentRevision: snapshot.documentRevision,
    structureRevision: snapshot.structureRevision,
    selectedElements: snapshot.selectedElements,
    selectedFrames: snapshot.selectedFrames,
    selectedIds: [
      ...snapshot.selectedElements.map((item) => item.id),
      ...snapshot.selectedFrames.map((item) => `frame:${item.id}`),
    ],
    summary: snapshot.summary,
    summaryParts,
    projection: snapshot.projection,
    canvasAvailable: !snapshot.canvasDeleted,
    deepLink: snapshot.deepLink,
  };
}
