/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/chrome/CircleShapeHandlesOverlay.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Circle / ellipse knobs: 内半径, 开始位置 (display), 弧度 / 周弧度.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { previewSvgNodeEllipseParams } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import { useRcbCamera } from '@recombyn-native/components/rcb/camera/context';
import {
  clampEllipseInnerRatio,
  ellipseArcAlongFromPointerAngle,
  ellipseArcAlongRadFromPercent,
  ellipseArcApplyFullHysteresis,
  ellipseArcEndAngles,
  ellipseArcLockSign,
  ellipseArcPercentFromAlongRad,
  ellipseArcPercentFromAttrs,
  ellipseInnerRatioFromAttrs,
  ellipseStartDegFromAttrs,
  snapEllipseArcPercent,
  snapEllipseInnerRatio,
  wrapAngleDelta,
} from '@recombyn-native/components/rcb/scene/document/sceneShapes';
import { patchDocumentNode } from '@recombyn-native/store/modules/editor';
import {
  getShapeHost,
  getSharedNodeEls,
  notifyShapeHostGeometry,
} from '@recombyn-native/components/rcb/shapes/shapeHostRegistry';
import type { SceneBox } from '../alignGuides';
import {
  CHROME_HANDLE_HIT_PX,
  CHROME_HANDLE_VIS_PX,
  CHROME_STROKE_PX,
  WorldSvgFrame,
  WorldScreenBadge,
} from '../SelectionChrome';

const DRAG_DISTANCE_SQUARED = 16;
const KNOB_VIS_PX = CHROME_HANDLE_VIS_PX;
const KNOB_HIT_PX = CHROME_HANDLE_HIT_PX;
const KNOB_STROKE_PX = CHROME_STROKE_PX;
/** Arc / start knobs sit slightly inside the rim so they clear resize chrome. */
const ARC_RIM_INSET_PX = 10;

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

function commitEllipseParams(opts: {
  dispatch: (a: unknown) => void;
  nodeId: string;
  innerRatio: number;
  arcPercent: number;
  startDeg: number;
  skipHistory?: boolean;
}) {
  opts.dispatch(
    patchDocumentNode({
      nodeId: opts.nodeId,
      skipHistory: Boolean(opts.skipHistory),
      patch: {
        attrs: {
          ellipseInnerRatio: snapEllipseInnerRatio(opts.innerRatio),
          ellipseArcPercent: snapEllipseArcPercent(opts.arcPercent),
          ellipseStartDeg: opts.startDeg,
        },
      },
    })
  );
}

type DragState =
  | {
      mode: 'inner';
      startRatio: number;
      current: number;
      startX: number;
      startY: number;
      moved: boolean;
    }
  | {
      mode: 'arc';
      startPercent: number;
      current: number;
      /** Locked on first move — one direction; end cannot cross 开始位置. */
      lockSign: 1 | -1 | null;
      /** Remaining sweep radians in (0, 2π]; 2π = closed at 开始位置. */
      alongRad: number;
      /** Hysteresis: has left the full-circle band once this gesture. */
      openedOnce: boolean;
      /** Hysteresis: currently latched to full (absorb pointer chatter). */
      heldFull: boolean;
      startX: number;
      startY: number;
      moved: boolean;
    };

function CircleShapeHandlesOverlay({
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

  const [activeKey, setActiveKey] = useState<'inner' | 'arc' | null>(null);
  const [hoverStart, setHoverStart] = useState(false);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [liveInner, setLiveInner] = useState<number | null>(null);
  const [liveArc, setLiveArc] = useState<number | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const outerR = Math.min(rx, ry);

  const baseInner = ellipseInnerRatioFromAttrs(node?.attrs);
  const baseArc = ellipseArcPercentFromAttrs(node?.attrs);
  const startDeg = ellipseStartDegFromAttrs(node?.attrs);
  const innerRatio = liveInner ?? baseInner;
  const arcPercent = liveArc ?? baseArc;
  const isFull = Math.abs(arcPercent) >= 99.95;

  const rimInset = Math.min(outerR * 0.2, ARC_RIM_INSET_PX * k);
  const arcSeatR = Math.max(outerR * 0.35, outerR - rimInset);
  const { a0, a1, mid } = ellipseArcEndAngles(arcPercent, startDeg);
  const seatOnRim = (ang: number, r: number) => ({
    x: cx + Math.cos(ang) * (rx / outerR) * r,
    y: cy + Math.sin(ang) * (ry / outerR) * r,
  });
  // 内半径: solid → center; donut → mid-sweep on the inner rim.
  const innerSeatR =
    innerRatio > 1e-4 ? Math.max(2 * k, outerR * innerRatio) : 0;
  const innerLocal =
    innerRatio > 1e-4 ? seatOnRim(mid, innerSeatR) : { x: cx, y: cy };
  // Full: one 周弧度 knob where ends coincide (at 开始位置).
  // Partial: fixed 开始位置 at a0 + movable 弧度 at a1.
  const startLocal = seatOnRim(a0, arcSeatR);
  const arcLocal = seatOnRim(isFull ? a0 : a1, arcSeatR);

  const innerPos = localPointToScene(innerLocal.x, innerLocal.y, box, angle);
  const startPos = localPointToScene(startLocal.x, startLocal.y, box, angle);
  const arcPos = localPointToScene(arcLocal.x, arcLocal.y, box, angle);

  const preview = (opts: { inner?: number; arc?: number }) => {
    const hostEl = liveNodeEl(nodeId);
    if (!hostEl) return;
    const map = getSharedNodeEls() || new Map<string, any>([[nodeId, hostEl]]);
    if (!map.has(nodeId)) map.set(nodeId, hostEl);
    if (
      previewSvgNodeEllipseParams(map, nodeId, {
        width: w,
        height: h,
        innerRatio: opts.inner ?? innerRatio,
        arcPercent: opts.arc ?? arcPercent,
        startDeg,
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
      // Arc follows the pointer immediately; inner keeps a tiny slop before drag.
      if (d.mode === 'inner') {
        const distSq = (e.clientX - d.startX) ** 2 + (e.clientY - d.startY) ** 2;
        if (!d.moved && distSq <= DRAG_DISTANCE_SQUARED) return;
      }
      d.moved = true;

      const sc = toScene(e.clientX, e.clientY);
      const local = scenePointToLocal(sc.x, sc.y, box, angle);

      if (d.mode === 'inner') {
        const dist = Math.hypot(local.x - cx, local.y - cy);
        const next = snapEllipseInnerRatio(
          clampEllipseInnerRatio(dist / Math.max(1e-3, outerR), d.startRatio),
          { sceneDist: dist, zoom: z }
        );
        d.current = next;
        setDragValue(Math.round(next * 100));
        setLiveInner(next);
        preview({ inner: next });
        return;
      }

      // Arc: end handle tracks the pointer angle (not Δθ accumulation).
      const pointerAngle = Math.atan2(local.y - cy, local.x - cx);
      const startRad = (startDeg * Math.PI) / 180;
      const delta = wrapAngleDelta(pointerAngle - startRad);
      if (d.lockSign == null) {
        d.lockSign = ellipseArcLockSign(d.startPercent, delta);
      }

      const prevAlong = d.alongRad;
      const mapped = ellipseArcAlongFromPointerAngle(
        pointerAngle,
        startRad,
        d.lockSign,
        prevAlong
      );
      const hyst = ellipseArcApplyFullHysteresis(mapped, {
        openedOnce: d.openedOnce,
        heldFull: d.heldFull,
      });
      d.openedOnce = hyst.openedOnce;
      d.heldFull = hyst.heldFull;
      d.alongRad = hyst.along;
      const next = ellipseArcPercentFromAlongRad(d.alongRad, d.lockSign);
      d.current = next;
      setDragValue(Math.round(next * 10) / 10);
      setLiveArc(next);
      preview({ arc: next });
    };

    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      const soft = !d.moved;
      dragRef.current = null;
      setActiveKey(null);
      setDragValue(null);
      setLiveInner(null);
      setLiveArc(null);

      if (soft) {
        preview({ inner: baseInner, arc: baseArc });
        return;
      }

      commitEllipseParams({
        dispatch,
        nodeId,
        innerRatio: d.mode === 'inner' ? d.current : baseInner,
        arcPercent: d.mode === 'arc' ? d.current : baseArc,
        startDeg,
        skipHistory: false,
      });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dragRef.current) return;
      dragRef.current = null;
      setActiveKey(null);
      setDragValue(null);
      setLiveInner(null);
      setLiveArc(null);
      preview({ inner: baseInner, arc: baseArc });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [
    interactive,
    box,
    angle,
    toScene,
    cx,
    cy,
    outerR,
    z,
    baseInner,
    baseArc,
    startDeg,
    dispatch,
    nodeId,
    w,
    h,
  ]);

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

  const innerLabel = t('editor.imageToolbar.ellipseInnerRadius', {
    defaultValue: '内半径',
  });
  const startLabel = t('editor.imageToolbar.ellipseStartPosition', {
    defaultValue: '开始位置',
  });
  const arcLabel = isFull
    ? t('editor.imageToolbar.ellipseFullArc', { defaultValue: '周弧度' })
    : t('editor.imageToolbar.arcPercent', { defaultValue: '弧度' });
  const startDegLabel = Math.round(startDeg * 10) / 10;

  let badgePos: { x: number; y: number } | null = null;
  let badgeText = '';
  if (activeKey === 'inner' && dragValue != null) {
    badgePos = innerPos;
    badgeText = `${innerLabel} ${dragValue}%`;
  } else if (activeKey === 'arc' && dragValue != null) {
    badgePos = arcPos;
    badgeText = `${arcLabel} ${dragValue}%`;
  } else if (hoverStart && !isFull && !activeKey) {
    badgePos = startPos;
    badgeText = `${startLabel} ${startDegLabel}°`;
  }

  const beginInner = (e: ReactPointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      mode: 'inner',
      startRatio: baseInner,
      current: baseInner,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    setActiveKey('inner');
    setHoverStart(false);
    setDragValue(Math.round(baseInner * 100));
    setLiveInner(baseInner);
  };

  /** Double-click 内半径 → solid disk (restore after opening a hole). */
  const resetInnerSolid = (e: React.MouseEvent<SVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = null;
    setActiveKey(null);
    setDragValue(null);
    setLiveInner(null);
    setLiveArc(null);
    commitEllipseParams({
      dispatch,
      nodeId,
      innerRatio: 0,
      arcPercent: baseArc,
      startDeg,
    });
    preview({ inner: 0 });
  };

  const beginArc = (e: ReactPointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      mode: 'arc',
      startPercent: baseArc,
      current: baseArc,
      lockSign: Math.abs(baseArc) >= 99.95 ? null : baseArc < 0 ? -1 : 1,
      alongRad: ellipseArcAlongRadFromPercent(baseArc),
      // From full: follow pointer until clearly open, then enable close-snap hysteresis.
      openedOnce: Math.abs(baseArc) < 99.95,
      heldFull: false,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    setActiveKey('arc');
    setHoverStart(false);
    setDragValue(Math.round(baseArc * 10) / 10);
    setLiveArc(baseArc);
  };

  /** Double-click 弧度 → full circle (keep prior CW/CCW sign). */
  const resetArcFull = (e: React.MouseEvent<SVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const full = baseArc < 0 ? -100 : 100;
    dragRef.current = null;
    setActiveKey(null);
    setDragValue(null);
    setLiveInner(null);
    setLiveArc(null);
    commitEllipseParams({
      dispatch,
      nodeId,
      innerRatio: baseInner,
      arcPercent: full,
      startDeg,
    });
    preview({ arc: full });
  };

  type KnobSpec = {
    key: string;
    lx: number;
    ly: number;
    label: string;
    interactive: boolean;
    isActive: boolean;
    onDown?: (e: ReactPointerEvent<SVGElement>) => void;
    onDoubleClick?: (e: React.MouseEvent<SVGGElement>) => void;
    onEnter?: () => void;
    onLeave?: () => void;
  };

  const knobs: KnobSpec[] = [
    {
      key: 'inner',
      lx: innerLocal.x,
      ly: innerLocal.y,
      label: innerLabel,
      interactive: true,
      isActive: activeKey === 'inner',
      onDown: beginInner,
      onDoubleClick: resetInnerSolid,
    },
  ];

  if (isFull) {
    // Coincident ends → single 周弧度 control.
    knobs.push({
      key: 'arc',
      lx: arcLocal.x,
      ly: arcLocal.y,
      label: arcLabel,
      interactive: true,
      isActive: activeKey === 'arc',
      onDown: beginArc,
      onDoubleClick: resetArcFull,
    });
  } else {
    knobs.push(
      {
        key: 'start',
        lx: startLocal.x,
        ly: startLocal.y,
        label: `${startLabel} ${startDegLabel}°`,
        interactive: false,
        isActive: hoverStart,
        onEnter: () => setHoverStart(true),
        onLeave: () => setHoverStart(false),
      },
      {
        key: 'arc',
        lx: arcLocal.x,
        ly: arcLocal.y,
        label: arcLabel,
        interactive: true,
        isActive: activeKey === 'arc',
        onDown: beginArc,
        onDoubleClick: resetArcFull,
      }
    );
  }

  return (
    <WorldSvgFrame left={left} top={top} width={w} height={h} angle={angle} zClass="z-[28]">
      <g transform={gTransform}>
        {knobs.map((knob) => {
          const canHit = interactive && (knob.interactive || Boolean(knob.onEnter));
          return (
            <g
              key={knob.key}
              data-circle-handle={knob.key}
              transform={`translate(${knob.lx} ${knob.ly})`}
              style={{
                pointerEvents: canHit ? 'all' : 'none',
                cursor: knob.interactive && interactive ? 'default' : undefined,
              }}
              onPointerDown={
                interactive && knob.interactive && knob.onDown ? knob.onDown : undefined
              }
              onDoubleClick={
                interactive && knob.interactive && knob.onDoubleClick
                  ? knob.onDoubleClick
                  : undefined
              }
              onPointerEnter={interactive ? knob.onEnter : undefined}
              onPointerLeave={interactive ? knob.onLeave : undefined}
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
              {knob.isActive ? (
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

export default CircleShapeHandlesOverlay;
