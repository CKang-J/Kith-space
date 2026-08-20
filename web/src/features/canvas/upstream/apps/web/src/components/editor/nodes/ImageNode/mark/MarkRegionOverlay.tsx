/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/mark/MarkRegionOverlay.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  memo,
} from 'react';
import {
  RcbOverlayPortal,
  useRcbCamera,
  rcbSceneToScreen,
} from '@recombyn-native/components/rcb';
import { markLocalFromClientRect } from '@/features/canvas/adapters/recombynMarkOverlay';

/** Mark rect in image-local coords (origin = image top-left). */
export type MarkRect = { x: number; y: number; w: number; h: number };

export type MarkRegion = MarkRect & {
  id: string;
  /** 1-based display index. */
  index: number;
  label?: string;
  kind?: 'image' | 'text' | 'manual' | string;
  selected?: boolean;
};

/** Min size to *commit* a region (scene px). Preview uses a softer floor. */
const MIN_MARK = 12;
/** Live rubber-band can show as soon as the drag leaves a 1×1 cell. */
const MIN_PREVIEW = 1;
/** Scene px — below this, pointer-up on a hit region counts as click-select. */
const CLICK_SLOP = 4;

function clampDragBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cw: number,
  ch: number
): MarkRect {
  const left = Math.max(0, Math.min(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const right = Math.min(cw, Math.max(x0, x1));
  const bottom = Math.min(ch, Math.max(y0, y1));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Rubber-band while dragging — keep tiny boxes so the preview never blinks out. */
export function previewDragBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cw: number,
  ch: number
): MarkRect | null {
  const box = clampDragBox(x0, y0, x1, y1, cw, ch);
  if (box.w < MIN_PREVIEW && box.h < MIN_PREVIEW) return null;
  return {
    x: box.x,
    y: box.y,
    w: Math.max(MIN_PREVIEW, box.w),
    h: Math.max(MIN_PREVIEW, box.h),
  };
}

/** Commit gate — reject clicks / sub-threshold drags. */
export function normalizeDragBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cw: number,
  ch: number
): MarkRect | null {
  const box = clampDragBox(x0, y0, x1, y1, cw, ch);
  if (box.w < MIN_MARK || box.h < MIN_MARK) return null;
  return box;
}

function pointInRect(px: number, py: number, r: MarkRect): boolean {
  return px >= r.x && py >= r.y && px <= r.x + r.w && py <= r.y + r.h;
}

type Props = {
  imageBox: { left: number; top: number; width: number; height: number };
  regions: MarkRegion[];
  draft: MarkRect | null;
  detecting?: boolean;
  onDraftChange: (rect: MarkRect | null) => void;
  onCommitDraft: (rect: MarkRect) => void;
  onSelectRegion: (id: string, additive: boolean) => void;
  onClickWithoutDrag?: () => void;
};

/**
 * On-image mark overlay: crosshair cursor, drag-to-box, dashed region badges.
 * Mode hint follows the pointer in the gutter next to the cursor — never a
 * static caption on the photo.
 */
function MarkRegionOverlay({
  imageBox,
  regions,
  draft,
  detecting,
  onDraftChange,
  onCommitDraft,
  onSelectRegion,
  onClickWithoutDrag,
}: Props): ReactNode {
  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
  const dragRef = useRef<{
    x0: number;
    y0: number;
    pointerId: number;
    hitId: string | null;
    additive: boolean;
    moved: boolean;
  } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const onDraftChangeRef = useRef(onDraftChange);
  const onCommitDraftRef = useRef(onCommitDraft);
  const onSelectRegionRef = useRef(onSelectRegion);
  const onClickWithoutDragRef = useRef(onClickWithoutDrag);
  onDraftChangeRef.current = onDraftChange;
  onCommitDraftRef.current = onCommitDraft;
  onSelectRegionRef.current = onSelectRegion;
  onClickWithoutDragRef.current = onClickWithoutDrag;

  const origin = rcbSceneToScreen(camera, imageBox.left, imageBox.top);
  const stageW = Math.max(1, imageBox.width * z);
  const stageH = Math.max(1, imageBox.height * z);
  const cw = imageBox.width;
  const ch = imageBox.height;
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const localFromClient = useCallback(
    (clientX: number, clientY: number) =>
      markLocalFromClientRect(
        clientX,
        clientY,
        overlayRef.current?.getBoundingClientRect(),
        cw,
        ch
      ),
    [cw, ch]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const p = localFromClient(e.clientX, e.clientY);
      const dist = Math.hypot(p.x - drag.x0, p.y - drag.y0);
      if (dist >= CLICK_SLOP) drag.moved = true;
      // Started on an existing region → click-select only, never start a new box.
      if (drag.hitId) return;
      // Soft preview (1px+) while dragging; commit still uses MIN_MARK on pointer-up.
      onDraftChangeRef.current(previewDragBox(drag.x0, drag.y0, p.x, p.y, cw, ch));
    };
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      const p = localFromClient(e.clientX, e.clientY);
      if (drag.hitId) {
        onDraftChangeRef.current(null);
        onSelectRegionRef.current(drag.hitId, drag.additive);
        return;
      }
      const box = normalizeDragBox(drag.x0, drag.y0, p.x, p.y, cw, ch);
      onDraftChangeRef.current(null);
      if (box) onCommitDraftRef.current(box);
      else if (!drag.moved) onClickWithoutDragRef.current?.();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [localFromClient, cw, ch]);

  const shellStyle: CSSProperties = {
    position: 'absolute',
    left: origin.x,
    top: origin.y,
    width: stageW,
    height: stageH,
    zIndex: 80,
    cursor: 'crosshair',
    touchAction: 'none',
  };

  const renderBox = (
    r: MarkRect,
    opts: {
      id?: string;
      index?: number;
      label?: string;
      selected?: boolean;
      draft?: boolean;
    }
  ) => {
    const selected = Boolean(opts.selected);
    const isDraft = Boolean(opts.draft);
    const hovered = opts.id != null && hoverId === opts.id;
    const left = r.x * z;
    const top = r.y * z;
    const width = Math.max(1, r.w * z);
    const height = Math.max(1, r.h * z);
    // White strokes vanish on light photos — keep marks in the blue family.
    const borderColor = isDraft
      ? 'rgba(37,99,235,0.95)'
      : selected
        ? 'rgba(59,130,246,0.95)'
        : hovered
          ? 'rgba(96,165,250,0.9)'
          : 'rgba(59,130,246,0.55)';
    const fill =
      isDraft || selected
        ? 'inset 0 0 0 9999px rgba(59,130,246,0.16)'
        : hovered
          ? 'inset 0 0 0 9999px rgba(59,130,246,0.08)'
          : 'inset 0 0 0 9999px rgba(59,130,246,0.04)';
    const badgeBg = selected || isDraft ? '#2563eb' : '#60a5fa';

    return (
      <div
        key={opts.id || 'draft'}
        data-mark-region={opts.id || 'draft'}
        data-mark-draft={isDraft ? '1' : undefined}
        className="pointer-events-none absolute"
        style={{
          left,
          top,
          width,
          height,
          border: `${isDraft ? 2 : 1.5}px dashed ${borderColor}`,
          boxShadow: selected
            ? `0 0 0 1px rgba(59,130,246,0.35), ${fill}`
            : fill,
          boxSizing: 'border-box',
        }}
      >
        {opts.index != null ? (
          <span
            className="pointer-events-none absolute right-0 top-1/2 flex h-5 min-w-5 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-md px-1 text-[11px] font-semibold text-white shadow-sm"
            style={{ background: badgeBg }}
          >
            {opts.index}
          </span>
        ) : null}
        {opts.label ? (
          <span
            className="pointer-events-none absolute -bottom-6 right-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium text-[#1e3a8a] shadow-sm"
            style={{ background: 'rgba(191,219,254,0.95)' }}
          >
            {opts.label}
          </span>
        ) : null}
        {isDraft ? (
          <span
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm"
            style={{ background: 'rgba(37,99,235,0.92)' }}
          >
            {Math.round(r.w)} × {Math.round(r.h)}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <RcbOverlayPortal>
      <div
        ref={overlayRef}
        data-image-tool-panel
        data-mark-overlay
        className="pointer-events-auto absolute"
        style={shellStyle}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation?.();
          const p = localFromClient(e.clientX, e.clientY);
          if (!p.inside) return;

          const hit = [...regions].reverse().find((r) => pointInRect(p.x, p.y, r));
          dragRef.current = {
            x0: p.x,
            y0: p.y,
            pointerId: e.pointerId,
            hitId: hit?.id ?? null,
            additive: e.shiftKey,
            moved: false,
          };
          onDraftChange(null);
          setCursor(null);
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragRef.current) return;
          const p = localFromClient(e.clientX, e.clientY);
          if (!p.inside) {
            setHoverId(null);
            setCursor(null);
            return;
          }
          const hit = [...regions].reverse().find((r) => pointInRect(p.x, p.y, r));
          setHoverId(hit?.id ?? null);
          setCursor({ x: p.x * z, y: p.y * z });
        }}
        onPointerLeave={() => {
          if (!dragRef.current) {
            setHoverId(null);
            setCursor(null);
          }
        }}
      >
        {detecting ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
            <span className="rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-medium text-[var(--ink)] shadow-sm">
              识别主题中…
            </span>
          </div>
        ) : !draft && cursor ? (
          <span
            role="status"
            data-mark-cursor-hint
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md bg-[var(--ink)]/80 px-2 py-0.5 text-[11px] font-medium text-white shadow-sm"
            style={{
              // Runtime pointer offset — cannot be a static Tailwind class.
              left: Math.min(cursor.x + 14, Math.max(8, stageW - 72)),
              top: Math.min(cursor.y + 18, Math.max(8, stageH - 24)),
            }}
          >
            按住拖选
          </span>
        ) : null}
        {regions.map((r) =>
          renderBox(r, {
            id: r.id,
            index: r.index,
            label: r.label,
            selected: r.selected,
          })
        )}
        {draft && draft.w >= 1 && draft.h >= 1
          ? renderBox(draft, { draft: true })
          : null}
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(MarkRegionOverlay);
