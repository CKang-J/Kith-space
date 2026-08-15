/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/chrome/StarShapeHandlesOverlay.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Star shape handles.
 * World-SVG knobs — same paint contract as SelectionChrome / CornerRadius.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { previewSvgNodeCornerRadii } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import { useRcbCamera } from '@recombyn-native/components/rcb/camera/context';
import {
  clampCornerRadii,
  cornerVertexCount,
  isRadiusLinked,
  radiiFromAttrs,
  serializeRadiusVertices,
  setLiveCornerRadiusPreview,
  type CornerRadii,
} from '@recombyn-native/components/rcb/scene/document/sceneRadii';
import {
  clampShapeSides,
  clampStarInnerRatio,
  shapeVertexPoints,
  sidesFromAttrs,
  starInnerRatioFromAttrs,
} from '@recombyn-native/components/rcb/scene/document/sceneShapes';
import { patchDocumentNode } from '@recombyn-native/store/modules/editor';
import {
  getShapeHost,
  getSharedNodeEls,
  notifyShapeHostGeometry,
} from '@recombyn-native/components/rcb/shapes/shapeHostRegistry';
import type { SceneBox } from '../alignGuides';
import {
  CHROME_HANDLE_VIS_PX,
  CHROME_RADIUS_HIT_PX,
  CHROME_STROKE_PX,
  radiusHandleParkScreenPx,
  radiusParkSceneForBox,
  WorldSvgFrame,
  WorldScreenBadge,
} from '../SelectionChrome';

const DRAG_DISTANCE_SQUARED = 16;
const SIDES_DRAG_STEP_PX = 14;
const KNOB_VIS_PX = CHROME_HANDLE_VIS_PX;
const KNOB_HIT_PX = CHROME_RADIUS_HIT_PX;
const KNOB_STROKE_PX = CHROME_STROKE_PX;
const RADIUS_MIN_INSET_PX = radiusHandleParkScreenPx();

function liveNodeEl(nodeId: string): Element | null {
  return (
    (getSharedNodeEls()?.get(nodeId) as Element | undefined) ||
    (getShapeHost(nodeId)?.el as Element | null | undefined) ||
    null
  );
}

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

function uniformRadii(r: number): CornerRadii {
  const v = Math.max(0, Math.round(r));
  return { tl: v, tr: v, br: v, bl: v };
}

/** Rightmost outer tip (even indices) — sides knob sits on the tip, not the AABB edge. */
function rightmostOuterTip(pts: Array<[number, number]>): { x: number; y: number } {
  let best = pts[0];
  for (let i = 0; i < pts.length; i += 2) {
    const p = pts[i];
    if (p[0] > best[0] + 1e-6 || (Math.abs(p[0] - best[0]) <= 1e-6 && p[1] < best[1])) {
      best = p;
    }
  }
  return { x: best[0], y: best[1] };
}

function starSites(width: number, height: number, sides: number, innerRatio: number) {
  const pts = shapeVertexPoints('star', width, height, sides, innerRatio);
  if (pts.length < 2) return null;
  const cx = width / 2;
  const cy = height / 2;
  const top = pts[0];
  const valley = pts[1];
  let ix = cx - top[0];
  let iy = cy - top[1];
  const len = Math.hypot(ix, iy) || 1;
  ix /= len;
  iy /= len;
  const outerDist = Math.hypot(top[0] - cx, top[1] - cy) || 1;
  const tip = rightmostOuterTip(pts);
  return {
    pts,
    cx,
    cy,
    top: { x: top[0], y: top[1], ix, iy },
    valley: { x: valley[0], y: valley[1] },
    tip,
    outerDist,
  };
}

function commitUniformRadius(opts: {
  dispatch: (a: unknown) => void;
  nodeId: string;
  node: SceneNodeInput;
  radius: number;
}) {
  const w = Math.max(1, Number(opts.node.width) || 1);
  const h = Math.max(1, Number(opts.node.height) || 1);
  const clamped = clampCornerRadii(uniformRadii(opts.radius), w, h);
  const count = Math.max(1, cornerVertexCount(opts.node));
  const vertices = Array.from({ length: count }, () => Math.round(clamped.tl));
  opts.dispatch(
    patchDocumentNode({
      nodeId: opts.nodeId,
      patch: {
        attrs: {
          radiusTL: clamped.tl,
          radiusTR: clamped.tr,
          radiusBR: clamped.br,
          radiusBL: clamped.bl,
          radiusLinked: 'true',
          radiusVertices: serializeRadiusVertices(vertices),
          radius: Math.round(clamped.tl),
          cornerRadius: Math.round(clamped.tl),
        },
      },
    })
  );
}

type DragState =
  | {
      mode: 'radius';
      startR: number;
      site: { x: number; y: number; ix: number; iy: number };
      startX: number;
      startY: number;
      moved: boolean;
    }
  | {
      mode: 'inner';
      startRatio: number;
      outerDist: number;
      cx: number;
      cy: number;
      startX: number;
      startY: number;
      moved: boolean;
    }
  | {
      mode: 'sides';
      startSides: number;
      startX: number;
      startY: number;
      moved: boolean;
    };

function StarShapeHandlesOverlay({
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
  stageEl: HTMLElement | null;
  interactive?: boolean;
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
  const k = 1 / z;

  const [activeKey, setActiveKey] = useState<'radius' | 'inner' | 'sides' | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [liveSides, setLiveSides] = useState<number | null>(null);
  const [liveInner, setLiveInner] = useState<number | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const maxR = Math.min(w, h) / 2;
  const baseSides = sidesFromAttrs(node?.attrs);
  const sides = liveSides ?? baseSides;
  const baseInner = starInnerRatioFromAttrs(node?.attrs);
  const innerRatio = liveInner ?? baseInner;
  const baseRadii = clampCornerRadii(radiiFromAttrs(node?.attrs), w, h);
  const linked = isRadiusLinked(node?.attrs);
  const baseR = Math.round(
    linked
      ? (baseRadii.tl + baseRadii.tr + baseRadii.br + baseRadii.bl) / 4
      : baseRadii.tl
  );
  const radius = dragValue != null && activeKey === 'radius' ? dragValue : baseR;

  const sites = starSites(w, h, sides, innerRatio);
  // Seat tracks R along the tip→center bisector (same contract as rect R-dots).
  // A fixed park inset left the knob glued to the sharp tip while the rounded
  // silhouette pulled inward — looked like “controls stuck at the old place”.
  const insetFor = (r: number) => {
    const park = radiusParkSceneForBox(w, h, z, RADIUS_MIN_INSET_PX);
    const maxAlong = Math.max(park, maxR - 1);
    return Math.max(park, Math.min(Math.max(0, Number(r) || 0), maxAlong));
  };

  let radiusLocal = { x: w / 2, y: insetFor(radius) };
  let innerLocal = { x: w * 0.65, y: h * 0.35 };
  let sidesLocal = { x: w, y: h / 2 };
  if (sites) {
    radiusLocal = {
      x: sites.top.x + sites.top.ix * insetFor(radius),
      y: sites.top.y + sites.top.iy * insetFor(radius),
    };
    innerLocal = sites.valley;
    sidesLocal = sites.tip;
  }

  const radiusPos = localPointToScene(radiusLocal.x, radiusLocal.y, box, angle);
  const innerPos = localPointToScene(innerLocal.x, innerLocal.y, box, angle);
  const sidesPos = localPointToScene(sidesLocal.x, sidesLocal.y, box, angle);

  const preview = (opts: { r?: number; sides?: number; inner?: number }) => {
    const hostEl = liveNodeEl(nodeId);
    if (!hostEl) return;
    const map = getSharedNodeEls() || new Map<string, any>([[nodeId, hostEl]]);
    if (!map.has(nodeId)) map.set(nodeId, hostEl);
    const r = opts.r ?? radius;
    const nextSides = opts.sides ?? sides;
    const nextInner = opts.inner ?? innerRatio;
    const radii = uniformRadii(r);
    if (
      previewSvgNodeCornerRadii(map, nodeId, {
        width: w,
        height: h,
        shapeType: 'star',
        radii,
        sides: nextSides,
        attrs: {
          ...(node?.attrs || {}),
          radiusTL: radii.tl,
          radiusTR: radii.tr,
          radiusBR: radii.br,
          radiusBL: radii.bl,
          radiusLinked: 'true',
          sides: nextSides,
          starInnerRatio: nextInner,
        },
      })
    ) {
      notifyShapeHostGeometry(nodeId);
    }
  };

  useEffect(() => {
    if (!interactive) return undefined;

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const distSq = (e.clientX - d.startX) ** 2 + (e.clientY - d.startY) ** 2;
      if (!d.moved && distSq <= DRAG_DISTANCE_SQUARED) return;
      d.moved = true;

      if (d.mode === 'sides') {
        const delta = Math.round((d.startY - e.clientY) / SIDES_DRAG_STEP_PX);
        const next = clampShapeSides(d.startSides + delta, d.startSides);
        setDragValue(next);
        setLiveSides(next);
        preview({ sides: next });
        return;
      }

      if (d.mode === 'inner') {
        const sc = toScene(e.clientX, e.clientY);
        const local = scenePointToLocal(sc.x, sc.y, box, angle);
        const dist = Math.hypot(local.x - d.cx, local.y - d.cy);
        const next = clampStarInnerRatio(dist / Math.max(1e-3, d.outerDist), d.startRatio);
        setDragValue(Math.round(next * 100));
        setLiveInner(next);
        preview({ inner: next });
        return;
      }

      const sc = toScene(e.clientX, e.clientY);
      const local = scenePointToLocal(sc.x, sc.y, box, angle);
      const along = (local.x - d.site.x) * d.site.ix + (local.y - d.site.y) * d.site.iy;
      const rounded = Math.max(0, Math.min(maxR, Math.round(along)));
      setDragValue(rounded);
      setLiveCornerRadiusPreview({ nodeId, display: rounded });
      preview({ r: rounded });
    };

    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const soft = !d.moved;
      dragRef.current = null;
      setActiveKey(null);
      setDragValue(null);
      setLiveSides(null);
      setLiveInner(null);
      setLiveCornerRadiusPreview(null);

      if (soft) {
        preview({ r: baseR, sides: baseSides, inner: baseInner });
        return;
      }

      if (d.mode === 'sides') {
        const delta = Math.round((d.startY - e.clientY) / SIDES_DRAG_STEP_PX);
        const next = clampShapeSides(d.startSides + delta, d.startSides);
        dispatch(patchDocumentNode({ nodeId, patch: { attrs: { sides: next } } }));
        return;
      }

      if (d.mode === 'inner') {
        const sc = toScene(e.clientX, e.clientY);
        const local = scenePointToLocal(sc.x, sc.y, box, angle);
        const dist = Math.hypot(local.x - d.cx, local.y - d.cy);
        const next = clampStarInnerRatio(dist / Math.max(1e-3, d.outerDist), d.startRatio);
        dispatch(patchDocumentNode({ nodeId, patch: { attrs: { starInnerRatio: next } } }));
        return;
      }

      const sc = toScene(e.clientX, e.clientY);
      const local = scenePointToLocal(sc.x, sc.y, box, angle);
      const along = (local.x - d.site.x) * d.site.ix + (local.y - d.site.y) * d.site.iy;
      const rounded = Math.max(0, Math.min(maxR, Math.round(along)));
      commitUniformRadius({ dispatch, nodeId, node, radius: rounded });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dragRef.current) return;
      dragRef.current = null;
      setActiveKey(null);
      setDragValue(null);
      setLiveSides(null);
      setLiveInner(null);
      setLiveCornerRadiusPreview(null);
      preview({ r: baseR, sides: baseSides, inner: baseInner });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
      setLiveCornerRadiusPreview(null);
    };
  }, [
    interactive,
    dispatch,
    nodeId,
    node,
    box,
    angle,
    toScene,
    baseR,
    baseSides,
    baseInner,
    sides,
    innerRatio,
    radius,
    maxR,
  ]);

  if (!sites) return null;

  const hitSize = KNOB_HIT_PX * k;
  const visualSize = KNOB_VIS_PX * k;
  const stroke = KNOB_STROKE_PX * k;
  const halfVis = visualSize / 2;
  const halfHit = hitSize / 2;
  const left = box.left;
  const top = box.top;
  const gTransform =
    Math.abs(angle) > 0.001
      ? `translate(${left} ${top}) rotate(${angle} ${w / 2} ${h / 2})`
      : `translate(${left} ${top})`;

  const radiusLabel = t('editor.imageToolbar.cornerRadius');
  const innerLabel = t('editor.imageToolbar.innerRadius', { defaultValue: '内角半径' });
  const sidesLabel = t('editor.imageToolbar.vertexCount', { defaultValue: '顶点' });

  let badgePos: { x: number; y: number } | null = null;
  let badgeText = '';
  if (activeKey && dragValue != null) {
    if (activeKey === 'radius') {
      badgePos = radiusPos;
      badgeText = `${radiusLabel} ${dragValue}`;
    } else if (activeKey === 'inner') {
      badgePos = innerPos;
      badgeText = `${innerLabel} ${dragValue}%`;
    } else {
      badgePos = sidesPos;
      badgeText = `${sidesLabel} ${dragValue}`;
    }
  }

  type KnobSpec = {
    key: 'radius' | 'inner' | 'sides';
    lx: number;
    ly: number;
    label: string;
    onDown: (e: ReactPointerEvent<SVGElement>) => void;
  };

  const knobs: KnobSpec[] = [
    {
      key: 'radius',
      lx: radiusLocal.x,
      ly: radiusLocal.y,
      label: radiusLabel,
      onDown: (e) => {
        if (e.button !== 0 || !sites) return;
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = {
          mode: 'radius',
          startR: baseR,
          site: sites.top,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
        setActiveKey('radius');
        setDragValue(baseR);
      },
    },
    {
      key: 'inner',
      lx: innerLocal.x,
      ly: innerLocal.y,
      label: innerLabel,
      onDown: (e) => {
        if (e.button !== 0 || !sites) return;
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = {
          mode: 'inner',
          startRatio: baseInner,
          outerDist: sites.outerDist,
          cx: sites.cx,
          cy: sites.cy,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
        setActiveKey('inner');
        setDragValue(Math.round(baseInner * 100));
        setLiveInner(baseInner);
      },
    },
    {
      key: 'sides',
      lx: sidesLocal.x,
      ly: sidesLocal.y,
      label: sidesLabel,
      onDown: (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = {
          mode: 'sides',
          startSides: baseSides,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
        setActiveKey('sides');
        setDragValue(baseSides);
        setLiveSides(baseSides);
      },
    },
  ];

  return (
    <WorldSvgFrame left={left} top={top} width={w} height={h} angle={angle} zClass="z-[28]">
      <g transform={gTransform}>
        {knobs.map((knob) => {
          const isActive = activeKey === knob.key;
          return (
            <g
              key={knob.key}
              data-star-handle={knob.key}
              transform={`translate(${knob.lx} ${knob.ly})`}
              style={{
                pointerEvents: interactive ? 'all' : 'none',
                cursor: interactive ? 'default' : undefined,
              }}
              onPointerDown={interactive ? knob.onDown : undefined}
            >
              <title>{knob.label}</title>
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
      </g>
      {badgePos ? (
        <WorldScreenBadge
          text={badgeText}
          x={badgePos.x}
          y={badgePos.y}
          inv={k}
          anchor="right"
          clearance={halfVis + 2 * k}
        />
      ) : null}
    </WorldSvgFrame>
  );
}

export default StarShapeHandlesOverlay;
