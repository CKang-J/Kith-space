const FRAME_PREFIX = "frame:";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseSelectionTokens(selectedIds: readonly string[]): { nodeIds: string[]; frameIds: string[] } {
  const nodeIds: string[] = [];
  const frameIds: string[] = [];
  const seenNodes = new Set<string>();
  const seenFrames = new Set<string>();
  for (const raw of selectedIds) {
    if (typeof raw !== "string") continue;
    const token = raw.trim();
    if (!token) continue;
    if (token.startsWith(FRAME_PREFIX)) {
      const frameId = token.slice(FRAME_PREFIX.length).trim();
      if (!frameId || seenFrames.has(frameId)) continue;
      seenFrames.add(frameId);
      frameIds.push(frameId);
      continue;
    }
    if (seenNodes.has(token)) continue;
    seenNodes.add(token);
    nodeIds.push(token);
  }
  return { nodeIds, frameIds };
}

export function parseCanvasSelectionTokens(selectedIds: readonly string[]): { nodeIds: string[]; frameIds: string[] } {
  return parseSelectionTokens(selectedIds);
}

function survivingNodeIds(document: unknown, nodeIds: readonly string[]): string[] {
  if (!document || typeof document !== "object" || Array.isArray(document)) return [];
  const nodes = (document as { deltaSetLike?: Record<string, unknown> }).deltaSetLike;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return [];
  return nodeIds.filter((id) => Object.prototype.hasOwnProperty.call(nodes, id));
}

export function selectionPreviewSceneDocument(
  document: unknown,
  selectedIds: readonly string[] | undefined,
): unknown {
  if (!document) return null;
  if (!selectedIds?.length) return document;
  return extractSelectionPreviewDocument(document, selectedIds) ?? document;
}

function nodeBounds(node: Record<string, unknown>) {
  return {
    x: num(node.x),
    y: num(node.y),
    w: Math.max(1, num(node.width, 1)),
    h: Math.max(1, num(node.height, 1)),
  };
}

function overlapsNodeFrame(node: Record<string, unknown>, frame: Record<string, unknown>): boolean {
  const bounds = nodeBounds(node);
  const frameBounds = nodeBounds(frame);
  const overlapW = Math.max(0, Math.min(bounds.x + bounds.w, frameBounds.x + frameBounds.w) - Math.max(bounds.x, frameBounds.x));
  const overlapH = Math.max(0, Math.min(bounds.y + bounds.h, frameBounds.y + frameBounds.h) - Math.max(bounds.y, frameBounds.y));
  return overlapW * overlapH >= bounds.w * bounds.h * 0.12;
}

export function previewDocumentFromCanvasSelection(input: {
  previewDocument?: unknown;
  projection?: unknown;
}): unknown {
  if (input.previewDocument) return input.previewDocument;
  const projection = input.projection;
  if (!projection || typeof projection !== "object") return null;
  const record = projection as { elements?: Array<Record<string, unknown>>; frames?: Array<Record<string, unknown>> };
  if (!Array.isArray(record.elements) && !Array.isArray(record.frames)) return projection;
  const elements = record.elements ?? [];
  const deltaSetLike: Record<string, unknown> = {
    ROOT: { children: elements.map((element) => element.id).filter((id): id is string => typeof id === "string") },
  };
  for (const element of elements) {
    if (typeof element.id === "string") deltaSetLike[element.id] = element;
  }
  return { deltaSetLike, frames: record.frames ?? [] };
}

export function extractSelectionPreviewDocument(
  document: unknown,
  selectedIds: readonly string[],
): unknown | null {
  if (!document || typeof document !== "object") return null;
  const root = document as Record<string, unknown>;
  const deltaSetLike = asRecord(root.deltaSetLike) ?? {};
  const frames = Array.isArray(root.frames)
    ? root.frames.flatMap((frame) => {
      const record = asRecord(frame);
      return record ? [record] : [];
    })
    : [];
  const frameById = new Map(frames.flatMap((frame) => typeof frame.id === "string" ? [[frame.id, frame] as const] : []));

  const requested = parseSelectionTokens(selectedIds);
  const includeNodeIds = new Set<string>(requested.nodeIds.filter((id) => id !== "ROOT" && deltaSetLike[id]));
  const includeFrameIds = new Set<string>();

  for (const frameId of requested.frameIds) {
    if (frameById.has(frameId)) includeFrameIds.add(frameId);
  }
  for (const nodeId of [...requested.nodeIds]) {
    if (frameById.has(nodeId) && !deltaSetLike[nodeId]) {
      includeFrameIds.add(nodeId);
      includeNodeIds.delete(nodeId);
    }
  }

  if (!includeNodeIds.size && !includeFrameIds.size && !selectedIds.length) {
    return document;
  }

  for (const [nodeId, value] of Object.entries(deltaSetLike)) {
    if (nodeId === "ROOT" || includeNodeIds.has(nodeId)) continue;
    const node = asRecord(value);
    if (!node) continue;
    for (const frameId of includeFrameIds) {
      const frame = frameById.get(frameId);
      if (frame && overlapsNodeFrame(node, frame)) {
        includeNodeIds.add(nodeId);
        break;
      }
    }
  }

  const includedFrames = [...includeFrameIds]
    .flatMap((frameId) => {
      const frame = frameById.get(frameId);
      return frame ? [frame] : [];
    });

  if (!includeNodeIds.size && !includedFrames.length) return null;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const absorb = (x: number, y: number, w: number, h: number) => {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + w);
    bottom = Math.max(bottom, y + h);
  };

  for (const nodeId of includeNodeIds) {
    const node = asRecord(deltaSetLike[nodeId]);
    if (!node) continue;
    const bounds = nodeBounds(node);
    absorb(bounds.x, bounds.y, bounds.w, bounds.h);
  }
  for (const frame of includedFrames) {
    const bounds = nodeBounds(frame);
    absorb(bounds.x, bounds.y, bounds.w, bounds.h);
  }
  if (!Number.isFinite(left)) return null;

  const pad = Math.max(12, Math.round(Math.max(right - left, bottom - top) * 0.08));
  const boardW = Math.max(32, Math.round(right - left + pad * 2));
  const boardH = Math.max(32, Math.round(bottom - top + pad * 2));
  const shiftX = left - pad;
  const shiftY = top - pad;

  const nextDelta: Record<string, unknown> = {
    ROOT: { id: "ROOT", key: "entry", children: [...includeNodeIds] },
  };
  for (const nodeId of includeNodeIds) {
    const node = asRecord(deltaSetLike[nodeId]);
    if (!node) continue;
    nextDelta[nodeId] = {
      ...node,
      id: nodeId,
      x: num(node.x) - shiftX,
      y: num(node.y) - shiftY,
    };
  }

  const nextFrames = includedFrames.length
    ? includedFrames.map((frame) => ({
      ...frame,
      x: num(frame.x) - shiftX,
      y: num(frame.y) - shiftY,
    }))
    : [{
      id: "selection-cover",
      x: 0,
      y: 0,
      width: boardW,
      height: boardH,
      backgroundColor: "#ffffff",
    }];

  return {
    width: boardW,
    height: boardH,
    backgroundColor: "#ffffff",
    backgroundFillType: "solid",
    frames: nextFrames,
    deltaSetLike: nextDelta,
  };
}

export async function renderCanvasSelectionThumbnail(
  document: unknown,
  selectedIds: readonly string[] | undefined,
  maxEdge = 128,
): Promise<string | null> {
  if (!document || typeof document !== "object") return null;

  const { renderComposerChipThumb } = await import("@recombyn-native/components/rcb/scene/paint/exportImage");
  const maxSide = Math.max(32, Math.min(160, maxEdge));

  if (!selectedIds?.length) {
    const { renderDocumentThumbnail } = await import("@recombyn-native/utils/renderProjectThumbnail");
    return renderDocumentThumbnail(document, { allowEmpty: true, maxEdge: maxSide, format: "png" });
  }

  const { nodeIds, frameIds } = parseSelectionTokens(selectedIds);
  const surviving = survivingNodeIds(document, nodeIds);

  if (frameIds.length === 1 && !surviving.length) {
    return renderComposerChipThumb({
      document: document as never,
      frameId: frameIds[0],
      maxSide,
    });
  }

  if (surviving.length) {
    return renderComposerChipThumb({
      document: document as never,
      nodeIds: surviving,
      maxSide,
    });
  }

  if (frameIds.length === 1) {
    return renderComposerChipThumb({
      document: document as never,
      frameId: frameIds[0],
      maxSide,
    });
  }

  const slice = extractSelectionPreviewDocument(document, selectedIds);
  if (!slice) return null;
  const { renderDocumentThumbnail } = await import("@recombyn-native/utils/renderProjectThumbnail");
  return renderDocumentThumbnail(slice, { allowEmpty: true, maxEdge: maxSide, format: "png" });
}
