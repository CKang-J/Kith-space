/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/shapes/RcbShapesLayer.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { useRcbCamera, useRcbCameraMotion, useRcbViewportEl } from '../camera/context';
import { rcbViewportSceneBounds } from '../core/math';
import {
  RcbSpatialIndex,
  boxesIntersect,
  buildIdRankMap,
  nodeSceneAabb,
  sortIdsByRank,
} from '../core/spatialIndex';
import {
  isNodeHidden
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import {
  stackZIndex
} from '@recombyn-native/components/rcb/scene/document/sceneDocument';
import { nodeLeftTop, sceneSurfaceSvgProps } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import { HEAVY_PATH_D_CHARS } from '@recombyn-native/components/rcb/scene/document/sceneShapes';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';
import { parseSimplePathPoints } from '@recombyn-native/components/rcb/tools/pencilBrushes';
import RcbShapeHost from './RcbShapeHost';

type Props = {
  document: SceneDocument;
  reloadToken?: number | string;
  /** Bumps paint for nodes touched by the latest document patch. */
  documentPatchToken?: number;
  lastPatchedNodeIds?: string[];
  /** Hide this node's SVG paint (e.g. while inline text editor is open). */
  hiddenNodeId?: string | null;
  /** Never cull these (selection / inline editors) even if off-screen. */
  keepVisibleIds?: readonly string[];
  /** Must stay as full SVG hosts (inline editors only — selection stays LOD). */
  forceFullIds?: readonly string[];
  /** Shared scene index from SvgCanvas — drives viewport visible set. */
  spatialIndex?: RcbSpatialIndex | null;
};

const EMPTY_KEEP: readonly string[] = [];
const EMPTY_FORCE_FULL: readonly string[] = [];
const EMPTY_FORCE_FULL_SET = new Set<string>();

/** Screen-px margin so shapes entering the view aren't blank for a frame. */
const CULL_PAD_SCREEN_PX = 96;

/** Above this count, use stepped zoom while the camera is moving. */
const EFFICIENT_ZOOM_SHAPE_THRESHOLD = 80;

/** Prefer index.search over O(N) AABB walk once the scene is this large. */
const INDEX_CULL_THRESHOLD = 64;

/** Cap full SVG hosts; overflow paints as shared-SVG AABB proxies. */
const MAX_FULL_HOSTS = 96;

/**
 * Hard cap on LOD proxy paint. Canvas2D batches handle denser zoom-out than
 * per-rect SVG DOM — keep a ceiling for fill cost on huge viewports.
 */
const MAX_PROXY_PAINT = 4096;

/** Below this zoom, prefer proxies for most on-screen nodes. */
const LOD_ZOOM_FAR = 0.2;

/** Cap centerline samples when stroking a dense pencil path as LOD ink. */
const LOD_STROKE_MAX_PTS = 64;

function isTransparentPaint(v: unknown): boolean {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return !s || s === 'none' || s === 'transparent' || s === 'rgba(0,0,0,0)';
}

/** Draw a minimal image-placeholder icon (mountain + sun) into ctx at (0,0) w×h. */
function drawImageProxyIcon(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opacity: number
): void {
  const s = Math.min(w, h) * 0.28;
  if (s < 3) return;
  const cx = w / 2;
  const cy = h / 2;
  ctx.save();
  ctx.globalAlpha = opacity * 0.55;
  // Background fill
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(0, 0, w, h);
  // Border
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = Math.max(0.5, Math.min(1.5, s * 0.06));
  ctx.strokeRect(0, 0, w, h);
  // Sun circle
  const sunR = s * 0.18;
  ctx.fillStyle = '#94a3b8';
  ctx.beginPath();
  ctx.arc(cx - s * 0.28, cy - s * 0.22, sunR, 0, Math.PI * 2);
  ctx.fill();
  // Mountain triangle
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.5, cy + s * 0.35);
  ctx.lineTo(cx, cy - s * 0.2);
  ctx.lineTo(cx + s * 0.5, cy + s * 0.35);
  ctx.closePath();
  ctx.fill();
  // Small right hill
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.1, cy + s * 0.35);
  ctx.lineTo(cx + s * 0.45, cy + s * 0.05);
  ctx.lineTo(cx + s * 0.8, cy + s * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Text proxy: greeking lines at (0,0) w×h — no solid AABB. */
function drawTextProxyLines(
  ctx: CanvasRenderingContext2D,
  node: SceneNodeInput,
  w: number,
  h: number,
  fill: string,
  opacity: number
): void {
  const fontSize = Math.max(6, Number(node.attrs?.fontSize) || 14);
  const lineH = fontSize * (Number(node.attrs?.lineHeight) || 1.4);
  const lineCount = Math.max(1, Math.round(h / lineH));
  const barH = Math.max(1, Math.min(fontSize * 0.55, lineH * 0.55));
  const lastLineW = w * (0.35 + 0.4 * Math.abs(Math.sin(w * 0.05)));
  ctx.fillStyle = fill;
  for (let li = 0; li < lineCount; li++) {
    const barW = li === lineCount - 1 && lineCount > 1 ? lastLineW : w;
    ctx.globalAlpha = opacity * 0.72;
    ctx.fillRect(0, li * lineH + (lineH - barH) / 2, barW, barH);
  }
}

/** Pencil / open strokes must never become solid AABB 色块 at far zoom. */
export function lodProxyIsStrokeOnly(node: SceneNodeInput): boolean {
  const a = node?.attrs || {};
  const t = String(a.shapeType || '');
  if (t === 'pencil' || t === 'pen' || t === 'line' || t === 'arrow') return true;
  if (t === 'path' || String(node?.key || '') === 'path') {
    return isTransparentPaint(a['fill-color'] ?? a.fill);
  }
  return false;
}

function nodeProxyFill(node: SceneNodeInput): string {
  const a = node?.attrs || {};
  for (const k of ['fill-color', 'fill', 'color', 'border-color', 'stroke'] as const) {
    const v = a[k];
    if (typeof v === 'string' && v && v !== 'none' && v !== 'transparent') return v;
  }
  return '#94a3b8';
}

function nodeProxyStrokeWidth(node: SceneNodeInput, zoom: number): number {
  const a = node?.attrs || {};
  const raw = Number(a['stroke-width'] ?? a.strokeWidth ?? a.borderWidth ?? 2);
  const w = Number.isFinite(raw) && raw > 0 ? raw : 2;
  // Keep far-zoom ink visible but thin — avoid fat AABB slabs.
  return Math.max(0.75, Math.min(6, w * Math.max(0.35, zoom || 1)));
}

/**
 * Subsample path centerline into ctx stroke. Returns false if path unusable
 * (caller may skip rather than fillRect a scribble AABB).
 */
function strokeLodCenterline(
  ctx: CanvasRenderingContext2D,
  d: string,
  maxPts = LOD_STROKE_MAX_PTS
): boolean {
  const trimmed = String(d || '').trim();
  if (!trimmed) return false;
  // Dense freehand: subsample centerline (avoid parsing megabyte paths every frame).
  const pts = parseSimplePathPoints(trimmed);
  if (pts.length < 2) return false;
  const step = Math.max(1, Math.ceil(pts.length / maxPts));
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    if (!p) continue;
    if (!started) {
      ctx.moveTo(p.x, p.y);
      started = true;
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  const last = pts[pts.length - 1];
  if (last && started) ctx.lineTo(last.x, last.y);
  ctx.stroke();
  return started;
}

function isHeavyPathNode(node: SceneNodeInput): boolean {
  const d = String(node?.attrs?.path || node?.attrs?.d || '');
  return d.length >= HEAVY_PATH_D_CHARS;
}

function screenAreaPx(node: SceneNodeInput, zoom: number): number {
  const w = Math.max(1, Number(node?.width) || 1);
  const h = Math.max(1, Number(node?.height) || 1);
  const z = Math.max(0.05, zoom || 1);
  return w * h * z * z;
}

function hostBudget(opts: {
  zoom: number;
  moving: boolean;
  visibleCount: number;
}): number {
  const { zoom, moving, visibleCount } = opts;
  const far = zoom < LOD_ZOOM_FAR;
  // Far zoom: prefer Canvas2D stroke/fill proxies over many SVG hosts.
  if (far) return Math.min(MAX_FULL_HOSTS, 24);
  if (moving && visibleCount >= EFFICIENT_ZOOM_SHAPE_THRESHOLD) {
    return Math.min(MAX_FULL_HOSTS, 56);
  }
  return MAX_FULL_HOSTS;
}

function trimProxyIds(opts: {
  document: SceneDocument;
  proxyIds: string[];
  zoom: number;
  maxProxies: number;
}): string[] {
  const { document, proxyIds, zoom, maxProxies } = opts;
  if (proxyIds.length <= maxProxies) return proxyIds;
  const scored = proxyIds.map((id) => ({
    id,
    score: screenAreaPx(document?.deltaSetLike?.[id], zoom),
  }));
  scored.sort((a, b) => b.score - a.score);
  const keep = new Set(scored.slice(0, maxProxies).map((s) => s.id));
  // Preserve document z-order among survivors.
  return proxyIds.filter((id) => keep.has(id));
}

/**
 * Split visible ids into full SVG hosts vs shared-SVG LOD proxies.
 * Selection / editing always get a real host; heavy paths demoted when far.
 * Proxy count is capped for 100k-scale zoom-out (imperative paint still).
 * Exported for unit tests.
 */
export function pickFullAndProxyIds(opts: {
  document: SceneDocument;
  visibleIds: string[];
  keepSet: Set<string>;
  /** Only these force full SVG (e.g. text/pen editors). Selection uses keepSet for cull only. */
  forceFullSet?: Set<string>;
  zoom: number;
  moving: boolean;
  maxProxies?: number;
}): { fullIds: string[]; proxyIds: string[] } {
  const { document, visibleIds, zoom, moving } = opts;
  const forceFullSet = opts.forceFullSet ?? EMPTY_FORCE_FULL_SET;
  const maxProxies = opts.maxProxies ?? MAX_PROXY_PAINT;
  const budget = hostBudget({ zoom, moving, visibleCount: visibleIds.length });
  const far = zoom < LOD_ZOOM_FAR;
  const forceLod =
    far || (moving && visibleIds.length >= EFFICIENT_ZOOM_SHAPE_THRESHOLD);

  if (visibleIds.length <= budget && !forceLod) {
    return { fullIds: visibleIds, proxyIds: [] };
  }

  const scored: Array<{ id: string; score: number; force: boolean }> = [];
  for (const id of visibleIds) {
    const node = document?.deltaSetLike?.[id];
    // Selection must not promote proxy → full while LOD is active.
    const force = forceFullSet.has(id);
    let score = screenAreaPx(node, zoom);
    if (isHeavyPathNode(node) && forceLod) score *= 0.05;
    // Far zoom: demote media-heavy nodes (image/video/lottie/text) so cheap shapes
    // stay as full SVG hosts and expensive ones drop to canvas proxy.
    if (far && !force) {
      const key = String(node?.key || '');
      if (key === 'image' || key === 'video' || key === 'lottie' || key === 'text') {
        score *= 0.08;
      }
    }
    scored.push({ id, score, force });
  }
  scored.sort((a, b) => {
    if (a.force !== b.force) return a.force ? -1 : 1;
    return b.score - a.score;
  });

  const fullSet = new Set<string>();
  for (const s of scored) {
    if (s.force || fullSet.size < budget) fullSet.add(s.id);
  }
  // Preserve document z-order for both lists.
  const fullIds = visibleIds.filter((id) => fullSet.has(id));
  const proxyRaw = visibleIds.filter((id) => !fullSet.has(id));
  const proxyIds = trimProxyIds({
    document,
    proxyIds: proxyRaw,
    zoom,
    maxProxies,
  });
  return { fullIds, proxyIds };
}

/**
 * Far zoom / dense views: one Canvas2D LOD batch — stroke centerlines for
 * pencil/pen/path, AABB fill only for true filled shapes (no scribble 色块).
 * z-index comes from document order among proxyIds.
 */
function paintLodProxiesCanvas(opts: {
  canvas: HTMLCanvasElement;
  document: SceneDocument;
  proxyIds: string[];
  hiddenNodeId: string | null;
  view: { minX: number; minY: number; w: number; h: number };
  zoom: number;
}) {
  const { canvas, document: sceneDoc, proxyIds, hiddenNodeId, view, zoom } = opts;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
  const cssW = Math.max(1, view.w);
  const cssH = Math.max(1, view.h);
  const bw = Math.max(1, Math.ceil(cssW * dpr));
  const bh = Math.max(1, Math.ceil(cssH * dpr));
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.save();
  ctx.translate(-view.minX, -view.minY);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const id of proxyIds) {
    const node = sceneDoc?.deltaSetLike?.[id];
    if (!node || isNodeHidden(node) || hiddenNodeId === id) continue;
    const { left, top } = nodeLeftTop(sceneDoc, node);
    const w = Math.max(1, Number(node.width) || 1);
    const h = Math.max(1, Number(node.height) || 1);
    const angle = Number(node.attrs?.angle) || 0;
    const fill = nodeProxyFill(node);
    const opacity = Math.min(1, Math.max(0.15, Number(node.attrs?.opacity) || 1));
    const strokeOnly = lodProxyIsStrokeOnly(node);
    const pathD = String(node.attrs?.path || node.attrs?.d || '');
    ctx.save();
    ctx.globalAlpha = opacity;
    const isMedia = node.key === 'image' || node.key === 'video' || node.key === 'lottie';
    if (Math.abs(angle) > 0.5) {
      const cx = left + w / 2;
      const cy = top + h / 2;
      ctx.translate(cx, cy);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.translate(-w / 2, -h / 2);
      if (strokeOnly) {
        ctx.strokeStyle = fill;
        ctx.lineWidth = nodeProxyStrokeWidth(node, zoom);
        if (!strokeLodCenterline(ctx, pathD)) {
          ctx.beginPath();
          ctx.moveTo(0, h / 2);
          ctx.lineTo(w, h / 2);
          ctx.stroke();
        }
      } else if (node.key === 'text') {
        drawTextProxyLines(ctx, node, w, h, fill, opacity);
      } else if (isMedia) {
        drawImageProxyIcon(ctx, w, h, opacity);
      } else {
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, w, h);
      }
    } else if (strokeOnly) {
      ctx.translate(left, top);
      ctx.strokeStyle = fill;
      ctx.lineWidth = nodeProxyStrokeWidth(node, zoom);
      if (!strokeLodCenterline(ctx, pathD)) {
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
      }
    } else if (node.key === 'text') {
      ctx.save();
      ctx.translate(left, top);
      drawTextProxyLines(ctx, node, w, h, fill, opacity);
      ctx.restore();
    } else if (isMedia) {
      ctx.save();
      ctx.translate(left, top);
      drawImageProxyIcon(ctx, w, h, opacity);
      ctx.restore();
    } else {
      ctx.fillStyle = fill;
      ctx.fillRect(left, top, w, h);
    }
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Renders each ROOT child as its own SVG shape host (sharp under CSS camera zoom).
 * Canvas Path2D is only used by selection indicators / draw-tool overlays.
 * Off-viewport nodes are not mounted (lazy paint); selection/editing stay culled-alive.
 * Far zoom / dense views: one Canvas2D LOD batch (stroke for pencil; AABB for fills).
 * Selection does not promote proxies back to full SVG — only inline editors do.
 * z-index comes from document.stackOrder so shapes can interleave with artboards.
 */
function RcbShapesLayer({
  document,
  reloadToken = 0,
  documentPatchToken = 0,
  lastPatchedNodeIds = [],
  hiddenNodeId = null,
  keepVisibleIds = EMPTY_KEEP,
  forceFullIds = EMPTY_FORCE_FULL,
  spatialIndex = null,
}: Props) {
  const camera = useRcbCamera();
  const { moving, efficientZoom } = useRcbCameraMotion();
  const viewportEl = useRcbViewportEl();
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  /** Coalesce pan/zoom cull to one update per frame. */
  const [cullCam, setCullCam] = useState({ x: camera.x, y: camera.y, zoom: camera.zoom });
  const lodCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!viewportEl) return undefined;
    const measure = () => {
      const r = viewportEl.getBoundingClientRect();
      setStageSize({
        width: Math.max(0, r.width),
        height: Math.max(0, r.height),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(viewportEl);
    return () => ro.disconnect();
  }, [viewportEl]);

  const ids = useMemo(() => {
    const children = document?.deltaSetLike?.ROOT?.children;
    return Array.isArray(children) ? (children as string[]) : [];
  }, [document]);

  const idRank = useMemo(() => buildIdRankMap(ids), [ids]);

  const zoomForCull =
    moving && ids.length >= EFFICIENT_ZOOM_SHAPE_THRESHOLD ? efficientZoom : camera.zoom;

  useEffect(() => {
    let raf = 0;
    raf = requestAnimationFrame(() => {
      setCullCam({ x: camera.x, y: camera.y, zoom: zoomForCull });
    });
    return () => cancelAnimationFrame(raf);
  }, [camera.x, camera.y, zoomForCull]);

  const keepSet = useMemo(
    () => new Set(keepVisibleIds.filter(Boolean)),
    [keepVisibleIds]
  );
  const forceFullSet = useMemo(
    () => new Set(forceFullIds.filter(Boolean)),
    [forceFullIds]
  );

  /** Mount only in-view (+ keep) ids — never `ids.filter` over 100k after spatial hits. */
  const visibleIds = useMemo(() => {
    if (!document || !ids.length || stageSize.width < 1 || stageSize.height < 1) {
      return ids;
    }
    const vp = rcbViewportSceneBounds(cullCam, stageSize);
    const pad = CULL_PAD_SCREEN_PX / Math.max(0.05, cullCam.zoom || 1);
    const view = {
      minX: vp.x - pad,
      minY: vp.y - pad,
      maxX: vp.x + vp.width + pad,
      maxY: vp.y + vp.height + pad,
    };

    if (ids.length >= INDEX_CULL_THRESHOLD && spatialIndex && spatialIndex.size > 0) {
      const hits = spatialIndex.search(view.minX, view.minY, view.maxX, view.maxY);
      const vis = new Set(hits.map((h) => h.id));
      for (const id of keepSet) vis.add(id);
      return sortIdsByRank(vis, idRank, { ascending: true });
    }

    const out: string[] = [];
    for (const id of ids) {
      if (keepSet.has(id)) {
        out.push(id);
        continue;
      }
      const box = nodeSceneAabb(document, id, 8);
      if (!box) continue;
      if (boxesIntersect(box, view)) out.push(id);
    }
    return out;
  }, [
    document,
    ids,
    idRank,
    stageSize.width,
    stageSize.height,
    cullCam.x,
    cullCam.y,
    cullCam.zoom,
    keepSet,
    spatialIndex,
    documentPatchToken,
  ]);

  const { fullIds, proxyIds } = useMemo(
    () =>
      pickFullAndProxyIds({
        document,
        visibleIds,
        keepSet,
        forceFullSet,
        zoom: cullCam.zoom || 1,
        moving,
      }),
    [document, visibleIds, keepSet, forceFullSet, cullCam.zoom, moving]
  );

  const patched = useMemo(() => new Set(lastPatchedNodeIds.filter(Boolean)), [lastPatchedNodeIds]);

  /** Fitted viewBox for LOD proxies — same CSS box + viewBox as shape hosts. */
  const lodViewport = useMemo(() => {
    if (!proxyIds.length || !document) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of proxyIds) {
      const node = document.deltaSetLike?.[id];
      if (!node || isNodeHidden(node) || hiddenNodeId === id) continue;
      const { left, top } = nodeLeftTop(document, node);
      const w = Math.max(1, Number(node.width) || 1);
      const h = Math.max(1, Number(node.height) || 1);
      const angle = Number(node.attrs?.angle) || 0;
      const rad = (angle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const cx = left + w / 2;
      const cy = top + h / 2;
      for (const [lx, ly] of [
        [left, top],
        [left + w, top],
        [left + w, top + h],
        [left, top + h],
      ] as const) {
        const dx = lx - cx;
        const dy = ly - cy;
        const x = cx + dx * cos - dy * sin;
        const y = cy + dx * sin + dy * cos;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
    const pad = 2;
    const raw = {
      left: minX - pad,
      top: minY - pad,
      width: Math.max(1, maxX - minX + pad * 2),
      height: Math.max(1, maxY - minY + pad * 2),
    };
    const s = sceneSurfaceSvgProps(raw, camera);
    return { minX: s.style.left, minY: s.style.top, w: s.width, h: s.height };
  }, [document, proxyIds, hiddenNodeId, camera.x, camera.y, camera.zoom]);

  useEffect(() => {
    const canvas = lodCanvasRef.current;
    if (!canvas || !document || !proxyIds.length || !lodViewport) return;
    paintLodProxiesCanvas({
      canvas,
      document,
      proxyIds,
      hiddenNodeId,
      view: lodViewport,
      zoom: camera.zoom,
    });
  }, [document, proxyIds, hiddenNodeId, lodViewport, camera.zoom]);

  if (!document || !visibleIds.length) return null;

  return (
    <div
      data-rcb-shapes-layer="1"
      data-rcb-visible-count={visibleIds.length}
      data-rcb-full-host-count={fullIds.length}
      data-rcb-proxy-count={proxyIds.length}
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
    >
      {lodViewport ? (
        <canvas
          ref={lodCanvasRef}
          data-rcb-lod-layer="1"
          data-rcb-infinite="1"
          className="pointer-events-none absolute"
          style={{
            left: lodViewport.minX,
            top: lodViewport.minY,
            width: lodViewport.w,
            height: lodViewport.h,
            display: 'block',
          }}
          aria-hidden
        />
      ) : null}
      {fullIds.map((id) => {
        const node = document?.deltaSetLike?.[id];
        // Layer hide (`attrs.hidden`) + inline-edit hide share the same paint gate.
        const layerHidden = isNodeHidden(node);
        return (
          <RcbShapeHost
            key={id}
            nodeId={id}
            document={document}
            zIndex={stackZIndex(document, 'node', id)}
            reloadToken={patched.has(id) ? `${reloadToken}:${documentPatchToken}` : reloadToken}
            forceHidden={hiddenNodeId === id || layerHidden}
          />
        );
      })}
    </div>
  );
}

export default memo(RcbShapesLayer);
