/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/tools/PenPathEditFeature.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';
import { useEffect, useRef, useState, memo, type ReactNode } from 'react';
import { createPortal } from '@/features/canvas/adapters/recombynReactDom';
import {
  useRcbCamera,
  useRcbScreenToScene,
} from '../camera/context';
import {
  boundsOfAnchors,
  findClosestPathHit,
  localizeAnchors,
  offsetAnchors,
  penAnchorsToD,
  penSubpathsFromD,
  penSubpathsToD,
  withMirroredHandles,
  type PenAnchor,
} from './penPath';
import { nodeLeftTop } from '../scene/paint/sceneToSvg';
import { normalizePathDForEdit } from '../scene/paint/outlineToPath';
import { snapPenAnchorPoint } from './PenDrawFeature';
import {
  getSceneDrawPreviewMount,
  getSceneWorldEpoch,
  subscribeShapeHosts,
} from '../shapes/shapeHostRegistry';

type HandleSide = 'in' | 'out';
type AnchorRef = { sub: number; index: number };
type HandleHit = AnchorRef & { side: HandleSide };

type PenSubpath = { anchors: PenAnchor[]; closed: boolean };

type DragKind =
  | { kind: 'anchor'; sub: number; index: number; ox: number; oy: number; start: PenAnchor }
  | { kind: 'handle'; sub: number; index: number; side: HandleSide; mirror: boolean }
  /** Alt-drag on an anchor: pull mirrored handles. */
  | { kind: 'convert'; sub: number; index: number; ax: number; ay: number; pulled: boolean };

function anchorHasHandles(a: PenAnchor) {
  return (
    (a.outX != null && a.outY != null) || (a.inX != null && a.inY != null)
  );
}

type Props = {
  enabled: boolean;
  nodeId: string;
  document: SceneDocument;
  paperEl: HTMLElement | null;
  stageEl?: HTMLElement | null;
  /**
   * Path-edit toolbar Pen (independent of the bottom toolstrip):
   * hover path edge → preview dot; click to draw a new path in-place
   * (never activates the global Pen tool / PenStrokeToolbar).
   */
  drawNewShapeMode?: boolean;
  /**
   * Path-edit Curve subtool — same as Alt/Option on anchors/handles
   * (pull out mirrored handles / cornerize / clear one handle).
   */
  convertPointMode?: boolean;
  /** Stroke paint for newly drawn paths (path-edit Pen). */
  newStrokeColor?: string;
  newStrokeWidth?: number;
  /** Snap anchors to grid corners (default on). Hold Ctrl to drag/place free. */
  gridSnap?: boolean;
  gridSize?: number;
  onCommitNewShape?: (payload: {
    pathD: string;
    box: { left: number; top: number; width: number; height: number };
    closed: boolean;
  }) => void;
  onCommit: (payload: {
    nodeId: string;
    pathD: string;
    box: { left: number; top: number; width: number; height: number };
    closed: boolean;
  }) => void;
  onExit: () => void;
};

const HANDLE_HIT_PX = 14;
const ANCHOR_HIT_PX = 16;
/** Screen px — hover near stroke to show a preview dot. */
const PATH_HIT_PX = 14;

/**
 * Screen-constant chrome (same contract as SelectionChrome):
 * page size = screenPx / zoom under the camera CSS scale. No Math.min caps.
 */
const ANCHOR_VIS_PX = 8;
const HANDLE_VIS_PX = 7;
const STROKE_PX = 1.5;
const HANDLE_STROKE_PX = 1.25;
const LINK_STROKE_PX = 1;
const SEL_BASELINE = '#3388ff';

function hitRadiusScene(zoom: number, screenPx: number) {
  return screenPx / Math.max(0.05, zoom || 1);
}

/**
 * Path-edit ink width in scene units.
 * Real `border-width` when stroke is on (star/polygon must not look thinner after
 * outline → path-edit). Hairline guide only when stroke is off (fill-only edit).
 */
function pathEditStrokeWidth(opts: {
  strokeEnabled: boolean;
  borderWidth: number;
  inv: number;
}): number {
  if (opts.strokeEnabled) return Math.max(0, opts.borderWidth);
  // Fill-only: screen-constant hairline so the centerline stays visible.
  return STROKE_PX * opts.inv;
}

/** In-progress draft path `d` while path-edit Pen is placing points. */
function draftPathD(
  anchors: PenAnchor[],
  cursor: { x: number; y: number } | null
): string {
  if (anchors.length >= 2) return penAnchorsToD(anchors, false);
  if (anchors.length === 1 && cursor) {
    const a = anchors[0];
    return `M ${a.x} ${a.y} L ${cursor.x} ${cursor.y}`;
  }
  return '';
}

/** Rubber-band segment from last draft anchor to cursor. */
function draftRubberBandD(
  anchors: PenAnchor[],
  cursor: { x: number; y: number } | null
): string {
  if (anchors.length < 2 || !cursor) return '';
  const last = anchors[anchors.length - 1];
  return `M ${last.x} ${last.y} L ${cursor.x} ${cursor.y}`;
}

/** Drop stacked outline verts (no handles) so knobs sit on the silhouette. */
function mergeStackedAnchors(anchors: PenAnchor[], eps = 0.55): PenAnchor[] {
  if (anchors.length < 2) return anchors;
  const out: PenAnchor[] = [];
  for (const a of anchors) {
    const last = out[out.length - 1];
    const aBusy = a.inX != null || a.outX != null;
    const lastBusy = last && (last.inX != null || last.outX != null);
    if (last && !aBusy && !lastBusy && Math.hypot(a.x - last.x, a.y - last.y) < eps) {
      continue;
    }
    out.push(a);
  }
  if (out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    const firstBusy = first.inX != null || first.outX != null;
    const lastBusy = last.inX != null || last.outX != null;
    if (!firstBusy && !lastBusy && Math.hypot(first.x - last.x, first.y - last.y) < eps) {
      out.pop();
    }
  }
  return out.length >= 2 ? out : anchors;
}

/** Merge eps from path size — thick outlines left tip/`to` pairs a few units apart.
 * Cap by the thin axis: long stroke ribbons are only `strokeWidth` tall; a diag-based
 * eps of ~6 merged the butt short-sides into 2 verts → zero-area digon (line vanished).
 */
function mergeEpsForAnchors(anchors: PenAnchor[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const a of anchors) {
    minX = Math.min(minX, a.x);
    minY = Math.min(minY, a.y);
    maxX = Math.max(maxX, a.x);
    maxY = Math.max(maxY, a.y);
  }
  if (!Number.isFinite(minX)) return 0.55;
  const w = Math.max(0, maxX - minX);
  const h = Math.max(0, maxY - minY);
  const diag = Math.hypot(w, h);
  const thin = Math.max(0.5, Math.min(w, h) || diag);
  return Math.max(0.35, Math.min(1.1, thin * 0.22, diag * 0.008));
}

type AnchorDraw = {
  x: number;
  y: number;
  r: number;
  fill: string;
  strokeColor: string;
};

type HandleDraw = {
  x: number;
  y: number;
  r: number;
  active: boolean;
};

function AnchorKnobSvg({ a, strokeW }: { a: AnchorDraw; strokeW: number }) {
  return (
    <circle
      cx={a.x}
      cy={a.y}
      r={a.r}
      fill={a.fill}
      stroke={a.strokeColor}
      strokeWidth={strokeW}
    />
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
  subs: PenSubpath[],
  p: { x: number; y: number },
  radius: number
): HandleHit | null {
  let best: HandleHit | null = null;
  let bestD = radius;
  for (let s = 0; s < subs.length; s += 1) {
    const anchors = subs[s].anchors;
    for (let i = 0; i < anchors.length; i += 1) {
      const a = anchors[i];
      if (a.outX != null && a.outY != null) {
        const d = Math.hypot(p.x - a.outX, p.y - a.outY);
        if (d <= bestD) {
          bestD = d;
          best = { sub: s, index: i, side: 'out' };
        }
      }
      if (a.inX != null && a.inY != null) {
        const d = Math.hypot(p.x - a.inX, p.y - a.inY);
        if (d <= bestD) {
          bestD = d;
          best = { sub: s, index: i, side: 'in' };
        }
      }
    }
  }
  return best;
}

function hitAnchor(subs: PenSubpath[], p: { x: number; y: number }, radius: number): AnchorRef | null {
  let best: AnchorRef | null = null;
  let bestD = radius;
  for (let s = 0; s < subs.length; s += 1) {
    const anchors = subs[s].anchors;
    for (let i = 0; i < anchors.length; i += 1) {
      const d = Math.hypot(p.x - anchors[i].x, p.y - anchors[i].y);
      if (d <= bestD) {
        bestD = d;
        best = { sub: s, index: i };
      }
    }
  }
  return best;
}

function findClosestOnSubpaths(
  subs: PenSubpath[],
  px: number,
  py: number
): { x: number; y: number; dist: number } | null {
  let best: { x: number; y: number; dist: number } | null = null;
  for (const s of subs) {
    const hit = findClosestPathHit(s.anchors, s.closed, px, py);
    if (hit && (!best || hit.dist < best.dist)) {
      best = { x: hit.x, y: hit.y, dist: hit.dist };
    }
  }
  return best;
}

function boundsOfSubpaths(subs: PenSubpath[]) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const s of subs) {
    if (s.anchors.length < 2) continue;
    const b = boundsOfAnchors(s.anchors, s.closed);
    left = Math.min(left, b.left);
    top = Math.min(top, b.top);
    right = Math.max(right, b.left + b.width);
    bottom = Math.max(bottom, b.top + b.height);
  }
  if (!Number.isFinite(left)) {
    return { left: 0, top: 0, width: 1, height: 1 };
  }
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function mapSubpathAnchor(
  subs: PenSubpath[],
  sub: number,
  index: number,
  fn: (a: PenAnchor) => PenAnchor
): PenSubpath[] {
  return subs.map((s, si) => {
    if (si !== sub) return s;
    const anchors = s.anchors.map((a, i) => (i === index ? fn(a) : a));
    return { ...s, anchors };
  });
}

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
    return withMirroredHandles({
      x: anchor.x,
      y: anchor.y,
      outX: anchor.x * 2 - hx,
      outY: anchor.y * 2 - hy,
    });
  }
  if (side === 'out') {
    return {
      x: anchor.x,
      y: anchor.y,
      outX: hx,
      outY: hy,
      ...(anchor.inX != null && anchor.inY != null ? { inX: anchor.inX, inY: anchor.inY } : {}),
    };
  }
  return {
    x: anchor.x,
    y: anchor.y,
    inX: hx,
    inY: hy,
    ...(anchor.outX != null && anchor.outY != null ? { outX: anchor.outX, outY: anchor.outY } : {}),
  };
}

function loadSceneAnchors(document: SceneDocument, nodeId: string) {
  const node = document?.deltaSetLike?.[nodeId];
  if (!node) return null;
  const raw = String(node.attrs?.path || node.attrs?.d || '');
  if (!raw.trim()) return null;
  // Normalize arcs / shorthand so anchors parse reliably after outline.
  // Keep multi-contour paths intact (do not sample into one polyline).
  const d = normalizePathDForEdit(raw) || raw;
  const { left, top } = nodeLeftTop(document, node);
  const parsed = penSubpathsFromD(d);
  if (!parsed.length) return null;
  const strokeOn =
    node.attrs?.['stroke-enabled'] !== false && node.attrs?.['stroke-enabled'] !== 'false';
  const bw = Number(node.attrs?.['border-width'] ?? node.attrs?.borderWidth ?? 0);
  const strokeWidth = strokeOn ? Math.max(0, Number.isFinite(bw) ? bw : 0) : 0;
  const strokeColor = String(node.attrs?.['border-color'] || node.attrs?.stroke || '#333333');
  const fillColor = String(node.attrs?.['fill-color'] || node.attrs?.fill || '');
  const fillEnabled =
    node.attrs?.['fill-enabled'] !== false &&
    node.attrs?.['fill-enabled'] !== 'false' &&
    fillColor &&
    fillColor !== 'transparent';
  const fillRule =
    String(node.attrs?.['fill-rule'] || node.attrs?.fillRule || 'nonzero') === 'evenodd'
      ? 'evenodd'
      : 'nonzero';
  const anyClosed = parsed.some((s) => s.closed);
  return {
    subpaths: parsed.map((s) => ({
      anchors: offsetAnchors(
        mergeStackedAnchors(s.anchors, mergeEpsForAnchors(s.anchors)),
        left,
        top
      ),
      closed: s.closed,
    })),
    strokeWidth,
    strokeColor,
    strokeEnabled: strokeOn && strokeWidth > 0,
    fill: anyClosed && fillEnabled ? fillColor : 'none',
    fillRule,
  };
}

/**
 * Double-click pen path → edit anchors / Bezier handles.
 * Exit via Esc / ✓ only. Empty-canvas click never auto-exits.
 * Path-edit Pen: hover shows a preview dot; click adds a path in-place.
 *
 * Convert point:
 * - Alt + drag anchor → pull mirrored handles
 * - Alt + click anchor with handles → remove handles (corner)
 * - Double-click anchor → remove handles
 * - Alt + click a handle → delete that side
 * - Curve subtool → same convert without Alt
 */
function PenPathEditFeature({
  enabled,
  nodeId,
  document,
  paperEl,
  stageEl = null,
  drawNewShapeMode = false,
  convertPointMode = false,
  newStrokeColor = '#333333',
  newStrokeWidth = 2,
  gridSnap = true,
  gridSize = 1,
  onCommitNewShape,
  onCommit,
  onExit,
}: Props) {
  const camera = useRcbCamera();
  const toScene = useRcbScreenToScene();
  const [subpaths, setSubpaths] = useState<PenSubpath[]>([]);
  const [strokeWidth, setStrokeWidth] = useState(0);
  const [strokeColor, setStrokeColor] = useState('#333333');
  const [strokeEnabled, setStrokeEnabled] = useState(false);
  const [fillColor, setFillColor] = useState('none');
  const [fillRule, setFillRule] = useState<'nonzero' | 'evenodd'>('nonzero');
  const [selectedHandle, setSelectedHandle] = useState<HandleHit | null>(null);
  const [hoverHandle, setHoverHandle] = useState<HandleHit | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<AnchorRef | null>(null);
  const [pathHover, setPathHover] = useState<{ x: number; y: number } | null>(null);
  /** In-place new path while path-edit Pen is active (keeps edge-hover + PathEditToolbar). */
  const [draftAnchors, setDraftAnchors] = useState<PenAnchor[]>([]);
  const [draftCursor, setDraftCursor] = useState<{ x: number; y: number } | null>(null);

  const subpathsRef = useRef<PenSubpath[]>([]);
  const strokeWidthRef = useRef(0);
  const draftAnchorsRef = useRef<PenAnchor[]>([]);
  const pathHoverRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<DragKind | null>(null);
  const dirtyRef = useRef(false);
  const lastAnchorTapRef = useRef<{ sub: number; index: number; t: number } | null>(null);
  const selectedHandleRef = useRef<HandleHit | null>(null);
  const onCommitRef = useRef(onCommit);
  const onExitRef = useRef(onExit);
  const onCommitNewShapeRef = useRef(onCommitNewShape);
  const drawNewRef = useRef(drawNewShapeMode);
  const convertPointRef = useRef(convertPointMode);
  const newStrokeWidthRef = useRef(newStrokeWidth);
  const gridSnapRef = useRef(gridSnap);
  const gridSizeRef = useRef(gridSize);
  onCommitRef.current = onCommit;
  onExitRef.current = onExit;
  onCommitNewShapeRef.current = onCommitNewShape;
  drawNewRef.current = drawNewShapeMode;
  convertPointRef.current = convertPointMode;
  newStrokeWidthRef.current = newStrokeWidth;
  gridSnapRef.current = gridSnap;
  gridSizeRef.current = gridSize;

  subpathsRef.current = subpaths;
  strokeWidthRef.current = strokeWidth;
  draftAnchorsRef.current = draftAnchors;
  pathHoverRef.current = pathHover;
  selectedHandleRef.current = selectedHandle;

  const commitDirty = () => {
    const list = subpathsRef.current;
    if (list.length && dirtyRef.current) {
      const pad = Math.max(0, strokeWidthRef.current) / 2;
      const bounds = boundsOfSubpaths(list);
      const box = {
        left: bounds.left - pad,
        top: bounds.top - pad,
        width: bounds.width + pad * 2,
        height: bounds.height + pad * 2,
      };
      const local = list.map((s) => ({
        anchors: localizeAnchors(s.anchors, box.left, box.top),
        closed: s.closed,
      }));
      const d = penSubpathsToD(local);
      onCommitRef.current({
        nodeId,
        pathD: d,
        box,
        closed: list.every((s) => s.closed),
      });
    }
    dirtyRef.current = false;
  };

  const commitDraftIfAny = (closedDraft: boolean) => {
    const list = draftAnchorsRef.current;
    if (list.length < 2) {
      setDraftAnchors([]);
      setDraftCursor(null);
      return false;
    }
    const pad = Math.max(1, newStrokeWidthRef.current) / 2;
    const bounds = boundsOfAnchors(list, closedDraft);
    const box = {
      left: bounds.left - pad,
      top: bounds.top - pad,
      width: bounds.width + pad * 2,
      height: bounds.height + pad * 2,
    };
    const local = localizeAnchors(list, box.left, box.top);
    const d = penAnchorsToD(local, closedDraft);
    onCommitNewShapeRef.current?.({ pathD: d, box, closed: closedDraft });
    setDraftAnchors([]);
    setDraftCursor(null);
    return true;
  };

  const commitAndExit = () => {
    commitDirty();
    commitDraftIfAny(false);
    setPathHover(null);
    setDraftCursor(null);
    onExitRef.current();
  };

  useEffect(() => {
    if (!drawNewShapeMode) {
      // Leaving Pen subtool: keep a 鈮?-point draft as an open path.
      commitDraftIfAny(false);
      setPathHover(null);
      setDraftCursor(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawNewShapeMode]);

  useEffect(() => {
    if (!enabled || !nodeId) {
      setSubpaths([]);
      setPathHover(null);
      setDraftAnchors([]);
      setDraftCursor(null);
      return;
    }
    const loaded = loadSceneAnchors(document, nodeId);
    if (!loaded) {
      onExitRef.current();
      return;
    }
    setSubpaths(loaded.subpaths);
    setStrokeWidth(loaded.strokeWidth);
    setStrokeColor(loaded.strokeColor);
    setStrokeEnabled(loaded.strokeEnabled);
    setFillColor(loaded.fill || 'none');
    setFillRule(loaded.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
    dirtyRef.current = false;
    dragRef.current = null;
    setSelectedHandle(null);
    setHoverHandle(null);
    setHoverAnchor(null);
    setPathHover(null);
    setDraftAnchors([]);
    setDraftCursor(null);
    // Reload when path geometry changes (e.g. path-edit pen boolean union).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    nodeId,
    String(document?.deltaSetLike?.[nodeId]?.attrs?.path || document?.deltaSetLike?.[nodeId]?.attrs?.d || ''),
    Number(document?.deltaSetLike?.[nodeId]?.width),
    Number(document?.deltaSetLike?.[nodeId]?.height),
  ]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onExitToolbar = () => commitAndExit();
    window.addEventListener('resume:exit-path-edit', onExitToolbar);
    return () => window.removeEventListener('resume:exit-path-edit', onExitToolbar);
    // commitAndExit closes over refs 鈥?stable enough for this listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nodeId]);

  useEffect(() => {
    const hitEl = stageEl || paperEl;
    if (!enabled || !hitEl) return undefined;

    const radii = () => ({
      anchor: hitRadiusScene(camera.zoom, ANCHOR_HIT_PX),
      handle: hitRadiusScene(camera.zoom, HANDLE_HIT_PX),
      path: hitRadiusScene(camera.zoom, PATH_HIT_PX),
    });

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-sel-toolbar],[data-frame-toolbar],[data-text-inline-editor]')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const p = toScene(e.clientX, e.clientY);
      const list = subpathsRef.current;
      const { anchor: anchorR, handle: handleR } = radii();

      // Path-edit Pen: draw a new path in-place (keep edge hover; never leave to Pen tool).
      if (drawNewRef.current) {
        const draft = draftAnchorsRef.current;
        const skipGrid = e.ctrlKey || !gridSnapRef.current;
        const place = snapPenAnchorPoint(p.x, p.y, gridSizeRef.current, skipGrid);
        if (draft.length >= 2) {
          const first = draft[0];
          const last = draft[draft.length - 1];
          const onFirst =
            Math.hypot(place.x - first.x, place.y - first.y) <= 0.75 ||
            Math.hypot(p.x - first.x, p.y - first.y) <= radii().anchor;
          const onLast =
            Math.hypot(place.x - last.x, place.y - last.y) <= 0.75 ||
            Math.hypot(p.x - last.x, p.y - last.y) <= radii().anchor;
          // Same landing as last → keep stroke linked (do not close / split).
          if (onLast && !onFirst) {
            setDraftCursor(place);
            return;
          }
          // Only close when tip hits the first anchor (not merely nearby).
          if (onFirst) {
            commitDraftIfAny(true);
            return;
          }
        } else if (draft.length === 1) {
          const only = draft[0];
          if (Math.hypot(place.x - only.x, place.y - only.y) <= 0.75) {
            setDraftCursor(place);
            return;
          }
        }
        setDraftAnchors((prev) => [...prev, { x: place.x, y: place.y }]);
        setDraftCursor(place);
        return;
      }

      const aRef = hitAnchor(list, p, anchorR);
      const handleHit = aRef ? null : hitHandle(list, p, handleR);
      const convertMod = convertPointRef.current || e.altKey;

      // Alt/Option (or Meta) on a handle clears that side — not Curve tool alone
      // (Curve still needs to drag handles after pulling them out).
      if (handleHit && (e.altKey || e.metaKey)) {
        dirtyRef.current = true;
        setSubpaths((prev) =>
          mapSubpathAnchor(prev, handleHit.sub, handleHit.index, (a) =>
            clearHandle(a, handleHit.side)
          )
        );
        setSelectedHandle(null);
        return;
      }

      if (handleHit) {
        dragRef.current = {
          kind: 'handle',
          sub: handleHit.sub,
          index: handleHit.index,
          side: handleHit.side,
          // Curve / Alt: break handle symmetry while dragging one side.
          mirror: !(convertPointRef.current || e.altKey),
        };
        setSelectedHandle(handleHit);
        try {
          hitEl.setPointerCapture?.(e.pointerId);
        } catch {
          /* ignore */
        }
        return;
      }

      if (aRef) {
        const a = list[aRef.sub]?.anchors[aRef.index];
        if (!a) return;
        // Convert point: Alt/Option, or Curve subtool (no modifier).
        if (convertMod && !e.metaKey) {
          dragRef.current = {
            kind: 'convert',
            sub: aRef.sub,
            index: aRef.index,
            ax: a.x,
            ay: a.y,
            pulled: false,
          };
          lastAnchorTapRef.current = null;
          setSelectedHandle(null);
          try {
            hitEl.setPointerCapture?.(e.pointerId);
          } catch {
            /* ignore */
          }
          return;
        }

        const now = Date.now();
        const last = lastAnchorTapRef.current;
        if (
          last &&
          last.sub === aRef.sub &&
          last.index === aRef.index &&
          now - last.t < 450
        ) {
          dirtyRef.current = true;
          setSubpaths((prev) =>
            mapSubpathAnchor(prev, aRef.sub, aRef.index, clearAllHandles)
          );
          lastAnchorTapRef.current = null;
          setSelectedHandle(null);
          return;
        }
        lastAnchorTapRef.current = { sub: aRef.sub, index: aRef.index, t: now };
        dragRef.current = {
          kind: 'anchor',
          sub: aRef.sub,
          index: aRef.index,
          ox: p.x,
          oy: p.y,
          start: { ...a },
        };
        try {
          hitEl.setPointerCapture?.(e.pointerId);
        } catch {
          /* ignore */
        }
        return;
      }

      // Empty canvas: stay in path-edit. Exit only via ✓ / Esc / bottom Select.
      setSelectedHandle(null);
      setHoverHandle(null);
      setHoverAnchor(null);
      setPathHover(null);
    };

    const onMove = (e: PointerEvent) => {
      const p = toScene(e.clientX, e.clientY);
      const drag = dragRef.current;
      if (!drag) {
        const { anchor: anchorR, handle: handleR, path: pathR } = radii();
        const list = subpathsRef.current;
        if (drawNewRef.current) {
          // Always show edge preview on the edited path — even mid-draw.
          const nearest = findClosestOnSubpaths(list, p.x, p.y);
          if (nearest && nearest.dist <= pathR) {
            setPathHover({ x: nearest.x, y: nearest.y });
          } else {
            setPathHover(null);
          }
          const skipGrid = e.ctrlKey || !gridSnapRef.current;
          // Snap tip even before the first draft click (CSS cursor ≠ lattice).
          setDraftCursor(snapPenAnchorPoint(p.x, p.y, gridSizeRef.current, skipGrid));
          setHoverAnchor(null);
          setHoverHandle(null);
          return;
        }
        setHoverAnchor(hitAnchor(list, p, anchorR));
        setHoverHandle(hitHandle(list, p, handleR));
        setPathHover(null);
        return;
      }

      if (drag.kind === 'convert') {
        const dist = Math.hypot(p.x - drag.ax, p.y - drag.ay);
        // Small threshold so a plain Alt-click can still mean 鈥渕ake corner鈥?
        if (dist < 3 / Math.max(0.05, camera.zoom || 1)) return;
        drag.pulled = true;
        dirtyRef.current = true;
        setSubpaths((prev) =>
          mapSubpathAnchor(prev, drag.sub, drag.index, () =>
            withMirroredHandles({
              x: drag.ax,
              y: drag.ay,
              outX: p.x,
              outY: p.y,
            })
          )
        );
        setSelectedHandle({ sub: drag.sub, index: drag.index, side: 'out' });
        return;
      }

      if (drag.kind === 'anchor') {
        dirtyRef.current = true;
        const skipGrid = e.ctrlKey || !gridSnapRef.current;
        const dx = p.x - drag.ox;
        const dy = p.y - drag.oy;
        const snapped = snapPenAnchorPoint(
          drag.start.x + dx,
          drag.start.y + dy,
          gridSizeRef.current,
          skipGrid
        );
        const adx = snapped.x - drag.start.x;
        const ady = snapped.y - drag.start.y;
        setSubpaths((prev) =>
          mapSubpathAnchor(prev, drag.sub, drag.index, () => {
            const s = drag.start;
            return {
              ...s,
              x: snapped.x,
              y: snapped.y,
              ...(s.inX != null && s.inY != null
                ? { inX: s.inX + adx, inY: s.inY + ady }
                : {}),
              ...(s.outX != null && s.outY != null
                ? { outX: s.outX + adx, outY: s.outY + ady }
                : {}),
            };
          })
        );
        return;
      }

      dirtyRef.current = true;
      setSubpaths((prev) =>
        mapSubpathAnchor(prev, drag.sub, drag.index, (a) =>
          setHandle(a, drag.side, p.x, p.y, drag.mirror)
        )
      );
      setSelectedHandle({ sub: drag.sub, index: drag.index, side: drag.side });
    };

    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      // Alt-click (no drag): convert smooth 鈫?corner (remove handles).
      if (drag.kind === 'convert' && !drag.pulled) {
        const a = subpathsRef.current[drag.sub]?.anchors[drag.index];
        if (a && anchorHasHandles(a)) {
          dirtyRef.current = true;
          setSubpaths((prev) =>
            mapSubpathAnchor(prev, drag.sub, drag.index, clearAllHandles)
          );
          setSelectedHandle(null);
        }
      }
      dragRef.current = null;
      try {
        hitEl.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        if (drawNewRef.current && draftAnchorsRef.current.length >= 2) {
          e.preventDefault();
          e.stopPropagation();
          commitDraftIfAny(false);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        commitAndExit();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = selectedHandleRef.current;
        if (!sel) return;
        e.preventDefault();
        dirtyRef.current = true;
        setSubpaths((prev) =>
          mapSubpathAnchor(prev, sel.sub, sel.index, (a) => clearHandle(a, sel.side))
        );
        setSelectedHandle(null);
      }
    };

    hitEl.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
    return () => {
      hitEl.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [enabled, paperEl, stageEl, camera.zoom, toScene, nodeId]);

  if (!enabled || !subpaths.length) return null;

  const d = penSubpathsToD(subpaths);
  const sw = Math.max(0, strokeWidth);
  // Screen-constant ink in scene units (HostPathChrome / SelectionChrome: px / zoom).
  const z = Math.max(0.05, camera.zoom || 1);
  const inv = 1 / z;
  const stroke = STROKE_PX * inv;
  const handleStroke = HANDLE_STROKE_PX * inv;
  const linkStroke = LINK_STROKE_PX * inv;
  const anchorR = Math.max(0.01, (ANCHOR_VIS_PX * inv) / 2 - stroke / 2);
  const anchorRHot = Math.max(0.01, ((ANCHOR_VIS_PX + 2) * inv) / 2 - stroke / 2);
  const handleR = Math.max(0.01, (HANDLE_VIS_PX * inv) / 2 - handleStroke / 2);
  const handleRHot = Math.max(0.01, ((HANDLE_VIS_PX + 2) * inv) / 2 - handleStroke / 2);
  const editStrokeOn = strokeEnabled || fillColor === 'none';
  const editStrokeColor = strokeEnabled ? strokeColor : SEL_BASELINE;
  const pathSw = pathEditStrokeWidth({
    strokeEnabled,
    borderWidth: sw,
    inv,
  });
  const draftSw = Math.max(1, newStrokeWidth) * inv;
  const draftD = draftPathD(draftAnchors, draftCursor);
  const draftRubber = draftRubberBandD(draftAnchors, draftCursor);

  type LinkSeg = { x1: number; y1: number; x2: number; y2: number };
  const linkSegs: LinkSeg[] = [];
  const anchorsDraw: AnchorDraw[] = [];
  const handlesDraw: HandleDraw[] = [];

  subpaths.forEach((sp, si) => {
    sp.anchors.forEach((a, i) => {
      const hovered = hoverAnchor?.sub === si && hoverAnchor?.index === i;
      const pushHandle = (side: HandleSide, hx: number, hy: number) => {
        const active =
          (selectedHandle?.sub === si &&
            selectedHandle?.index === i &&
            selectedHandle.side === side) ||
          (hoverHandle?.sub === si && hoverHandle?.index === i && hoverHandle.side === side);
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
      anchorsDraw.push({
        x: a.x,
        y: a.y,
        r: hovered ? anchorRHot : anchorR,
        fill: hovered ? SEL_BASELINE : '#fff',
        strokeColor: SEL_BASELINE,
      });
    });
  });

  if (pathHover) {
    anchorsDraw.push({
      x: pathHover.x,
      y: pathHover.y,
      r: anchorR,
      fill: SEL_BASELINE,
      strokeColor: '#fff',
    });
  }
  draftAnchors.forEach((a) => {
    anchorsDraw.push({
      x: a.x,
      y: a.y,
      r: anchorR,
      fill: '#fff',
      strokeColor: SEL_BASELINE,
    });
  });

  return (
    <PenPathEditInkSvg
      pathD={d}
      fillColor={fillColor}
      fillRule={fillRule === 'evenodd' ? 'evenodd' : 'nonzero'}
      editStrokeOn={editStrokeOn}
      editStrokeColor={editStrokeColor}
      pathSw={pathSw}
      linkSegs={linkSegs}
      linkSw={linkStroke}
      draftD={draftD}
      draftRubber={draftRubber}
      draftColor={newStrokeColor}
      draftSw={draftSw}
      inv={inv}
      draftCursor={draftCursor}
      anchorsDraw={anchorsDraw}
      handlesDraw={handlesDraw}
      knobStroke={stroke}
      handleStroke={handleStroke}
    />
  );
}

function PenPathEditInkSvg({
  pathD,
  fillColor,
  fillRule,
  editStrokeOn,
  editStrokeColor,
  pathSw,
  linkSegs,
  linkSw,
  draftD,
  draftRubber,
  draftColor,
  draftSw,
  inv,
  draftCursor,
  anchorsDraw,
  handlesDraw,
  knobStroke,
  handleStroke,
}: {
  pathD: string;
  fillColor: string;
  fillRule: 'evenodd' | 'nonzero';
  editStrokeOn: boolean;
  editStrokeColor: string;
  pathSw: number;
  linkSegs: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  linkSw: number;
  draftD: string;
  draftRubber: string;
  draftColor: string;
  draftSw: number;
  inv: number;
  draftCursor: { x: number; y: number } | null;
  anchorsDraw: AnchorDraw[];
  handlesDraw: HandleDraw[];
  knobStroke: number;
  handleStroke: number;
}) {
  // Portal into shared world SVG — sibling sceneSurfaceSvgProps drifts under fractional DPR.
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
  const tipArm = 4 * inv;
  const tipR = Math.max(0.01, (3 * inv) / 2);
  const dash = `${4 * inv} ${3 * inv}`;

  const children: ReactNode = (
    <g data-pen-path-edit-preview pointerEvents="none" aria-hidden>
      {linkSegs.map((s, i) => (
        <line
          key={`link-${i}`}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke="#8b8b8b"
          strokeWidth={linkSw}
          strokeLinecap="round"
        />
      ))}
      {pathD ? (
        <path
          d={pathD}
          fill={fillColor !== 'none' ? fillColor : 'none'}
          fillRule={fillRule}
          stroke={editStrokeOn && pathSw > 0 ? editStrokeColor : 'none'}
          strokeWidth={pathSw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {draftD ? (
        <path
          d={draftD}
          fill="none"
          stroke={draftColor}
          strokeWidth={draftSw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {draftRubber ? (
        <path
          d={draftRubber}
          fill="none"
          stroke={draftColor}
          strokeWidth={draftSw}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={dash}
          opacity={0.7}
        />
      ) : null}
      {draftCursor ? (
        <g data-pen-snap-tip="1">
          <circle
            cx={draftCursor.x}
            cy={draftCursor.y}
            r={tipR}
            fill={SEL_BASELINE}
            stroke="none"
            shapeRendering="geometricPrecision"
          />
          <path
            d={`M ${draftCursor.x - tipArm} ${draftCursor.y} L ${draftCursor.x + tipArm} ${draftCursor.y} M ${draftCursor.x} ${draftCursor.y - tipArm} L ${draftCursor.x} ${draftCursor.y + tipArm}`}
            fill="none"
            stroke={SEL_BASELINE}
            strokeWidth={knobStroke}
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

  if (!previewMount) return null;
  if (!pathD && !draftD && !draftRubber && !anchorsDraw.length && !handlesDraw.length) {
    return null;
  }

  return createPortal(children, previewMount);
}

export default memo(PenPathEditFeature);
