/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/utils/plazaCover.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Plaza list / publish covers — active or first artboard (no dedicated「封面」 required).
 */

import {
  isExportableSceneNode
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';

export const PLAZA_COVER_FRAME_NAME = '封面';

/** Canonical Plaza card size (list slot). Aspect is no longer a publish gate. */
export const PLAZA_CARD_WIDTH = 680;
export const PLAZA_CARD_HEIGHT = 385;
export const PLAZA_CARD_ASPECT = PLAZA_CARD_WIDTH / PLAZA_CARD_HEIGHT;

/** Soft tolerance when comparing a stored cover to a list card slot. */
export const PLAZA_COVER_ASPECT_TOLERANCE = 0.12;

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export type PlazaCoverFrame = {
  id?: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor?: string;
};

function asFrame(raw: Record<string, unknown>): PlazaCoverFrame | null {
  const width = Math.max(0, num(raw.width));
  const height = Math.max(0, num(raw.height));
  if (!(width > 0 && height > 0)) return null;
  return {
    id: raw.id != null ? String(raw.id) : undefined,
    name: raw.name != null ? String(raw.name) : undefined,
    x: num(raw.x),
    y: num(raw.y),
    width,
    height,
    backgroundColor: raw.backgroundColor != null ? String(raw.backgroundColor) : undefined,
  };
}

/** All valid artboards on the canvas. */
export function listArtboardFrames(document: unknown): PlazaCoverFrame[] {
  const frames = (document as { frames?: unknown })?.frames;
  if (!Array.isArray(frames)) return [];
  const out: PlazaCoverFrame[] = [];
  for (const frame of frames) {
    if (!frame || typeof frame !== 'object') continue;
    const next = asFrame(frame as Record<string, unknown>);
    if (next) out.push(next);
  }
  return out;
}

/**
 * Frame used for Plaza list cards / publish preview.
 * Prefer activeFrameId, then「封面」, then the first artboard.
 */
export function findPlazaCoverFrame(document: unknown): PlazaCoverFrame | null {
  const frames = listArtboardFrames(document);
  if (!frames.length || !document || typeof document !== 'object') return null;

  const activeId = String((document as { activeFrameId?: unknown }).activeFrameId || '').trim();
  if (activeId) {
    const active = frames.find((f) => f.id === activeId);
    if (active) return active;
  }

  const named = frames.find((f) => String(f.name || '').trim() === PLAZA_COVER_FRAME_NAME);
  if (named) return named;

  return frames[0];
}

export function plazaAspectMatches(
  coverAspect: number,
  targetAspect: number = PLAZA_CARD_ASPECT
): boolean {
  if (!Number.isFinite(coverAspect) || !Number.isFinite(targetAspect) || targetAspect <= 0) {
    return false;
  }
  return Math.abs(coverAspect - targetAspect) / targetAspect <= PLAZA_COVER_ASPECT_TOLERANCE;
}

/** True when cover board aspect roughly matches the visible Plaza card slot. */
export function plazaCoverMatchesItemAspect(
  coverDocument: unknown,
  itemWidth: number,
  itemHeight: number
): boolean {
  const frames = listArtboardFrames(coverDocument);
  const frame = frames[0] || null;
  if (!frame || itemWidth < 8 || itemHeight < 8) return false;
  return plazaAspectMatches(frame.width / frame.height, itemWidth / itemHeight);
}

/** True when the node meaningfully overlaps the artboard (not center-only). */
function overlapsFrame(node: Record<string, unknown>, frame: PlazaCoverFrame): boolean {
  const x = num(node.x);
  const y = num(node.y);
  const w = Math.max(1, num(node.width, 1));
  const h = Math.max(1, num(node.height, 1));
  const ow = Math.max(0, Math.min(x + w, frame.x + frame.width) - Math.max(x, frame.x));
  const oh = Math.max(0, Math.min(y + h, frame.y + frame.height) - Math.max(y, frame.y));
  return ow * oh >= w * h * 0.12;
}

export type ExtractFrameOptions = {
  /**
   * Crop the preview to the content bounding box (padded) so list cards
   * center the design instead of a mostly-empty artboard.
   */
  contentFit?: boolean;
};

function contentBoundsOfNodes(
  nodes: Record<string, unknown>,
  children: string[]
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of children) {
    const node = nodes[id];
    if (!node || typeof node !== 'object') continue;
    if (!isExportableSceneNode(node)) continue;
    const x = num((node as Record<string, unknown>).x);
    const y = num((node as Record<string, unknown>).y);
    const w = Math.max(1, num((node as Record<string, unknown>).width, 1));
    const h = Math.max(1, num((node as Record<string, unknown>).height, 1));
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  if (!Number.isFinite(minX) || !(maxX > minX) || !(maxY > minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Tight crop around content when it meaningfully shrinks empty margins. */
function maybeContentFitCrop(
  nodes: Record<string, unknown>,
  children: string[],
  frame: PlazaCoverFrame
): { outW: number; outH: number } | null {
  if (!children.length) return null;
  const box = contentBoundsOfNodes(nodes, children);
  if (!box) return null;
  const pad = Math.max(12, Math.round(Math.max(box.width, box.height) * 0.08));
  const x0 = Math.max(0, Math.floor(box.x - pad));
  const y0 = Math.max(0, Math.floor(box.y - pad));
  const x1 = Math.min(frame.width, Math.ceil(box.x + box.width + pad));
  const y1 = Math.min(frame.height, Math.ceil(box.y + box.height + pad));
  const cropW = Math.max(1, x1 - x0);
  const cropH = Math.max(1, y1 - y0);
  if (!(cropW * cropH < frame.width * frame.height * 0.85)) return null;
  for (const id of children) {
    const node = nodes[id] as Record<string, unknown>;
    node.x = num(node.x) - x0;
    node.y = num(node.y) - y0;
  }
  return { outW: cropW, outH: cropH };
}

/** Lightweight single-frame doc for one artboard (+ nodes inside). */
export function extractFrameDocument(
  document: unknown,
  frame: PlazaCoverFrame | null,
  opts?: ExtractFrameOptions
): unknown | null {
  if (!frame || !document || typeof document !== 'object') return null;

  const doc = document as Record<string, unknown>;
  const dsl = (doc.deltaSetLike && typeof doc.deltaSetLike === 'object'
    ? doc.deltaSetLike
    : {}) as Record<string, unknown>;

  const children: string[] = [];
  const nodes: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(dsl)) {
    if (key === 'ROOT' || !raw || typeof raw !== 'object') continue;
    const node = raw as Record<string, unknown>;
    // Image-generator plates are editor UI — never bake into cover / publish docs.
    if (!isExportableSceneNode(node)) continue;
    if (!overlapsFrame(node, frame)) continue;
    const cloned = { ...node };
    cloned.x = num(cloned.x) - frame.x;
    cloned.y = num(cloned.y) - frame.y;
    const nid = String(cloned.id ?? key);
    cloned.id = nid;
    nodes[nid] = cloned;
    children.push(nid);
  }

  const bg =
    frame.backgroundColor ||
    (typeof doc.backgroundColor === 'string' ? doc.backgroundColor : '#ffffff');
  const fid = frame.id || 'frame';

  let outW = frame.width;
  let outH = frame.height;

  if (opts?.contentFit) {
    const crop = maybeContentFitCrop(nodes, children, frame);
    if (crop) {
      outW = crop.outW;
      outH = crop.outH;
    }
  }

  return {
    width: outW,
    height: outH,
    backgroundColor: bg,
    backgroundFillType: 'solid',
    frames: [
      {
        id: fid,
        name: String(frame.name || '').trim() || fid,
        x: 0,
        y: 0,
        width: outW,
        height: outH,
        backgroundColor: bg,
      },
    ],
    activeFrameId: fid,
    deltaSetLike: {
      ROOT: { id: 'ROOT', children },
      ...nodes,
    },
  };
}

/** True when a cover/preview doc has at least one scene node. */
export function coverDocumentHasContent(document: unknown): boolean {
  const children = (document as { deltaSetLike?: { ROOT?: { children?: unknown } } })
    ?.deltaSetLike?.ROOT?.children;
  return Array.isArray(children) && children.length > 0;
}

/** Lightweight doc for Plaza list / publish preview (active or first artboard, else full doc). */
export function extractPlazaCoverDocument(
  document: unknown,
  opts?: ExtractFrameOptions
): unknown | null {
  const framed = extractFrameDocument(document, findPlazaCoverFrame(document), opts);
  if (framed) return framed;
  if (!(document && typeof document === 'object' && coverDocumentHasContent(document))) {
    return null;
  }
  if (!opts?.contentFit) return document;

  // No artboard — still crop to content so loose nodes are not stuck in a huge empty world.
  const doc = document as Record<string, unknown>;
  const dsl = (doc.deltaSetLike && typeof doc.deltaSetLike === 'object'
    ? doc.deltaSetLike
    : {}) as Record<string, unknown>;
  const rootChildren = (dsl.ROOT as { children?: unknown } | undefined)?.children;
  const children = Array.isArray(rootChildren)
    ? rootChildren
        .map((id) => String(id))
        .filter((id) => {
          const node = dsl[id];
          return Boolean(node && typeof node === 'object' && isExportableSceneNode(node));
        })
    : [];
  const box = contentBoundsOfNodes(dsl, children);
  if (!box) return document;
  const pad = Math.max(12, Math.round(Math.max(box.width, box.height) * 0.08));
  const x0 = Math.floor(box.x - pad);
  const y0 = Math.floor(box.y - pad);
  const outW = Math.max(1, Math.ceil(box.width + pad * 2));
  const outH = Math.max(1, Math.ceil(box.height + pad * 2));
  const nodes: Record<string, unknown> = {};
  for (const id of children) {
    const raw = dsl[id];
    if (!raw || typeof raw !== 'object') continue;
    if (!isExportableSceneNode(raw)) continue;
    const node = { ...(raw as Record<string, unknown>) };
    node.x = num(node.x) - x0;
    node.y = num(node.y) - y0;
    nodes[id] = node;
  }
  const bg =
    typeof doc.backgroundColor === 'string' && doc.backgroundColor.trim()
      ? doc.backgroundColor
      : '#ffffff';
  return {
    width: outW,
    height: outH,
    backgroundColor: bg,
    backgroundFillType: 'solid',
    frames: [
      {
        id: 'content',
        name: 'content',
        x: 0,
        y: 0,
        width: outW,
        height: outH,
        backgroundColor: bg,
      },
    ],
    activeFrameId: 'content',
    deltaSetLike: {
      ROOT: { id: 'ROOT', children },
      ...nodes,
    },
  };
}

export type PlazaCoverPublishCheck = {
  ok: boolean;
  hasCover: boolean;
  frame: PlazaCoverFrame | null;
  coverDocument: unknown | null;
};

/**
 * Publish gate — artboard optional. Preview crops to design content so the card
 * centers the work instead of a mostly-empty artboard.
 */
export function checkPlazaCoverForPublish(document: unknown): PlazaCoverPublishCheck {
  const frame = findPlazaCoverFrame(document);
  const coverDocument = extractPlazaCoverDocument(document, { contentFit: true });
  const hasCover = Boolean(frame);
  return {
    ok: Boolean(document && typeof document === 'object'),
    hasCover,
    frame,
    coverDocument,
  };
}
