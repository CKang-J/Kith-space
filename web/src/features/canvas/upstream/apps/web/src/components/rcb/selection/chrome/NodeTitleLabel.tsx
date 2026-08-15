/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/chrome/NodeTitleLabel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Frame / image / video title row above the control box.
 * HTML under camera scale (same contract as SelectionToolbarShell) — not world SVG.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  memo,
} from 'react';
import { LuAudioLines, LuImagePlus } from 'react-icons/lu';
import { RiClapperboardFill, RiVideoAiLine } from 'react-icons/ri';
import { useRcbCamera, rcbCameraCssZoom } from '@recombyn-native/components/rcb';
import {
  NODE_TITLE_LABEL_GAP_PX,
  NODE_TITLE_LABEL_LINE_PX,
} from './SelectionToolbarShell';
import { cn } from '@recombyn-native/utils/classnames';

type NodeTitleLabelBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type NodeTitleIcon =
  | 'frame'
  | 'image'
  | 'image-generator'
  | 'video'
  | 'video-generator'
  | 'lottie'
  | 'lottie-generator'
  | 'audio';

type Props = {
  /** Scene-space AABB of the node / frame. */
  box: NodeTitleLabelBox;
  name: string;
  sizeWidth: number;
  sizeHeight: number;
  /** Hit-test marker: `data-frame-label` | `data-image-label`. */
  dataAttr: 'frame-label' | 'image-label';
  icon?: NodeTitleIcon;
  dataProps?: Record<string, string>;
  /** Degrees; title follows the rotated top edge. */
  angle?: number;
  hidden?: boolean;
  onSelect?: () => void;
  onRename?: (name: string) => void;
  onMove?: (x: number, y: number, opts?: { skipGrid?: boolean }) => void;
  onMoveStart?: () => void;
  onMoveEnd?: () => void;
  originX?: number;
  originY?: number;
  renameAriaLabel?: string;
};

const MUTED = 'var(--muted)';
/** Idle + edit font (screen px; parent counter-scales under camera zoom). */
const TITLE_FONT_PX = 11;
const TITLE_ICON_PX = 12;

/**
 * Scene-space title layout: used by toolbar clearance math / tests.
 * Paint is HTML (`scale(1/zoom)`); these numbers stay `screenPx / zoom`.
 */
export function nodeTitleLabelWorldPlacement(
  box: NodeTitleLabelBox,
  zoom: number,
  opts?: { sizeText?: string }
): {
  inv: number;
  gapScene: number;
  lineScene: number;
  fontSize: number;
  iconSize: number;
  labelBottomScene: number;
  labelTopScene: number;
  textY: number;
  iconX: number;
  iconY: number;
  nameX: number;
  sizeX: number;
  /** Name column width before the size text (overflow clip). */
  nameMaxWidth: number;
  sizeReserve: number;
  hitLeft: number;
  hitTop: number;
  hitWidth: number;
  hitHeight: number;
} {
  const z = Math.max(0.05, zoom || 1);
  const inv = 1 / z;
  const gapScene = NODE_TITLE_LABEL_GAP_PX * inv;
  const lineScene = NODE_TITLE_LABEL_LINE_PX * inv;
  const fontSize = TITLE_FONT_PX * inv;
  const iconSize = TITLE_ICON_PX * inv;
  const labelBottomScene = box.top - gapScene;
  const labelTopScene = labelBottomScene - lineScene;
  const textY = labelTopScene + lineScene * 0.5;
  const gapIcon = 4 * inv;
  const gapNameSize = 8 * inv;
  const sizeText = opts?.sizeText ?? '000 × 000';
  const sizeReserve = Math.max(fontSize * 3, sizeText.length * fontSize * 0.62);
  const nameX = box.left + iconSize + gapIcon;
  const sizeX = box.left + Math.max(1, box.width);
  const nameMaxWidth = Math.max(0, sizeX - gapNameSize - sizeReserve - nameX);
  return {
    inv,
    gapScene,
    lineScene,
    fontSize,
    iconSize,
    labelBottomScene,
    labelTopScene,
    textY,
    iconX: box.left,
    iconY: textY - iconSize * 0.5,
    nameX,
    sizeX,
    nameMaxWidth,
    sizeReserve,
    hitLeft: box.left,
    hitTop: labelTopScene,
    hitWidth: Math.max(1, box.width),
    hitHeight: lineScene,
  };
}

/** Stage layout px from plate top → title bottom. */
export function nodeTitleScreenGapPx(
  place: { labelBottomScene: number },
  boxTop: number,
  cameraZoom: number,
  viewportScale = 1
): number {
  const z = Math.max(0.05, cameraZoom || 1);
  const sx = viewportScale > 0 ? viewportScale : 1;
  return (boxTop - place.labelBottomScene) * z * sx;
}

/** Same glyphs as context-menu Generators (LuImagePlus / RiVideoAiLine / RiClapperboardFill). */
function TitleIcon({ kind }: { kind: NodeTitleIcon }): ReactNode {
  const iconStyle = { color: MUTED } as const;
  if (kind === 'audio') {
    return (
      <LuAudioLines
        size={TITLE_ICON_PX}
        strokeWidth={2}
        className="shrink-0"
        style={iconStyle}
        aria-hidden
      />
    );
  }
  if (kind === 'image-generator') {
    return (
      <LuImagePlus
        size={TITLE_ICON_PX}
        strokeWidth={2}
        className="shrink-0"
        style={iconStyle}
        aria-hidden
      />
    );
  }
  if (kind === 'video-generator') {
    return (
      <RiVideoAiLine
        size={TITLE_ICON_PX}
        className="shrink-0"
        style={{ ...iconStyle, opacity: 0.72 }}
        aria-hidden
      />
    );
  }
  if (kind === 'lottie-generator') {
    return (
      <RiClapperboardFill
        size={TITLE_ICON_PX}
        className="shrink-0"
        style={iconStyle}
        aria-hidden
      />
    );
  }
  const common = {
    fill: 'none' as const,
    stroke: MUTED,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  let path: ReactNode = null;
  if (kind === 'frame') {
    path = (
      <>
        <rect x={3} y={3} width={18} height={18} rx={2} {...common} />
        <path d="M3 9h18" {...common} />
        <path d="M9 21V9" {...common} />
      </>
    );
  } else if (kind === 'video') {
    path = (
      <>
        <rect x={2} y={5} width={20} height={14} rx={2} {...common} />
        <path d="M10 9l5 3-5 3z" {...common} fill={MUTED} />
      </>
    );
  } else {
    path = (
      <>
        <rect x={3} y={3} width={18} height={18} rx={2} {...common} />
        <circle cx={9} cy={9} r={2} {...common} />
        <path d="M21 15l-5-5L5 21" {...common} />
      </>
    );
  }
  return (
    <svg
      width={TITLE_ICON_PX}
      height={TITLE_ICON_PX}
      viewBox="0 0 24 24"
      className="shrink-0"
      aria-hidden
    >
      {path}
    </svg>
  );
}

/**
 * Title row above frames / images / generators — HTML chrome, screen-constant type.
 */
function NodeTitleLabel({
  box,
  name,
  sizeWidth,
  sizeHeight,
  dataAttr,
  icon,
  dataProps,
  angle = 0,
  hidden = false,
  onSelect,
  onRename,
  onMove,
  onMoveStart,
  onMoveEnd,
  originX = 0,
  originY = 0,
  renameAriaLabel,
}: Props): ReactNode {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [labelDragging, setLabelDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const labelDragRef = useRef<{
    originX: number;
    originY: number;
    clientX0: number;
    clientY0: number;
    started: boolean;
  } | null>(null);
  const camera = useRcbCamera();
  const z = rcbCameraCssZoom(camera);
  const inv = 1 / Math.max(0.05, z);
  const rotated = Math.abs(angle) > 0.001;
  const sizeText = `${Math.round(sizeWidth)} × ${Math.round(sizeHeight)}`;

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  useLayoutEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, [editing]);

  useEffect(() => {
    if (!editing) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('[data-rcb-title-edit="1"]')) return;
      window.requestAnimationFrame(() => {
        const el = inputRef.current;
        const value = (el?.value ?? '').trim() || name;
        setEditing(false);
        setDraft(value);
        if (value !== name) onRename?.(value);
      });
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [editing, name, onRename]);

  const iconKind: NodeTitleIcon =
    icon || (dataAttr === 'frame-label' ? 'frame' : 'image');

  const commit = () => {
    const next = draft.trim() || name;
    setEditing(false);
    setDraft(next);
    if (next !== name) onRename?.(next);
  };

  if (hidden || labelDragging) return null;

  const attrProps =
    dataAttr === 'frame-label'
      ? { 'data-frame-label': true as const }
      : { 'data-image-label': true as const };

  const onLabelPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    if (editing) return;
    onSelect?.();
    if (!onMove || e.button !== 0) return;
    labelDragRef.current = {
      originX,
      originY,
      clientX0: e.clientX,
      clientY0: e.clientY,
      started: false,
    };
    const onMoveWin = (ev: PointerEvent) => {
      const drag = labelDragRef.current;
      if (!drag) return;
      const dx = (ev.clientX - drag.clientX0) / z;
      const dy = (ev.clientY - drag.clientY0) / z;
      if (!drag.started) {
        if (Math.hypot(dx, dy) < 3) return;
        drag.started = true;
        setLabelDragging(true);
        onMoveStart?.();
      }
      onMove(Math.round(drag.originX + dx), Math.round(drag.originY + dy), {
        skipGrid: ev.ctrlKey || ev.metaKey,
      });
    };
    const onUpWin = () => {
      const wasDragging = labelDragRef.current?.started;
      labelDragRef.current = null;
      setLabelDragging(false);
      window.removeEventListener('pointermove', onMoveWin);
      window.removeEventListener('pointerup', onUpWin);
      if (wasDragging) onMoveEnd?.();
    };
    window.addEventListener('pointermove', onMoveWin);
    window.addEventListener('pointerup', onUpWin);
  };

  // Anchor at box center (scene). Counter-scale so children use screen px.
  // Title row sits above the top edge: gap + line, left-aligned to the plate.
  const screenW = Math.max(1, box.width) / inv;
  const halfH = Math.max(1, box.height) / (2 * inv);

  return (
    <div
      data-rcb-node-title="1"
      className="pointer-events-none absolute z-[999990] overflow-visible"
      style={{
        left: box.left + box.width / 2,
        top: box.top + box.height / 2,
        width: 0,
        height: 0,
        transform: rotated ? `rotate(${angle}deg) scale(${inv})` : `scale(${inv})`,
        transformOrigin: '0 0',
        pointerEvents: 'none',
      }}
    >
      <div
        {...attrProps}
        {...dataProps}
        className={cn(
          'pointer-events-auto absolute flex min-w-0 items-center gap-1 overflow-hidden font-medium select-none',
          onMove ? 'cursor-grab' : 'cursor-default'
        )}
        style={{
          left: -screenW / 2,
          top: -halfH - NODE_TITLE_LABEL_GAP_PX,
          width: screenW,
          height: NODE_TITLE_LABEL_LINE_PX,
          transform: 'translateY(-100%)',
          color: MUTED,
          fontSize: TITLE_FONT_PX,
          lineHeight: `${NODE_TITLE_LABEL_LINE_PX}px`,
        }}
        onPointerDown={onLabelPointerDown}
        onDoubleClick={(e) => {
          if (!onRename) return;
          e.preventDefault();
          e.stopPropagation();
          onSelect?.();
          setDraft(name);
          setEditing(true);
        }}
      >
        <TitleIcon kind={iconKind} />
        {editing && onRename ? (
          <input
            ref={inputRef}
            data-rcb-title-edit="1"
            data-text-inline-editor
            value={draft}
            aria-label={renameAriaLabel || name}
            className="min-w-0 flex-1 appearance-none overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 font-medium leading-none text-[var(--ink)] shadow-none outline-none ring-0"
            style={{
              fontSize: TITLE_FONT_PX,
              lineHeight: `${NODE_TITLE_LABEL_LINE_PX}px`,
              height: NODE_TITLE_LABEL_LINE_PX,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(name);
                setEditing(false);
              }
              e.stopPropagation();
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {name}
          </span>
        )}
        <span className="shrink-0 opacity-80 tabular-nums">{sizeText}</span>
      </div>
    </div>
  );
}

export default memo(NodeTitleLabel);
