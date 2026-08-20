export interface CanvasSelectionFocusRequest {
  canvasId: string;
  nodeIds: string[];
  frameIds: string[];
}

let pendingFocus: CanvasSelectionFocusRequest | null = null;
const listeners = new Set<() => void>();

export function requestCanvasSelectionFocus(request: CanvasSelectionFocusRequest): void {
  pendingFocus = {
    canvasId: request.canvasId,
    nodeIds: [...new Set(request.nodeIds.filter(Boolean))],
    frameIds: [...new Set(request.frameIds.filter(Boolean))],
  };
  for (const listener of listeners) listener();
}

export function consumeCanvasSelectionFocus(canvasId: string): CanvasSelectionFocusRequest | null {
  if (!pendingFocus || pendingFocus.canvasId !== canvasId) return null;
  const next = pendingFocus;
  pendingFocus = null;
  return next;
}

export function peekCanvasSelectionFocus(): CanvasSelectionFocusRequest | null {
  return pendingFocus;
}

export function resetCanvasSelectionFocusForTests(): void {
  pendingFocus = null;
}

export function subscribeCanvasSelectionFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function applyCanvasSelectionFocus(
  canvasId: string,
  apply: (request: CanvasSelectionFocusRequest) => void,
): () => void {
  const run = () => {
    const request = peekCanvasSelectionFocus();
    if (!request || request.canvasId !== canvasId) return;
    apply(request);
    consumeCanvasSelectionFocus(canvasId);
  };
  run();
  const unsubscribe = subscribeCanvasSelectionFocus(run);
  const frame = requestAnimationFrame(run);
  return () => {
    unsubscribe();
    cancelAnimationFrame(frame);
  };
}
