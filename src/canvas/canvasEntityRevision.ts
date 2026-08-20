import type { CanvasJson } from "./canvasTypes.js";

export const KITH_ENTITY_REVISION_KEY = "_kithRevision";

function asRecord(value: unknown): Record<string, CanvasJson> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, CanvasJson>
    : null;
}

export function readEntityRevision(entity: unknown, fallback = 0): number {
  const record = asRecord(entity);
  if (!record) return fallback;
  const value = record[KITH_ENTITY_REVISION_KEY];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function stampEntityRevision(entity: Record<string, CanvasJson>, revision: number): void {
  entity[KITH_ENTITY_REVISION_KEY] = revision;
}

export function stampCanvasEntityRevisions(
  document: CanvasJson,
  elementIds: Iterable<string> | "all",
  frameIds: Iterable<string> | "all",
  elementRevision: number,
  frameRevision: number,
): void {
  const root = asRecord(document);
  if (!root) return;
  const nodes = asRecord(root.deltaSetLike);
  if (nodes) {
    const ids = elementIds === "all"
      ? Object.keys(nodes).filter((id) => id !== "ROOT")
      : [...new Set(elementIds)];
    for (const id of ids) {
      const node = asRecord(nodes[id]);
      if (node) stampEntityRevision(node, elementRevision);
    }
  }
  if (!Array.isArray(root.frames)) return;
  const wanted = frameIds === "all" ? null : new Set(frameIds);
  for (const frame of root.frames) {
    const record = asRecord(frame);
    if (!record || typeof record.id !== "string") continue;
    if (wanted && !wanted.has(record.id)) continue;
    stampEntityRevision(record, frameRevision);
  }
}
