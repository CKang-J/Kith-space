/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/document/nodeCapabilities.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/** Node predicates: is* / supports* (no document writes). */

import type { SceneNodeAttrs } from '@recombyn-native/components/rcb/sceneNode';

/**
 * Predicate input — full `SceneNode` or a key/attrs stub (layer list, tests).
 */
export type SceneNodeRef = {
  key?: string;
  attrs?: SceneNodeAttrs | null;
} | null | undefined;

function attrFlagTrue(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function looksLikeSvgSrc(src: string) {
  const s = String(src || '').trim();
  if (!s) return false;
  if (s.startsWith('data:image/svg+xml')) return true;
  const path = s.split('?')[0].toLowerCase();
  return path.endsWith('.svg');
}

export function isImageGeneratorNode(node: SceneNodeRef): boolean {
  return Boolean(node) && node!.key === 'image' && attrFlagTrue(node!.attrs?.imageGenerator);
}

/** Canvas video-generator plate (empty video + generator overlay until promote). */
export function isVideoGeneratorNode(node: SceneNodeRef): boolean {
  return Boolean(node) && node!.key === 'video' && attrFlagTrue(node!.attrs?.videoGenerator);
}

/** Canvas Lottie-generator plate (empty lottie + composer until promote). */
export function isLottieGeneratorNode(node: SceneNodeRef): boolean {
  return Boolean(node) && node!.key === 'lottie' && attrFlagTrue(node!.attrs?.lottieGenerator);
}

/** Canvas audio-generator plate (empty audio + generator overlay until promote). */
export function isAudioGeneratorNode(node: SceneNodeRef): boolean {
  return Boolean(node) && node!.key === 'audio' && attrFlagTrue(node!.attrs?.audioGenerator);
}

/** Image / video / Lottie / audio generator plates — not real scene content (no hide / lock / export). */
export function isGeneratorNode(node: SceneNodeRef): boolean {
  return (
    isImageGeneratorNode(node) ||
    isVideoGeneratorNode(node) ||
    isLottieGeneratorNode(node) ||
    isAudioGeneratorNode(node)
  );
}

export function isVideoNode(node: SceneNodeRef): boolean {
  return Boolean(node) && node!.key === 'video' && !isVideoGeneratorNode(node);
}

/** Finished audio plate (not a generator composer). */
export function isAudioNode(node: SceneNodeRef): boolean {
  return Boolean(node) && node!.key === 'audio' && !isAudioGeneratorNode(node);
}

/** Layer hidden — skipped in SVG render + hit-test. */
export function isNodeHidden(node: SceneNodeRef): boolean {
  return Boolean(node) && attrFlagTrue(node!.attrs?.hidden);
}

/**
 * Nodes that belong in export / cover / thumbnail output.
 * Skip editor-only chrome: image/video-generator plates and in-progress process shimmer.
 */
export function isExportableSceneNode(node: SceneNodeRef): boolean {
  if (!node || isNodeHidden(node)) return false;
  if (isGeneratorNode(node)) return false;
  if (String(node?.attrs?.processStatus || '') === 'running') return false;
  return true;
}

/**
 * Share / public preview: drop generator plates and process-shimmer so viewers
 * only see finished scene content (same filter as export / cover).
 */
export function isImageProcessRunning(node: SceneNodeRef): boolean {
  return Boolean(node) && String(node?.attrs?.processStatus || '') === 'running';
}

/**
 * In-flight process placeholder (upload / import / AI tools like editElements).
 * Delete is permanent — scrubbed from history so Undo cannot revive it; clearing
 * pendingImageProcessId aborts applying the result (same as upload-in-flight).
 */
export function isEphemeralUploadNode(node: SceneNodeRef): boolean {
  return isImageProcessRunning(node);
}

/**
 * Nodes that may be pinned into Chat (右键 / 快捷键 / composer).
 * Generator plates and process-shimmer nodes stay out.
 * `imagesOnly` — image-generator / quick-edit pick: reject video nodes.
 */
export function isNodeLocked(node: SceneNodeRef): boolean {
  return Boolean(node) && attrFlagTrue(node!.attrs?.locked);
}

/** Finished Lottie plate (not a generator composer). */
export function isLottieNode(node: SceneNodeRef): boolean {
  return Boolean(node) && node!.key === 'lottie' && !isLottieGeneratorNode(node);
}

/** True for icon-library assets that still use an SVG source. */
export function isIconImageNode(node: SceneNodeRef): boolean {
  if (!node || node.key !== 'image') return false;
  const kind = String(node.attrs?.assetKind || '');
  const src = String(node.attrs?.src || '');
  // Explicit photo (incl. after replace) → never annotate-as-icon.
  if (kind === 'image') return false;
  if (kind === 'icon') return looksLikeSvgSrc(src);
  // Untagged legacy catalog inserts were SVG data URLs without assetKind.
  return looksLikeSvgSrc(src);
}

/**
 * Per-side stroke (T/R/B/L) is only rendered for rect-like closed paths
 * (`createRectLike` in sceneToSvg).
 */
export function supportsSideStroke(node: SceneNodeRef) {
  if (!node) return false;
  if (node.key === 'rect') return true;
  if (node.key === 'shape') {
    const t = String(node.attrs?.shapeType || 'rect');
    return t === 'rect' || t === 'roundRect' || t === '';
  }
  return false;
}

/** Closed path / boolean result — fillets sharp verts via `radiusVertices` (sceneToSvg). */
function isClosedFilletPath(node: SceneNodeRef): boolean {
  if (!node?.attrs) return false;
  const closed = node.attrs.closed;
  if (closed === false || closed === 'false' || closed === 0 || closed === '0') return false;
  if (closed === true || closed === 'true' || closed === 1 || closed === '1') return true;
  const d = String(node.attrs.path || node.attrs.d || '').trim();
  return /z\s*$/i.test(d);
}

/**
 * Outlined text / multi-glyph paths: many M…Z rings. Selection R-dots would
 * carpet every silhouette corner — edit anchors only in path-edit mode.
 * Same threshold as `requestEnterPathEdit` (skip auto-enter).
 */
function isMultiGlyphOutlinePath(node: SceneNodeRef): boolean {
  const d = String(node?.attrs?.path || node?.attrs?.d || '').trim();
  if (!d) return false;
  const rings = d.split(/(?=[Mm])/).filter((s) => s.trim()).length;
  return rings >= 4;
}

function pathAllowsCornerRadius(node: SceneNodeRef): boolean {
  return isClosedFilletPath(node) && !isMultiGlyphOutlinePath(node);
}

/** Nodes that expose corner-radius toolbar + on-canvas handles. */
export function supportsCornerRadius(node: SceneNodeRef) {
  if (!node) return false;
  // Circles / ellipses have no corners — AABB R-dots sit in the square's empty
  // corners (outside the disk). Use path/geo edit instead.
  if (node.key === 'ellipse') return false;
  if (node.key === 'rect' || node.key === 'image') return true;
  // Closed boolean / outlined paths: fillet sharp corners (same R dots as rect).
  // Open pen / pencil / freehand stay out — no meaningful box corners.
  // Multi-glyph outlines (text→path): no R-dots until path-edit mode.
  if (node.key === 'path') return pathAllowsCornerRadius(node);
  if (node.key === 'shape') {
    const t = String(node.attrs?.shapeType || 'rect');
    if (t === 'circle' || t === 'ellipse') return false;
    if (t === 'rect' || t === 'roundRect' || t === 'triangle' || t === 'polygon' || t === 'star') {
      return true;
    }
    if (t === 'pen' || t === 'pencil' || t === 'line' || t === 'arrow') return false;
    if (t === 'path') return pathAllowsCornerRadius(node);
  }
  return false;
}

/** Regular polygon / star: adjustable side (or point) count. */
export function supportsShapeSides(node: SceneNodeRef) {
  if (!node || node.key !== 'shape') return false;
  const t = String(node.attrs?.shapeType || '');
  return t === 'polygon' || t === 'star';
}

/**
 * Whether preset aspect ratios (1:1 / 16:9 …) are meaningful.
 * Freehand paths, lines, and arrows only have a loose bounding box — skip presets.
 */
export function supportsAspectPresets(node: SceneNodeRef) {
  if (!node) return false;
  if (
    node.key === 'image' ||
    node.key === 'video' ||
    node.key === 'lottie' ||
    node.key === 'audio' ||
    node.key === 'frame' ||
    node.key === 'svg'
  )
    return true;
  if (node.key === 'rect' || node.key === 'ellipse') return true;
  if (node.key !== 'shape' && node.key !== 'path') return false;
  const t = String(node.attrs?.shapeType || (node.key === 'path' ? 'path' : 'rect'));
  // Open strokes have no box aspect; closed path (e.g. boolean result) does.
  if (['line', 'arrow', 'pen', 'pencil'].includes(t)) return false;
  if (t === 'path') return String(node.attrs?.closed) !== 'false';
  return true;
}

/**
 * Whether the node can have a fill / background color.
 * Open stroke paths (line, arrow, pencil, unclosed pen/path) are stroke-only.
 */
export function supportsFill(node: SceneNodeRef) {
  if (!node) return false;
  if (
    node.key === 'rect' ||
    node.key === 'ellipse' ||
    node.key === 'image' ||
    node.key === 'video' ||
    node.key === 'lottie' ||
    node.key === 'audio' ||
    node.key === 'svg'
  )
    return true;
  if (node.key === 'path') {
    const d = String(node.attrs?.path || node.attrs?.d || '');
    if (node.attrs?.closed === false || node.attrs?.closed === 'false') return false;
    return (
      node.attrs?.closed === true ||
      node.attrs?.closed === 'true' ||
      /\sZ\s*$/i.test(d.trim())
    );
  }
  if (node.key !== 'shape') return false;
  const t = String(node.attrs?.shapeType || 'rect');
  if (t === 'line' || t === 'arrow' || t === 'pencil') return false;
  if (t === 'pen' || t === 'path') {
    const d = String(node.attrs?.path || node.attrs?.d || '');
    if (node.attrs?.closed === false || node.attrs?.closed === 'false') return false;
    return (
      node.attrs?.closed === true ||
      node.attrs?.closed === 'true' ||
      /\sZ\s*$/i.test(d.trim())
    );
  }
  return true;
}

/**
 * Shape stroke panel (描边). Images / text / frames use other chrome — not this control.
 */
export function supportsStroke(node: SceneNodeRef) {
  if (!node) return false;
  if (
    node.key === 'image' ||
    node.key === 'video' ||
    node.key === 'lottie' ||
    node.key === 'audio' ||
    node.key === 'text' ||
    node.key === 'frame' ||
    node.key === 'svg'
  )
    return false;
  if (node.key === 'rect' || node.key === 'ellipse' || node.key === 'path') return true;
  return node.key === 'shape';
}

/**
 * Closed shapes eligible for union / subtract / intersect / exclude.
 * Excludes open strokes and non-shape nodes (image, text, …).
 */
export function supportsBooleanOp(node: SceneNodeRef) {
  if (!node || node.key !== 'shape') return false;
  const t = String(node.attrs?.shapeType || 'rect');
  return !['line', 'arrow', 'pen', 'pencil'].includes(t);
}
