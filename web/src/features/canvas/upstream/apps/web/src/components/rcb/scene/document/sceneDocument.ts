/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/document/sceneDocument.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { produce, type WritableDraft } from 'immer';
import { nanoid } from '@reduxjs/toolkit';
import type { ArtboardFrame } from '@recombyn-native/components/rcb/frames/types';
import type {
  SceneDeltaSet,
  SceneDocument,
  SceneNode,
  SceneNodeAttrs,
  SceneNodeInput,
  ScenePage,
} from '@recombyn-native/components/rcb/sceneNode';

/** Default canvas size (approx A4 @ 96dpi); user can change freely */
export const DEFAULT_CANVAS = { width: 794, height: 1123 };

export const A4_PORTRAIT = { ...DEFAULT_CANVAS };

/** Partial node update: attrs shallow-merge onto the previous bag. */
export type SceneNodePatch = Partial<Omit<SceneNode, 'attrs'>> & {
  attrs?: SceneNodeAttrs | null;
};

/** Canvas chrome / size fields written by `setDocumentCanvasMeta`. */
export type DocumentCanvasMetaPatch = {
  backgroundColor?: string;
  backgroundFillType?: string;
  backgroundGradient?: unknown;
  backgroundOpacity?: number;
  backgroundImageSrc?: string;
  backgroundImageFit?: string;
  backgroundImageRotate?: number;
  backgroundImageAdjust?: unknown;
  width?: number;
  height?: number;
  gridSize?: number;
};

function createPage(id?: string): ScenePage {
  return {
    id: id || nanoid(8),
    children: [],
  };
}

/** Isolate a node/frame/doc slice without JSON.parse(JSON.stringify). */
export function cloneSceneValue<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return { ...(value as object) } as T;
}

/** Unified paint / layer order: `frame:id` | `node:id` (bottom → top). */
export function stackFrameKey(id: string) {
  return `frame:${id}`;
}

export function stackNodeKey(id: string) {
  return `node:${id}`;
}

export function parseStackKey(
  key: string
): { kind: 'frame' | 'node'; id: string } | null {
  if (typeof key !== 'string') return null;
  if (key.startsWith('frame:')) return { kind: 'frame', id: key.slice(6) };
  if (key.startsWith('node:')) return { kind: 'node', id: key.slice(5) };
  return null;
}

function listRootNodeIds(doc: SceneDocument): string[] {
  const page = Array.isArray(doc?.pages) ? doc.pages[0] : null;
  const fromPage = page?.children;
  if (Array.isArray(fromPage)) return fromPage.filter(Boolean).map(String);
  const fromRoot = doc?.deltaSetLike?.ROOT?.children;
  return Array.isArray(fromRoot) ? fromRoot.filter(Boolean).map(String) : [];
}

/**
 * Keep `doc.stackOrder` in sync with frames + root nodes.
 * Empty → migrate legacy paint (frames under nodes).
 * Missing frames insert under content; missing nodes append on top.
 */
export function reconcileStackOrder(doc: SceneDocument): string[] {
  if (!doc || typeof doc !== 'object') return [];
  const frameIds = (Array.isArray(doc.frames) ? doc.frames : [])
    .map((f) => (f?.id != null ? String(f.id) : ''))
    .filter(Boolean);
  const nodeIds = listRootNodeIds(doc);
  const frameSet = new Set(frameIds);
  const nodeSet = new Set(nodeIds);
  const raw = Array.isArray(doc.stackOrder) ? doc.stackOrder.map(String) : [];

  if (!raw.length) {
    const migrated = [
      ...frameIds.map(stackFrameKey),
      ...nodeIds.map(stackNodeKey),
    ];
    doc.stackOrder = migrated;
    return migrated;
  }

  const seen = new Set<string>();
  let kept: string[] = [];
  for (const key of raw) {
    const parsed = parseStackKey(key);
    if (!parsed) continue;
    if (parsed.kind === 'frame' && !frameSet.has(parsed.id)) continue;
    if (parsed.kind === 'node' && !nodeSet.has(parsed.id)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(key);
  }
  // Missing frames belong under content (after last kept frame, else at front).
  // Appending them on top paints the white plate over existing nodes.
  let frameInsertAt = 0;
  for (let i = 0; i < kept.length; i += 1) {
    if (parseStackKey(kept[i])?.kind === 'frame') frameInsertAt = i + 1;
  }
  const missingFrames: string[] = [];
  for (const id of frameIds) {
    const key = stackFrameKey(id);
    if (seen.has(key)) continue;
    missingFrames.push(key);
    seen.add(key);
  }
  if (missingFrames.length) {
    kept = [
      ...kept.slice(0, frameInsertAt),
      ...missingFrames,
      ...kept.slice(frameInsertAt),
    ];
  }
  for (const id of nodeIds) {
    const key = stackNodeKey(id);
    if (seen.has(key)) continue;
    kept.push(key);
    seen.add(key);
  }
  doc.stackOrder = kept;
  return kept;
}

/** 1-based CSS z-index from unified stack (0 if missing). */
export function stackZIndex(doc: SceneDocument, kind: 'frame' | 'node', id: string): number {
  const order = Array.isArray(doc?.stackOrder) ? doc.stackOrder : [];
  const key = kind === 'frame' ? stackFrameKey(id) : stackNodeKey(id);
  const i = order.indexOf(key);
  return i >= 0 ? i + 1 : 0;
}

function reorderKeysInList(
  ids: string[],
  selected: string[],
  action: 'front' | 'back' | 'forward' | 'backward'
): string[] {
  if (!selected.length) return ids;
  const rest = ids.filter((id) => !selected.includes(id));
  if (action === 'front') return [...rest, ...selected];
  if (action === 'back') return [...selected, ...rest];
  if (action === 'forward') {
    const working = [...ids];
    for (let i = working.length - 2; i >= 0; i -= 1) {
      if (selected.includes(working[i]) && !selected.includes(working[i + 1])) {
        const tmp = working[i];
        working[i] = working[i + 1];
        working[i + 1] = tmp;
      }
    }
    return working;
  }
  const working = [...ids];
  for (let i = 1; i < working.length; i += 1) {
    if (selected.includes(working[i]) && !selected.includes(working[i - 1])) {
      const tmp = working[i];
      working[i] = working[i - 1];
      working[i - 1] = tmp;
    }
  }
  return working;
}

function emptyDeltaSet(): SceneDeltaSet {
  return {
    ROOT: {
      id: 'ROOT',
      key: 'entry',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      attrs: {},
      children: [],
    },
  };
}

/** Bare infinite world (no artboard frames). */
export function createBareDocument(): SceneDocument {
  const page = createPage();
  return {
    x: 0,
    y: 0,
    width: DEFAULT_CANVAS.width,
    height: DEFAULT_CANVAS.height,
    // Empty → editor follows theme `--canvas` (light/dark).
    backgroundColor: '',
    frames: [],
    activeFrameId: null,
    pages: [page],
    activePageId: page.id,
    deltaSetLike: emptyDeltaSet(),
  };
}

export function createEmptyDocument(size?: {
  width?: number;
  height?: number;
  emptyWorld?: boolean;
}): SceneDocument {
  if (size?.emptyWorld) return createBareDocument();

  const width = Math.max(100, Math.round(size?.width || DEFAULT_CANVAS.width));
  const height = Math.max(100, Math.round(size?.height || DEFAULT_CANVAS.height));
  const page = createPage();
  return {
    x: 0,
    y: 0,
    width,
    height,
    backgroundColor: '',
    frames: [],
    activeFrameId: null,
    pages: [page],
    activePageId: page.id,
    deltaSetLike: emptyDeltaSet(),
  };
}

/** Merge a partial node patch (attrs shallow-merge; preserve shapeType). */
export function mergeNodePatch(prev: SceneNode, patch: SceneNodePatch | null | undefined): SceneNode;
export function mergeNodePatch(
  prev: SceneNode | null | undefined,
  patch: SceneNodePatch | null | undefined
): SceneNode | null | undefined;
export function mergeNodePatch(
  prev: SceneNode | null | undefined,
  patch: SceneNodePatch | null | undefined
): SceneNode | null | undefined {
  if (!prev) return prev;
  const { attrs, ...rest } = patch || {};
  const prevAttrs = prev.attrs || {};
  let nextAttrs: SceneNodeAttrs = prevAttrs;
  if (attrs) {
    nextAttrs = { ...prevAttrs, ...attrs };
    if (
      prevAttrs.shapeType != null &&
      (nextAttrs.shapeType == null || nextAttrs.shapeType === '')
    ) {
      nextAttrs.shapeType = prevAttrs.shapeType;
    }
  }
  return { ...prev, ...rest, attrs: nextAttrs };
}

/**
 * Patch deltaSetLike keys with Immer structural sharing (plain objects only).
 * Never use a custom Proxy — Redux/Immer Object.keys traps reject it.
 *
 * Always return an extensible shallow shell: Immer autoFreeze seals `produce`
 * results in DEV, but normalize/add/remove still assign or delete top-level keys.
 */
export function patchDeltaSetLike(
  delta: SceneDeltaSet | null | undefined,
  patches: Record<string, SceneNode>
): SceneDeltaSet {
  const keys = patches ? Object.keys(patches) : [];
  if (!keys.length) {
    if (!delta || typeof delta !== 'object') return {};
    return Object.isExtensible(delta) ? delta : flattenDeltaSetLike(delta);
  }
  const base: SceneDeltaSet = delta && typeof delta === 'object' ? delta : {};
  const produced = produce(base, (draft: WritableDraft<SceneDeltaSet>) => {
    for (const key of keys) {
      draft[key] = patches[key];
    }
  });
  return flattenDeltaSetLike(produced);
}

/** Shallow copy for normalize/save (delta is always a plain object now). */
export function flattenDeltaSetLike(delta: SceneDeltaSet | null | undefined): SceneDeltaSet {
  if (!delta || typeof delta !== 'object') return {};
  return { ...delta };
}

/** Ensure older saved docs still work; keep a single logical page for editing */
export function normalizeDocument(doc: unknown): SceneDocument {
  if (!doc || typeof doc !== 'object') return createEmptyDocument({ emptyWorld: true });
  const src = doc as SceneDocument;
  // Shallow COW shell — share node objects; never JSON deep-clone the whole map.
  const next: SceneDocument = {
    ...src,
    deltaSetLike: flattenDeltaSetLike(src.deltaSetLike),
    frames: Array.isArray(src.frames) ? src.frames.slice() : [],
    pages: Array.isArray(src.pages)
      ? src.pages.map((p) =>
          p && typeof p === 'object'
            ? {
                ...p,
                children: Array.isArray(p.children) ? [...p.children] : p.children,
              }
            : p
        )
      : src.pages,
    stackOrder: Array.isArray(src.stackOrder) ? [...src.stackOrder] : src.stackOrder,
  };
  next.width = Math.max(100, Math.round(Number(next.width) || DEFAULT_CANVAS.width));
  next.height = Math.max(100, Math.round(Number(next.height) || DEFAULT_CANVAS.height));
  // Keep empty / legacy light defaults; EditorPage maps them to theme `--canvas`.
  if (next.backgroundColor == null) next.backgroundColor = '';
  delete next.orientation;
  if (!Array.isArray(next.frames)) next.frames = [];
  next.frames = next.frames.map((f) => {
    if (!f || typeof f !== 'object') return f;
    const bg = String(f.backgroundColor || '').trim();
    const withBg: ArtboardFrame =
      !bg || bg === 'none' ? { ...f, backgroundColor: '#FFFFFF' } : { ...f };
    // Default: show overflow for legacy frames that never set the flag.
    if (withBg.clipContent === undefined) withBg.clipContent = false;
    return withBg;
  });
  // Keep activeFrameId nullable — null means no frame selected (do not force frames[0]).
  if (next.activeFrameId != null) {
    const exists = next.frames.some((f) => f?.id === next.activeFrameId);
    if (!exists) next.activeFrameId = null;
  }

  // Collapse multi-page docs into one canvas
  if (!Array.isArray(next.pages) || !next.pages.length) {
    const page = createPage();
    page.children = [...(next.deltaSetLike?.ROOT?.children || [])];
    next.pages = [page];
  } else if (next.pages.length > 1) {
    const merged = next.pages.flatMap((p) => p.children || []);
    const page = createPage(next.pages[0].id);
    page.children = [...new Set(merged)];
    next.pages = [page];
  }
  next.activePageId = next.pages[0].id;
  syncRootChildren(next);
  reconcileStackOrder(next);
  return next;
}

/** Shift imported JSON so content sits in canvas-local coords (document origin cleared). */
export function alignImportedDocumentOrigin(doc: unknown) {
  const next = normalizeDocument(doc);
  const page = getActivePage(next);
  const ids = page?.children || [];
  const docOx = Number(next.x) || 0;
  const docOy = Number(next.y) || 0;

  /**
   * Always bake `document.x/y` into node/frame coords then clear origin.
   * Editor paint (`canvasDocument`) forces origin 0 — leaving a non-zero store
   * origin makes fitView (store) disagree with hosts (zeroed), then a later
   * align remounts every shape and the page jumps after boot.
   *
   * With artboards: only bake the document origin (do NOT also subtract minX/minY —
   * that would collapse case margins). Without frames: also pull content to (0,0).
   */
  const hasFrames = Array.isArray(next.frames) && next.frames.length > 0;
  let shiftX = docOx;
  let shiftY = docOy;
  if (!hasFrames) {
    let minX = Infinity;
    let minY = Infinity;
    for (const id of ids) {
      const node = next.deltaSetLike?.[id];
      if (!node) continue;
      const x = Number(node.x) || 0;
      const y = Number(node.y) || 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
    }
    if (Number.isFinite(minX)) {
      shiftX = docOx + minX;
      shiftY = docOy + minY;
    }
  }

  if (shiftX !== 0 || shiftY !== 0) {
    for (const id of ids) {
      const node = next.deltaSetLike?.[id];
      if (!node) continue;
      node.x = (Number(node.x) || 0) - shiftX;
      node.y = (Number(node.y) || 0) - shiftY;
    }
    if (hasFrames) {
      for (const f of next.frames) {
        if (!f) continue;
        f.x = (Number(f.x) || 0) - shiftX;
        f.y = (Number(f.y) || 0) - shiftY;
      }
    }
  }
  next.x = 0;
  next.y = 0;
  return next;
}

/**
 * Ensure content is paintable at document origin 0.
 * Non-zero `document.x/y` must always be baked away — not only when off-canvas.
 */
export function ensureDocumentContentOnCanvas(doc: SceneDocument) {
  const next = normalizeDocument(doc);
  const ox = Number(next.x) || 0;
  const oy = Number(next.y) || 0;
  if (ox !== 0 || oy !== 0) {
    return alignImportedDocumentOrigin(next);
  }

  const page = getActivePage(next);
  const ids = page?.children || [];
  if (!ids.length) return next;

  const w = next.width || DEFAULT_CANVAS.width;
  const h = next.height || DEFAULT_CANVAS.height;

  let minL = Infinity;
  let minT = Infinity;
  let maxR = -Infinity;
  let maxB = -Infinity;
  for (const id of ids) {
    const node = next.deltaSetLike?.[id];
    if (!node) continue;
    const left = Number(node.x) || 0;
    const top = Number(node.y) || 0;
    const right = left + Math.max(Number(node.width) || 0, 1);
    const bottom = top + Math.max(Number(node.height) || 0, 1);
    minL = Math.min(minL, left);
    minT = Math.min(minT, top);
    maxR = Math.max(maxR, right);
    maxB = Math.max(maxB, bottom);
  }
  if (!Number.isFinite(minL)) return next;

  const intersects = maxR > 0 && maxB > 0 && minL < w && minT < h;
  if (intersects) return next;
  return alignImportedDocumentOrigin(next);
}

export function syncRootChildren(doc: SceneDocument) {
  const page = doc.pages?.find((p) => p.id === doc.activePageId) || doc.pages?.[0];
  if (!doc.deltaSetLike?.ROOT || !page) return doc;
  const root = doc.deltaSetLike.ROOT;
  doc.deltaSetLike = patchDeltaSetLike(doc.deltaSetLike, {
    ROOT: {
      ...root,
      children: [...(page.children || [])],
    },
  });
  return doc;
}

export function getActivePage(doc: SceneDocument) {
  if (!doc?.pages?.length) return null;
  return doc.pages.find((p) => p.id === doc.activePageId) || doc.pages[0];
}

export function setDocumentSize(doc: SceneDocument, width: number, height: number) {
  const next = normalizeDocument(doc);
  next.width = Math.max(100, Math.round(width) || DEFAULT_CANVAS.width);
  next.height = Math.max(100, Math.round(height) || DEFAULT_CANVAS.height);
  return next;
}

export function setDocumentCanvasMeta(doc: SceneDocument, patch: DocumentCanvasMetaPatch = {}) {
  const next = normalizeDocument(doc);
  if (patch.backgroundColor != null) next.backgroundColor = patch.backgroundColor;
  if (patch.backgroundFillType != null) next.backgroundFillType = patch.backgroundFillType;
  if (patch.backgroundGradient != null) next.backgroundGradient = patch.backgroundGradient;
  if (patch.backgroundOpacity != null) next.backgroundOpacity = patch.backgroundOpacity;
  if (patch.backgroundImageSrc != null) next.backgroundImageSrc = patch.backgroundImageSrc;
  if (patch.backgroundImageFit != null) next.backgroundImageFit = patch.backgroundImageFit;
  if (patch.backgroundImageRotate != null) next.backgroundImageRotate = patch.backgroundImageRotate;
  if (patch.backgroundImageAdjust != null) next.backgroundImageAdjust = patch.backgroundImageAdjust;
  if (patch.width != null) next.width = Math.max(100, Math.round(patch.width) || DEFAULT_CANVAS.width);
  if (patch.height != null) next.height = Math.max(100, Math.round(patch.height) || DEFAULT_CANVAS.height);
  if (patch.gridSize != null) {
    const g = Number(patch.gridSize);
    if (Number.isFinite(g) && g > 0) next.gridSize = g;
  }
  return next;
}

export function addNodeToDocument(
  doc: SceneDocument | null | undefined,
  nodeId: string,
  node: SceneNodeInput | Record<string, unknown>
) {
  const next = normalizeDocument(doc);
  next.deltaSetLike[nodeId] = node as SceneNode;
  const page = getActivePage(next);
  if (page && !page.children.includes(nodeId)) {
    page.children.push(nodeId);
  }
  syncRootChildren(next);
  const key = stackNodeKey(nodeId);
  const order = Array.isArray(next.stackOrder) ? next.stackOrder.map(String) : [];
  if (!order.includes(key)) next.stackOrder = [...order, key];
  else reconcileStackOrder(next);
  return next;
}

/** Merge an imported Scene (image job) into the current canvas with remapped ids. */
export function mergeImportedIntoDocument(
  base: SceneDocument | null | undefined,
  incoming: SceneDocument | null | undefined,
  opts?: { offsetX?: number; offsetY?: number }
) {
  if (!base) return alignImportedDocumentOrigin(incoming);
  const src = alignImportedDocumentOrigin(incoming);
  const ox = opts?.offsetX ?? 40;
  const oy = opts?.offsetY ?? 40;
  let next = normalizeDocument(base);
  const children: string[] = src.deltaSetLike?.ROOT?.children || [];
  const idMap = new Map<string, string>();
  children.forEach((oldId) => idMap.set(oldId, nanoid(10)));

  children.forEach((oldId) => {
    const raw = src.deltaSetLike?.[oldId];
    if (!raw) return;
    const node = cloneSceneValue(raw);
    const newId = idMap.get(oldId)!;
    node.id = newId;
    node.x = (Number(node.x) || 0) + ox;
    node.y = (Number(node.y) || 0) + oy;
    next = addNodeToDocument(next, newId, node);
  });

  // Import artboard frames if present (offset too).
  if (Array.isArray(src.frames) && src.frames.length) {
    const frames = Array.isArray(next.frames) ? [...next.frames] : [];
    const order = Array.isArray(next.stackOrder) ? [...next.stackOrder] : [];
    src.frames.forEach((f) => {
      const newId = nanoid(8);
      frames.push({
        ...cloneSceneValue(f),
        id: newId,
        x: (Number(f.x) || 0) + ox,
        y: (Number(f.y) || 0) + oy,
      });
      order.push(stackFrameKey(newId));
    });
    next.frames = frames;
    next.stackOrder = order;
    if (!next.activeFrameId && frames[0]) next.activeFrameId = frames[0].id;
  }

  reconcileStackOrder(next);
  return next;
}

export function removeNodesFromDocument(
  doc: SceneDocument | null | undefined,
  nodeIds: string[]
) {
  const ids = Array.isArray(nodeIds) ? nodeIds.filter(Boolean) : [];
  if (!ids.length) return doc;
  let next = normalizeDocument(doc);
  ids.forEach((nodeId) => {
    delete next.deltaSetLike[nodeId];
    (next.pages || []).forEach((page) => {
      page.children = page.children.filter((id: string) => id !== nodeId);
    });
  });
  syncRootChildren(next);
  reconcileStackOrder(next);
  return next;
}

export function updateNodeInDocument(
  doc: SceneDocument | null | undefined,
  nodeId: string,
  patch: SceneNodePatch
) {
  const prev = doc?.deltaSetLike?.[nodeId];
  if (!prev || !doc) return doc;
  return produce(doc, (draft: WritableDraft<SceneDocument>) => {
    draft.deltaSetLike[nodeId] = mergeNodePatch(draft.deltaSetLike[nodeId], patch);
  });
}

/** Batch node patches in one Immer produce (align / distribute / multi-drag). */
export function updateNodesInDocument(
  doc: SceneDocument | null | undefined,
  patches: Array<{ nodeId: string; patch: SceneNodePatch }>
) {
  if (!doc || !Array.isArray(patches) || !patches.length) return doc;
  return produce(doc, (draft: WritableDraft<SceneDocument>) => {
    for (const item of patches) {
      const nodeId = item?.nodeId ? String(item.nodeId) : '';
      const patch = item?.patch;
      if (!nodeId || !patch || !draft.deltaSetLike?.[nodeId]) continue;
      draft.deltaSetLike[nodeId] = mergeNodePatch(draft.deltaSetLike[nodeId], patch);
    }
  });
}

export function listSceneNodes(doc: SceneDocument | null | undefined) {
  if (!doc) return [];
  // Read-only: never mutate Redux/Immer state here
  const page = getActivePage(doc);
  const ids = page?.children || doc.deltaSetLike?.ROOT?.children || [];
  return ids
    .map((id: string) => ({ id, node: doc.deltaSetLike?.[id] }))
    .filter((item): item is { id: string; node: SceneNode } => Boolean(item.node));
}

/** Reorder selected nodes in z-order (ROOT / page children + unified stack). */
export function reorderNodesInDocument(
  doc: SceneDocument,
  nodeIds: string[],
  action: 'front' | 'back' | 'forward' | 'backward'
) {
  const next = normalizeDocument(doc);
  const page = getActivePage(next);
  if (!page) return next;
  const ids = [...(page.children || [])];
  const selected = nodeIds.filter((id) => ids.includes(id));
  if (!selected.length) return next;

  page.children = reorderKeysInList(ids, selected, action);
  syncRootChildren(next);

  const selectedKeys = selected.map(stackNodeKey);
  const stack = Array.isArray(next.stackOrder) ? next.stackOrder.map(String) : [];
  next.stackOrder = reorderKeysInList(stack, selectedKeys, action);
  reconcileStackOrder(next);
  return next;
}

/** Reorder frames and/or nodes in the unified stack (and sync node page children). */
export function reorderStackInDocument(
  doc: SceneDocument,
  entries: Array<{ kind: 'frame' | 'node'; id: string }>,
  action: 'front' | 'back' | 'forward' | 'backward'
) {
  const next = normalizeDocument(doc);
  const selectedKeys = entries
    .map((e) => (e.kind === 'frame' ? stackFrameKey(e.id) : stackNodeKey(e.id)))
    .filter((key) => (next.stackOrder || []).includes(key));
  if (!selectedKeys.length) return next;
  next.stackOrder = reorderKeysInList(
    (next.stackOrder || []).map(String),
    selectedKeys,
    action
  );

  const page = getActivePage(next);
  if (page) {
    const nodeSelected = entries
      .filter((e) => e.kind === 'node')
      .map((e) => e.id)
      .filter((id) => (page.children || []).includes(id));
    if (nodeSelected.length) {
      page.children = reorderKeysInList([...(page.children || [])], nodeSelected, action);
      syncRootChildren(next);
    }
  }
  reconcileStackOrder(next);
  return next;
}
