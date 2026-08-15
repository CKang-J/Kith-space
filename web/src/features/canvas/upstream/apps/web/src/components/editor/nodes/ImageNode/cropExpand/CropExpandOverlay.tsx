/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/cropExpand/CropExpandOverlay.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, memo } from 'react';
import { useSelector } from 'react-redux';
import {
  RcbOverlayPortal,
  useRcbCamera,
  rcbSceneToScreen,
} from '@recombyn-native/components/rcb';
import {
  getDocumentGridSize,
  snapBoxToGrid,
  type SceneBox,
} from '@recombyn-native/components/rcb/selection/alignGuides';

export type HandlePos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Crop rect in image-local coords (origin = image top-left). */
export type CropRect = { x: number; y: number; w: number; h: number };

/** Expand frame: outer size + origin relative to image top-left (ox/oy ≤ 0). */
export type ExpandFrame = { w: number; h: number; ox: number; oy: number };

const MIN_CROP = 20;

function calcCropMove(
  orig: CropRect,
  dx: number,
  dy: number,
  cw: number,
  ch: number
): CropRect {
  return {
    ...orig,
    x: Math.max(0, Math.min(orig.x + dx, cw - orig.w)),
    y: Math.max(0, Math.min(orig.y + dy, ch - orig.h)),
  };
}

function calcCropEdgeResize(
  orig: CropRect,
  handle: 'n' | 's' | 'w' | 'e',
  dx: number,
  dy: number,
  cw: number,
  ch: number
): CropRect {
  const right = orig.x + orig.w;
  const bottom = orig.y + orig.h;
  if (handle === 'n') {
    const y = Math.max(0, Math.min(orig.y + dy, bottom - MIN_CROP));
    return { ...orig, y, h: bottom - y };
  }
  if (handle === 's') {
    const newBottom = Math.max(orig.y + MIN_CROP, Math.min(bottom + dy, ch));
    return { ...orig, h: newBottom - orig.y };
  }
  if (handle === 'w') {
    const x = Math.max(0, Math.min(orig.x + dx, right - MIN_CROP));
    return { ...orig, x, w: right - x };
  }
  const newRight = Math.max(orig.x + MIN_CROP, Math.min(right + dx, cw));
  return { ...orig, w: newRight - orig.x };
}

function calcCropCornerResize(
  orig: CropRect,
  handle: 'nw' | 'ne' | 'sw' | 'se',
  dx: number,
  dy: number,
  cw: number,
  ch: number
): CropRect {
  const right = orig.x + orig.w;
  const bottom = orig.y + orig.h;
  const minScale = MIN_CROP / Math.min(orig.w, orig.h);

  if (handle === 'se') {
    const maxScale = Math.min((cw - orig.x) / orig.w, (ch - orig.y) / orig.h);
    const raw = Math.min((orig.w + dx) / orig.w, (orig.h + dy) / orig.h);
    const scale = Math.max(minScale, Math.min(raw, maxScale));
    return { x: orig.x, y: orig.y, w: orig.w * scale, h: orig.h * scale };
  }
  if (handle === 'sw') {
    const maxScale = Math.min(right / orig.w, (ch - orig.y) / orig.h);
    const raw = Math.min((orig.w - dx) / orig.w, (orig.h + dy) / orig.h);
    const scale = Math.max(minScale, Math.min(raw, maxScale));
    const w = orig.w * scale;
    return { x: right - w, y: orig.y, w, h: orig.h * scale };
  }
  if (handle === 'ne') {
    const maxScale = Math.min((cw - orig.x) / orig.w, bottom / orig.h);
    const raw = Math.min((orig.w + dx) / orig.w, (orig.h - dy) / orig.h);
    const scale = Math.max(minScale, Math.min(raw, maxScale));
    const h = orig.h * scale;
    return { x: orig.x, y: bottom - h, w: orig.w * scale, h };
  }
  const maxScale = Math.min(right / orig.w, bottom / orig.h);
  const raw = Math.min((orig.w - dx) / orig.w, (orig.h - dy) / orig.h);
  const scale = Math.max(minScale, Math.min(raw, maxScale));
  const w = orig.w * scale;
  const h = orig.h * scale;
  return { x: right - w, y: bottom - h, w, h };
}

function calcExpandMove(
  orig: ExpandFrame,
  dx: number,
  dy: number,
  cw: number,
  ch: number
): ExpandFrame {
  const { w, h } = orig;
  return {
    w,
    h,
    ox: Math.min(0, Math.max(cw - w, orig.ox + dx)),
    oy: Math.min(0, Math.max(ch - h, orig.oy + dy)),
  };
}

function calcExpandEdgeResize(
  orig: ExpandFrame,
  handle: 'n' | 's' | 'w' | 'e',
  dx: number,
  dy: number,
  cw: number,
  ch: number
): ExpandFrame {
  const { ox, oy, w, h } = orig;
  const right = ox + w;
  const bottom = oy + h;
  if (handle === 'n') {
    const newY = Math.min(0, oy + dy, bottom - ch);
    return { ox, oy: newY, w, h: bottom - newY };
  }
  if (handle === 's') {
    const newBottom = Math.max(ch, bottom + dy);
    return { ox, oy, w, h: newBottom - oy };
  }
  if (handle === 'w') {
    const newX = Math.min(0, ox + dx, right - cw);
    return { ox: newX, oy, w: right - newX, h };
  }
  const newRight = Math.max(cw, right + dx);
  return { ox, oy, w: newRight - ox, h };
}

function calcExpandCornerResize(
  orig: ExpandFrame,
  handle: 'nw' | 'ne' | 'sw' | 'se',
  dx: number,
  dy: number,
  cw: number,
  ch: number
): ExpandFrame {
  const { ox, oy, w: w0, h: h0 } = orig;
  const right = ox + w0;
  const bottom = oy + h0;

  if (handle === 'se') {
    const raw = Math.min((w0 + dx) / w0, (h0 + dy) / h0);
    const minScale = Math.max((cw - ox) / w0, (ch - oy) / h0);
    const scale = Math.max(minScale, raw);
    return { ox, oy, w: w0 * scale, h: h0 * scale };
  }
  if (handle === 'sw') {
    const raw = Math.min((w0 - dx) / w0, (h0 + dy) / h0);
    const minScale = Math.max(right / w0, (ch - oy) / h0);
    const scale = Math.max(minScale, raw);
    const w = w0 * scale;
    return { ox: right - w, oy, w, h: h0 * scale };
  }
  if (handle === 'ne') {
    const raw = Math.min((w0 + dx) / w0, (h0 - dy) / h0);
    const minScale = Math.max((cw - ox) / w0, bottom / h0);
    const scale = Math.max(minScale, raw);
    const h = h0 * scale;
    return { ox, oy: bottom - h, w: w0 * scale, h };
  }
  const raw = Math.min((w0 - dx) / w0, (h0 - dy) / h0);
  const minScale = Math.max(right / w0, bottom / h0);
  const scale = Math.max(minScale, raw);
  const w = w0 * scale;
  const h = h0 * scale;
  return { ox: right - w, oy: bottom - h, w, h };
}

const EXPAND_PAD = 40;

export function initialExpandFrame(cw: number, ch: number): ExpandFrame {
  const pad = EXPAND_PAD;
  return { w: cw + pad * 2, h: ch + pad * 2, ox: -pad, oy: -pad };
}

export function initialCropRect(cw: number, ch: number): CropRect {
  return { x: 0, y: 0, w: cw, h: ch };
}

/** Largest centered crop of aspect `rw:rh` that fits inside the image. */
export function cropRectForRatio(
  cw: number,
  ch: number,
  rw: number,
  rh: number
): CropRect {
  if (rw <= 0 || rh <= 0) return initialCropRect(cw, ch);
  const target = rw / rh;
  const img = cw / ch;
  if (img > target) {
    const h = ch;
    const w = Math.max(MIN_CROP, h * target);
    return { x: (cw - w) / 2, y: 0, w, h };
  }
  const w = cw;
  const h = Math.max(MIN_CROP, w / target);
  return { x: 0, y: (ch - h) / 2, w, h };
}

/** Smallest expand frame of aspect `rw:rh` that still contains the image. */
export function expandFrameForRatio(
  cw: number,
  ch: number,
  rw: number,
  rh: number
): ExpandFrame {
  if (rw <= 0 || rh <= 0) return initialExpandFrame(cw, ch);
  const target = rw / rh;
  const img = cw / ch;
  if (img > target) {
    const w = cw;
    const h = Math.max(ch, w / target);
    return { w, h, ox: 0, oy: (ch - h) / 2 };
  }
  const h = ch;
  const w = Math.max(cw, h * target);
  return { w, h, ox: (cw - w) / 2, oy: 0 };
}

/** Match selection chrome (`SelectionChrome` SEL_BASELINE) — readable on photos. */
const ACCENT = '#3388ff';
const ACCENT_SOFT = 'rgba(51, 136, 255, 0.4)';
const LABEL = '#ffffff';
const EXPAND_GRAY = '#e8e8e8';
/** Dim outside the crop hole (kept region stays clear). */
const CROP_MASK = 'rgba(0, 0, 0, 0.48)';

const HANDLES: { id: HandlePos; cursor: string }[] = [
  { id: 'nw', cursor: 'nw-resize' },
  { id: 'n', cursor: 'n-resize' },
  { id: 'ne', cursor: 'ne-resize' },
  { id: 'e', cursor: 'e-resize' },
  { id: 'se', cursor: 'se-resize' },
  { id: 's', cursor: 's-resize' },
  { id: 'sw', cursor: 'sw-resize' },
  { id: 'w', cursor: 'w-resize' },
];

type DragState =
  | { type: 'move'; startX: number; startY: number; crop: CropRect; expand: ExpandFrame }
  | {
      type: 'resize';
      handle: HandlePos;
      startX: number;
      startY: number;
      crop: CropRect;
      expand: ExpandFrame;
    };

type Props = {
  mode: 'crop' | 'expand';
  /** Image box in world coords. */
  imageBox: { left: number; top: number; width: number; height: number };
  cropRect: CropRect;
  expandFrame: ExpandFrame;
  label?: string;
  /** Sibling / frame boxes for smart guides while dragging. */
  onCropChange: (next: CropRect) => void;
  onExpandChange: (next: ExpandFrame) => void;
};

/** Dashed frame, L-corners, edge bars, grid; expand shows gray margins. */
function CropExpandOverlay({
  mode,
  imageBox,
  cropRect,
  expandFrame,
  label = 'Image',
  onCropChange,
  onExpandChange,
}: Props): ReactNode {
  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
  const document = useSelector((state: any) => state.editor.document);
  const gridSize = getDocumentGridSize(document);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const cropRef = useRef(cropRect);
  const expandRef = useRef(expandFrame);
  cropRef.current = cropRect;
  expandRef.current = expandFrame;
  const onCropRef = useRef(onCropChange);
  const onExpandRef = useRef(onExpandChange);
  onCropRef.current = onCropChange;
  onExpandRef.current = onExpandChange;
  const imageBoxRef = useRef(imageBox);
  imageBoxRef.current = imageBox;

  const cw = Math.max(1, imageBox.width);
  const ch = Math.max(1, imageBox.height);

  const frameWorld =
    mode === 'expand'
      ? {
          left: imageBox.left + expandFrame.ox,
          top: imageBox.top + expandFrame.oy,
          width: expandFrame.w,
          height: expandFrame.h,
        }
      : {
          left: imageBox.left + cropRect.x,
          top: imageBox.top + cropRect.y,
          width: cropRect.w,
          height: cropRect.h,
        };

  const origin = rcbSceneToScreen(camera, frameWorld.left, frameWorld.top);
  const stageW = frameWorld.width * z;
  const stageH = frameWorld.height * z;
  const imgOrigin = rcbSceneToScreen(camera, imageBox.left, imageBox.top);
  const imgStageW = cw * z;
  const imgStageH = ch * z;

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = (e.clientX - drag.startX) / z;
      const dy = (e.clientY - drag.startY) / z;
      const img = imageBoxRef.current;
      if (mode === 'crop') {
        const orig = drag.crop;
        if (drag.type === 'move') {
          const moved = calcCropMove(orig, dx, dy, cw, ch);
          let world: SceneBox = {
            left: img.left + moved.x,
            top: img.top + moved.y,
            width: moved.w,
            height: moved.h,
          };
          if (!e.ctrlKey && !e.metaKey) {
            world = snapBoxToGrid(world, gridSize);
          }
          const next = calcCropMove(
            orig,
            world.left - img.left - orig.x,
            world.top - img.top - orig.y,
            cw,
            ch
          );
          onCropRef.current(next);
          return;
        }
        const h = drag.handle;
        const isEdge = h === 'n' || h === 's' || h === 'w' || h === 'e';
        onCropRef.current(
          isEdge
            ? calcCropEdgeResize(orig, h, dx, dy, cw, ch)
            : calcCropCornerResize(orig, h as 'nw' | 'ne' | 'sw' | 'se', dx, dy, cw, ch)
        );
        return;
      }

      const orig = drag.expand;
      if (drag.type === 'move') {
        const moved = calcExpandMove(orig, dx, dy, cw, ch);
        let world: SceneBox = {
          left: img.left + moved.ox,
          top: img.top + moved.oy,
          width: moved.w,
          height: moved.h,
        };
        if (!e.ctrlKey && !e.metaKey) {
          world = snapBoxToGrid(world, gridSize);
        }
        const next = calcExpandMove(
          orig,
          world.left - img.left - orig.ox,
          world.top - img.top - orig.oy,
          cw,
          ch
        );
        onExpandRef.current(next);
        return;
      }
      const h = drag.handle;
      const isEdge = h === 'n' || h === 's' || h === 'w' || h === 'e';
      onExpandRef.current(
        isEdge
          ? calcExpandEdgeResize(orig, h, dx, dy, cw, ch)
          : calcExpandCornerResize(orig, h as 'nw' | 'ne' | 'sw' | 'se', dx, dy, cw, ch)
      );
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [mode, z, cw, ch, gridSize]);

  const startMove = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      type: 'move',
      startX: e.clientX,
      startY: e.clientY,
      crop: { ...cropRef.current },
      expand: { ...expandRef.current },
    };
    setDragging(true);
  };

  const startResize = (handle: HandlePos) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      type: 'resize',
      handle,
      startX: e.clientX,
      startY: e.clientY,
      crop: { ...cropRef.current },
      expand: { ...expandRef.current },
    };
    setDragging(true);
  };

  const frameStyle: CSSProperties = {
    position: 'absolute',
    left: origin.x,
    top: origin.y,
    width: stageW,
    height: stageH,
  };

  const dimLabel = `${Math.round(frameWorld.width)} × ${Math.round(frameWorld.height)}`;

  /** L-bracket corner. */
  const corner = (id: HandlePos): CSSProperties => {
    const arm = 14;
    const thick = 3;
    const base: CSSProperties = {
      position: 'absolute',
      width: arm,
      height: arm,
      pointerEvents: 'auto',
      boxSizing: 'border-box',
      background: 'transparent',
    };
    if (id === 'nw') {
      return {
        ...base,
        left: -1,
        top: -1,
        borderTop: `${thick}px solid ${ACCENT}`,
        borderLeft: `${thick}px solid ${ACCENT}`,
      };
    }
    if (id === 'ne') {
      return {
        ...base,
        right: -1,
        top: -1,
        borderTop: `${thick}px solid ${ACCENT}`,
        borderRight: `${thick}px solid ${ACCENT}`,
      };
    }
    if (id === 'sw') {
      return {
        ...base,
        left: -1,
        bottom: -1,
        borderBottom: `${thick}px solid ${ACCENT}`,
        borderLeft: `${thick}px solid ${ACCENT}`,
      };
    }
    return {
      ...base,
      right: -1,
      bottom: -1,
      borderBottom: `${thick}px solid ${ACCENT}`,
      borderRight: `${thick}px solid ${ACCENT}`,
    };
  };

  const edgeBar = (id: HandlePos): CSSProperties => {
    const base: CSSProperties = {
      position: 'absolute',
      background: ACCENT,
      borderRadius: 2,
      pointerEvents: 'auto',
    };
    if (id === 'n' || id === 's') {
      return {
        ...base,
        left: '50%',
        width: 22,
        height: 4,
        transform: 'translateX(-50%)',
        ...(id === 'n' ? { top: -2 } : { bottom: -2 }),
      };
    }
    return {
      ...base,
      top: '50%',
      width: 4,
      height: 22,
      transform: 'translateY(-50%)',
      ...(id === 'w' ? { left: -2 } : { right: -2 }),
    };
  };

  const holeLeft = mode === 'expand' ? -expandFrame.ox * z : 0;
  const holeTop = mode === 'expand' ? -expandFrame.oy * z : 0;

  return (
    <RcbOverlayPortal>
      <div
        data-crop-expand-overlay
        className="pointer-events-none absolute inset-0 z-[36]"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {mode === 'expand' ? (
          <div className="pointer-events-none absolute overflow-hidden" style={frameStyle}>
            <div
              className="absolute left-0 right-0 top-0"
              style={{ height: Math.max(0, holeTop), background: EXPAND_GRAY }}
            />
            <div
              className="absolute bottom-0 left-0 right-0"
              style={{
                height: Math.max(0, stageH - holeTop - imgStageH),
                background: EXPAND_GRAY,
              }}
            />
            <div
              className="absolute"
              style={{
                left: 0,
                top: holeTop,
                width: Math.max(0, holeLeft),
                height: imgStageH,
                background: EXPAND_GRAY,
              }}
            />
            <div
              className="absolute"
              style={{
                left: holeLeft + imgStageW,
                top: holeTop,
                width: Math.max(0, stageW - holeLeft - imgStageW),
                height: imgStageH,
                background: EXPAND_GRAY,
              }}
            />
          </div>
        ) : null}

        {mode === 'crop' ? (
          <div
            className="pointer-events-none absolute overflow-hidden"
            style={{
              left: imgOrigin.x,
              top: imgOrigin.y,
              width: imgStageW,
              height: imgStageH,
            }}
            aria-hidden
          >
            {/* Dim discarded regions inside the image; crop hole stays clear. */}
            <div
              className="absolute left-0 right-0 top-0"
              style={{
                height: Math.max(0, origin.y - imgOrigin.y),
                background: CROP_MASK,
              }}
            />
            <div
              className="absolute bottom-0 left-0 right-0"
              style={{
                height: Math.max(0, imgOrigin.y + imgStageH - (origin.y + stageH)),
                background: CROP_MASK,
              }}
            />
            <div
              className="absolute"
              style={{
                left: 0,
                top: Math.max(0, origin.y - imgOrigin.y),
                width: Math.max(0, origin.x - imgOrigin.x),
                height: stageH,
                background: CROP_MASK,
              }}
            />
            <div
              className="absolute"
              style={{
                left: Math.max(0, origin.x - imgOrigin.x + stageW),
                top: Math.max(0, origin.y - imgOrigin.y),
                width: Math.max(0, imgOrigin.x + imgStageW - (origin.x + stageW)),
                height: stageH,
                background: CROP_MASK,
              }}
            />
          </div>
        ) : null}

        <div
          className="pointer-events-auto absolute cursor-move"
          style={{
            ...frameStyle,
            border: `1.5px dashed ${ACCENT}`,
            boxSizing: 'border-box',
          }}
          onPointerDown={startMove}
        >
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div
              className="absolute left-0 right-0"
              style={{ top: '33.33%', height: 1, background: ACCENT_SOFT }}
            />
            <div
              className="absolute left-0 right-0"
              style={{ top: '66.66%', height: 1, background: ACCENT_SOFT }}
            />
            <div
              className="absolute top-0 bottom-0"
              style={{ left: '33.33%', width: 1, background: ACCENT_SOFT }}
            />
            <div
              className="absolute top-0 bottom-0"
              style={{ left: '66.66%', width: 1, background: ACCENT_SOFT }}
            />
          </div>

          <div
            className="pointer-events-none absolute left-2 top-1.5 text-[11px] font-medium"
            style={{ color: LABEL, textShadow: '0 1px 2px rgba(0,0,0,0.55)' }}
          >
            {label}
          </div>
          <div
            className="pointer-events-none absolute right-2 top-1.5 text-[11px] font-medium tabular-nums"
            style={{ color: LABEL, textShadow: '0 1px 2px rgba(0,0,0,0.55)' }}
          >
            {dimLabel}
          </div>

          {HANDLES.map(({ id, cursor }) => {
            const isCorner = id === 'nw' || id === 'ne' || id === 'sw' || id === 'se';
            return (
              <div
                key={id}
                role="slider"
                aria-label={id}
                className="absolute"
                style={{ ...(isCorner ? corner(id) : edgeBar(id)), cursor }}
                onPointerDown={startResize(id)}
              />
            );
          })}
        </div>

        {mode === 'expand' && dragging ? (
          <div
            className="pointer-events-none absolute ring-1 ring-black/20"
            style={{
              left: imgOrigin.x,
              top: imgOrigin.y,
              width: imgStageW,
              height: imgStageH,
            }}
          />
        ) : null}

      </div>
    </RcbOverlayPortal>
  );
}

export default memo(CropExpandOverlay);
