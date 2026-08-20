import type { CanvasLibraryItem } from "./canvasCoreApi";

export type CanvasRecoveryResult = {
  deleted: false;
  snapshot: CanvasLibraryItem;
  changes: unknown[];
} | {
  deleted: true;
  canvasId: string;
  spaceId: string;
  sequence: number;
};

export function isDeletedCanvasRecovery(
  value: unknown,
  expected: { canvasId: string; spaceId: string },
): value is Extract<CanvasRecoveryResult, { deleted: true }> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.deleted === true
    && candidate.canvasId === expected.canvasId
    && candidate.spaceId === expected.spaceId
    && Number.isSafeInteger(candidate.sequence);
}
