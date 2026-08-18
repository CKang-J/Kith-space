import { pendingSelectionSummaryParts, type CanvasSelectionSummaryParts } from "./canvasSelectionCopy";
import { CANVAS_SELECTION_TO_CHAT_EVENT, type CanvasSelectionToChatTarget } from "../adapters/recombynSelectionToChat";

export interface PendingCanvasChatContext {
  id: string;
  canvasId: string;
  canvasTitle: string;
  selectedIds: string[];
  summaryParts: CanvasSelectionSummaryParts;
  previewDocument: unknown;
  documentRevision?: number;
  surfaceId: string;
}

export type PendingCanvasChatContextInput = Omit<PendingCanvasChatContext, "id" | "surfaceId" | "summaryParts"> & {
  id?: string;
  summaryParts?: CanvasSelectionSummaryParts;
};

type Listener = () => void;

const pendingBySurface = new Map<string, PendingCanvasChatContext[]>();
const listeners = new Set<Listener>();
const surfaceStack: string[] = [];
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
  if (current.some((item) => pendingCanvasSelectionKey(item.canvasId, item.selectedIds) === identity)) {
    return current.find((item) => pendingCanvasSelectionKey(item.canvasId, item.selectedIds) === identity) ?? null;
  }
  pendingBySurface.set(key, [...current, next]);
  notify();
  return next;
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

export function clearPendingCanvasChatContextForCanvas(canvasId: string): void {
  let changed = false;
  for (const [key, value] of pendingBySurface) {
    const next = value.filter((item) => item.canvasId !== canvasId);
    if (next.length === value.length) continue;
    changed = true;
    if (next.length) pendingBySurface.set(key, next);
    else pendingBySurface.delete(key);
  }
  if (changed) notify();
}

export function subscribePendingCanvasChatContext(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function noteActiveCanvasFlyLand(surfaceId: string | null): void {
  if (!surfaceId) return;
  void import("@recombyn-native/components/editor/panels/agent/flyToChat").then(({ noteCanvasFlyLand }) => {
    noteCanvasFlyLand(`kith-chat:${surfaceId}`);
  }).catch(() => undefined);
}

export function bindCanvasSelectionToChat(input: {
  canvasId: string;
  canvasTitle: string;
  previewDocument: unknown;
  documentRevision?: number;
}): () => void {
  const onSelection = (event: Event) => {
    const target = (event as CustomEvent<{ target?: CanvasSelectionToChatTarget }>).detail?.target;
    const selectedIds = parseCanvasSelectionTarget(target);
    appendPendingCanvasChatContext({
      canvasId: input.canvasId,
      canvasTitle: input.canvasTitle,
      selectedIds,
      previewDocument: input.previewDocument,
      documentRevision: input.documentRevision,
    });
  };
  window.addEventListener(CANVAS_SELECTION_TO_CHAT_EVENT, onSelection);
  return () => {
    window.removeEventListener(CANVAS_SELECTION_TO_CHAT_EVENT, onSelection);
    clearPendingCanvasChatContextForCanvas(input.canvasId);
  };
}
