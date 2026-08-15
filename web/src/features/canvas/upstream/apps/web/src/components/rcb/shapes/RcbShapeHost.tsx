/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/shapes/RcbShapeHost.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, useState, type CSSProperties, memo } from 'react';
import { useRcbCamera } from '@recombyn-native/components/rcb/camera/context';
import { rcbCameraCssZoom } from '@recombyn-native/components/rcb/core/math';
import { applyFrameContentClip } from '@recombyn-native/components/rcb/frames/frameContentClip';
import { strokeVisualOutset } from '@recombyn-native/components/rcb/scene/document/sceneEffects';
import {
  createSvgBoard,
  fitInfiniteSvgToContent,
  nodeLeftTop,
  nodeToSvgElement,
  seedInfiniteSvgViewport,
} from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import {
  blendModeToCss,
  parseBlendMode,
  parseLayerOpacity,
} from '@recombyn-native/components/rcb/selection/chrome/BlendModeControl';
import {
  getSceneShapesMount,
  getSceneWorldEpoch,
  getSceneWorldRoot,
  getSharedNodeEls,
  registerShapeHost,
  subscribeShapeHosts,
  syncSharedMountPaintOrder,
  unregisterShapeHost,
  updateShapeHostElement,
} from '@recombyn-native/components/rcb/shapes/shapeHostRegistry';
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';

function hostJumpLog(event: string, data: Record<string, unknown> = {}) {
  const row = { event, t: Math.round(performance.now()), ...data };
  const w = window as Window & {
    __rcbJumpLog?: unknown[];
    __rcbJumpDump?: () => string;
  };
  if (!Array.isArray(w.__rcbJumpLog)) w.__rcbJumpLog = [];
  w.__rcbJumpLog.push(row);
  w.__rcbJumpDump = () => JSON.stringify(w.__rcbJumpLog, null, 2);
  console.info(JSON.stringify(row));
}

type Props = {
  nodeId: string;
  document: SceneDocument;
  /** Paint order among siblings (ROOT.children index). */
  zIndex: number;
  /** Bumps force a full remount / redraw of this host. */
  reloadToken?: number | string;
  /** Keep SVG paint invisible (inline text editor owns the glyphs). */
  forceHidden?: boolean;
};

function setHostPaintOpacity(el: Element | null | undefined, hidden: boolean) {
  if (!el) return;
  const v = hidden ? '0' : '1';
  if (el instanceof HTMLElement || el instanceof SVGElement) {
    el.style.opacity = v;
  }
  el.setAttribute('opacity', v);
  const anyEl = el as any;
  if (typeof anyEl.opacity === 'function') anyEl.opacity(hidden ? 0 : 1);
}

/**
 * One paint host per scene node under the camera world layer.
 * Prefers the shared scene-world SVG (grid + shapes, one raster lattice).
 * Falls back to a private infinite SVG when the world root is not mounted yet.
 */
function RcbShapeHost({
  nodeId,
  document,
  zIndex,
  reloadToken = 0,
  forceHidden = false,
}: Props) {
  const camera = useRcbCamera();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<SVGGElement | null>(null);
  const bootRef = useRef(0);
  const forceHiddenRef = useRef(forceHidden);
  forceHiddenRef.current = forceHidden;
  const [worldEpoch, setWorldEpoch] = useState(() => getSceneWorldEpoch());
  useEffect(
    () =>
      subscribeShapeHosts(() => {
        setWorldEpoch((prev) => {
          const next = getSceneWorldEpoch();
          return prev === next ? prev : next;
        });
      }),
    []
  );
  const node = document?.deltaSetLike?.[nodeId];
  const blendMode = parseBlendMode(node?.attrs?.blendMode, { allowPassThrough: false });
  const layerOpacity = parseLayerOpacity(node?.attrs?.opacity, 1);
  const blendCss = blendModeToCss(blendMode);
  // Remount when stroke/fill paint attrs change — not on every geometry nudge.
  const paintToken = [
    node?.attrs?.hidden,
    node?.attrs?.locked,
    node?.attrs?.strokeAlign,
    node?.attrs?.['stroke-align'],
    node?.attrs?.['border-width'],
    node?.attrs?.strokeWidth,
    node?.attrs?.['border-color'],
    node?.attrs?.stroke,
    node?.attrs?.['stroke-opacity'],
    node?.attrs?.strokeStyle,
    node?.attrs?.strokeLinecap,
    node?.attrs?.['stroke-linecap'],
    node?.attrs?.strokeLinejoin,
    node?.attrs?.['stroke-linejoin'],
    node?.attrs?.['stroke-enabled'],
    node?.attrs?.['stroke-visible'],
    node?.attrs?.['fill-color'],
    node?.attrs?.['fill-type'],
    node?.attrs?.['fill-opacity'],
    node?.attrs?.['fill-enabled'],
    node?.attrs?.['fill-visible'],
    node?.attrs?.['fill-gradient'],
    node?.attrs?.['fill-image-src'],
    node?.attrs?.['fill-image-fit'],
    node?.attrs?.['fill-image-rotate'],
    node?.attrs?.['fill-image-adjust'],
    node?.attrs?.opacity,
    node?.attrs?.blendMode,
    node?.attrs?.brushStampSrc,
    node?.width,
    node?.height,
    node?.attrs?.markdown ?? node?.attrs?.DATA,
    node?.attrs?.fontSize,
    node?.attrs?.fontFamily,
    node?.attrs?.autoSize,
    node?.attrs?.path,
    node?.attrs?.shapeType,
    node?.attrs?.brushStyle,
    node?.attrs?.pathPressure,
    // Empty generator / process hairlines are screen-constant (css/zoom) — remount on zoom.
    String(node?.attrs?.processStatus || '') === 'running' ||
    node?.attrs?.imageGenerator ||
    node?.attrs?.videoGenerator ||
    node?.attrs?.lottieGenerator ||
    node?.attrs?.audioGenerator
      ? rcbCameraCssZoom(camera).toFixed(3)
      : '',
  ].join('|');

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !document) return undefined;

    const seq = ++bootRef.current;
    const n = document.deltaSetLike?.[nodeId];
    let cancelled = false;

    const { root, layer, shared } = createSvgBoard(host, 1, 1, {
      infinite: true,
      sharedRoot: getSceneWorldRoot(),
      sharedMount: getSceneShapesMount(),
    });
    layerRef.current = layer;
    layer.setAttribute('data-rcb-shape-id', nodeId);
    layer.setAttribute('data-z', String(zIndex));
    layer.style.opacity = forceHiddenRef.current ? '0' : String(layerOpacity);
    if (blendCss) layer.style.mixBlendMode = blendCss;
    else layer.style.removeProperty('mix-blend-mode');

    // Private-host seed only — shared world viewport is owned by RcbCanvas.
    let seedBox: { left: number; top: number; width: number; height: number } | null = null;
    if (!shared && n) {
      try {
        const { left, top } = nodeLeftTop(document, n);
        const w = Math.max(1, Number(n.width) || 1);
        const h = Math.max(1, Number(n.height) || 1);
        const outset = Math.max(0, strokeVisualOutset(n));
        seedBox = {
          left: left - outset,
          top: top - outset,
          width: w + outset * 2,
          height: h + outset * 2,
        };
        seedInfiniteSvgViewport(root, seedBox);
        hostJumpLog('host.seed', { nodeId, seed: seedBox, paintToken });
      } catch {
        /* keep 1×1 until fit */
      }
    }
    const nodeEls = getSharedNodeEls() || new Map();
    registerShapeHost({ nodeId, root, layer, el: null, kind: 'svg' });

    async function mountShape() {
      try {
        const el = await nodeToSvgElement(root, layer, document, n, nodeId);
        if (cancelled || bootRef.current !== seq) {
          try {
            el?.remove();
          } catch {
            /* ignore */
          }
          return;
        }
        if (el) {
          el.style.removeProperty('mix-blend-mode');
          el.style.opacity = '1';
          el.setAttribute('opacity', '1');
          if (forceHiddenRef.current) setHostPaintOpacity(el, true);
          applyFrameContentClip(root, el, document, n, { zoom: camera.zoom });
          const sharedMap = getSharedNodeEls();
          if (sharedMap) sharedMap.set(nodeId, el);
          else nodeEls.set(nodeId, el);
          updateShapeHostElement(nodeId, el);
        }
        if (shared) return;
        try {
          const before = {
            left: root.style.left,
            top: root.style.top,
            width: root.style.width,
            height: root.style.height,
            viewBox: root.getAttribute('viewBox'),
          };
          const shapeType = String(n?.attrs?.shapeType || '');
          const unlockFit =
            shapeType === 'pen' ||
            shapeType === 'pencil' ||
            shapeType === 'path' ||
            shapeType === 'line' ||
            shapeType === 'arrow';
          if (unlockFit) root.removeAttribute('data-rcb-viewport-locked');
          fitInfiniteSvgToContent(root, layer);
          const after = {
            left: root.style.left,
            top: root.style.top,
            width: root.style.width,
            height: root.style.height,
            viewBox: root.getAttribute('viewBox'),
          };
          const moved =
            before.left !== after.left ||
            before.top !== after.top ||
            before.width !== after.width ||
            before.height !== after.height;
          if (moved) {
            hostJumpLog('host.fitDelta', { nodeId, seed: seedBox, before, after });
          }
        } catch {
          /* ignore */
        }
      } catch (err) {
        console.error('RcbShapeHost mount failed', nodeId, err);
      }
    }
    mountShape();

    return () => {
      cancelled = true;
      hostJumpLog('host.unmount', { nodeId, paintToken: String(paintToken).slice(0, 120) });
      unregisterShapeHost(nodeId);
      try {
        if (shared) layer.remove();
        else root.remove();
      } catch {
        /* ignore */
      }
      if (!shared) host.innerHTML = '';
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, reloadToken, paintToken, worldEpoch]);

  // Toggle hide without remounting (enter / leave inline text edit).
  useEffect(() => {
    const el =
      getSharedNodeEls()?.get(nodeId) ||
      (hostRef.current?.querySelector?.('[data-scene-node-id]') as Element | null);
    setHostPaintOpacity(el, forceHidden);
    const layer = layerRef.current;
    if (layer) layer.style.opacity = forceHidden ? '0' : String(layerOpacity);
  }, [forceHidden, nodeId, paintToken, reloadToken, layerOpacity]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    if (blendCss) layer.style.mixBlendMode = blendCss;
    else layer.style.removeProperty('mix-blend-mode');
  }, [blendCss, paintToken]);

  // Keep SVG paint order ≈ document z (shapes + artboard plates interleaved).
  useEffect(() => {
    const layer = layerRef.current;
    const mount = getSceneShapesMount();
    if (!layer) return;
    layer.setAttribute('data-z', String(zIndex));
    if (!mount || layer.parentNode !== mount) return;
    syncSharedMountPaintOrder(mount);
  }, [zIndex, paintToken, worldEpoch]);

  return (
    <div
      ref={wrapRef}
      data-rcb-shape={nodeId}
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
      style={{
        zIndex,
        // Shared-world paint lives in the scene SVG; wrap is a React anchor only.
        opacity: getSceneWorldRoot() ? 1 : forceHidden ? 0 : layerOpacity,
        mixBlendMode: (getSceneWorldRoot() ? undefined : blendCss || undefined) as CSSProperties['mixBlendMode'],
      }}
    >
      <div
        ref={hostRef}
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        data-rcb-shape-host={nodeId}
        style={{ width: 0, height: 0, overflow: 'visible' }}
      />
    </div>
  );
}

export default memo(RcbShapeHost);
