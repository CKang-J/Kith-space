/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/SelectionChrome.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { memo, type ReactNode } from 'react';
import { useRcbCamera, useRcbDevicePixelRatio } from '../camera/context';
import {
  hostMirrorSvgProps,
  sceneSurfaceSvgProps,
  snapSvgSurfaceBox,
} from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import { getSceneWorldRoot } from '@recombyn-native/components/rcb/shapes/shapeHostRegistry';
import type { RcbCamera } from '../core/types';
import { cursorForRotate } from './rotateCornerCursor';

export type SceneBox = { left: number; top: number; width: number; height: number };
type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type SelectionChromeProps = {
  box: SceneBox;
  angle?: number;
  showHandles?: boolean;
  /** Multi-select: only four corner knobs. */
  cornerHandlesOnly?: boolean;
  /**
   * `line`: shaft + two free endpoints (length + angle). No box / corners / rotate knob.
   * Used for straight line & arrow.
   */
  variant?: 'box' | 'line';
  showRotate?: boolean;
  metaLabel?: string;
  /**
   * When false, the blue border box does not capture pointers (handles still do).
   * Used for artboard frames so content inside remains clickable.
   */
  interactiveBox?: boolean;
  /** Override move-box data attribute (default data-sel-box). */
  boxDataAttr?: string;
  /** Override handle data attribute name (default data-sel-handle). */
  handleDataAttr?: string;
  /** Value for handleDataAttr (default "resize"). */
  handleDataValue?: string;
  /**
   * Edge handles: `all` (default), `horizontal` (text L/R wrap width only), or none.
   */
  edgeHandles?: 'all' | 'horizontal' | 'none';
  /** When false, only handles / hit targets (no AABB stroke). */
  showBoxStroke?: boolean;
};

/**
 * Selection overlay: AABB box + resize / rotate knobs.
 * Screen-constant ink: `lineWidth = screenPx / zoom`.
 * Prefer shared world surface; path chrome may mirror a shape host.
 */
export const CHROME_STROKE_PX = 1.5;
export const CHROME_HANDLE_VIS_PX = 8;
/**
 * Resize hit — barely larger than the 8px knob. Hits follow the icon; do not
 * inflate into a big magnet that swallows radius seats inside the box.
 */
export const CHROME_HANDLE_HIT_PX = 10;
/** Corner-radius hit — icon-sized, slightly under resize so corner prefers scale. */
export const CHROME_RADIUS_HIT_PX = 8;
/** Air between resize hit edge and radius hit edge (screen px). */
export const CHROME_RADIUS_PARK_GAP_PX = 6;
/** Transparent rotate hotzone (screen px) — shared with HostPathChrome. */
export const CHROME_ROTATE_HIT_PX = 14;
/** Air between resize hit outer edge and rotate hit inner edge (screen px). */
export const CHROME_ROTATE_GAP_PX = 8;
/** Line / arrow endpoint chrome (screen px). */
export const CHROME_LINE_ENDPOINT_VIS_PX = 8;
export const CHROME_LINE_ENDPOINT_HALO_PX = 22;
export const CHROME_LINE_ENDPOINT_HIT_PX = 28;
export const CHROME_LINE_SHAFT_HIT_PX = 28;

const SEL_BASELINE = '#3388ff';

/**
 * Scene distance from a corner knob center to the rotate hotzone center.
 * Axis-aligned into the outer quadrant — diagonal push made the rotate AABB
 * overlap the resize hit and steal corner clicks after zoom.
 */
export function rotateHotzoneOutward(
  handleHit: number,
  rotateGap: number,
  rotateHit: number
): number {
  return handleHit / 2 + rotateGap + rotateHit / 2;
}

/**
 * Scene pad so resize + rotate hits outside the geom (and chromeOutset) still
 * receive pointer events when the chrome SVG is tight to the box.
 */
export function chromeOutsideHitPadScene(
  inv: number,
  chromeOutset = 0,
  strokePad = 0
): number {
  const outset = Math.max(0, chromeOutset);
  const handleHit = CHROME_HANDLE_HIT_PX * inv;
  const rotateHit = CHROME_ROTATE_HIT_PX * inv;
  const rotateGap = CHROME_ROTATE_GAP_PX * inv;
  const rotateOuter =
    rotateHotzoneOutward(handleHit, rotateGap, rotateHit) + rotateHit / 2;
  return Math.max(strokePad, outset + handleHit / 2, outset + rotateOuter);
}

/**
 * Screen px from corner (resize / control-box icon center) → radius seat when R≈0.
 * Both hits are centered on their icons; axis park `(inset, inset)` clears
 * `halfResizeHit + halfRadiusHit + gap` along each axis.
 */
export function radiusHandleParkScreenPx(): number {
  return CHROME_HANDLE_HIT_PX / 2 + CHROME_RADIUS_HIT_PX / 2 + CHROME_RADIUS_PARK_GAP_PX;
}

/**
 * Scene park for radius seats at any zoom.
 *
 * Control-box local model (same space as HostPathChrome resize/rotate):
 * - box corners at (0,0) / (w,0) / (w,h) / (0,h)
 * - radius seat at axis inset `(inset, inset)` from that corner
 * - rotate hotzone = corner ± `rotateHotzoneOutward(...)` in scene units
 *
 * Park is screen-constant (`parkPx / zoom`), only clamped so it cannot cross
 * the box center. Do not scale park with box size — that made seats jump
 * while resizing.
 */
export function radiusParkSceneForBox(
  boxW: number,
  boxH: number,
  zoom: number,
  parkPx = radiusHandleParkScreenPx()
): number {
  const z = Math.max(0.05, Number(zoom) || 1);
  const half = Math.min(Math.max(1, boxW), Math.max(1, boxH)) / 2;
  return Math.min(Math.max(0, parkPx) / z, half * 0.45);
}

/**
 * True when the box is large enough on screen for radius hits without covering move.
 */
export function radiusHandlesFitOnScreen(
  boxW: number,
  boxH: number,
  zoom: number,
  parkPx = radiusHandleParkScreenPx()
): boolean {
  const z = Math.max(0.05, Number(zoom) || 1);
  const minScreen = Math.min(Math.max(1, boxW), Math.max(1, boxH)) * z;
  return minScreen >= parkPx * 2 + CHROME_HANDLE_HIT_PX;
}

/**
 * Scale chrome hit pads down when the box is tiny on screen so move stays reachable.
 * Driven by on-screen size (any zoom), not a single zoom value.
 */
export function chromeHitScaleForBox(
  boxW: number,
  boxH: number,
  zoom: number,
  minScreenPx = 56
): number {
  const z = Math.max(0.05, Number(zoom) || 1);
  const minScreen = Math.min(Math.max(1, boxW), Math.max(1, boxH)) * z;
  if (minScreen >= minScreenPx) return 1;
  return Math.max(0.35, minScreen / minScreenPx);
}

/** Scene AABB that covers a (possibly rotated) box plus chrome pad. */
export function fittedSvgViewport(
  left: number,
  top: number,
  width: number,
  height: number,
  angleDeg: number,
  pad: number
): { minX: number; minY: number; w: number; h: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = width / 2;
  const cy = height / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [lx, ly] of [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ] as const) {
    const dx = lx - cx;
    const dy = ly - cy;
    const x = left + cx + dx * cos - dy * sin;
    const y = top + cy + dx * sin + dy * cos;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const p = Math.max(0, pad);
  minX = minX - p;
  minY = minY - p;
  return {
    minX,
    minY,
    w: Math.max(1, maxX - minX + p * 2),
    h: Math.max(1, maxY - minY + p * 2),
  };
}

/** fittedSvgViewport + surface box (raw scene). */
export function fittedSnappedSvgViewport(
  left: number,
  top: number,
  width: number,
  height: number,
  angleDeg: number,
  pad: number,
  camera?: RcbCamera,
  dpr?: number
): { minX: number; minY: number; w: number; h: number } {
  const raw = fittedSvgViewport(left, top, width, height, angleDeg, pad);
  const s = snapSvgSurfaceBox(
    { left: raw.minX, top: raw.minY, width: raw.w, height: raw.h },
    camera,
    dpr
  );
  return { minX: s.left, minY: s.top, w: s.width, h: s.height };
}

/**
 * AABB selection chrome SVG surface.
 * Prefer the shared world root (same lattice as shape ink + full viewport so
 * handle hits outside the geom still receive pointers). Never inflate a
 * per-box surface with 1/zoom handle pads — that resizes the CSS box every
 * zoom tick and desyncs the blue box from ink.
 */
export function selectionChromeSurfaceProps(
  box: { left: number; top: number; width: number; height: number },
  angle: number,
  strokePad: number,
  camera?: RcbCamera,
  dpr?: number
): {
  width: number | string;
  height: number | string;
  viewBox: string;
  style: {
    left: number | string;
    top: number | string;
    width: number | string;
    height: number | string;
    overflow: 'visible';
    display: 'block';
    shapeRendering: 'geometricPrecision';
  };
} {
  const worldRoot = getSceneWorldRoot();
  const mirrored = worldRoot ? hostMirrorSvgProps(worldRoot) : null;
  if (mirrored) return mirrored;
  const vp = fittedSnappedSvgViewport(
    box.left,
    box.top,
    box.width,
    box.height,
    angle,
    // Screen-constant stroke only — never floor at 1 scene unit (at 8000%
    // that is a huge pad and reintroduces chrome/ink drift).
    Math.max(1e-4, strokePad),
    camera,
    dpr
  );
  return sceneSurfaceSvgProps(
    { left: vp.minX, top: vp.minY, width: vp.w, height: vp.h },
    camera,
    dpr
  );
}

/**
 * World-layer SVG shell — CSS box === viewBox in scene units.
 */
export function WorldSvgFrame({
  left,
  top,
  width,
  height,
  angle = 0,
  pad = 0,
  zClass = 'z-[18]',
  pointerEvents = 'none',
  children,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  angle?: number;
  pad?: number;
  zClass?: string;
  pointerEvents?: 'none' | 'auto';
  children: ReactNode;
}) {
  const camera = useRcbCamera();
  const vp = fittedSnappedSvgViewport(left, top, width, height, angle, pad, camera);
  const surf = sceneSurfaceSvgProps(
    { left: vp.minX, top: vp.minY, width: vp.w, height: vp.h },
    camera
  );
  return (
    <svg
      data-rcb-infinite="1"
      className={`absolute overflow-visible ${zClass}`}
      width={surf.width}
      height={surf.height}
      viewBox={surf.viewBox}
      preserveAspectRatio="none"
      style={{
        ...surf.style,
        pointerEvents,
      }}
      aria-hidden
    >
      {children}
    </svg>
  );
}

/**
 * Screen-constant value pill in scene space (SVG).
 * HTML pills under camera `scale(zoom)` squash fonts / radius — keep badges as SVG.
 */
export function WorldScreenBadge({
  text,
  x,
  y,
  inv,
  anchor = 'above',
  fill = '#3388ff',
  clearance = 0,
}: {
  text: string;
  x: number;
  y: number;
  /** Scene units per screen px (= 1 / camera.zoom). */
  inv: number;
  anchor?: 'center' | 'below' | 'above' | 'right';
  fill?: string;
  clearance?: number;
}) {
  const fontSize = 11 * inv;
  const padX = 5.5 * inv;
  const padY = 2.25 * inv;
  const radius = 4 * inv;
  const gap = Math.max(6 * inv, clearance);
  const tw = Math.max(14 * inv, String(text).length * fontSize * 0.62);
  const th = fontSize * 1.2;
  const w = tw + padX * 2;
  const h = th + padY * 2;
  let cx = x;
  let cy = y;
  if (anchor === 'below') cy = y + gap + h / 2;
  else if (anchor === 'above') cy = y - gap - h / 2;
  else if (anchor === 'right') cx = x + gap + w / 2;
  return (
    <g pointerEvents="none">
      <rect
        x={cx - w / 2}
        y={cy - h / 2}
        width={w}
        height={h}
        rx={radius}
        ry={radius}
        fill={fill}
      />
      <text
        x={cx}
        y={cy}
        fill="#ffffff"
        fontSize={fontSize}
        fontWeight={600}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {text}
      </text>
    </g>
  );
}

const HANDLE_DIR_DEG: Record<ResizeHandle, number> = {
  e: 0,
  se: 45,
  s: 90,
  sw: 135,
  w: 180,
  nw: 225,
  n: 270,
  ne: 315,
};

export function cursorForResize(handle: ResizeHandle, angleDeg: number): string {
  const dirs = [
    'e-resize',
    'se-resize',
    's-resize',
    'sw-resize',
    'w-resize',
    'nw-resize',
    'n-resize',
    'ne-resize',
  ];
  const base = HANDLE_DIR_DEG[handle];
  const idx = Math.round(((((base + angleDeg) % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

function rotateLocal(lx: number, ly: number, w: number, h: number, angleDeg: number) {
  if (Math.abs(angleDeg) < 0.001) return { x: lx, y: ly };
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  const dx = lx - cx;
  const dy = ly - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

type Knob = [ResizeHandle, number, number];

function isCornerHandle(dir: ResizeHandle) {
  return dir === 'nw' || dir === 'ne' || dir === 'se' || dir === 'sw';
}

function isEdgeHandle(dir: ResizeHandle) {
  return dir === 'n' || dir === 's' || dir === 'e' || dir === 'w';
}

function buildAllKnobs(w: number, h: number): Knob[] {
  return [
    ['nw', 0, 0],
    ['n', w / 2, 0],
    ['ne', w, 0],
    ['e', w, h / 2],
    ['se', w, h],
    ['s', w / 2, h],
    ['sw', 0, h],
    ['w', 0, h / 2],
  ];
}

function selectResizeKnobs(opts: {
  lineMode: boolean;
  cornerHandlesOnly: boolean;
  edgeHandles: 'all' | 'horizontal' | 'none';
  w: number;
  h: number;
}): Knob[] {
  const { lineMode, cornerHandlesOnly, edgeHandles, w, h } = opts;
  if (lineMode) return [['w', 0, h / 2], ['e', w, h / 2]];
  const all = buildAllKnobs(w, h);
  let picked: Knob[];
  if (cornerHandlesOnly) picked = all.filter(([dir]) => isCornerHandle(dir));
  else if (edgeHandles === 'horizontal') {
    picked = all.filter(([dir]) => isCornerHandle(dir) || dir === 'e' || dir === 'w');
  } else {
    picked = all;
  }
  // Edges first, corners last — corner hits must win when AABBs overlap on tiny boxes.
  return [
    ...picked.filter(([dir]) => isEdgeHandle(dir)),
    ...picked.filter(([dir]) => isCornerHandle(dir)),
  ];
}

function selectVisualKnobs(
  knobs: Knob[],
  opts: { lineMode: boolean; cornerHandlesOnly: boolean; edgeHandles: 'all' | 'horizontal' | 'none' }
): Knob[] {
  if (opts.lineMode) return [];
  const showEdges = !opts.cornerHandlesOnly && opts.edgeHandles === 'all';
  return knobs.filter(([dir]) => (isEdgeHandle(dir) ? showEdges : true));
}

const ROTATE_CORNERS: Array<{
  corner: 'nw' | 'ne' | 'se' | 'sw';
  localX: number;
  localY: number;
  iconDeg: number;
  label: string;
}> = [
  { corner: 'nw', localX: 0, localY: 0, iconDeg: 0, label: 'Rotate' },
  { corner: 'ne', localX: 1, localY: 0, iconDeg: 90, label: 'Rotate' },
  { corner: 'se', localX: 1, localY: 1, iconDeg: 180, label: 'Rotate' },
  { corner: 'sw', localX: 0, localY: 1, iconDeg: 270, label: 'Rotate' },
];

function SelectionChrome({
  box,
  angle = 0,
  showHandles = true,
  cornerHandlesOnly = false,
  variant = 'box',
  showRotate = true,
  metaLabel,
  interactiveBox = true,
  boxDataAttr = 'data-sel-box',
  handleDataAttr = 'data-sel-handle',
  handleDataValue = 'resize',
  edgeHandles = 'all',
  showBoxStroke = true,
}: SelectionChromeProps) {
  const camera = useRcbCamera();
  const dpr = useRcbDevicePixelRatio();
  const z = Math.max(0.05, camera.zoom || 1);
  const inv = 1 / z;

  const left = box.left;
  const top = box.top;
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const lineMode = variant === 'line';

  const stroke = CHROME_STROKE_PX * inv;
  const hitScale = chromeHitScaleForBox(w, h, z);
  const handleVis = CHROME_HANDLE_VIS_PX * inv;
  const handleHit = CHROME_HANDLE_HIT_PX * inv * hitScale;
  const lineEpVis = CHROME_LINE_ENDPOINT_VIS_PX * inv;
  const lineEpHalo = CHROME_LINE_ENDPOINT_HALO_PX * inv;
  const lineEpHit = CHROME_LINE_ENDPOINT_HIT_PX * inv * hitScale;
  const lineShaftHit = CHROME_LINE_SHAFT_HIT_PX * inv * hitScale;
  const rotateHit = CHROME_ROTATE_HIT_PX * inv * hitScale;
  const rotateGap = CHROME_ROTATE_GAP_PX * inv;
  const metaOffset = 16 * inv;
  const metaFont = 10 * inv;
  const halfVis = handleVis / 2;
  const halfHit = handleHit / 2;

  const svgBoxTransform =
    Math.abs(angle) > 0.001
      ? `translate(${left} ${top}) rotate(${angle} ${w / 2} ${h / 2})`
      : `translate(${left} ${top})`;

  const knobs = selectResizeKnobs({
    lineMode,
    cornerHandlesOnly,
    edgeHandles,
    w,
    h,
  });
  const visualKnobs = selectVisualKnobs(knobs, {
    lineMode,
    cornerHandlesOnly,
    edgeHandles,
  });

  const toScene = (lx: number, ly: number) => {
    const p = rotateLocal(lx, ly, w, h, angle);
    return { x: left + p.x, y: top + p.y };
  };

  const lineStart = toScene(0, h / 2);
  const lineEnd = toScene(w, h / 2);
  const lineLen = Math.hypot(lineEnd.x - lineStart.x, lineEnd.y - lineStart.y) || 1;
  const lineAngleDeg =
    (Math.atan2(lineEnd.y - lineStart.y, lineEnd.x - lineStart.x) * 180) / Math.PI;

  // World root when available (hits + lattice). Fallback: box outline only —
  // never include 1/zoom handle pads (that desynced chrome from ink).
  const surf = selectionChromeSurfaceProps(box, angle, stroke, camera, dpr);

  return (
    <svg
      data-rcb-infinite="1"
      className="absolute z-[18] overflow-visible"
      width={surf.width}
      height={surf.height}
      viewBox={surf.viewBox}
      preserveAspectRatio="none"
      style={{
        ...surf.style,
        pointerEvents: 'none',
      }}
      aria-hidden={!showHandles && !interactiveBox}
    >
      <style>{`
        g.sel-hit:hover > .sel-ep-halo { opacity: 1; }
      `}</style>
      {metaLabel ? (
        <text
          x={left + w / 2}
          y={top - metaOffset}
          fill={SEL_BASELINE}
          fontSize={metaFont}
          fontWeight={500}
          textAnchor="middle"
          dominantBaseline="auto"
          style={{ pointerEvents: 'none' }}
        >
          {metaLabel}
        </text>
      ) : null}

      {showRotate && !lineMode
        ? ROTATE_CORNERS.map(({ corner, localX, localY, iconDeg, label }) => {
            // Under resize hits in paint order — control-box / corner prefer scale.
            const signX = localX === 0 ? -1 : 1;
            const signY = localY === 0 ? -1 : 1;
            const out = rotateHotzoneOutward(handleHit, rotateGap, rotateHit);
            // Rotate measures from the control-box / resize icon center (same as hit).
            const cornerPt = toScene(localX * w, localY * h);
            const cx = cornerPt.x + signX * out;
            const cy = cornerPt.y + signY * out;
            return (
              <g key={`rot-${corner}`} className="sel-hit" transform={`translate(${cx} ${cy})`}>
                <title>{label}</title>
                <rect
                  data-sel-handle="rotate"
                  data-rotate-corner={corner}
                  data-testid={`selection.rotate.${corner}`}
                  role="button"
                  aria-label={label}
                  x={-rotateHit / 2}
                  y={-rotateHit / 2}
                  width={rotateHit}
                  height={rotateHit}
                  fill="transparent"
                  style={{
                    pointerEvents: 'all',
                    cursor: cursorForRotate(iconDeg, angle),
                  }}
                />
              </g>
            );
          })
        : null}

      {lineMode ? (
        <g transform={`translate(${lineStart.x} ${lineStart.y}) rotate(${lineAngleDeg})`}>
          {interactiveBox ? (
            <rect
              {...{ [boxDataAttr]: true }}
              x={0}
              y={-lineShaftHit / 2}
              width={lineLen}
              height={lineShaftHit}
              fill="transparent"
              style={{ pointerEvents: 'all', cursor: 'move' }}
            />
          ) : null}
        </g>
      ) : (
        <g transform={svgBoxTransform}>
          {interactiveBox ? (
            <rect
              {...{ [boxDataAttr]: true }}
              x={0}
              y={0}
              width={w}
              height={h}
              fill="transparent"
              style={{ pointerEvents: 'all', cursor: 'move' }}
            />
          ) : null}
          {showBoxStroke ? (
            <rect
              x={0}
              y={0}
              width={w}
              height={h}
              fill="none"
              stroke={SEL_BASELINE}
              strokeWidth={stroke}
              style={{ pointerEvents: 'none' }}
            />
          ) : null}
          {showHandles
            ? visualKnobs.map(([dir, lx, ly]) => (
                <g key={`knob-${dir}`} transform={`translate(${lx} ${ly})`} style={{ pointerEvents: 'none' }}>
                  <rect
                    x={-halfVis}
                    y={-halfVis}
                    width={handleVis}
                    height={handleVis}
                    fill="#ffffff"
                    stroke="none"
                  />
                  <rect
                    x={-halfVis}
                    y={-halfVis}
                    width={handleVis}
                    height={handleVis}
                    fill="none"
                    stroke={SEL_BASELINE}
                    strokeWidth={stroke}
                  />
                </g>
              ))
            : null}
          {showHandles
            ? knobs.map(([dir, lx, ly]) => (
                <g key={`hit-${dir}`} transform={`translate(${lx} ${ly})`}>
                  <rect
                    {...{ [handleDataAttr]: handleDataValue }}
                    data-resize={dir}
                    role="button"
                    aria-label={`resize-${dir}`}
                    x={-halfHit}
                    y={-halfHit}
                    width={handleHit}
                    height={handleHit}
                    fill="transparent"
                    style={{ pointerEvents: 'all', cursor: cursorForResize(dir, angle) }}
                  />
                </g>
              ))
            : null}
        </g>
      )}

      {showHandles && lineMode
        ? knobs.map(([dir, lx, ly]) => {
            const p = toScene(lx, ly);
            return (
              <g key={`ep-${dir}`} className="sel-hit" transform={`translate(${p.x} ${p.y})`}>
                <circle
                  className="sel-ep-halo"
                  r={lineEpHalo / 2}
                  fill={`${SEL_BASELINE}59`}
                  opacity={0}
                  style={{ pointerEvents: 'none' }}
                />
                <circle
                  r={Math.max(0.01, lineEpVis / 2 - stroke / 2)}
                  fill="#fff"
                  stroke={SEL_BASELINE}
                  strokeWidth={stroke}
                  style={{ pointerEvents: 'none' }}
                />
                <rect
                  {...{ [handleDataAttr]: handleDataValue }}
                  data-resize={dir}
                  role="button"
                  aria-label={`endpoint-${dir}`}
                  x={-lineEpHit / 2}
                  y={-lineEpHit / 2}
                  width={lineEpHit}
                  height={lineEpHit}
                  fill="transparent"
                  style={{ pointerEvents: 'all', cursor: 'grab' }}
                />
              </g>
            );
          })
        : null}
    </svg>
  );
}

export default memo(SelectionChrome);
