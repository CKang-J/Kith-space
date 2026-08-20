/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/tools/PenDrawFeature.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  useRcbCamera,
  useRcbScreenToScene,
} from '../camera/context';
import { useEffect, useRef, useState, memo, type ReactNode } from 'react';
import { createPortal } from '@/features/canvas/adapters/recombynReactDom';
import {
  CLOSE_THRESHOLD,
  localizeAnchors,
  penAnchorsToD,
  boundsOfAnchors,
  withMirroredHandles,
  resolvePenPlaceAction,
  reversePenAnchors,
  penSubpathsFromD,
  offsetAnchors,
  type PenAnchor,
} from './penPath';
import { isEditablePathNode } from '../scene/paint/outlineToPath';
import { nodeLeftTop } from '../scene/paint/sceneToSvg';
import { PEN_CURSOR } from './PencilDrawFeature';
import { snapCoordToGrid } from '../selection/alignGuides';
import {
  getSceneDrawPreviewMount,
  getSceneWorldEpoch,
  subscribeShapeHosts,
} from '../shapes/shapeHostRegistry';
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';

function dist2(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function isGridCorner(x: number, y: number, g: number) {
  const qx = Math.round(x / g) * g;
  const qy = Math.round(y / g) * g;
  return Math.abs(x - qx) < 1e-9 && Math.abs(y - qy) < 1e-9;
}

/**
 * Snap pen anchors to the pixel-grid lattice (hold Ctrl to skip):
 * - cell **corners** (i, j)
 * - **edge midpoints** (i+½, j) / (i, j+½) — 网格边缘线中间
 *
 * Cell centers (½,½) are not snap targets (not on an edge line).
 */
export function snapPenAnchorPoint(
  x: number,
  y: number,
  gridSize: number,
  skip = false
): { x: number; y: number } {
  if (skip || !(gridSize > 0)) return { x, y };
  const g = gridSize;
  const half = g / 2;
  const gx0 = Math.floor(x / g) * g;
  const gy0 = Math.floor(y / g) * g;

  let bestX = snapCoordToGrid(x, g);
  let bestY = snapCoordToGrid(y, g);
  let bestD = dist2(x, y, bestX, bestY);
  let bestCorner = isGridCorner(bestX, bestY, g);

  const consider = (cx: number, cy: number) => {
    const d = dist2(x, y, cx, cy);
    const corner = isGridCorner(cx, cy, g);
    if (d < bestD - 1e-12) {
      bestD = d;
      bestX = cx;
      bestY = cy;
      bestCorner = corner;
      return;
    }
    if (Math.abs(d - bestD) <= 1e-12) {
      // Tie: prefer corners, then lower x, then lower y (stable).
      if (corner && !bestCorner) {
        bestX = cx;
        bestY = cy;
        bestCorner = true;
        return;
      }
      if (corner === bestCorner && (cx < bestX - 1e-12 || (Math.abs(cx - bestX) <= 1e-12 && cy < bestY))) {
        bestX = cx;
        bestY = cy;
        bestCorner = corner;
      }
    }
  };

  // Local 3×3 corners + edge mids around the containing cell.
  for (let ix = -1; ix <= 2; ix += 1) {
    for (let iy = -1; iy <= 2; iy += 1) {
      const cx = gx0 + ix * g;
      const cy = gy0 + iy * g;
      consider(cx, cy);
      // Mid of horizontal edge (on horizontal grid line).
      if (iy <= 1) consider(cx + half, cy);
      // Mid of vertical edge (on vertical grid line).
      if (ix <= 1) consider(cx, cy + half);
    }
  }

  return { x: bestX, y: bestY };
}

export { resolvePenPlaceAction, reversePenAnchors } from './penPath';

/**
 * Empty draft + click near an open pen/path endpoint → resume that stroke
 * (so re-clicking the same landing links instead of starting a disconnected path).
 */
export function findOpenPenEndpointResume(
  document: SceneDocument,
  x: number,
  y: number,
  threshold: number
): { nodeId: string; anchors: PenAnchor[] } | null {
  const set = document?.deltaSetLike;
  if (!set || !(threshold > 0)) return null;
  let best: { nodeId: string; anchors: PenAnchor[]; dist: number } | null = null;
  for (const id of Object.keys(set)) {
    const node = set[id];
    if (!isEditablePathNode(node)) continue;
    const closed =
      node.attrs?.closed === true ||
      node.attrs?.closed === 'true' ||
      /\sZ\s*$/i.test(String(node.attrs?.path || node.attrs?.d || ''));
    if (closed) continue;
    const raw = String(node.attrs?.path || node.attrs?.d || '');
    if (!raw.trim()) continue;
    const { left, top } = nodeLeftTop(document, node);
    const subs = penSubpathsFromD(raw);
    for (const s of subs) {
      if (s.closed || s.anchors.length < 2) continue;
      const scene = offsetAnchors(s.anchors, left, top);
      const first = scene[0];
      const last = scene[scene.length - 1];
      const dFirst = Math.hypot(x - first.x, y - first.y);
      const dLast = Math.hypot(x - last.x, y - last.y);
      if (dLast <= threshold && (!best || dLast < best.dist)) {
        best = { nodeId: id, anchors: scene, dist: dLast };
      }
      if (dFirst <= threshold && (!best || dFirst < best.dist)) {
        best = { nodeId: id, anchors: reversePenAnchors(scene), dist: dFirst };
      }
    }
  }
  return best ? { nodeId: best.nodeId, anchors: best.anchors } : null;
}

type HandleSide = 'in' | 'out';

type HandleHit = { index: number; side: HandleSide };

type DragKind =
  | { kind: 'place' }
  | { kind: 'close' }
  | { kind: 'handle'; index: number; side: HandleSide; mirror: boolean };

type PenDrawFeatureProps = {
  enabled: boolean;
  artboard: { width: number; height: number };
  paperEl: HTMLElement | null;
  stageEl?: HTMLElement | null;
  strokeColor?: string;
  strokeWidth?: number;
  /** Snap anchors to document grid corners (default on). Hold Ctrl to place free. */
  gridSnap?: boolean;
  gridSize?: number;
  onCommit: (
    pathD: string,
    box: { left: number; top: number; width: number; height: number },
    closed: boolean,
    opts?: { replaceNodeId?: string }
  ) => void;
  onCancel?: () => void;
  hitTest?: (
    x: number,
    y: number,
    screen?: { clientX: number; clientY: number }
  ) => string | null;
  onEditExistingPath?: (nodeId: string) => void;
  document?: any;
};

const HANDLE_HIT_PX = 14;
const ANCHOR_HIT_PX = 16;
const ANCHOR_DBL_MS = 450;

/** Same as SelectionChrome: page size = screenPx / zoom under camera scale. */
const ANCHOR_VIS_PX = 8;
const HANDLE_VIS_PX = 7;
const STROKE_PX = 1.5;
const HANDLE_STROKE_PX = 1.25;
const LINK_STROKE_PX = 1;
const SEL_BASELINE = '#3388ff';

/** Scene-space radius matching ~screenPx at current camera zoom. */
function hitRadiusScene(zoom: number, screenPx: number) {
  return screenPx / Math.max(0.05, zoom || 1);
}

type AnchorDraw = {
  x: number;
  y: number;
  r: number;
  fill: string;
  strokeColor: string;
  /** Soft halo (close-target / hover) — same SVG as ink so knobs stay seated. */
  ringR?: number;
};

type HandleDraw = {
  x: number;
  y: number;
  r: number;
  active: boolean;
};

function AnchorKnobSvg({ a, strokeW }: { a: AnchorDraw; strokeW: number }) {
  return (
    <g>
      {a.ringR != null && a.ringR > a.r ? (
        <circle
          cx={a.x}
          cy={a.y}
          r={a.ringR}
          fill="none"
          stroke={SEL_BASELINE}
          strokeWidth={strokeW}
          opacity={0.45}
        />
      ) : null}
      <circle
        cx={a.x}
        cy={a.y}
        r={a.r}
        fill={a.fill}
        stroke={a.strokeColor}
        strokeWidth={strokeW}
      />
    </g>
  );
}

function HandleDiamondSvg({ h, strokeW }: { h: HandleDraw; strokeW: number }) {
  const d = `M ${h.x} ${h.y - h.r} L ${h.x + h.r} ${h.y} L ${h.x} ${h.y + h.r} L ${h.x - h.r} ${h.y} Z`;
  return (
    <path
      d={d}
      fill={h.active ? SEL_BASELINE : '#fff'}
      stroke={h.active ? SEL_BASELINE : '#383838'}
      strokeWidth={strokeW}
    />
  );
}

function hitHandle(
  anchors: PenAnchor[],
  p: { x: number; y: number },
  radius: number
): HandleHit | null {
  let best: HandleHit | null = null;
  let bestD = radius;
  for (let i = 0; i < anchors.length; i += 1) {
    const a = anchors[i];
    if (a.outX != null && a.outY != null) {
      const d = Math.hypot(p.x - a.outX, p.y - a.outY);
      if (d <= bestD) {
        bestD = d;
        best = { index: i, side: 'out' };
      }
    }
    if (a.inX != null && a.inY != null) {
      const d = Math.hypot(p.x - a.inX, p.y - a.inY);
      if (d <= bestD) {
        bestD = d;
        best = { index: i, side: 'in' };
      }
    }
  }
  return best;
}

/** Nearest anchor index within hit radius, or -1. */
function hitAnchor(
  anchors: PenAnchor[],
  p: { x: number; y: number },
  radius: number
): number {
  let best = -1;
  let bestD = radius;
  for (let i = 0; i < anchors.length; i += 1) {
    const a = anchors[i];
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Clear one bezier handle side (keep the other). */
function clearHandle(anchor: PenAnchor, side: HandleSide): PenAnchor {
  if (side === 'out') {
    const next: PenAnchor = { x: anchor.x, y: anchor.y };
    if (anchor.inX != null && anchor.inY != null) {
      next.inX = anchor.inX;
      next.inY = anchor.inY;
    }
    return next;
  }
  const next: PenAnchor = { x: anchor.x, y: anchor.y };
  if (anchor.outX != null && anchor.outY != null) {
    next.outX = anchor.outX;
    next.outY = anchor.outY;
  }
  return next;
}

/** Drop both in/out handles ??sharp corner. */
function clearAllHandles(anchor: PenAnchor): PenAnchor {
  return { x: anchor.x, y: anchor.y };
}

function setHandle(
  anchor: PenAnchor,
  side: HandleSide,
  hx: number,
  hy: number,
  mirror: boolean
): PenAnchor {
  if (mirror) {
    if (side === 'out') {
      return withMirroredHandles({ x: anchor.x, y: anchor.y, outX: hx, outY: hy });
    }
    // Dragging in with mirror ??set out as mirror of in.
    const mirrored = withMirroredHandles({
      x: anchor.x,
      y: anchor.y,
      outX: anchor.x * 2 - hx,
      outY: anchor.y * 2 - hy,
    });
    return mirrored;
  }
  if (side === 'out') {
    return {
      x: anchor.x,
      y: anchor.y,
      outX: hx,
      outY: hy,
      ...(anchor.inX != null && anchor.inY != null
        ? { inX: anchor.inX, inY: anchor.inY }
        : {}),
    };
  }
  return {
    x: anchor.x,
    y: anchor.y,
    inX: hx,
    inY: hy,
    ...(anchor.outX != null && anchor.outY != null
      ? { outX: anchor.outX, outY: anchor.outY }
      : {}),
  };
}

/**
 * Bezier pen tool: click anchors, drag for handles, re-drag / delete in|out handles,
 * click curved anchor to clear handles (corner), close near first,
 * Enter / Esc / toolbar??????finish as open path.
 */
function PenDrawFeature({
  enabled,
  artboard,
  paperEl,
  stageEl = null,
  strokeColor = '#333333',
  strokeWidth = 2,
  gridSnap = true,
  gridSize = 1,
  onCommit,
  onCancel,
  hitTest,
  onEditExistingPath,
  document,
}: PenDrawFeatureProps) {
  const camera = useRcbCamera();
  const toScene = useRcbScreenToScene();
  const [anchors, setAnchors] = useState<PenAnchor[]>([]);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [closeHot, setCloseHot] = useState(false);
  const [closing, setClosing] = useState(false);
  const [selectedHandle, setSelectedHandle] = useState<HandleHit | null>(null);
  const [hoverHandle, setHoverHandle] = useState<HandleHit | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<number | null>(null);
  const placingRef = useRef<PenAnchor | null>(null);
  const draggingRef = useRef(false);
  const closingRef = useRef(false);
  const dragKindRef = useRef<DragKind | null>(null);
  const anchorsRef = useRef<PenAnchor[]>([]);
  const selectedHandleRef = useRef<HandleHit | null>(null);
  const prevCursorRef = useRef<string>('');
  /** Last click on an existing anchor ??second click within window ??corner. */
  const lastAnchorTapRef = useRef<{ index: number; t: number } | null>(null);
  /** When set, finish() patches this open path instead of creating a new node. */
  const resumeNodeIdRef = useRef<string | null>(null);
  const onCommitRef = useRef(onCommit);
  const onCancelRef = useRef(onCancel);
  const strokeWidthRef = useRef(strokeWidth);
  const gridSnapRef = useRef(gridSnap);
  const gridSizeRef = useRef(gridSize);
  onCommitRef.current = onCommit;
  onCancelRef.current = onCancel;
  strokeWidthRef.current = strokeWidth;
  gridSnapRef.current = gridSnap;
  gridSizeRef.current = gridSize;
  anchorsRef.current = anchors;
  selectedHandleRef.current = selectedHandle;

  const setPaperCursor = (el: HTMLElement, next: string) => {
    if (prevCursorRef.current === next) return;
    prevCursorRef.current = next;
    el.style.cursor = next;
  };

  const resetDraft = () => {
    setAnchors([]);
    setCloseHot(false);
    setCursor(null);
    setClosing(false);
    setSelectedHandle(null);
    setHoverHandle(null);
    setHoverAnchor(null);
    placingRef.current = null;
    closingRef.current = false;
    draggingRef.current = false;
    dragKindRef.current = null;
    lastAnchorTapRef.current = null;
    resumeNodeIdRef.current = null;
  };

  /**
   * Commit open/closed path.
   * `leaveTool`: Esc / ??/ switch-to-select ??exit to select after commit.
   * Closing the path by clicking the first point keeps the pen tool for the next stroke.
   */
  const finish = (closed: boolean, opts?: { leaveTool?: boolean }) => {
    const list = anchorsRef.current;
    const leave = Boolean(opts?.leaveTool);
    closingRef.current = false;
    dragKindRef.current = null;
    setClosing(false);
    setSelectedHandle(null);
    if (list.length < 2) {
      resetDraft();
      if (leave) onCancelRef.current?.();
      return;
    }
    const sw = Math.max(1, Number(strokeWidthRef.current) || 2);
    const bounds = boundsOfAnchors(list, closed);
    const pad = sw / 2;
    const origin = {
      left: bounds.left - pad,
      top: bounds.top - pad,
      width: bounds.width + pad * 2,
      height: bounds.height + pad * 2,
    };
    const local = localizeAnchors(list, origin.left, origin.top);
    const d = penAnchorsToD(local, closed);
    const replaceNodeId = resumeNodeIdRef.current || undefined;
    resetDraft();
    onCommitRef.current(d, origin, closed, replaceNodeId ? { replaceNodeId } : undefined);
    if (leave) onCancelRef.current?.();
  };

  // Switching away from pen (e.g. bottom Select): commit draft, then tear down.
  useEffect(() => {
    if (enabled) return;
    const list = anchorsRef.current;
    if (list.length >= 2) {
      const sw = Math.max(1, Number(strokeWidthRef.current) || 2);
      const bounds = boundsOfAnchors(list, false);
      const pad = sw / 2;
      const origin = {
        left: bounds.left - pad,
        top: bounds.top - pad,
        width: bounds.width + pad * 2,
        height: bounds.height + pad * 2,
      };
      const local = localizeAnchors(list, origin.left, origin.top);
      const d = penAnchorsToD(local, false);
      const replaceNodeId = resumeNodeIdRef.current || undefined;
      onCommitRef.current(d, origin, false, replaceNodeId ? { replaceNodeId } : undefined);
    }
    resetDraft();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onSeed = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const x = Number(detail.x);
      const y = Number(detail.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (anchorsRef.current.length > 0) return;
      const anchor = snapPenAnchorPoint(x, y, gridSizeRef.current, !gridSnapRef.current);
      placingRef.current = null;
      draggingRef.current = false;
      setAnchors([anchor]);
      setCursor(anchor);
      setSelectedHandle(null);
      setHoverHandle(null);
      setHoverAnchor(null);
    };
    window.addEventListener('resume:pen-seed', onSeed);
    return () => window.removeEventListener('resume:pen-seed', onSeed);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const hitEl = stageEl || paperEl;

    const radii = () => ({
      anchor: hitRadiusScene(camera.zoom, ANCHOR_HIT_PX),
      handle: hitRadiusScene(camera.zoom, HANDLE_HIT_PX),
    });

    const nearClose = (p: { x: number; y: number }) => {
      const list = anchorsRef.current;
      if (list.length < 2) return false;
      // Hover/close halo: tip on the first landing (same rule as click close).
      const action = resolvePenPlaceAction({
        anchors: list,
        snapped: p,
        raw: p,
        anchorHitRadius: Math.max(radii().anchor, CLOSE_THRESHOLD / Math.max(1, camera.zoom || 1)),
        closeThreshold: CLOSE_THRESHOLD,
      });
      return action.kind === 'close';
    };

    const anchorHasHandles = (a: PenAnchor) =>
      (a.inX != null && a.inY != null) || (a.outX != null && a.outY != null);

    const cornerizeAnchor = (index: number) => {
      setAnchors((prev) => {
        if (!prev[index]) return prev;
        const next = [...prev];
        next[index] = clearAllHandles(next[index]);
        return next;
      });
      setSelectedHandle(null);
      setHoverHandle(null);
      setHoverAnchor(index);
    };

    const exitOpen = () => {
      // Do not clear hitEl.style.cursor ? RcbCanvas owns the tool cursor via React.
      // Clearing here races the next tool (e.g. pencil) and wipes its icon cursor.
      // Esc / Enter: commit open path and leave the pen tool.
      finish(false, { leaveTool: true });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        exitOpen();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = selectedHandleRef.current;
        if (!sel) return;
        e.preventDefault();
        e.stopPropagation();
        setAnchors((prev) => {
          if (!prev[sel.index]) return prev;
          const next = [...prev];
          next[sel.index] = clearHandle(next[sel.index], sel.side);
          return next;
        });
        setSelectedHandle(null);
        setHoverHandle(null);
      }
    };

    const onExitEvent = () => exitOpen();

    // Always listen while pen is active ??do not require hitEl (Esc / ??must work).
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resume:exit-pen', onExitEvent);

    if (!hitEl) {
      return () => {
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resume:exit-pen', onExitEvent);
      };
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const raw = toScene(e.clientX, e.clientY);
      // Hit-test with raw pointer; place new anchors on grid corners (Ctrl = free).
      const skipGrid = e.ctrlKey || !gridSnapRef.current;
      const p = snapPenAnchorPoint(raw.x, raw.y, gridSizeRef.current, skipGrid);
      const list = anchorsRef.current;
      const { anchor: anchorR, handle: handleR } = radii();

      // Prefer the anchor disc over nearby handle diamonds (click center ??corner).
      const anchorIdx = hitAnchor(list, raw, anchorR);
      const handleHit = anchorIdx >= 0 ? null : hitHandle(list, raw, handleR);

      // Alt/Option + click handle ??delete that side (in = left, out = right).
      if (handleHit && (e.altKey || e.metaKey)) {
        setAnchors((prev) => {
          const next = [...prev];
          next[handleHit.index] = clearHandle(next[handleHit.index], handleHit.side);
          return next;
        });
        setSelectedHandle(null);
        setHoverHandle(null);
        setHoverAnchor(null);
        setPaperCursor(hitEl || paperEl, PEN_CURSOR);
        return;
      }

      if (handleHit) {
        // Enter handle-edit mode (adjust curvature); release returns to drawing.
        draggingRef.current = false;
        placingRef.current = null;
        closingRef.current = false;
        lastAnchorTapRef.current = null;
        setClosing(false);
        setCloseHot(false);
        setCursor(null);
        setSelectedHandle(handleHit);
        setHoverHandle(handleHit);
        setHoverAnchor(null);
        setPaperCursor(hitEl || paperEl, 'grabbing');
        // Shift keeps opposite handle mirrored while dragging.
        dragKindRef.current = {
          kind: 'handle',
          index: handleHit.index,
          side: handleHit.side,
          mirror: e.shiftKey,
        };
        hitEl.setPointerCapture?.(e.pointerId);
        return;
      }

      setSelectedHandle(null);
      setHoverHandle(null);
      setPaperCursor(hitEl || paperEl, PEN_CURSOR);

      // Empty draft: resume open stroke from its endpoint (same landing → link).
      if (list.length === 0) {
        const resume = findOpenPenEndpointResume(
          document,
          p.x,
          p.y,
          Math.max(CLOSE_THRESHOLD, radii().anchor)
        );
        if (resume) {
          resumeNodeIdRef.current = resume.nodeId;
          placingRef.current = null;
          draggingRef.current = false;
          dragKindRef.current = null;
          lastAnchorTapRef.current = null;
          setCloseHot(false);
          setAnchors(resume.anchors);
          setCursor(p);
          setHoverAnchor(null);
          return;
        }
      }

      const action = resolvePenPlaceAction({
        anchors: list,
        snapped: p,
        raw,
        anchorHitRadius: radii().anchor,
        closeThreshold: CLOSE_THRESHOLD,
      });

      if (action.kind === 'close') {
        closingRef.current = true;
        draggingRef.current = false;
        placingRef.current = null;
        lastAnchorTapRef.current = null;
        dragKindRef.current = { kind: 'close' };
        setClosing(true);
        setCloseHot(true);
        setHoverAnchor(null);
        setCursor(null);
        hitEl.setPointerCapture?.(e.pointerId);
        return;
      }

      // Click / double-click existing anchor: clear handles ??sharp corner.
      if (action.kind === 'anchor') {
        const anchorIdx = action.index;
        const a = list[anchorIdx];
        const now = performance.now();
        const last = lastAnchorTapRef.current;
        const isDbl =
          last != null && last.index === anchorIdx && now - last.t <= ANCHOR_DBL_MS;
        lastAnchorTapRef.current = isDbl ? null : { index: anchorIdx, t: now };

        // Clear on first click if curved, or on double-click (always).
        if (anchorHasHandles(a) || isDbl) {
          cornerizeAnchor(anchorIdx);
          lastAnchorTapRef.current = null;
        } else {
          setHoverAnchor(anchorIdx);
        }
        draggingRef.current = false;
        placingRef.current = null;
        dragKindRef.current = null;
        setCloseHot(false);
        setCursor(p);
        setPaperCursor(hitEl || paperEl, 'pointer');
        return;
      }

      lastAnchorTapRef.current = null;
      setHoverAnchor(null);

      const anchor: PenAnchor = { x: action.x, y: action.y };
      placingRef.current = anchor;
      draggingRef.current = false;
      dragKindRef.current = { kind: 'place' };
      setCloseHot(false);
      setAnchors((prev) => [...prev, anchor]);
      hitEl.setPointerCapture?.(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      const raw = toScene(e.clientX, e.clientY);
      const skipGrid = e.ctrlKey || !gridSnapRef.current;
      const p = snapPenAnchorPoint(raw.x, raw.y, gridSizeRef.current, skipGrid);
      const drag = dragKindRef.current;
      const { anchor: anchorR, handle: handleR } = radii();

      if (drag?.kind === 'handle') {
        draggingRef.current = true;
        setPaperCursor(hitEl || paperEl, 'grabbing');
        setAnchors((prev) => {
          if (!prev[drag.index]) return prev;
          const next = [...prev];
          // Handles stay free (curvature); only anchors snap to grid corners.
          next[drag.index] = setHandle(
            next[drag.index],
            drag.side,
            raw.x,
            raw.y,
            drag.mirror || e.shiftKey
          );
          return next;
        });
        return;
      }

      if (closingRef.current || drag?.kind === 'close') {
        const first = anchorsRef.current[0];
        if (!first) return;
        const dist = Math.hypot(raw.x - first.x, raw.y - first.y);
        if (dist > 3) draggingRef.current = true;
        if (draggingRef.current) {
          const updated = withMirroredHandles({
            x: first.x,
            y: first.y,
            outX: raw.x,
            outY: raw.y,
          });
          setAnchors((prev) => {
            if (!prev.length) return prev;
            const next = [...prev];
            next[0] = updated;
            return next;
          });
        }
        return;
      }

      const placing = placingRef.current;
      if (placing) {
        const dist = Math.hypot(raw.x - placing.x, raw.y - placing.y);
        if (dist > 3) draggingRef.current = true;
        if (draggingRef.current) {
          placing.outX = raw.x;
          placing.outY = raw.y;
          const mirrored = withMirroredHandles(placing);
          setAnchors((prev) => {
            if (!prev.length) return prev;
            const next = [...prev];
            next[next.length - 1] = mirrored;
            return next;
          });
        }
        setCloseHot(false);
        setCursor(null);
        setHoverHandle(null);
        setHoverAnchor(null);
        setPaperCursor(hitEl || paperEl, PEN_CURSOR);
        return;
      }

      // Idle: prefer anchor hover, then handle diamonds (raw hit). Tip always
      // sticks to grid corners / edge mids so the CSS pen cursor tip ≠ place lattice.
      const aIdx = hitAnchor(anchorsRef.current, raw, anchorR);
      if (aIdx >= 0) {
        setHoverAnchor(aIdx);
        setHoverHandle(null);
        setPaperCursor(hitEl || paperEl, 'pointer');
        setCloseHot(false);
        setCursor(p);
        return;
      }

      const hit = hitHandle(anchorsRef.current, raw, handleR);
      setHoverAnchor(null);
      setHoverHandle(hit);
      if (hit) {
        setPaperCursor(hitEl || paperEl, 'grab');
        setCloseHot(false);
        setCursor(p);
        return;
      }

      setPaperCursor(hitEl || paperEl, PEN_CURSOR);
      // Rubber-band / snap tip sticks to grid corners + edge midpoints.
      setCursor(p);
      setCloseHot(nearClose(p));
    };

    const onUp = (e: PointerEvent) => {
      try {
        hitEl.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }

      if (dragKindRef.current?.kind === 'handle') {
        dragKindRef.current = null;
        draggingRef.current = false;
        // Back to drawing: restore rubber-band from current pointer.
        const rawUp = toScene(e.clientX, e.clientY);
        const skipUp = e.ctrlKey || !gridSnapRef.current;
        const p = snapPenAnchorPoint(rawUp.x, rawUp.y, gridSizeRef.current, skipUp);
        const { anchor: anchorR, handle: handleR } = radii();
        const aIdx = hitAnchor(anchorsRef.current, rawUp, anchorR);
        if (aIdx >= 0) {
          setHoverAnchor(aIdx);
          setHoverHandle(null);
          setPaperCursor(hitEl || paperEl, 'pointer');
          setCloseHot(false);
        } else {
          const hit = hitHandle(anchorsRef.current, rawUp, handleR);
          setHoverAnchor(null);
          setHoverHandle(hit);
          setPaperCursor(hitEl || paperEl, hit ? 'grab' : PEN_CURSOR);
          setCloseHot(!hit && nearClose(p));
        }
        setCursor(p);
        return;
      }

      if (closingRef.current) {
        closingRef.current = false;
        draggingRef.current = false;
        dragKindRef.current = null;
        setClosing(false);
        finish(true);
        return;
      }

      if (!placingRef.current) return;
      placingRef.current = null;
      draggingRef.current = false;
      dragKindRef.current = null;
      const rawUp = toScene(e.clientX, e.clientY);
      const skipUp = e.ctrlKey || !gridSnapRef.current;
      setCursor(snapPenAnchorPoint(rawUp.x, rawUp.y, gridSizeRef.current, skipUp));
      setPaperCursor(hitEl || paperEl, PEN_CURSOR);
    };

    const onLeave = () => {
      if (placingRef.current || closingRef.current || dragKindRef.current) return;
      setCursor(null);
      setCloseHot(false);
      setHoverHandle(null);
      setHoverAnchor(null);
      setPaperCursor(hitEl, PEN_CURSOR);
    };

    const onDbl = (e: MouseEvent) => {
      if (!hitTest || !onEditExistingPath) return;
      if (anchorsRef.current.length > 0) return;
      const p = toScene(e.clientX, e.clientY);
      const id = hitTest(p.x, p.y, { clientX: e.clientX, clientY: e.clientY });
      if (!id) return;
      const node = document?.deltaSetLike?.[id];
      if (!isEditablePathNode(node)) return;
      e.preventDefault();
      e.stopPropagation();
      onEditExistingPath(id);
    };

    setPaperCursor(hitEl, PEN_CURSOR);
    // Capture so anchors register even when shapes SVG sits under the pointer.
    hitEl.addEventListener('pointerdown', onDown, true);
    hitEl.addEventListener('pointermove', onMove);
    hitEl.addEventListener('pointerup', onUp);
    hitEl.addEventListener('pointerleave', onLeave);
    hitEl.addEventListener('dblclick', onDbl, true);
    return () => {
      hitEl.removeEventListener('pointerdown', onDown, true);
      hitEl.removeEventListener('pointermove', onMove);
      hitEl.removeEventListener('pointerup', onUp);
      hitEl.removeEventListener('pointerleave', onLeave);
      hitEl.removeEventListener('dblclick', onDbl, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resume:exit-pen', onExitEvent);
      prevCursorRef.current = '';
      // Leave style.cursor alone ? React (RcbCanvas) sets the next tool cursor after commit;
      // assigning '' here runs in effect cleanup and erases pencil/bucket icons.
    };
  }, [enabled, paperEl, stageEl, camera.zoom, toScene, onCommit, onCancel, strokeWidth, hitTest, onEditExistingPath, document]);

  if (!enabled) return null;

  const d = penAnchorsToD(anchors, false);
  const closePreviewD = closing || closeHot ? penAnchorsToD(anchors, true) : '';
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  const showClosePreview =
    (closing || closeHot) && first && last && anchors.length >= 2 && !placingRef.current;

  const sw = Math.max(1, Number(strokeWidth) || 1);
  const z = Math.max(0.05, camera.zoom || 1);
  const inv = 1 / z;
  const stroke = STROKE_PX * inv;
  const handleStroke = HANDLE_STROKE_PX * inv;
  const linkStroke = LINK_STROKE_PX * inv;
  // Same as path-edit after outline: real border width in scene units (not a
  // screen-capped hairline that drifts from committed SVG ink).
  const pathSw = sw;
  const anchorR = Math.max(0.01, (ANCHOR_VIS_PX * inv) / 2 - stroke / 2);
  const anchorRHot = Math.max(0.01, ((ANCHOR_VIS_PX + 2) * inv) / 2 - stroke / 2);
  const handleR = Math.max(0.01, (HANDLE_VIS_PX * inv) / 2 - handleStroke / 2);
  const handleRHot = Math.max(0.01, ((HANDLE_VIS_PX + 2) * inv) / 2 - handleStroke / 2);

  const handleSelected = (i: number, side: HandleSide) =>
    selectedHandle?.index === i && selectedHandle.side === side;
  const handleHovered = (i: number, side: HandleSide) =>
    hoverHandle?.index === i && hoverHandle.side === side;

  type LinkSeg = { x1: number; y1: number; x2: number; y2: number };
  const linkSegs: LinkSeg[] = [];
  const anchorsDraw: AnchorDraw[] = [];
  const handlesDraw: HandleDraw[] = [];

  anchors.forEach((a, i) => {
    const isStart = i === 0;
    const hot = isStart && (closeHot || closing) && anchors.length >= 2;
    const hovered = hoverAnchor === i;
    const pushHandle = (side: HandleSide, hx: number, hy: number) => {
      const active = handleSelected(i, side) || handleHovered(i, side);
      linkSegs.push({ x1: a.x, y1: a.y, x2: hx, y2: hy });
      handlesDraw.push({
        x: hx,
        y: hy,
        r: active ? handleRHot : handleR,
        active,
      });
    };
    if (a.outX != null && a.outY != null) pushHandle('out', a.outX, a.outY);
    if (a.inX != null && a.inY != null) pushHandle('in', a.inX, a.inY);

    if (hot) {
      anchorsDraw.push({
        x: a.x,
        y: a.y,
        r: anchorR,
        fill: SEL_BASELINE,
        strokeColor: '#fff',
        ringR: anchorR + 3 * inv,
      });
    } else {
      anchorsDraw.push({
        x: a.x,
        y: a.y,
        r: hovered ? anchorRHot : anchorR,
        fill: hovered ? SEL_BASELINE : isStart ? '#383838' : '#fff',
        strokeColor: hovered ? '#fff' : '#383838',
        ringR: hovered ? anchorRHot + 2 * inv : undefined,
      });
    }
  });

  const rubberBand =
    !showClosePreview &&
    cursor &&
    anchors.length > 0 &&
    last &&
    !hoverHandle &&
    hoverAnchor == null
      ? { x1: last.x, y1: last.y, x2: cursor.x, y2: cursor.y }
      : null;

  // Snapped place tip (even before first click) — CSS pen cursor tip ≠ lattice.
  const snapTip =
    cursor && !hoverHandle && hoverAnchor == null && !placingRef.current
      ? cursor
      : null;

  return (
    <PenInkPreviewSvg
      pathD={d}
      closePreviewD={showClosePreview ? closePreviewD : ''}
      rubberBand={rubberBand}
      snapTip={snapTip}
      linkSegs={linkSegs}
      strokeColor={strokeColor || '#333333'}
      pathSw={pathSw}
      hairlineSw={stroke}
      linkSw={linkStroke}
      inv={inv}
      anchorsDraw={anchorsDraw}
      handlesDraw={handlesDraw}
      knobStroke={stroke}
      handleStroke={handleStroke}
    />
  );
}

function PenInkPreviewSvg({
  pathD,
  closePreviewD,
  rubberBand,
  snapTip,
  linkSegs,
  strokeColor,
  pathSw,
  hairlineSw,
  linkSw,
  inv,
  anchorsDraw,
  handlesDraw,
  knobStroke,
  handleStroke,
}: {
  pathD: string;
  closePreviewD: string;
  rubberBand: { x1: number; y1: number; x2: number; y2: number } | null;
  snapTip: { x: number; y: number } | null;
  linkSegs: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  strokeColor: string;
  pathSw: number;
  hairlineSw: number;
  linkSw: number;
  inv: number;
  anchorsDraw: AnchorDraw[];
  handlesDraw: HandleDraw[];
  knobStroke: number;
  handleStroke: number;
}) {
  // Remount when shared world SVG appears (portal target).
  const [, setWorldEpoch] = useState(() => getSceneWorldEpoch());
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
  const previewMount = getSceneDrawPreviewMount();

  const tipR = Math.max(0.01, (3 * inv) / 2);
  const tipArm = 4 * inv;

  const chrome: ReactNode = (
    <g data-pen-draw-preview pointerEvents="none" aria-hidden>
      {linkSegs.map((s, i) => (
        <line
          key={`link-${i}`}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke="#8b8b8b"
          strokeWidth={linkSw}
          strokeLinecap="butt"
        />
      ))}
      {pathD ? (
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth={pathSw}
          strokeLinecap="butt"
          strokeLinejoin="miter"
        />
      ) : null}
      {closePreviewD ? (
        <path
          d={closePreviewD}
          fill="none"
          stroke={SEL_BASELINE}
          strokeWidth={hairlineSw}
          strokeLinecap="butt"
          strokeLinejoin="miter"
          strokeDasharray={`${4 * inv} ${3 * inv}`}
          opacity={0.85}
        />
      ) : rubberBand ? (
        <line
          x1={rubberBand.x1}
          y1={rubberBand.y1}
          x2={rubberBand.x2}
          y2={rubberBand.y2}
          stroke="#8b8b8b"
          strokeWidth={linkSw}
          strokeDasharray={`${3 * inv} ${3 * inv}`}
          opacity={0.55}
          strokeLinecap="butt"
        />
      ) : null}
      {snapTip ? (
        <g data-pen-snap-tip="1">
          {/* Fill-only + crisp: white stroke made the tip look ~0.5–1px off the lattice. */}
          <circle
            cx={snapTip.x}
            cy={snapTip.y}
            r={tipR}
            fill={SEL_BASELINE}
            stroke="none"
            shapeRendering="geometricPrecision"
          />
          <path
            d={`M ${snapTip.x - tipArm} ${snapTip.y} L ${snapTip.x + tipArm} ${snapTip.y} M ${snapTip.x} ${snapTip.y - tipArm} L ${snapTip.x} ${snapTip.y + tipArm}`}
            fill="none"
            stroke={SEL_BASELINE}
            strokeWidth={hairlineSw}
            strokeLinecap="butt"
            shapeRendering="geometricPrecision"
            opacity={0.9}
          />
        </g>
      ) : null}
      {handlesDraw.map((h, i) => (
        <HandleDiamondSvg key={`h-${i}`} h={h} strokeW={handleStroke} />
      ))}
      {anchorsDraw.map((a, i) => (
        <AnchorKnobSvg key={`a-${i}`} a={a} strokeW={knobStroke} />
      ))}
    </g>
  );

  const hasInk =
    Boolean(pathD) ||
    Boolean(closePreviewD) ||
    Boolean(rubberBand) ||
    Boolean(snapTip) ||
    anchorsDraw.length > 0 ||
    handlesDraw.length > 0;

  if (!hasInk || !previewMount) return null;

  return createPortal(chrome, previewMount);
}

export default memo(PenDrawFeature);
