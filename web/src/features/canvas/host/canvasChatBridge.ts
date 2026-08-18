import { pendingSelectionSummaryParts, type CanvasSelectionSummaryParts } from "./canvasSelectionCopy";
import { CANVAS_SELECTION_TO_CHAT_EVENT, type CanvasSelectionToChatTarget } from "../adapters/recombynSelectionToChat";

export interface PendingCanvasChatContext {
  canvasId: string;
  canvasTitle: string;
  selectedIds: string[];
  summaryParts: CanvasSelectionSummaryParts;
  previewDocument: unknown;
  documentRevision?: number;
  surfaceId: string;
}

type Listener = () => void;

const pendingBySurface = new Map<string, PendingCanvasChatContext>();
const listeners = new Set<Listener>();
const surfaceStack: string[] = [];
let activeSurfaceId: string | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

export function canvasChatSurfaceKey(channelId: string): string {
  return channelId;
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
}

export function getActiveCanvasChatSurface(): string | null {
  return activeSurfaceId;
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

export function getPendingCanvasChatContext(surfaceId?: string | null): PendingCanvasChatContext | null {
  const key = surfaceId ?? activeSurfaceId;
  if (!key) return null;
  return pendingBySurface.get(key) ?? null;
}

export function setPendingCanvasChatContext(
  value: Omit<PendingCanvasChatContext, "surfaceId" | "summaryParts"> & { summaryParts?: CanvasSelectionSummaryParts } | null,
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
  pendingBySurface.set(key, {
    ...value,
    surfaceId: key,
    summaryParts: value.summaryParts ?? pendingSelectionSummaryParts(
      value.canvasTitle,
      value.selectedIds,
      value.documentRevision ?? 0,
    ),
  });
  notify();
}

export function clearPendingCanvasChatContextForCanvas(canvasId: string): void {
  let changed = false;
  for (const [key, value] of pendingBySurface) {
    if (value.canvasId === canvasId) {
      pendingBySurface.delete(key);
      changed = true;
    }
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
    setPendingCanvasChatContext({
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
