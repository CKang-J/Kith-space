/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/paint/svgToScene.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { fillAttrsFromElement } from '../document/sceneFill';
import {
  buildTextAttrs,
  buildTextAttrsPreservingMarkdown,
  measurePlainTextSize,
  measureWrappedTextSize,
  parseNodeText,
  parseNodeTextStyle,
} from '../document/sceneText';
import { markdownToPlain } from '../document/sceneMarkdown';
import {
  getActivePage,
  normalizeDocument,
  syncRootChildren
} from '../document/sceneDocument';
import { isCustomPathShape, scalePathData } from '../document/pathScale';
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';

function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Scene left/top → document node x/y (adds page origin). */
export function sceneToDocumentCoords(document: SceneDocument, left: number, top: number) {
  return {
    x: num(left, 0) + num(document?.x, 0),
    y: num(top, 0) + num(document?.y, 0),
  };
}

export type SvgSceneObject = {
  sceneNodeId: string;
  sceneNodeKey: string;
  sceneShapeType?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  angle?: number;
  opacity?: number;
  flipX?: boolean;
  flipY?: boolean;
  text?: string;
  fontSize?: number;
  fill?: string;
  fontWeight?: string;
  fontFamily?: string;
  fontStyle?: string;
  textAlign?: string;
  lineHeight?: number;
  letterSpacing?: number;
  textDecoration?: string;
  src?: string;
};

function preserveVisualAttrs(prev: any = {}, obj: SvgSceneObject) {
  return {
    opacity: obj.opacity ?? prev.opacity ?? 1,
    angle: obj.angle ?? prev.angle ?? 0,
    flipX: obj.flipX ? 'true' : 'false',
    flipY: obj.flipY ? 'true' : 'false',
    'border-width':
      prev['border-width'] != null && prev['border-width'] !== ''
        ? prev['border-width']
        : 1,
    radiusTL: prev.radiusTL ?? 0,
    radiusTR: prev.radiusTR ?? 0,
    radiusBR: prev.radiusBR ?? 0,
    radiusBL: prev.radiusBL ?? 0,
    radiusLinked: prev.radiusLinked ?? 'true',
    L: prev.L ?? 'true',
    R: prev.R ?? 'true',
    T: prev.T ?? 'true',
    B: prev.B ?? 'true',
  };
}

function paintAttrs(prevAttrs: Record<string, any> = {}) {
  const fill = fillAttrsFromElement(null, prevAttrs);
  return {
    ...fill,
    'border-color':
      prevAttrs['border-color'] != null && prevAttrs['border-color'] !== ''
        ? prevAttrs['border-color']
        : '#333333',
    ...(prevAttrs['stroke-enabled'] != null ? { 'stroke-enabled': prevAttrs['stroke-enabled'] } : {}),
    ...(prevAttrs['stroke-visible'] != null ? { 'stroke-visible': prevAttrs['stroke-visible'] } : {}),
    ...(prevAttrs['stroke-opacity'] != null ? { 'stroke-opacity': prevAttrs['stroke-opacity'] } : {}),
    ...(prevAttrs.strokeStyle != null ? { strokeStyle: prevAttrs.strokeStyle } : {}),
  };
}

export function svgObjectsToScene(document: SceneDocument, objects: SvgSceneObject[]) {
  const next = normalizeDocument(document);
  const rootChildren: string[] = [];

  objects.forEach((obj) => {
    const nodeId = obj.sceneNodeId;
    if (!nodeId) return;
    const key = obj.sceneNodeKey || 'text';
    const prev = document.deltaSetLike?.[nodeId];
    const visual = preserveVisualAttrs(prev?.attrs, obj);
    const { x, y } = sceneToDocumentCoords(document, obj.left, obj.top);

    if (key === 'text') {
      const prevStyle = parseNodeTextStyle(prev?.attrs || {});
      const style = {
        fontSize: obj.fontSize || prevStyle.fontSize || 14,
        fill: obj.fill || prevStyle.fill || '#333333',
        fontWeight: obj.fontWeight || prevStyle.fontWeight || 'normal',
        fontFamily: obj.fontFamily || prevStyle.fontFamily,
        fontStyle: obj.fontStyle || prevStyle.fontStyle || 'normal',
        textAlign: obj.textAlign || prevStyle.textAlign || 'left',
        lineHeight: obj.lineHeight || prevStyle.lineHeight || 1.4,
        letterSpacing: obj.letterSpacing ?? prevStyle.letterSpacing ?? 0,
        textDecoration: obj.textDecoration || prevStyle.textDecoration || 'none',
      };
      const plain = obj.text || '';
      const prevMd = prev?.attrs?.markdown;
      const textAttrs: Record<string, unknown> = { ...buildTextAttrs(plain, style) };
      if (typeof prevMd === 'string' && markdownToPlain(prevMd) === plain) {
        textAttrs.markdown = prevMd;
      } else {
        textAttrs.markdown = plain;
      }
      next.deltaSetLike[nodeId] = {
        id: nodeId,
        key: 'text',
        x,
        y,
        z: 0,
        width: Math.max(obj.width, 1),
        height: Math.max(obj.height, 1),
        attrs: {
          ...textAttrs,
          opacity: visual.opacity,
          angle: visual.angle,
          flipX: visual.flipX,
          flipY: visual.flipY,
        },
        children: [],
      };
    } else if (key === 'rect') {
      next.deltaSetLike[nodeId] = {
        id: nodeId,
        key: 'rect',
        x,
        y,
        z: 0,
        width: Math.max(obj.width, 1),
        height: Math.max(obj.height, 1),
        attrs: {
          ...visual,
          ...paintAttrs({
            ...prev?.attrs,
            'fill-color': prev?.attrs?.['fill-color'] || 'transparent',
          }),
        },
        children: [],
      };
    } else if (key === 'shape') {
      next.deltaSetLike[nodeId] = {
        id: nodeId,
        key: 'shape',
        x,
        y,
        z: 0,
        width: Math.max(obj.width, 1),
        height: Math.max(obj.height, 1),
        attrs: {
          ...visual,
          shapeType: obj.sceneShapeType || prev?.attrs?.shapeType || 'rect',
          ...paintAttrs({
            ...prev?.attrs,
            'fill-color': prev?.attrs?.['fill-color'] || '#FFFFFF',
          }),
          ...(prev?.attrs?.path ? { path: prev.attrs.path } : {}),
          ...(prev?.attrs?.closed != null ? { closed: prev.attrs.closed } : {}),
          ...(prev?.attrs?.sides != null ? { sides: prev.attrs.sides } : {}),
          ...(prev?.attrs?.brushStyle != null ? { brushStyle: prev.attrs.brushStyle } : {}),
          ...(prev?.attrs?.brushStampSrc != null
            ? { brushStampSrc: prev.attrs.brushStampSrc }
            : {}),
        },
        children: [],
      };
    } else if (key === 'image') {
      next.deltaSetLike[nodeId] = {
        id: nodeId,
        key: 'image',
        x,
        y,
        z: 0,
        width: Math.max(obj.width, 1),
        height: Math.max(obj.height, 1),
        attrs: {
          src: obj.src || prev?.attrs?.src || '',
          mode: prev?.attrs?.mode || 'FIT',
          opacity: visual.opacity,
          angle: visual.angle,
          flipX: visual.flipX,
          flipY: visual.flipY,
        },
        children: [],
      };
    }

    rootChildren.push(nodeId);
  });

  next.deltaSetLike.ROOT.children = rootChildren;
  const page = getActivePage(next);
  if (page) page.children = [...rootChildren];
  return syncRootChildren(next);
}

export type TextResizeMode = 'scale' | 'wrap';

export type PatchGeometryOptions = {
  /** Remasure text height so chrome hugs ink (keep wrap width). */
  fitTextBox?: boolean;
  /**
   * text resize:
   * - `scale`: corner handles — scale font with box
   * - `wrap`: left/right edges — change width only, remasure height (no font scale)
   */
  textResizeMode?: TextResizeMode;
};

/** Infer text resize mode when callers omit it (width-only → wrap). */
function inferTextResizeMode(
  oldW: number,
  oldH: number,
  newW: number,
  newH: number,
  explicit?: TextResizeMode
): TextResizeMode {
  if (explicit) return explicit;
  const dw = Math.abs(newW - oldW);
  const dh = Math.abs(newH - oldH);
  if (dw > 0.5 && dh <= 0.5) return 'wrap';
  return 'scale';
}

/** Patch a single node's geometry from selection chrome — document. */
export function patchNodeGeometry(
  document: SceneDocument,
  nodeId: string,
  geometry: { left: number; top: number; width: number; height: number },
  options?: PatchGeometryOptions
) {
  const next = normalizeDocument(document);
  const node = next.deltaSetLike?.[nodeId];
  if (!node) return next;
  const { x, y } = sceneToDocumentCoords(next, geometry.left, geometry.top);
  const oldW = Math.max(1, Number(node.width) || 1);
  const oldH = Math.max(1, Number(node.height) || 1);
  // Keep subpixel geometry. Integer rounding breaks flush visual snaps when stroke
  // outset is *.5 (odd border-width) — invisible at 100%, obvious at 300–800%.
  const quantize = (n: number) => Math.round(n * 1000) / 1000;
  let newW = Math.max(1, quantize(geometry.width));
  let newH = Math.max(1, quantize(geometry.height));
  const ix = quantize(x);
  const iy = quantize(y);

  let attrs = node.attrs;
  const shapeType = String(node.attrs?.shapeType || '');
  const pathD = node.attrs?.path != null ? String(node.attrs.path) : '';
  if (
    isCustomPathShape(shapeType) &&
    pathD &&
    (Math.abs(newW - oldW) > 0.5 || Math.abs(newH - oldH) > 0.5)
  ) {
    attrs = {
      ...node.attrs,
      path: scalePathData(pathD, newW / oldW, newH / oldH),
    };
  }

  // Text: corners scale type; L/R edges set wrap width only.
  if (
    node.key === 'text' &&
    (Math.abs(newW - oldW) > 0.5 || Math.abs(newH - oldH) > 0.5)
  ) {
    let style = parseNodeTextStyle(attrs || node.attrs || {});
    const mode = inferTextResizeMode(oldW, oldH, newW, newH, options?.textResizeMode);

    if (mode === 'scale') {
      const sx = newW / oldW;
      const sy = newH / oldH;
      // Prefer uniform scale when aspect-locked (sx ≈ sy); else follow height.
      const s = Math.abs(sx - sy) < 0.02 ? sx : sy;
      if (Math.abs(s - 1) > 1e-4) {
        const nextSize = Math.max(1, Math.round(style.fontSize * s * 100) / 100);
        const nextSpacing = Math.round(style.letterSpacing * s * 1000) / 1000;
        style = { ...style, fontSize: nextSize, letterSpacing: nextSpacing };
        attrs = {
          ...(attrs || node.attrs),
          ...buildTextAttrsPreservingMarkdown(node.attrs || {}, {
            fontSize: nextSize,
            letterSpacing: nextSpacing,
          }),
        };
      }
    }

    // Hug ink height; never shrink wrap width back to content (that broke edge resize).
    if (options?.fitTextBox || mode === 'wrap') {
      const plain = parseNodeText(attrs || node.attrs || {}) || ' ';
      const prevAuto =
        String((attrs || node.attrs || {}).autoSize ?? 'true') !== 'false';
      // only L/R wrap resize turns off autoSize — not corner scale / fit.
      if (mode === 'wrap') {
        const measured = measureWrappedTextSize(plain, style, Math.max(24, newW));
        newW = Math.max(1, Math.round(measured.width));
        newH = Math.max(1, Math.round(measured.height));
        attrs = {
          ...(attrs || node.attrs),
          autoSize: 'false',
        };
      } else if (prevAuto) {
        const measured = measurePlainTextSize(plain, style);
        newW = Math.max(1, Math.round(measured.width));
        newH = Math.max(1, Math.round(measured.height));
      } else {
        const measured = measureWrappedTextSize(plain, style, Math.max(24, newW));
        newW = Math.max(1, Math.round(measured.width));
        newH = Math.max(1, Math.round(measured.height));
      }
    }
  }

  next.deltaSetLike[nodeId] = {
    ...node,
    attrs,
    x: ix,
    y: iy,
    width: newW,
    height: newH,
  };
  return next;
}

/** Move/resize multiple nodes. Each entry is scene-local left/top/size. */
export function patchNodesGeometry(
  document: SceneDocument,
  patches: Array<{ nodeId: string; left: number; top: number; width: number; height: number }>,
  options?: PatchGeometryOptions
) {
  let next = normalizeDocument(document);
  patches.forEach((p) => {
    next = patchNodeGeometry(next, p.nodeId, p, options);
  });
  return next;
}
