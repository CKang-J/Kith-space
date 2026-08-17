import { CANVAS_SELECTION_TO_CHAT_EVENT, type CanvasSelectionToChatTarget } from "@/features/canvas/adapters/recombynSelectionToChat";

export interface PendingCanvasChatContext {
  canvasId: string;
  canvasTitle: string;
  selectedIds: string[];
  summary: string;
  previewDocument: unknown;
}

type Listener = () => void;

let pending: PendingCanvasChatContext | null = null;
const listeners = new Set<Listener>();

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

export function pendingCanvasSummary(canvasTitle: string, selectedIds: string[]): string {
  if (!selectedIds.length) return `${canvasTitle} · 整张画布`;
  const frames = selectedIds.filter((id) => id.startsWith("frame:")).length;
  const elements = selectedIds.length - frames;
  const parts = [canvasTitle];
  if (frames) parts.push(`${frames} 个 Frame`);
  if (elements) parts.push(`${elements} 个元素`);
  return parts.join(" · ");
}

export function getPendingCanvasChatContext(): PendingCanvasChatContext | null {
  return pending;
}

export function setPendingCanvasChatContext(value: PendingCanvasChatContext | null): void {
  pending = value;
  for (const listener of listeners) listener();
}

export function subscribePendingCanvasChatContext(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function bindCanvasSelectionToChat(input: {
  canvasId: string;
  canvasTitle: string;
  previewDocument: unknown;
}): () => void {
  const onSelection = (event: Event) => {
    const target = (event as CustomEvent<{ target?: CanvasSelectionToChatTarget }>).detail?.target;
    const selectedIds = parseCanvasSelectionTarget(target);
    setPendingCanvasChatContext({
      canvasId: input.canvasId,
      canvasTitle: input.canvasTitle,
      selectedIds,
      summary: pendingCanvasSummary(input.canvasTitle, selectedIds),
      previewDocument: input.previewDocument,
    });
  };
  window.addEventListener(CANVAS_SELECTION_TO_CHAT_EVENT, onSelection);
  return () => window.removeEventListener(CANVAS_SELECTION_TO_CHAT_EVENT, onSelection);
}
