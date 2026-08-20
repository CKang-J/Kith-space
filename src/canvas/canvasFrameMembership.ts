const OVERLAP_RATIO = 0.12;

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export type CanvasFrameLike = {
  id?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
};

export type CanvasNodeLike = {
  frameId?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
};

export function canvasFrameOrigin(frame: CanvasFrameLike | null | undefined): { x: number; y: number } {
  if (!frame) return { x: 0, y: 0 };
  return { x: finite(frame.x), y: finite(frame.y) };
}

export function canvasFrameLocalToCanvas(
  frame: CanvasFrameLike | null | undefined,
  x: number,
  y: number,
): { x: number; y: number } {
  const origin = canvasFrameOrigin(frame);
  return { x: x + origin.x, y: y + origin.y };
}

export function canvasNodeFrameId(node: CanvasNodeLike | null | undefined): string | null {
  return typeof node?.frameId === "string" && node.frameId.trim() ? node.frameId : null;
}

export function canvasNodeOverlapsFrame(node: CanvasNodeLike, frame: CanvasFrameLike): boolean {
  const nx = finite(node.x);
  const ny = finite(node.y);
  const nw = Math.max(1, finite(node.width, 1));
  const nh = Math.max(1, finite(node.height, 1));
  const fx = finite(frame.x);
  const fy = finite(frame.y);
  const fw = Math.max(1, finite(frame.width, 1));
  const fh = Math.max(1, finite(frame.height, 1));
  const overlapW = Math.max(0, Math.min(nx + nw, fx + fw) - Math.max(nx, fx));
  const overlapH = Math.max(0, Math.min(ny + nh, fy + fh) - Math.max(ny, fy));
  return overlapW * overlapH >= nw * nh * OVERLAP_RATIO;
}

export function canvasNodeBelongsToFrame(node: CanvasNodeLike, frame: CanvasFrameLike, frameId: string): boolean {
  const bound = canvasNodeFrameId(node);
  if (bound) return bound === frameId;
  return canvasNodeOverlapsFrame(node, frame);
}

export function findCanvasFrame<T extends CanvasFrameLike>(frames: readonly T[], frameId: string | null | undefined): T | null {
  if (!frameId) return null;
  return frames.find((frame) => typeof frame.id === "string" && frame.id === frameId) ?? null;
}
