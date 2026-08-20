/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/chrome/CornerRadiusHandlesOverlay.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Shape handles — corner radius.
 * Pointer engine stays in SelectionFeature; this paints world-SVG knobs only.
 *
 * Paint shell mirrors the shape-host SVG (same as HostPathChrome sel knobs) so
 * zoom / fractional DPR cannot desync dots from the blue control box.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  hostChromeBodyTransform,
  hostMirrorSvgProps,
  previewSvgNodeCornerRadii,
  sceneSurfaceSvgProps,
} from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import { useRcbCamera } from '@recombyn-native/components/rcb/camera/context';
import {
  clampCornerRadii,
  cornerRadiusDisplayFromRadii,
  cornerVertexCount,
  isRadiusLinked,
  radiiFromAttrs,
  serializeRadiusVertices,
  setLiveCornerRadiusPreview,
  sharpCornerSitesForNode,
  parseRadiusVertices,
  vertexRadiiFromAttrs,
  type CornerKey,
  type CornerRadii,
  type SharpCornerSite,
} from '@recombyn-native/components/rcb/scene/document/sceneRadii';
import { patchDocumentNode } from '@recombyn-native/store/modules/editor';
import {
  getShapeHost,
  getSharedNodeEls,
  notifyShapeHostGeometry,
  subscribeShapeHosts,
} from '@recombyn-native/components/rcb/shapes/shapeHostRegistry';
import type { SceneBox } from '../alignGuides';
import {
  CHROME_HANDLE_VIS_PX,
  CHROME_RADIUS_HIT_PX,
  CHROME_STROKE_PX,
  chromeHitScaleForBox,
  radiusHandleParkScreenPx,
  radiusHandlesFitOnScreen,
  radiusParkSceneForBox,
  WorldScreenBadge,
} from '../SelectionChrome';

/** Soft-click threshold (screen px²) — match SelectionFeature. */
const DRAG_DISTANCE_SQUARED = 16;

/** Ideal park when the box is large enough on screen (icon-centered hits). */
const RADIUS_PARK_PX = radiusHandleParkScreenPx();

function liveNodeEl(nodeId: string): Element | null {
  return (
    (getSharedNodeEls()?.get(nodeId) as Element | undefined) ||
    (getShapeHost(nodeId)?.el as Element | null | undefined) ||
    null
  );
}

/**
 * Twin the shape-host SVG viewport.
 * Local children: host-local box; sceneChildren: absolute scene (badges).
 */
function HostMirroredKnobSvg({
  nodeId,
  box,
  angle,
  localChildren,
  sceneChildren,
}: {
  nodeId: string;
  box: SceneBox;
  angle: number;
  localChildren: ReactNode;
  sceneChildren?: ReactNode;
}) {
  const camera = useRcbCamera();
  const [hostEpoch, setHostEpoch] = useState(0);
  useEffect(() => subscribeShapeHosts(() => setHostEpoch((n) => n + 1)), []);

  const host = getShapeHost(nodeId);
  const hostRoot = host?.root as SVGSVGElement | null | undefined;
  const el = (host?.el || getSharedNodeEls()?.get(nodeId)) as SVGElement | null | undefined;
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const pad = 32;
  void hostEpoch;

  const mirror = hostRoot ? hostMirrorSvgProps(hostRoot) : null;
  const mirrored = Boolean(mirror);
  const bodyTransform = hostChromeBodyTransform(el, box, angle, mirrored);

  if (mirror) {
    return (
      <svg
        data-rcb-infinite="1"
        className="absolute z-[16] overflow-visible"
        preserveAspectRatio="none"
        viewBox={mirror.viewBox}
        width={mirror.width}
        height={mirror.height}
        style={{
          ...mirror.style,
          pointerEvents: 'none',
        }}
        aria-hidden
      >
        <g transform={bodyTransform} style={{ pointerEvents: 'none' }}>
          {localChildren}
        </g>
        {sceneChildren}
      </svg>
    );
  }

  const surf = sceneSurfaceSvgProps(
    {
      left: box.left - pad,
      top: box.top - pad,
      width: w + pad * 2,
      height: h + pad * 2,
    },
    camera
  );

  return (
    <svg
      data-rcb-infinite="1"
      className="absolute z-[16] overflow-visible"
      preserveAspectRatio="none"
      width={surf.width}
      height={surf.height}
      viewBox={surf.viewBox}
      style={{
        ...surf.style,
        pointerEvents: 'none',
      }}
      aria-hidden
    >
      <g transform={bodyTransform} style={{ pointerEvents: 'none' }}>
        {localChildren}
      </g>
      {sceneChildren}
    </svg>
  );
}

const RADIUS_CORNERS: Array<{
  key: CornerKey;
  /** Inward unit in local box space. */
  ix: number;
  iy: number;
  cx: 0 | 1;
  cy: 0 | 1;
}> = [
  { key: 'tl', ix: 1, iy: 1, cx: 0, cy: 0 },
  { key: 'tr', ix: -1, iy: 1, cx: 1, cy: 0 },
  { key: 'br', ix: -1, iy: -1, cx: 1, cy: 1 },
  { key: 'bl', ix: 1, iy: -1, cx: 0, cy: 1 },
];

function scenePointToLocal(
  sceneX: number,
  sceneY: number,
  box: SceneBox,
  angleDeg: number
): { x: number; y: number } {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const dx = sceneX - cx;
  const dy = sceneY - cy;
  if (Math.abs(angleDeg) < 0.001) {
    return { x: dx + box.width / 2, y: dy + box.height / 2 };
  }
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: dx * cos - dy * sin + box.width / 2,
    y: dx * sin + dy * cos + box.height / 2,
  };
}

function localPointToScene(
  lx: number,
  ly: number,
  box: SceneBox,
  angleDeg: number
): { x: number; y: number } {
  const cx = box.width / 2;
  const cy = box.height / 2;
  const dx = lx - cx;
  const dy = ly - cy;
  if (Math.abs(angleDeg) < 0.001) {
    return { x: box.left + lx, y: box.top + ly };
  }
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: box.left + cx + dx * cos - dy * sin,
    y: box.top + cy + dx * sin + dy * cos,
  };
}

function maxRForPathSite(site: SharpCornerSite, boxMaxR: number): number {
  return Math.min(boxMaxR, site.maxR > 0 ? site.maxR : boxMaxR);
}

function radiusAlongBoxCorner(
  corner: (typeof RADIUS_CORNERS)[number],
  local: { x: number; y: number },
  w: number,
  h: number,
  boxMaxR: number
): number {
  const cornerLx = corner.cx * w;
  const cornerLy = corner.cy * h;
  const len = Math.hypot(corner.ix, corner.iy) || 1;
  // Bisector projection; seat at (R,R) ⇒ along = R√2, so R = along/√2.
  const along =
    (local.x - cornerLx) * (corner.ix / len) + (local.y - cornerLy) * (corner.iy / len);
  return Math.max(0, Math.min(boxMaxR, along / Math.SQRT2));
}

function radiusAlongPathSite(
  site: SharpCornerSite,
  local: { x: number; y: number },
  boxMaxR: number
): number {
  const along = (local.x - site.x) * site.ix + (local.y - site.y) * site.iy;
  return Math.max(0, Math.min(maxRForPathSite(site, boxMaxR), along));
}

function previewRadiiOnHost(opts: {
  nodeId: string;
  node: SceneNodeInput;
  linked: boolean;
  w: number;
  h: number;
  radii: CornerRadii;
  vertices?: number[];
}) {
  const { nodeId, node, linked, w, h, radii, vertices } = opts;
  const hostEl = liveNodeEl(nodeId);
  if (!hostEl) return;
  const map = getSharedNodeEls() || new Map<string, any>([[nodeId, hostEl]]);
  if (!map.has(nodeId)) map.set(nodeId, hostEl);
  const shapeType = String(
    node?.attrs?.shapeType || (node?.key === 'path' ? 'path' : node?.key) || 'rect'
  );
  const attrs = {
    ...(node?.attrs || {}),
    radiusTL: radii.tl,
    radiusTR: radii.tr,
    radiusBR: radii.br,
    radiusBL: radii.bl,
    radiusLinked: linked ? 'true' : 'false',
    ...(vertices ? { radiusVertices: serializeRadiusVertices(vertices) } : {}),
  };
  if (
    previewSvgNodeCornerRadii(map, nodeId, {
      width: w,
      height: h,
      shapeType,
      radii,
      attrs,
    })
  ) {
    notifyShapeHostGeometry(nodeId);
  }
}

/**
 * Seat inset from the corner: tracks R. When R is below the park distance,
 * keep a screen-constant inset so the radius hit clears the resize hit under any zoom.
 * Park is clamped on tiny boxes so the seat cannot cross the center.
 */
export function radiusSeatInset(r: number, halfSide: number, parkScene: number): number {
  const park = Math.min(Math.max(0, parkScene), Math.max(0, halfSide * 0.45));
  const capped = Math.max(0, Math.min(Number(r) || 0, Math.max(0, halfSide - park)));
  return Math.max(park, capped);
}

/**
 * Path R-dot seat distance along the fill bisector.
 * Use screen-constant `parkScene` as-is — do NOT amplify by 1/min(|ix|,|iy|)
 * (sharp hole cusps otherwise park into a concentric larger star / pentagon).
 * `maxR` caps travel at this corner's geometric fillet limit.
 */
export function pathRadiusSeatAlong(
  r: number,
  parkScene: number,
  maxR?: number
): number {
  const rNum = Math.max(0, Number(r) || 0);
  const park = Math.max(0, Number(parkScene) || 0);
  const cap =
    maxR != null && Number.isFinite(maxR) && maxR >= 0
      ? Math.min(rNum, maxR)
      : rNum;
  return Math.max(park, cap);
}

/**
 * Path seats travel along the inward bisector. Axis AABB clearance needs the
 * same park on both axes as box-mode `(inset, inset)` — so along ≥ park / min(|ix|,|iy|).
 * Prefer {@link pathRadiusSeatAlong} for seating path R-dots (no amplification).
 */
export function radiusParkAlongBisector(
  parkScene: number,
  ix: number,
  iy: number
): number {
  const park = Math.max(0, parkScene);
  const ax = Math.abs(Number(ix) || 0);
  const ay = Math.abs(Number(iy) || 0);
  const m = Math.min(ax, ay);
  if (!(m > 1e-9)) return park;
  return park / m;
}

function pathVerticesAfterDrag(
  start: number[],
  sharpIndex: number,
  rounded: number,
  solo: boolean
): number[] {
  if (solo) return start.map((v, i) => (i === sharpIndex ? rounded : v));
  return start.map(() => rounded);
}

function boxRadiiAfterDrag(
  start: CornerRadii,
  corner: CornerKey,
  rounded: number,
  solo: boolean
): CornerRadii {
  if (solo) return { ...start, [corner]: rounded };
  return { tl: rounded, tr: rounded, br: rounded, bl: rounded };
}

function uniformCornerRadii(v: number): CornerRadii {
  return { tl: v, tr: v, br: v, bl: v };
}

/** Path sharp-corner radii list — stored vertices, or uniform fallback from box radii. */
function resolvePathVertexRadii(
  attrs: any,
  pathVertexCount: number,
  baseRadii: CornerRadii
): number[] {
  const stored = parseRadiusVertices(attrs?.radiusVertices);
  if (stored.length === pathVertexCount) return stored;
  const u = Math.round((baseRadii.tl + baseRadii.tr + baseRadii.br + baseRadii.bl) / 4);
  return Array.from({ length: pathVertexCount }, () => (stored.length ? stored[0] ?? u : u));
}

function patchNodeCornerRadii(opts: {
  dispatch: (a: unknown) => void;
  nodeId: string;
  node: SceneNodeInput;
  radii: CornerRadii;
  linked: boolean;
  /** When set, written as radiusVertices (sharp-corner list for paths). */
  vertices?: number[];
  skipHistory?: boolean;
}) {
  const { dispatch, nodeId, node, radii, linked, skipHistory } = opts;
  const clamped = clampCornerRadii(radii, Number(node.width) || 1, Number(node.height) || 1);
  const count = cornerVertexCount(node);
  let vertices: number[];
  if (opts.vertices && opts.vertices.length) {
    vertices = opts.vertices.map((v) => Math.max(0, Math.round(v)));
  } else if (linked) {
    vertices = Array.from({ length: count }, () => Math.round(clamped.tl));
  } else {
    vertices = vertexRadiiFromAttrs(
      {
        radiusTL: clamped.tl,
        radiusTR: clamped.tr,
        radiusBR: clamped.br,
        radiusBL: clamped.bl,
        radiusLinked: 'false',
      },
      count
    );
  }
  dispatch(
    patchDocumentNode({
      nodeId,
      skipHistory: Boolean(skipHistory),
      patch: {
        attrs: {
          radiusTL: Math.max(0, Math.round(clamped.tl)),
          radiusTR: Math.max(0, Math.round(clamped.tr)),
          radiusBR: Math.max(0, Math.round(clamped.br)),
          radiusBL: Math.max(0, Math.round(clamped.bl)),
          radiusLinked: linked ? 'true' : 'false',
          radiusVertices: serializeRadiusVertices(vertices),
          radius: Math.max(
            0,
            Math.round(Math.max(clamped.tl, clamped.tr, clamped.br, clamped.bl))
          ),
          cornerRadius: Math.max(
            0,
            Math.round(Math.max(clamped.tl, clamped.tr, clamped.br, clamped.bl))
          ),
        },
      },
    })
  );
}

type RadiusHandleDrag =
  | {
      mode: 'box';
      corner: CornerKey;
      startRadii: CornerRadii;
      linked: boolean;
      solo: boolean;
      startX: number;
      startY: number;
      moved: boolean;
    }
  | {
      mode: 'path';
      sharpIndex: number;
      startVertices: number[];
      linked: boolean;
      solo: boolean;
      site: SharpCornerSite;
      startX: number;
      startY: number;
      moved: boolean;
    };

function radiusShapeType(node: SceneNodeInput): string {
  const fromAttrs = node?.attrs?.shapeType;
  if (fromAttrs) return String(fromAttrs);
  if (node?.key === 'ellipse') return 'ellipse';
  if (node?.key) return String(node.key);
  return 'rect';
}

/** Path / pen — radius seats come from sharp corners, not AABB box corners. */
function isPathRadiusShape(node: SceneNodeInput, shapeType: string): boolean {
  if (node?.key === 'path' || node?.key === 'pen') return true;
  return shapeType === 'path' || shapeType === 'pen';
}

/** Circle / ellipse: no corners — AABB park seats sit outside the disk. */
function shouldSkipRadiusHandles(node: SceneNodeInput, shapeType: string): boolean {
  if (node?.key === 'ellipse') return true;
  if (shapeType === 'circle' || shapeType === 'ellipse') return true;
  // Outlined text (many M rings): R-dots only after entering path-edit.
  const d = String(node?.attrs?.path || node?.attrs?.d || '').trim();
  if (!d) return false;
  const rings = d.split(/(?=[Mm])/).filter((s) => s.trim()).length;
  return rings >= 4;
}

/**
 * Corner-radius dots on the world camera layer (same SVG contract as
 * SelectionChrome). Seat tracks R; screen size = px / zoom under CSS scale.
 */
function CornerRadiusHandlesOverlay({
  box,
  angle,
  nodeId,
  node,
  toScene,
  stageEl: _stageEl,
  interactive = true,
}: {
  box: SceneBox;
  angle: number;
  nodeId: string;
  node: SceneNodeInput;
  toScene: (clientX: number, clientY: number) => { x: number; y: number };
  /** Kept for call-site parity with other shape overlays (unused — seats always show). */
  stageEl: HTMLElement | null;
  /** False while moving/resizing so dots follow chrome without stealing pointers. */
  interactive?: boolean;
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragRef = useRef<RadiusHandleDrag | null>(null);
  const dragSessionEndRef = useRef<(() => void) | null>(null);

  // Hooks must stay above any early return (outline rect→path can flip isPathType/usePath).
  useEffect(
    () => () => {
      dragSessionEndRef.current?.();
      dragSessionEndRef.current = null;
    },
    []
  );

  // Path / pen with curves (C/Q/A): parseClosedPathRings returns [] → pathSites null.
  // Those shapes have no sharp corners to fillet, so skip AABB fallback handles entirely.
  const shapeType = radiusShapeType(node);
  const isPathType = isPathRadiusShape(node, shapeType);
  const skipRadiusHandles = shouldSkipRadiusHandles(node, shapeType);

  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const boxMaxR = Math.min(w, h) / 2;
  const baseRadii = clampCornerRadii(radiiFromAttrs(node?.attrs), w, h);
  const linked = isRadiusLinked(node?.attrs);
  const pathSites = skipRadiusHandles ? null : sharpCornerSitesForNode(node);
  const usePath = Boolean(pathSites && pathSites.length > 0);
  // Path/pen with no parseable sharp corners (curves only) → no handles at all.
  // Without this guard the code falls back to AABB box-mode handles that float
  // in the empty space outside the actual shape (e.g. crescent, arc shapes).
  if (isPathType && !usePath) return null;
  const pathVertexCount = usePath ? pathSites!.length : 0;
  const pathVertices = usePath
    ? resolvePathVertexRadii(node?.attrs, pathVertexCount, baseRadii)
    : [];

  // Seat = max(R, park) in control-box local space — TL at (inset,inset), etc.
  // Park is screen-constant scene units (see radiusParkSceneForBox); resize /
  // rotate knobs use the same box corners in HostPathChrome.
  const hitScale = chromeHitScaleForBox(w, h, z);
  const hitPx = CHROME_RADIUS_HIT_PX * hitScale;
  const k = 1 / z;
  const parkScene = radiusParkSceneForBox(w, h, z, RADIUS_PARK_PX);
  const radiusInteractive =
    !skipRadiusHandles &&
    interactive &&
    radiusHandlesFitOnScreen(w, h, z, RADIUS_PARK_PX);
  // `box` prop is path geom (caller deflates visual chrome). Host-mirrored
  // local space is also geom — path sites need no chrome pad.
  const halfSide = Math.min(w, h) / 2;

  const radiusHandleInset = (r: number) => radiusSeatInset(r, halfSide, parkScene);

  /** Control-box local: corner (cx,cy) → seat at axis inset from that corner. */
  const boxHandleLocalPos = (corner: (typeof RADIUS_CORNERS)[number], r: number) => {
    const inset = radiusHandleInset(r);
    return {
      lx: corner.cx === 0 ? inset : w - inset,
      ly: corner.cy === 0 ? inset : h - inset,
    };
  };

  const boxHandleScenePos = (corner: (typeof RADIUS_CORNERS)[number], r: number) => {
    const { lx, ly } = boxHandleLocalPos(corner, r);
    return localPointToScene(lx, ly, box, angle);
  };

  const pathHandleLocalPos = (site: SharpCornerSite, r: number) => {
    const along = pathRadiusSeatAlong(r, parkScene, site.maxR > 0 ? site.maxR : undefined);
    return {
      lx: site.x + site.ix * along,
      ly: site.y + site.iy * along,
    };
  };

  const pathHandleScenePos = (site: SharpCornerSite, r: number) => {
    const { lx, ly } = pathHandleLocalPos(site, r);
    return localPointToScene(lx, ly, box, angle);
  };

  const endDragSession = () => {
    dragSessionEndRef.current?.();
    dragSessionEndRef.current = null;
  };

  const beginDragSession = () => {
    if (dragSessionEndRef.current) return;

    const preview = (radii: CornerRadii, vertices?: number[]) => {
      previewRadiiOnHost({ nodeId, node, linked, w, h, radii, vertices });
    };

    const restoreDrag = (d: RadiusHandleDrag) => {
      if (d.mode === 'path') {
        preview(uniformCornerRadii(d.startVertices[0] ?? 0), d.startVertices);
        return;
      }
      preview(d.startRadii);
    };

    const finishUi = () => {
      dragRef.current = null;
      setActiveKey(null);
      setDragValue(null);
      setLiveCornerRadiusPreview(null);
    };

    const applyPathDragLocal = (
      d: Extract<RadiusHandleDrag, { mode: 'path' }>,
      local: { x: number; y: number },
      opts: { preview: boolean }
    ) => {
      const rounded = Math.round(radiusAlongPathSite(d.site, local, boxMaxR));
      const next = pathVerticesAfterDrag(d.startVertices, d.sharpIndex, rounded, d.solo);
      if (opts.preview) {
        setDragValue(rounded);
        const previewRadii = uniformCornerRadii(rounded);
        setLiveCornerRadiusPreview({
          nodeId,
          display: cornerRadiusDisplayFromRadii(previewRadii, !d.solo && d.linked),
        });
        preview(previewRadii, next);
        return;
      }
      patchNodeCornerRadii({
        dispatch,
        nodeId,
        node,
        radii: uniformCornerRadii(next[0] ?? 0),
        linked: !d.solo && d.linked,
        vertices: next,
        skipHistory: false,
      });
    };

    const applyBoxDragLocal = (
      d: Extract<RadiusHandleDrag, { mode: 'box' }>,
      local: { x: number; y: number },
      opts: { preview: boolean }
    ) => {
      const corner = RADIUS_CORNERS.find((c) => c.key === d.corner);
      if (!corner) return;
      const rounded = Math.round(radiusAlongBoxCorner(corner, local, w, h, boxMaxR));
      const next = boxRadiiAfterDrag(d.startRadii, d.corner, rounded, d.solo);
      if (opts.preview) {
        setDragValue(rounded);
        setLiveCornerRadiusPreview({
          nodeId,
          display: cornerRadiusDisplayFromRadii(next, !d.solo && d.linked),
        });
        preview(next);
        return;
      }
      patchNodeCornerRadii({
        dispatch,
        nodeId,
        node,
        radii: next,
        linked: !d.solo && d.linked,
        skipHistory: false,
      });
    };

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const distSq = (e.clientX - d.startX) ** 2 + (e.clientY - d.startY) ** 2;
      // Soft-click: ignore OS jitter; seat maps to R via along/√2 but R=0
      // seats on the screen pad and must not commit that pad as radius.
      if (!d.moved && distSq <= DRAG_DISTANCE_SQUARED) return;
      d.moved = true;
      const sc = toScene(e.clientX, e.clientY);
      const local = scenePointToLocal(sc.x, sc.y, box, angle);
      if (d.mode === 'path') {
        applyPathDragLocal(d, local, { preview: true });
        return;
      }
      applyBoxDragLocal(d, local, { preview: true });
    };

    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) {
        endDragSession();
        return;
      }
      const softClick = !d.moved;
      finishUi();
      endDragSession();
      if (softClick) {
        restoreDrag(d);
        return;
      }
      const sc = toScene(e.clientX, e.clientY);
      const local = scenePointToLocal(sc.x, sc.y, box, angle);
      if (d.mode === 'path') {
        applyPathDragLocal(d, local, { preview: false });
        return;
      }
      applyBoxDragLocal(d, local, { preview: false });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dragRef.current) return;
      const d = dragRef.current;
      finishUi();
      endDragSession();
      restoreDrag(d);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    dragSessionEndRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
      setLiveCornerRadiusPreview(null);
    };
  };

  const startPathDrag = (
    e: ReactPointerEvent<SVGElement>,
    site: SharpCornerSite
  ) => {
    if (e.button !== 0 || !radiusInteractive) return;
    e.preventDefault();
    e.stopPropagation();
    const solo = e.altKey || !linked;
    dragRef.current = {
      mode: 'path',
      sharpIndex: site.sharpIndex,
      startVertices: [...pathVertices],
      linked,
      solo,
      site,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    setActiveKey(String(site.sharpIndex));
    setDragValue(Math.round(pathVertices[site.sharpIndex] ?? 0));
    beginDragSession();
  };

  const startBoxDrag = (
    e: ReactPointerEvent<SVGElement>,
    corner: (typeof RADIUS_CORNERS)[number]
  ) => {
    if (e.button !== 0 || !radiusInteractive) return;
    e.preventDefault();
    e.stopPropagation();
    const solo = e.altKey || !linked;
    dragRef.current = {
      mode: 'box',
      corner: corner.key,
      startRadii: { ...baseRadii },
      linked,
      solo,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    setActiveKey(corner.key);
    setDragValue(Math.round(baseRadii[corner.key]));
    beginDragSession();
  };

  if (skipRadiusHandles) return null;

  // Always show while selected — seats track R (park only when R≈0).
  let badgeVal = Math.round(baseRadii.tl);
  if (dragValue != null) {
    badgeVal = dragValue;
  } else if (activeKey && usePath) {
    badgeVal = Math.round(pathVertices[Number(activeKey)] ?? baseRadii.tl);
  } else if (activeKey && activeKey in baseRadii) {
    badgeVal = Math.round(baseRadii[activeKey as CornerKey]);
  }

  // Live radii while dragging so dots track the pointer before Redux catches up.
  const drag = dragRef.current;
  let liveBoxRadii = baseRadii;
  let livePathVertices = pathVertices;
  if (dragValue != null && drag) {
    if (drag.mode === 'box') {
      liveBoxRadii = boxRadiiAfterDrag(baseRadii, drag.corner, dragValue, drag.solo);
    } else {
      livePathVertices = pathVerticesAfterDrag(
        pathVertices,
        drag.sharpIndex,
        dragValue,
        drag.solo
      );
    }
  }

  const hitSize = hitPx * k;
  const visualSize = CHROME_HANDLE_VIS_PX * k;
  const stroke = CHROME_STROKE_PX * k;
  const halfVis = visualSize / 2;
  const halfHit = hitSize / 2;

  type HandleSpec = {
    key: string;
    lx: number;
    ly: number;
    onDown: (e: ReactPointerEvent<SVGElement>) => void;
  };

  const handles: HandleSpec[] =
    usePath && pathSites
      ? pathSites.map((site) => {
          const r = livePathVertices[site.sharpIndex] ?? 0;
          const { lx, ly } = pathHandleLocalPos(site, r);
          return {
            key: String(site.sharpIndex),
            lx,
            ly,
            onDown: (e: ReactPointerEvent<SVGElement>) => startPathDrag(e, site),
          };
        })
      : RADIUS_CORNERS.map((corner) => {
          const r = liveBoxRadii[corner.key];
          const { lx, ly } = boxHandleLocalPos(corner, r);
          return {
            key: corner.key,
            lx,
            ly,
            onDown: (e: ReactPointerEvent<SVGElement>) => startBoxDrag(e, corner),
          };
        });

  let badgePos: { x: number; y: number } | null = null;
  if (activeKey != null && dragValue != null) {
    if (usePath && pathSites) {
      const site = pathSites.find((s) => String(s.sharpIndex) === activeKey);
      if (site) {
        badgePos = pathHandleScenePos(
          site,
          livePathVertices[site.sharpIndex] ?? dragValue
        );
      }
    } else {
      const corner = RADIUS_CORNERS.find((c) => c.key === activeKey);
      if (corner) badgePos = boxHandleScenePos(corner, liveBoxRadii[corner.key]);
    }
  }

  return (
    <HostMirroredKnobSvg
      nodeId={nodeId}
      box={box}
      angle={angle}
      localChildren={handles.map((h) => {
        const isActive = activeKey === h.key;
        return (
          <g
            key={h.key}
            data-radius-handle={h.key}
            transform={`translate(${h.lx} ${h.ly})`}
            style={{
              pointerEvents: radiusInteractive ? 'all' : 'none',
              cursor: radiusInteractive ? 'default' : undefined,
            }}
            onPointerDown={radiusInteractive ? h.onDown : undefined}
          >
            <rect x={-halfHit} y={-halfHit} width={hitSize} height={hitSize} fill="transparent" />
            <circle
              r={Math.max(0.01, halfVis - stroke / 2)}
              fill="#ffffff"
              stroke="#3388ff"
              strokeWidth={stroke}
              style={{ pointerEvents: 'none' }}
            />
            {isActive ? (
              <circle
                r={Math.max(0.01, halfVis + stroke)}
                fill="none"
                stroke="rgba(51,136,255,0.35)"
                strokeWidth={2 * k}
                style={{ pointerEvents: 'none' }}
              />
            ) : null}
          </g>
        );
      })}
      sceneChildren={
        badgePos ? (
          <WorldScreenBadge
            text={`${t('editor.imageToolbar.cornerRadius')} ${badgeVal}`}
            x={badgePos.x}
            y={badgePos.y}
            inv={k}
            anchor="above"
            clearance={12 * k}
          />
        ) : null
      }
    />
  );
}

export default CornerRadiusHandlesOverlay;
