/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/document/mediaLifecycle.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { nanoid } from '@reduxjs/toolkit';
import { buildMarkdownTextAttrs } from './sceneText';
import {
  addNodeToDocument,
  cloneSceneValue,
  normalizeDocument,
  removeNodesFromDocument,
} from './sceneDocument';
import {
  isExportableSceneNode,
  isGeneratorNode,
  isImageProcessRunning,
} from './nodeCapabilities';
import {
  createAudioNode,
  createImageNode,
  createLottieNode,
  createTextNode,
  createVideoNode,
  resolveThemeSurfaceFill,
  serializeLottieAnimationData,
  TRANSPARENT_PIXEL,
} from './nodeFactories';
import { groupNodesInDocument } from './sceneGroups';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

/** Generator promote / upload placeholders / variants / decompose. */

export function documentForSharePreview(doc: SceneDocument): SceneDocument {
  if (!doc?.deltaSetLike?.ROOT) return doc;
  const delta = doc.deltaSetLike;
  const keepId = (id: string) => isExportableSceneNode(delta[id]);
  const rootChildren = Array.isArray(delta.ROOT.children)
    ? delta.ROOT.children.filter(keepId)
    : [];
  const pages = Array.isArray(doc.pages)
    ? doc.pages.map((p) => ({
        ...p,
        children: Array.isArray(p.children) ? p.children.filter(keepId) : p.children,
      }))
    : doc.pages;
  return {
    ...doc,
    pages,
    deltaSetLike: {
      ...delta,
      ROOT: { ...delta.ROOT, children: rootChildren },
    },
  };
}

/** True while an image job (upload / remove-bg / …) shows the loading shimmer. */
export function canAttachNodeToChat(
  node: SceneNodeInput,
  opts?: { imagesOnly?: boolean }
): boolean {
  if (!node) return false;
  if (isGeneratorNode(node)) return false;
  if (isImageProcessRunning(node)) return false;
  if (opts?.imagesOnly && (node.key === 'video' || node.key === 'lottie' || node.key === 'audio')) {
    return false;
  }
  return true;
}

/** Canvas → composer attach payload: many ids | one id | frame fallback. */
export function canvasAttachPickPayload(
  attachable: string[],
  frameId: string | null | undefined
): string | string[] {
  if (attachable.length > 1) return attachable;
  if (attachable.length === 1) return attachable[0]!;
  return `frame:${frameId}`;
}

/** Layer locked — still visible/selectable, but transforms are blocked. */
export function parseImageVariants(attrs: SceneNode['attrs'] | null | undefined): string[] {
  const raw = attrs?.imageVariants;
  if (Array.isArray(raw)) {
    return raw.map((u) => String(u || '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((u) => String(u || '').trim()).filter(Boolean);
      }
    } catch {
      /* ignore */
    }
  }
  return [];
}

/** All stack URLs for an image node (falls back to single `src`). */
export function listImageVariantUrls(node: SceneNodeInput): string[] {
  if (!node || node.key !== 'image') return [];
  const variants = parseImageVariants(node.attrs);
  if (variants.length) return variants;
  const src = String(node.attrs?.src || '').trim();
  return src ? [src] : [];
}

export function writeImageVariantsAttr(attrs: Record<string, unknown>, urls: string[]) {
  const cleaned = [...new Set(urls.map((u) => String(u || '').trim()).filter(Boolean))];
  if (cleaned.length <= 1) {
    delete attrs.imageVariants;
  } else {
    attrs.imageVariants = JSON.stringify(cleaned);
  }
}

/**
 * Turn a generator plate into a normal image node (same id / selection).
 * Clears generator + process attrs and applies the result `src` + geometry.
 * When `variants` has 2+ URLs, stores them on `attrs.imageVariants` for stack UI.
 */
export function promoteImageGeneratorToImage(
  doc: SceneDocument,
  nodeId: string,
  {
    src,
    width,
    height,
    x,
    y,
    name,
    variants,
    genPrompt,
  }: {
    src: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    name?: string;
    /** All generated URLs (including `src`); persisted when length > 1. */
    variants?: string[];
    /** Original text prompt — used to prefill quick-edit Chat. */
    genPrompt?: string;
  }
) {
  if (!doc || !nodeId || !src) return doc;
  const next = normalizeDocument(doc);
  const node = next.deltaSetLike?.[nodeId];
  if (!node || node.key !== 'image') return doc;
  const attrs = { ...(node.attrs || {}) };
  delete attrs.imageGenerator;
  delete attrs.imageGenAspect;
  delete attrs.imageGenResolution;
  delete attrs.imageGenCount;
  delete attrs.imageGenModel;
  delete attrs.processStatus;
  delete attrs.processKind;
  delete attrs.processLabel;
  delete attrs.processSourceId;
  delete attrs.processTargetWidth;
  delete attrs.processTargetHeight;
  delete attrs.processMeta;
  attrs.src = src;
  attrs.assetKind = 'image';
  if (name) attrs.name = name;
  const prompt = String(genPrompt || '').trim();
  if (prompt) attrs.genPrompt = prompt;
  else delete attrs.genPrompt;
  const stack = Array.isArray(variants) ? variants : [];
  const withMain = stack.includes(src) ? stack : [src, ...stack];
  writeImageVariantsAttr(attrs, withMain);
  node.attrs = attrs;
  if (width != null) node.width = Math.max(1, Math.round(width));
  if (height != null) node.height = Math.max(1, Math.round(height));
  if (x != null) node.x = Math.round(x);
  if (y != null) node.y = Math.round(y);
  return next;
}

/**
 * Spawn a Video Generator plate. Same `video` key so hit-test / select
 * keep working; `attrs.videoGenerator` flips on the HTML composer overlay.
 * After generate, call `promoteVideoGeneratorToVideo` to become a normal video.
 */
export function promoteVideoGeneratorToVideo(
  doc: SceneDocument,
  nodeId: string,
  {
    src,
    poster,
    width,
    height,
    x,
    y,
    name,
    genPrompt,
  }: {
    src: string;
    poster?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    name?: string;
    genPrompt?: string;
  }
) {
  if (!doc || !nodeId || !src) return doc;
  const next = normalizeDocument(doc);
  const node = next.deltaSetLike?.[nodeId];
  if (!node || node.key !== 'video') return doc;
  const attrs = { ...(node.attrs || {}) };
  delete attrs.videoGenerator;
  delete attrs.videoGenAspect;
  delete attrs.videoGenResolution;
  delete attrs.videoGenDuration;
  delete attrs.videoGenModel;
  delete attrs.processStatus;
  delete attrs.processKind;
  delete attrs.processLabel;
  delete attrs.processSourceId;
  delete attrs.processTargetWidth;
  delete attrs.processTargetHeight;
  delete attrs.processMeta;
  attrs.src = src;
  if (poster) attrs.poster = poster;
  attrs.assetKind = 'video';
  if (name) attrs.name = name;
  const prompt = String(genPrompt || '').trim();
  if (prompt) attrs.genPrompt = prompt;
  else delete attrs.genPrompt;
  node.attrs = attrs;
  if (width != null) node.width = Math.max(1, Math.round(width));
  if (height != null) node.height = Math.max(1, Math.round(height));
  if (x != null) node.x = Math.round(x);
  if (y != null) node.y = Math.round(y);
  return next;
}

/** Spawn video node with local preview while remote upload runs. */
export function spawnVideoUploadPlaceholderNode(
  doc: SceneDocument,
  {
    src,
    poster,
    width,
    height,
    label = '上传中',
    x,
    y,
    name,
    duration,
  }: {
    src: string;
    poster?: string;
    width: number;
    height: number;
    label?: string;
    x?: number;
    y?: number;
    name?: string;
    duration?: number;
  }
) {
  if (!doc || !src) return { document: doc, id: null as string | null };
  const next = normalizeDocument(doc);
  const { id, node } = createVideoNode({
    x: x ?? 40,
    y: y ?? 40,
    width,
    height,
    src,
    poster: poster || '',
    name: name || 'Video',
    duration,
  });
  node.attrs = {
    ...(node.attrs || {}),
    processStatus: 'running',
    processKind: 'upload',
    processLabel: label,
  };
  return { document: addNodeToDocument(next, id, node), id };
}

/**
 * Pull one stack URL out into a sibling image node (to the right).
 * Removes it from the source stack when successful.
 */
export function detachImageVariantToNode(
  doc: SceneDocument,
  nodeId: string,
  url: string,
  { gap = 16, name = 'Image' }: { gap?: number; name?: string } = {}
) {
  const src = String(url || '').trim();
  if (!doc || !nodeId || !src) return { document: doc, id: null as string | null };
  const next = normalizeDocument(doc);
  const source = next.deltaSetLike?.[nodeId];
  if (!source || source.key !== 'image') return { document: doc, id: null as string | null };
  const stack = listImageVariantUrls(source);
  if (!stack.includes(src)) return { document: doc, id: null as string | null };

  const width = Math.max(1, Math.round(Number(source.width) || 200));
  const height = Math.max(1, Math.round(Number(source.height) || 200));
  const { id, node } = createImageNode({
    x: (Number(source.x) || 0) + width + gap,
    y: Number(source.y) || 0,
    width,
    height,
    src,
    name: name || String(source.attrs?.name || 'Image'),
    assetKind: 'image',
  });
  let document = addNodeToDocument(next, id, node);

  const remaining = stack.filter((u) => u !== src);
  const mainSrc = String(source.attrs?.src || '').trim();
  const attrs = { ...(document.deltaSetLike[nodeId].attrs || {}) };
  if (mainSrc === src) {
    attrs.src = remaining[0] || '';
  }
  writeImageVariantsAttr(attrs, remaining);
  document.deltaSetLike[nodeId].attrs = attrs;
  return { document, id };
}

/**
 * Native SVG node — markup stays SVG (not rasterized image, not converted to path).
 * User can later 轮廓化 if they want an editable path.
 */
export function cloneAudioNodeSibling(
  doc: SceneDocument,
  sourceNode: SceneNode,
  {
    attrsPatch,
    defaultName,
    gap = 16,
  }: {
    attrsPatch: Record<string, unknown>;
    defaultName?: string;
    gap?: number;
  }
): { document: SceneDocument; id: string } | null {
  if (!doc || !sourceNode || sourceNode.key !== 'audio') return null;
  const w = Math.max(1, Math.round(Number(sourceNode.width) || 360));
  const h = Math.max(1, Math.round(Number(sourceNode.height) || 200));
  const id = nanoid(10);
  const clone = cloneSceneValue(sourceNode);
  clone.id = id;
  clone.x = Math.round((Number(sourceNode.x) || 0) + w + gap);
  clone.y = Math.round(Number(sourceNode.y) || 0);
  clone.width = w;
  clone.height = h;
  const attrs = { ...(clone.attrs || {}), ...attrsPatch };
  const name = String(attrs.name || '').trim();
  if (!name && defaultName) attrs.name = defaultName;
  delete attrs.processStatus;
  delete attrs.processKind;
  delete attrs.processLabel;
  delete attrs.processSourceId;
  clone.attrs = attrs;
  return { document: addNodeToDocument(doc, id, clone), id };
}

export function promoteAudioGeneratorToAudio(
  doc: SceneDocument,
  nodeId: string,
  {
    src,
    width,
    height,
    x,
    y,
    name,
    genPrompt,
    duration,
    uploadKey,
  }: {
    src: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    name?: string;
    genPrompt?: string;
    duration?: number;
    uploadKey?: string;
  }
) {
  if (!doc || !nodeId || !src) return doc;
  const next = normalizeDocument(doc);
  const node = next.deltaSetLike?.[nodeId];
  if (!node || node.key !== 'audio') return doc;
  const attrs = { ...(node.attrs || {}) };
  delete attrs.audioGenerator;
  delete attrs.processStatus;
  delete attrs.processKind;
  delete attrs.processLabel;
  delete attrs.processSourceId;
  delete attrs.processTargetWidth;
  delete attrs.processTargetHeight;
  delete attrs.processMeta;
  attrs.src = src;
  attrs.assetKind = 'audio';
  if (attrs.audioSpeed == null) attrs.audioSpeed = 1;
  attrs['fill-color'] = resolveThemeSurfaceFill(attrs['fill-color'] || attrs.fill);
  if (name) attrs.name = name;
  const key = String(uploadKey || '').trim();
  if (key) attrs.uploadKey = key;
  const d = Number(duration);
  if (Number.isFinite(d) && d > 0) attrs.duration = d;
  const prompt = String(genPrompt || '').trim();
  if (prompt) attrs.genPrompt = prompt;
  else delete attrs.genPrompt;
  node.attrs = attrs;
  if (width != null) node.width = Math.max(1, Math.round(width));
  if (height != null) node.height = Math.max(1, Math.round(height));
  if (x != null) node.x = Math.round(x);
  if (y != null) node.y = Math.round(y);
  return next;
}

/**
 * Spawn a Lottie Generator plate. Same `lottie` key so hit-test / select
 * keep working; `attrs.lottieGenerator` flips on the HTML composer overlay.
 * After generate, call `promoteLottieGeneratorToLottie` to become a normal Lottie.
 */
export function promoteLottieGeneratorToLottie(
  doc: SceneDocument,
  nodeId: string,
  {
    animationData,
    width,
    height,
    x,
    y,
    name,
    genPrompt,
  }: {
    animationData: unknown;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    name?: string;
    genPrompt?: string;
  }
) {
  if (!doc || !nodeId) return doc;
  const json = serializeLottieAnimationData(animationData);
  if (!json) return doc;
  const next = normalizeDocument(doc);
  const node = next.deltaSetLike?.[nodeId];
  if (!node || node.key !== 'lottie') return doc;
  const attrs = { ...(node.attrs || {}) };
  delete attrs.lottieGenerator;
  delete attrs.processStatus;
  delete attrs.processKind;
  delete attrs.processLabel;
  delete attrs.processSourceId;
  delete attrs.processTargetWidth;
  delete attrs.processTargetHeight;
  delete attrs.processMeta;
  attrs.animationData = json;
  attrs.assetKind = 'lottie';
  // Default readable plate under ink (never leave transparent).
  if (!String(attrs['fill-color'] || attrs.fill || '').trim() || attrs['fill-color'] === 'transparent') {
    attrs['fill-color'] = 'var(--surface)';
  }
  if (attrs.radiusTL == null) attrs.radiusTL = 8;
  if (attrs.radiusTR == null) attrs.radiusTR = 8;
  if (attrs.radiusBR == null) attrs.radiusBR = 8;
  if (attrs.radiusBL == null) attrs.radiusBL = 8;
  if (name) attrs.name = name;
  const prompt = String(genPrompt || '').trim();
  if (prompt) attrs.genPrompt = prompt;
  else delete attrs.genPrompt;
  node.attrs = attrs;
  if (width != null) node.width = Math.max(1, Math.round(width));
  if (height != null) node.height = Math.max(1, Math.round(height));
  if (x != null) node.x = Math.round(x);
  if (y != null) node.y = Math.round(y);
  return next;
}

function looksLikeSvgSrc(src: string) {
  const s = String(src || '').trim();
  if (!s) return false;
  if (s.startsWith('data:image/svg+xml')) return true;
  const path = s.split('?')[0].toLowerCase();
  return path.endsWith('.svg');
}

export type ImageProcessKind =
  | 'upscale'
  | 'removeBg'
  | 'eraser'
  | 'editText'
  | 'editElements'
  | 'multiAngle'
  | 'moveObject'
  | 'expand'
  | 'adjust'
  | 'crop'
  | 'vector'
  | 'flipRotate'
  | 'import'
  | 'upload'
  | 'generate';

/**
 * Blank loading plate for image import.
 */
export function spawnImportPlaceholderNode(
  doc: SceneDocument,
  opts: {
    label?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
  } = {}
) {
  if (!doc) return { document: doc, id: null as string | null };
  const frames = Array.isArray(doc.frames) ? doc.frames : [];
  const active =
    frames.find((f) => f.id === doc.activeFrameId) || frames[0] || null;
  const width = Math.max(120, Math.round(opts.width ?? 420));
  const height = Math.max(160, Math.round(opts.height ?? 594));
  let x = 40;
  if (opts.x != null) x = opts.x;
  else if (active) x = Math.round(Number(active.x) + Number(active.width) + 24);
  let y = 40;
  if (opts.y != null) y = opts.y;
  else if (active) y = Math.round(Number(active.y) || 0);
  const { id, node } = createImageNode({
    x,
    y,
    width,
    height,
    src: TRANSPARENT_PIXEL,
  });
  node.attrs = {
    ...node.attrs,
    processStatus: 'running',
    processKind: 'import',
    processLabel: opts.label || '解析中',
  };
  return { document: addNodeToDocument(doc, id, node), id };
}

/**
 * Prefer explicit coords; else center in the active frame; else center on the doc.
 * Keeps upload placeholders visible instead of parking off to the right.
 */
function centerInFrameOrDocument(opts: {
  explicit: number | undefined | null;
  size: number;
  frameOrigin: number;
  frameSpan: number;
  hasFrame: boolean;
  documentSpan: number;
}): number {
  if (opts.explicit != null) return opts.explicit;
  if (opts.hasFrame) {
    return Math.round(opts.frameOrigin + (opts.frameSpan - opts.size) / 2);
  }
  return Math.round((opts.documentSpan - opts.size) / 2);
}

/**
 * Image upload placeholder — shows local base64 preview at natural aspect while COS upload runs.
 */
export function spawnImageUploadPlaceholderNode(
  doc: SceneDocument,
  opts: {
    src: string;
    width: number;
    height: number;
    label?: string;
    x?: number;
    y?: number;
    name?: string;
  }
) {
  if (!doc || !opts?.src) return { document: doc, id: null as string | null };
  const frames = Array.isArray(doc.frames) ? doc.frames : [];
  const active =
    frames.find((f) => f.id === doc.activeFrameId) || frames[0] || null;
  const width = Math.max(1, Math.round(opts.width) || 1);
  const height = Math.max(1, Math.round(opts.height) || 1);
  const x = centerInFrameOrDocument({
    explicit: opts.x,
    size: width,
    hasFrame: Boolean(active),
    frameOrigin: Number(active?.x) || 0,
    frameSpan: Number(active?.width) || 0,
    documentSpan: Number(doc.width) || 800,
  });
  const y = centerInFrameOrDocument({
    explicit: opts.y,
    size: height,
    hasFrame: Boolean(active),
    frameOrigin: Number(active?.y) || 0,
    frameSpan: Number(active?.height) || 0,
    documentSpan: Number(doc.height) || 600,
  });
  const { id, node } = createImageNode({
    x,
    y,
    width,
    height,
    src: opts.src,
    name: opts.name || 'Image',
  });
  node.attrs = {
    ...node.attrs,
    processStatus: 'running',
    processKind: 'upload',
    processLabel: opts.label || '上传中',
  };
  return { document: addNodeToDocument(doc, id, node), id };
}

/** Process clone on-canvas size — expand may grow; other kinds keep source box. */
function processCloneSize(
  src: { width?: number; height?: number },
  opts: { kind: string; targetWidth?: number; targetHeight?: number }
): { width: number; height: number } {
  const fallbackW = Number(src.width) || 100;
  const fallbackH = Number(src.height) || 100;
  if (opts.kind !== 'expand') {
    return {
      width: Math.max(1, Math.round(fallbackW)),
      height: Math.max(1, Math.round(fallbackH)),
    };
  }
  return {
    width: Math.max(1, Math.round(opts.targetWidth ?? fallbackW)),
    height: Math.max(1, Math.round(opts.targetHeight ?? fallbackH)),
  };
}

/** Clone image to the right as a loading process node — original stays untouched. */
export function spawnImageProcessNode(
  doc: SceneDocument,
  sourceId: string,
  opts: {
    kind: ImageProcessKind;
    label: string;
    targetWidth?: number;
    targetHeight?: number;
    gap?: number;
    /** Extra JSON for watchers (e.g. multi-angle params). */
    meta?: Record<string, unknown> | null;
  }
) {
  if (!doc || !sourceId) return { document: doc, id: null as string | null };
  const src = doc.deltaSetLike?.[sourceId];
  if (!src || src.key !== 'image') return { document: doc, id: null as string | null };

  const id = nanoid(10);
  const gap = opts.gap ?? 16;
  // Upscale raises bitmap resolution only — keep on-canvas node size.
  // Expand may grow the plate; other kinds stay source-sized.
  const { width, height } = processCloneSize(src, opts);
  const node = cloneSceneValue(src);
  node.id = id;
  node.x = (Number(src.x) || 0) + (Number(src.width) || width) + gap;
  node.y = Number(src.y) || 0;
  node.width = width;
  node.height = height;
  node.attrs = {
    ...(node.attrs || {}),
    processStatus: 'running',
    processKind: opts.kind,
    processLabel: opts.label,
    processSourceId: sourceId,
    ...(opts.targetWidth != null ? { processTargetWidth: Math.round(opts.targetWidth) } : {}),
    ...(opts.targetHeight != null ? { processTargetHeight: Math.round(opts.targetHeight) } : {}),
    ...(opts.meta ? { processMeta: JSON.stringify(opts.meta) } : {}),
  };
  return { document: addNodeToDocument(doc, id, node), id };
}

/** Clear processing overlay attrs after a job finishes. */
export function clearImageProcessAttrs(doc: SceneDocument, nodeId: string) {
  if (!doc || !nodeId) return doc;
  const next = normalizeDocument(doc);
  const node = next.deltaSetLike?.[nodeId];
  if (!node?.attrs) return doc;
  // Must replace attrs — updateNodeInDocument merges and would keep processStatus.
  const attrs = { ...node.attrs };
  delete attrs.processStatus;
  delete attrs.processKind;
  delete attrs.processLabel;
  delete attrs.processSourceId;
  delete attrs.processTargetWidth;
  delete attrs.processTargetHeight;
  delete attrs.processMeta;
  node.attrs = attrs;
  return next;
}

export type DecomposeLayer = {
  type: 'image' | 'text' | string;
  src?: string;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  fill?: string;
  lineHeight?: number;
};

/**
 * Replace a process placeholder with split layers (editText / editElements).
 * Layer coords are in source-image pixels; scaled into the placeholder's box.
 * Result layers share one groupId so the stack still moves as one picture.
 */
export function applyImageDecomposeLayers(
  doc: SceneDocument,
  placeholderId: string,
  layers: DecomposeLayer[],
  opts?: { sourceWidth?: number; sourceHeight?: number }
) {
  if (!doc || !placeholderId || !Array.isArray(layers) || !layers.length) {
    return { document: doc, ids: [] as string[] };
  }
  let next = normalizeDocument(doc);
  const placeholder = next.deltaSetLike?.[placeholderId];
  if (!placeholder) return { document: doc, ids: [] as string[] };

  const originX = Number(placeholder.x) || 0;
  const originY = Number(placeholder.y) || 0;
  const boxW = Math.max(1, Number(placeholder.width) || 1);
  const boxH = Math.max(1, Number(placeholder.height) || 1);
  const srcW = Math.max(1, Number(opts?.sourceWidth) || boxW);
  const srcH = Math.max(1, Number(opts?.sourceHeight) || boxH);
  const sx = boxW / srcW;
  const sy = boxH / srcH;

  // Drop the loading clone first.
  next = removeNodesFromDocument(next, [placeholderId]);

  const ids: string[] = [];
  for (const layer of layers) {
    const lx = originX + (Number(layer.x) || 0) * sx;
    const ly = originY + (Number(layer.y) || 0) * sy;
    const lw = Math.max(4, (Number(layer.width) || srcW) * sx);
    const lh = Math.max(4, (Number(layer.height) || srcH) * sy);
    const kind = String(layer.type || '');

    if (kind === 'text' && String(layer.text || '').trim()) {
      // layer.fontSize is source-image pixels → scale with sy; lh is already canvas-scaled.
      const srcFont = Number(layer.fontSize) || 0;
      const fontSize = Math.max(
        8,
        Math.round((srcFont > 0 ? srcFont * sy : lh * 0.78) * 10) / 10
      );
      const { id, node } = createTextNode({
        x: Math.round(lx),
        y: Math.round(ly),
        text: String(layer.text),
        width: Math.round(lw),
        height: Math.round(lh),
        autoSize: false,
      });
      const style = {
        fontSize,
        fontFamily: String(layer.fontFamily || 'Alibaba PuHuiTi'),
        fontWeight: String(layer.fontWeight || 'normal') === 'bold' ? 'bold' : 'normal',
        fill: String(layer.fill || '#333333'),
        lineHeight: Number(layer.lineHeight) || 1.25,
      } as const;
      node.attrs = {
        ...buildMarkdownTextAttrs(String(layer.text), style),
        autoSize: 'false',
        name: String(layer.name || '文字'),
      } as Record<string, unknown>;
      next = addNodeToDocument(next, id, node);
      ids.push(id);
      continue;
    }

    if (kind === 'image' && layer.src) {
      const { id, node } = createImageNode({
        x: Math.round(lx),
        y: Math.round(ly),
        width: Math.round(lw),
        height: Math.round(lh),
        src: String(layer.src),
        name: String(layer.name || '图层'),
      });
      next = addNodeToDocument(next, id, node);
      ids.push(id);
    }
  }

  // Keep the stack selectable / movable as one composition.
  if (ids.length >= 2) {
    next = groupNodesInDocument(next, ids);
  }

  return { document: next, ids };
}
