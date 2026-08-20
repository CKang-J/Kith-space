import { pendingSelectionSummaryParts, type CanvasSelectionSummaryParts } from "./canvasSelectionCopy";
import { CANVAS_SELECTION_TO_CHAT_EVENT, type CanvasSelectionToChatDetail, type CanvasSelectionToChatTarget, type CanvasMarkedRegionInput } from "../adapters/recombynSelectionToChat";

export interface PendingCanvasChatContext {
  id: string;
  canvasId: string;
  canvasTitle: string;
  selectedIds: string[];
  summaryParts: CanvasSelectionSummaryParts;
  previewDocument: unknown;
  documentRevision?: number;
  surfaceId: string;
  markedRegions?: CanvasMarkedRegionInput[];
}

export type PendingCanvasChatContextInput = Omit<PendingCanvasChatContext, "id" | "surfaceId" | "summaryParts"> & {
  id?: string;
  summaryParts?: CanvasSelectionSummaryParts;
};

type Listener = () => void;

const pendingBySurface = new Map<string, PendingCanvasChatContext[]>();
const listeners = new Set<Listener>();
const surfaceStack: string[] = [];
const canvasSources = new Map<string, {
  canvasTitle: string;
  previewDocument: unknown;
  documentRevision?: number;
}>();
let activeSurfaceId: string | null = null;
let pendingSeq = 0;

function notify(): void {
  for (const listener of listeners) listener();
}

export function canvasChatSurfaceKey(channelId: string): string {
  return channelId;
}

export function pendingCanvasSelectionKey(canvasId: string, selectedIds: readonly string[]): string {
  return `${canvasId}::${[...selectedIds].map((id) => id.trim()).filter(Boolean).sort().join("\0")}`;
}

/** Empty selectedIds means a whole-canvas grant from the Composer + menu, not a circled selection. */
export function isWholeCanvasChatContext(item: { selectedIds: readonly string[] }): boolean {
  return item.selectedIds.length === 0;
}

export function setActiveCanvasChatSurface(surfaceId: string | null): void {
  if (activeSurfaceId === surfaceId) return;
  activeSurfaceId = surfaceId;
  notify();
}

export function pushCanvasChatSurface(surfaceId: string): () => void {
  surfaceStack.push(surfaceId);
  activeSurfaceId = surfaceId;
  notify();
  return () => {
    const index = surfaceStack.lastIndexOf(surfaceId);
    if (index >= 0) surfaceStack.splice(index, 1);
    activeSurfaceId = surfaceStack.at(-1) ?? null;
    notify();
  };
}

export function resetCanvasChatBridgeForTests(): void {
  pendingBySurface.clear();
  surfaceStack.length = 0;
  activeSurfaceId = null;
  pendingSeq = 0;
  canvasSources.clear();
}

export function getActiveCanvasChatSurface(): string | null {
  return activeSurfaceId;
}

export function canvasToolbarChatTargets(
  nodeIds: readonly string[] = [],
  frameIds: readonly string[] = [],
): string | string[] {
  const targets = [
    ...nodeIds.filter((id) => typeof id === "string" && id.trim()),
    ...frameIds
      .filter((id) => typeof id === "string" && id.trim())
      .map((id) => (id.startsWith("frame:") ? id : `frame:${id}`)),
  ];
  return targets.length === 1 ? targets[0]! : targets;
}

export function parseCanvasSelectionTarget(target: CanvasSelectionToChatTarget | unknown): string[] {
  const values = Array.isArray(target) ? target : [target];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function markedRegionKey(region: CanvasMarkedRegionInput): string {
  return `${region.nodeId}:${region.nx.toFixed(3)}:${region.ny.toFixed(3)}:${region.nw.toFixed(3)}:${region.nh.toFixed(3)}`;
}

export function mergeCanvasMarkedRegions(
  existing: readonly CanvasMarkedRegionInput[] | undefined,
  incoming: readonly CanvasMarkedRegionInput[] | undefined,
  limit = 8,
): CanvasMarkedRegionInput[] | undefined {
  const out: CanvasMarkedRegionInput[] = [];
  const seen = new Set<string>();
  for (const region of [...(existing ?? []), ...(incoming ?? [])]) {
    if (!region?.nodeId) continue;
    const key = markedRegionKey(region);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(region);
    if (out.length >= limit) break;
  }
  return out.length ? out : undefined;
}

function listFor(surfaceId: string): PendingCanvasChatContext[] {
  return pendingBySurface.get(surfaceId) ?? [];
}

export function getPendingCanvasChatContexts(surfaceId?: string | null): PendingCanvasChatContext[] {
  const key = surfaceId ?? activeSurfaceId;
  if (!key) return [];
  return [...listFor(key)];
}

/** First pending card on the surface. Prefer `getPendingCanvasChatContexts` for multi-card Composer. */
export function getPendingCanvasChatContext(surfaceId?: string | null): PendingCanvasChatContext | null {
  return getPendingCanvasChatContexts(surfaceId)[0] ?? null;
}

function hydratePending(
  value: PendingCanvasChatContextInput,
  surfaceId: string,
): PendingCanvasChatContext {
  pendingSeq += 1;
  return {
    ...value,
    id: value.id?.trim() || `pending-canvas-${pendingSeq}`,
    surfaceId,
    summaryParts: value.summaryParts ?? pendingSelectionSummaryParts(
      value.canvasTitle,
      value.selectedIds,
      value.documentRevision ?? 0,
    ),
  };
}

export function appendPendingCanvasChatContext(
  value: PendingCanvasChatContextInput,
  surfaceId?: string | null,
): PendingCanvasChatContext | null {
  const key = surfaceId ?? activeSurfaceId;
  if (!key) return null;
  const next = hydratePending(value, key);
  const current = listFor(key);
  const identity = pendingCanvasSelectionKey(next.canvasId, next.selectedIds);
  const existingIndex = current.findIndex((item) => pendingCanvasSelectionKey(item.canvasId, item.selectedIds) === identity);
  if (existingIndex >= 0) {
    const existing = current[existingIndex]!;
    const markedRegions = mergeCanvasMarkedRegions(existing.markedRegions, next.markedRegions);
    if (markedRegions === existing.markedRegions) return existing;
    const merged: PendingCanvasChatContext = { ...existing, markedRegions };
    const copy = [...current];
    copy[existingIndex] = merged;
    pendingBySurface.set(key, copy);
    notify();
    return merged;
  }
  pendingBySurface.set(key, [...current, next]);
  notify();
  return next;
}

export function listOpenCanvasChatSources(): Array<{ canvasId: string; canvasTitle: string }> {
  return [...canvasSources.entries()].map(([canvasId, source]) => ({
    canvasId,
    canvasTitle: source.canvasTitle,
  }));
}

export function grantWholeCanvasChatContext(canvasId: string, surfaceId?: string | null): PendingCanvasChatContext | null {
  const source = canvasSources.get(canvasId);
  if (!source) return null;
  return appendPendingCanvasChatContext({
    canvasId,
    canvasTitle: source.canvasTitle,
    selectedIds: [],
    previewDocument: null,
    documentRevision: source.documentRevision,
  }, surfaceId);
}

export function toggleWholeCanvasChatContext(canvasId: string, surfaceId?: string | null): void {
  const key = surfaceId ?? activeSurfaceId;
  if (!key) return;
  const existing = listFor(key).find((item) => item.canvasId === canvasId && isWholeCanvasChatContext(item));
  if (existing) {
    removePendingCanvasChatContext(existing.id, key);
    return;
  }
  grantWholeCanvasChatContext(canvasId, key);
}

/** Attach or remove whole-canvas chips for every currently open Canvas tab. */
export function toggleOpenCanvasChatContext(surfaceId?: string | null): void {
  const key = surfaceId ?? activeSurfaceId;
  if (!key) return;
  const wholes = listFor(key).filter((item) => isWholeCanvasChatContext(item));
  if (wholes.length) {
    const next = listFor(key).filter((item) => !isWholeCanvasChatContext(item));
    if (next.length) pendingBySurface.set(key, next);
    else pendingBySurface.delete(key);
    notify();
    return;
  }
  if (canvasSources.size === 0) return;
  for (const canvasId of canvasSources.keys()) grantWholeCanvasChatContext(canvasId, key);
}

export function removePendingCanvasChatContext(pendingId: string, surfaceId?: string | null): void {
  const key = surfaceId ?? activeSurfaceId;
  if (!key) return;
  const current = listFor(key);
  const next = current.filter((item) => item.id !== pendingId);
  if (next.length === current.length) return;
  if (next.length) pendingBySurface.set(key, next);
  else pendingBySurface.delete(key);
  notify();
}

export function setPendingCanvasChatContext(
  value: PendingCanvasChatContextInput | null,
  surfaceId?: string | null,
): void {
  const key = surfaceId ?? activeSurfaceId;
  if (!value) {
    if (key) pendingBySurface.delete(key);
    else pendingBySurface.clear();
    notify();
    return;
  }
  if (!key) return;
  pendingBySurface.set(key, [hydratePending(value, key)]);
  notify();
}

export function subscribePendingCanvasChatContext(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function bindCanvasSelectionToChat(input: {
  canvasId: string;
  canvasTitle: string;
  previewDocument: unknown;
  documentRevision?: number;
  /** Read the live editor document only when sending a selection to Chat. */
  getLivePreviewDocument?: () => unknown;
}): () => void {
  rememberCanvasChatSource(input);
  const onSelection = (event: Event) => {
    const detail = (event as CustomEvent<CanvasSelectionToChatDetail>).detail;
    const canvasId = typeof detail?.canvasId === "string" ? detail.canvasId.trim() : "";
    if (!canvasId || canvasId !== input.canvasId) return;
    const source = canvasSources.get(canvasId);
    if (!source) return;
    const livePreview = input.getLivePreviewDocument?.();
    appendPendingCanvasChatContext({
      canvasId,
      canvasTitle: source.canvasTitle,
      selectedIds: parseCanvasSelectionTarget(detail.target),
      previewDocument: livePreview ?? source.previewDocument,
      documentRevision: source.documentRevision,
      markedRegions: Array.isArray(detail.markedRegions) ? detail.markedRegions : undefined,
    });
  };
  window.addEventListener(CANVAS_SELECTION_TO_CHAT_EVENT, onSelection);
  return () => {
    window.removeEventListener(CANVAS_SELECTION_TO_CHAT_EVENT, onSelection);
    canvasSources.delete(input.canvasId);
  };
}

function rememberCanvasChatSource(input: {
  canvasId: string;
  canvasTitle: string;
  previewDocument: unknown;
  documentRevision?: number;
}): void {
  canvasSources.set(input.canvasId, {
    canvasTitle: input.canvasTitle,
    previewDocument: input.previewDocument,
    documentRevision: input.documentRevision,
  });
}
