/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/panels/LayerPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { getRecombynIslandRoot } from '@/features/canvas/adapters/recombynFloatingUi';
import { useEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent, type ReactNode, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { FiPenTool } from 'react-icons/fi';
import {
  LuAudioLines,
  LuFrame,
  LuPanelLeft,
  LuPencil,
  LuFilm,
  LuImagePlus,
} from 'react-icons/lu';
import { RiClapperboardFill, RiVideoAiLine } from 'react-icons/ri';
import { RxText } from 'react-icons/rx';
import {
  HiOutlineChevronDown,
  HiOutlineChevronUp,
  HiOutlineEye,
  HiOutlineEyeSlash,
  HiOutlineLockClosed,
  HiOutlineLockOpen,
  HiOutlineMinus,
  HiOutlinePhoto,
  HiOutlineStop,
} from 'react-icons/hi2';
import { TbArrowUpRight, TbCircle, TbPolygon, TbStar, TbTriangle } from 'react-icons/tb';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { VirtualList, type VirtualListHandle } from '@recombyn-native/components/base/VirtualList';
import {
  isGeneratorNode,
  isImageGeneratorNode,
  isAudioGeneratorNode,
  isLottieGeneratorNode,
  isVideoGeneratorNode,
  isNodeHidden,
  isNodeLocked
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import {
  listSceneNodes,
  parseStackKey
} from '@recombyn-native/components/rcb/scene/document/sceneDocument';
import { cn } from '@recombyn-native/utils/classnames';
import {
  patchDocumentNode,
  setActiveFrameId,
  setSelectedNodeId,
  updateArtboardFrame,
  EMPTY_ID_LIST,
} from '@recombyn-native/store/modules/editor';

type LayerStackRow = { kind: 'frame' | 'node'; id: string };

const LAYER_ROW_ESTIMATE_PX = 40;

const LAYER_DOCK_WIDTH_KEY = 'layer-dock-width';
const LAYER_DOCK_MIN_W = 180;
const LAYER_DOCK_MAX_W = 420;
const LAYER_DOCK_DEFAULT_W = 220;

function clampLayerDockWidth(width: number): number {
  const viewportCap =
    typeof window !== 'undefined'
      ? Math.max(LAYER_DOCK_MIN_W, window.innerWidth - 360)
      : LAYER_DOCK_MAX_W;
  return Math.min(
    LAYER_DOCK_MAX_W,
    viewportCap,
    Math.max(LAYER_DOCK_MIN_W, Math.round(width))
  );
}

function readStoredLayerDockWidth(): number {
  try {
    const raw = localStorage.getItem(LAYER_DOCK_WIDTH_KEY);
    if (!raw) return LAYER_DOCK_DEFAULT_W;
    const n = Number(raw);
    if (!Number.isFinite(n)) return LAYER_DOCK_DEFAULT_W;
    return clampLayerDockWidth(n);
  } catch {
    return LAYER_DOCK_DEFAULT_W;
  }
}

type LayerIconComponent = ComponentType<{ className?: string }>;

const LAYER_ICON_SLOT =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]';

const layerIconByKind: Record<string, LayerIconComponent> = {
  text: RxText,
  image: HiOutlinePhoto,
  rect: HiOutlineStop,
  line: HiOutlineMinus,
  arrow: TbArrowUpRight,
  circle: TbCircle,
  triangle: TbTriangle,
  star: TbStar,
  polygon: TbPolygon,
  pen: FiPenTool,
  pencil: LuPencil,
  path: FiPenTool,
};

const layerIconSizeByKind: Record<string, string> = {
  text: 'h-[14px] w-[14px]',
  image: 'h-[12px] w-[12px]',
  rect: 'h-[12px] w-[12px]',
  line: 'h-[11px] w-[16px]',
  arrow: 'h-[13px] w-[13px]',
  circle: 'h-[16px] w-[16px]',
  triangle: 'h-[14px] w-[14px]',
  star: 'h-[14px] w-[14px]',
  polygon: 'h-[13px] w-[13px]',
  pen: 'h-[14px] w-[14px]',
  pencil: 'h-[14px] w-[14px]',
  path: 'h-[14px] w-[14px]',
};

function resolveLayerIconKind(node: { key: string; attrs?: { shapeType?: string } }) {
  if (node.key === 'shape') return node.attrs?.shapeType || 'rect';
  return node.key;
}

function readLayerMediaSrc(attrs: Record<string, unknown> | undefined) {
  return String(attrs?.src || '').trim();
}

function readLayerPoster(attrs: Record<string, unknown> | undefined) {
  return String(attrs?.poster || '').trim();
}

function LayerMediaThumb({
  src,
  poster,
  kind,
}: {
  src?: string;
  poster?: string;
  kind: 'image' | 'video';
}) {
  const imageSrc = kind === 'video' ? poster || '' : src || '';
  if (imageSrc) {
    return (
      <span className={LAYER_ICON_SLOT}>
        <img src={imageSrc} alt="" className="h-full w-full object-cover" draggable={false} />
      </span>
    );
  }
  if (kind === 'video' && src) {
    return (
      <span className={LAYER_ICON_SLOT}>
        <video
          src={src}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      </span>
    );
  }
  return null;
}

function LayerGlyphFallback({ children }: { children: ReactNode }) {
  return <span className={LAYER_ICON_SLOT}>{children}</span>;
}

function LayerIcon({
  node,
  filled,
}: {
  node: {
    key: string;
    attrs?: {
      shapeType?: string;
      ['fill-color']?: string;
      imageGenerator?: unknown;
      videoGenerator?: unknown;
      src?: unknown;
      poster?: unknown;
      name?: unknown;
    };
  };
  filled?: boolean;
}) {
  const src = readLayerMediaSrc(node.attrs as Record<string, unknown> | undefined);
  const poster = readLayerPoster(node.attrs as Record<string, unknown> | undefined);

  if (isImageGeneratorNode(node)) {
    const thumb = src ? <LayerMediaThumb kind="image" src={src} /> : null;
    if (thumb) return thumb;
    return (
      <LayerGlyphFallback>
        <LuImagePlus className="block h-[13px] w-[13px] shrink-0" strokeWidth={1.75} />
      </LayerGlyphFallback>
    );
  }

  if (isVideoGeneratorNode(node)) {
    const thumb =
      poster || src ? <LayerMediaThumb kind="video" src={src} poster={poster} /> : null;
    if (thumb) return thumb;
    return (
      <LayerGlyphFallback>
        <RiVideoAiLine className="block h-[13px] w-[13px] shrink-0" />
      </LayerGlyphFallback>
    );
  }

  if (isLottieGeneratorNode(node)) {
    return (
      <LayerGlyphFallback>
        <RiClapperboardFill className="block h-[13px] w-[13px] shrink-0" />
      </LayerGlyphFallback>
    );
  }

  if (node.key === 'lottie') {
    return (
      <LayerGlyphFallback>
        <LuFilm className="block h-[13px] w-[13px] shrink-0" strokeWidth={1.75} />
      </LayerGlyphFallback>
    );
  }

  if (isAudioGeneratorNode(node) || node.key === 'audio') {
    return (
      <LayerGlyphFallback>
        <LuAudioLines className="block h-[13px] w-[13px] shrink-0" strokeWidth={1.75} />
      </LayerGlyphFallback>
    );
  }

  if (node.key === 'video') {
    const thumb =
      poster || src ? <LayerMediaThumb kind="video" src={src} poster={poster} /> : null;
    if (thumb) return thumb;
    return (
      <LayerGlyphFallback>
        <LuFilm className="block h-[13px] w-[13px] shrink-0" strokeWidth={1.75} />
      </LayerGlyphFallback>
    );
  }

  if (node.key === 'image' && src) {
    const thumb = <LayerMediaThumb kind="image" src={src} />;
    if (thumb) return thumb;
  }

  const kind = resolveLayerIconKind(node);
  const Icon = layerIconByKind[kind] || HiOutlineStop;
  const sizeClass = layerIconSizeByKind[kind] || layerIconSizeByKind.rect;
  const fill = String(node.attrs?.['fill-color'] || '');
  const isSolidRect =
    filled ||
    (kind === 'rect' && fill && fill !== 'transparent' && !/^rgba?\([^)]*,\s*0\)/.test(fill));

  return (
    <span
      className={cn(
        LAYER_ICON_SLOT,
        isSolidRect && 'bg-[var(--accent-soft)]'
      )}
    >
      {isSolidRect && kind === 'rect' ? (
        <span
          className="block h-3 w-3 rounded-[2px]"
          style={{ background: fill || 'var(--muted)' }}
        />
      ) : (
        <Icon className={cn(sizeClass, 'block shrink-0')} />
      )}
    </span>
  );
}

function layerLabel(
  node: {
    key: string;
    attrs?: {
      shapeType?: string;
      imageGenerator?: unknown;
      videoGenerator?: unknown;
      lottieGenerator?: unknown;
      audioGenerator?: unknown;
      name?: unknown;
    };
  },
  imageGeneratorLabel: string,
  videoGeneratorLabel?: string,
  lottieGeneratorLabel?: string,
  audioGeneratorLabel?: string
) {
  if (isImageGeneratorNode(node)) return imageGeneratorLabel;
  if (isVideoGeneratorNode(node)) return videoGeneratorLabel || 'Video Generator';
  if (isLottieGeneratorNode(node)) return lottieGeneratorLabel || 'Lottie Generator';
  if (isAudioGeneratorNode(node)) return audioGeneratorLabel || 'Audio Generator';
  if (node.key === 'video') return String(node.attrs?.name || 'Video');
  if (node.key === 'lottie') return String(node.attrs?.name || 'Lottie');
  if (node.key === 'audio') return String(node.attrs?.name || 'Audio');
  const kind = resolveLayerIconKind(node);
  const map: Record<string, string> = {
    text: '文字',
    image: '图片',
    rect: '矩形',
    line: '线条',
    arrow: '箭头',
    circle: '椭圆',
    triangle: '多边形',
    polygon: '多边形',
    star: '星形',
    pen: '钢笔',
    pencil: '画笔',
    path: '路径',
    svg: 'SVG',
    lottie: 'Lottie',
    audio: '音频',
  };
  return map[kind] || kind;
}

function hiddenAttrPatch(nextHidden: boolean) {
  return { attrs: { hidden: nextHidden ? 'true' : 'false' } };
}

function lockedAttrPatch(nextLocked: boolean) {
  return { attrs: { locked: nextLocked ? 'true' : 'false' } };
}

function LayerStackRowView({
  row,
  frame,
  node,
  selected,
  onSelectFrame,
  onSelectNode,
}: {
  row: LayerStackRow;
  frame?: any;
  node?: any;
  selected: boolean;
  onSelectFrame?: (frameId: string) => void;
  onSelectNode?: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();

  if (row.kind === 'frame') {
    if (!frame) return null;
    const locked = Boolean(frame.locked);
    const hidden = Boolean(frame.hidden);
    return (
      <div
        className={cn(
          'group flex min-h-[40px] w-full items-center gap-1 px-2 py-1 text-[13px] transition-colors',
          selected
            ? 'bg-[var(--accent-soft)] text-[var(--ink)]'
            : 'text-[var(--ink)] hover:bg-[var(--accent-soft)]'
        )}
      >
        <button
          type="button"
          onClick={() => {
            if (onSelectFrame) onSelectFrame(row.id);
            else dispatch(setActiveFrameId(row.id));
          }}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1 text-left',
            hidden && 'opacity-50'
          )}
        >
          <span className={LAYER_ICON_SLOT}>
            <LuFrame className="h-[13px] w-[13px] block shrink-0" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1 truncate">
            {String(frame.name || t('editor.tools.frame') || 'Frame')}
          </span>
        </button>
        <Tooltip
          tip={hidden ? t('editor.contextMenu.show') : t('editor.contextMenu.hide')}
          placement="top"
        >
          <button
            type="button"
            aria-label={hidden ? t('editor.contextMenu.show') : t('editor.contextMenu.hide')}
            aria-pressed={hidden}
            onClick={(e) => {
              e.stopPropagation();
              const nextHidden = !hidden;
              dispatch(
                updateArtboardFrame({
                  id: row.id,
                  patch: { hidden: nextHidden },
                })
              );
              if (nextHidden && selected) {
                dispatch(setActiveFrameId(null));
              }
            }}
            className={cn(
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--ink)]',
              !hidden && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              selected && !hidden && 'opacity-100'
            )}
          >
            {hidden ? (
              <HiOutlineEyeSlash className="h-3.5 w-3.5" strokeWidth={1.75} />
            ) : (
              <HiOutlineEye className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
          </button>
        </Tooltip>
        <Tooltip
          tip={locked ? t('editor.contextMenu.unlock') : t('editor.contextMenu.lock')}
          placement="top"
        >
          <button
            type="button"
            aria-label={locked ? t('editor.contextMenu.unlock') : t('editor.contextMenu.lock')}
            aria-pressed={locked}
            onClick={(e) => {
              e.stopPropagation();
              dispatch(
                updateArtboardFrame({
                  id: row.id,
                  patch: { locked: !locked },
                })
              );
            }}
            className={cn(
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--ink)]',
              !locked && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              selected && !locked && 'opacity-100'
            )}
          >
            {locked ? (
              <HiOutlineLockClosed className="h-3.5 w-3.5" strokeWidth={1.75} />
            ) : (
              <HiOutlineLockOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
          </button>
        </Tooltip>
      </div>
    );
  }

  if (!node) return null;
  const hidden = isNodeHidden(node);
  const locked = isNodeLocked(node);
  const generator = isGeneratorNode(node);
  return (
    <div
      className={cn(
        'group flex min-h-[40px] w-full items-center gap-1 px-2 py-1 text-[13px] transition-colors',
        selected
          ? 'bg-[var(--accent-soft)] text-[var(--ink)]'
          : 'text-[var(--ink)] hover:bg-[var(--accent-soft)]'
      )}
    >
      <button
        type="button"
        onClick={() => {
          if (onSelectNode) onSelectNode(row.id);
          else dispatch(setSelectedNodeId(row.id));
        }}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1 text-left',
          hidden && 'opacity-50'
        )}
      >
        <LayerIcon node={node} />
        <span className="min-w-0 flex-1 truncate">
          {layerLabel(
            node,
            t('editor.tools.imageGenerator'),
            t('editor.tools.videoGenerator'),
            t('editor.tools.lottieGenerator'),
            t('editor.tools.audioGenerator', { defaultValue: '音频生成器' })
          )}
        </span>
      </button>
      <Tooltip
        tip={hidden ? t('editor.contextMenu.show') : t('editor.contextMenu.hide')}
        placement="top"
      >
        <button
          type="button"
          disabled={generator}
          aria-label={hidden ? t('editor.contextMenu.show') : t('editor.contextMenu.hide')}
          aria-pressed={hidden}
          onClick={(e) => {
            e.stopPropagation();
            if (generator) return;
            const nextHidden = !hidden;
            dispatch(
              patchDocumentNode({
                nodeId: row.id,
                patch: hiddenAttrPatch(nextHidden),
              })
            );
            if (nextHidden && selected) {
              dispatch(setSelectedNodeId(null));
            }
          }}
          className={cn(
            'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--muted)]',
            !generator && !hidden && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            !generator && selected && !hidden && 'opacity-100'
          )}
        >
          {hidden ? (
            <HiOutlineEyeSlash className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <HiOutlineEye className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
      </Tooltip>
      <Tooltip
        tip={locked ? t('editor.contextMenu.unlock') : t('editor.contextMenu.lock')}
        placement="top"
      >
        <button
          type="button"
          disabled={generator}
          aria-label={locked ? t('editor.contextMenu.unlock') : t('editor.contextMenu.lock')}
          aria-pressed={locked}
          onClick={(e) => {
            e.stopPropagation();
            if (generator) return;
            dispatch(
              patchDocumentNode({
                nodeId: row.id,
                patch: lockedAttrPatch(!locked),
              })
            );
          }}
          className={cn(
            'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--muted)]',
            !generator && !locked && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            !generator && selected && !locked && 'opacity-100'
          )}
        >
          {locked ? (
            <HiOutlineLockClosed className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <HiOutlineLockOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
      </Tooltip>
    </div>
  );
}

/** Left layers dock — history + frames/nodes from unified stackOrder. */
function LayerPanel({
  onClose,
  onSelectNode,
  onSelectFrame,
  mobile = false,
}: {
  onClose?: () => void;
  /** Select + pan camera so the node is centered in the current viewport. */
  onSelectNode?: (nodeId: string) => void;
  /** Select + pan camera so the artboard is centered. */
  onSelectFrame?: (frameId: string) => void;
  mobile?: boolean;
} = {}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const document = useSelector((state: any) => state.editor.document);
  const selectedNodeId = useSelector((state: any) => state.editor.selectedNodeId);
  const activeFrameId = useSelector((state: any) => state.editor.document?.activeFrameId);
  const selectedFrameIds = useSelector(
    (state: any) => (state.editor.selectedFrameIds as string[]) ?? EMPTY_ID_LIST
  );
  const historyPast = useSelector((state: any) => state.editor.historyPast as any[]);
  const nodes = listSceneNodes(document);
  const frames = Array.isArray(document?.frames) ? document.frames : [];
  const frameById = useMemo(() => {
    const map = new Map<string, any>();
    for (const f of frames) {
      if (f?.id) map.set(String(f.id), f);
    }
    return map;
  }, [frames]);
  const nodeById = useMemo(() => {
    const map = new Map<string, any>();
    for (const { id, node } of nodes) map.set(id, node);
    return map;
  }, [nodes]);
  const layerRows = useMemo(() => {
    const order = Array.isArray(document?.stackOrder) ? document.stackOrder.map(String) : [];
    const rows: LayerStackRow[] = [];
    if (order.length) {
      for (const key of [...order].reverse()) {
        const parsed = parseStackKey(key);
        if (!parsed) continue;
        if (parsed.kind === 'frame' && frameById.has(parsed.id)) {
          rows.push(parsed);
        } else if (parsed.kind === 'node' && nodeById.has(parsed.id)) {
          rows.push(parsed);
        }
      }
      return rows;
    }
    // Fallback before stackOrder migrates
    for (const f of [...frames].reverse()) {
      if (f?.id) rows.push({ kind: 'frame', id: String(f.id) });
    }
    for (const { id } of [...nodes].reverse()) rows.push({ kind: 'node', id });
    return rows;
  }, [document?.stackOrder, frameById, nodeById, frames, nodes]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dockWidth, setDockWidth] = useState(LAYER_DOCK_DEFAULT_W);
  const resizeDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const layerListRef = useRef<VirtualListHandle | null>(null);

  useEffect(() => {
    setDockWidth(readStoredLayerDockWidth());
  }, []);

  useEffect(() => {
    const onWinResize = () => setDockWidth((w) => clampLayerDockWidth(w));
    window.addEventListener('resize', onWinResize);
    return () => window.removeEventListener('resize', onWinResize);
  }, []);

  useEffect(
    () => () => {
      getRecombynIslandRoot().style.cursor = '';
      getRecombynIslandRoot().style.userSelect = '';
    },
    []
  );

  useEffect(() => {
    if (!layerRows.length) return;
    let index = -1;
    if (selectedNodeId) {
      index = layerRows.findIndex((r) => r.kind === 'node' && r.id === selectedNodeId);
    } else if (selectedFrameIds.length) {
      const fid = selectedFrameIds[0];
      index = layerRows.findIndex((r) => r.kind === 'frame' && r.id === fid);
    } else if (activeFrameId) {
      index = layerRows.findIndex((r) => r.kind === 'frame' && r.id === activeFrameId);
    }
    if (index >= 0) layerListRef.current?.scrollToIndex(index, { align: 'auto' });
  }, [selectedNodeId, selectedFrameIds, activeFrameId, layerRows]);

  const persistDockWidth = (width: number) => {
    const next = clampLayerDockWidth(width);
    setDockWidth(next);
    try {
      localStorage.setItem(LAYER_DOCK_WIDTH_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  const onDockResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeDragRef.current = { startX: e.clientX, startW: dockWidth };
    getRecombynIslandRoot().style.cursor = 'col-resize';
    getRecombynIslandRoot().style.userSelect = 'none';
  };

  const onDockResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    // Right edge: drag right → wider
    setDockWidth(clampLayerDockWidth(drag.startW + (e.clientX - drag.startX)));
  };

  const endDockResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeDragRef.current) return;
    resizeDragRef.current = null;
    getRecombynIslandRoot().style.cursor = '';
    getRecombynIslandRoot().style.userSelect = '';
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setDockWidth((w) => {
      try {
        localStorage.setItem(LAYER_DOCK_WIDTH_KEY, String(w));
      } catch {
        /* ignore */
      }
      return w;
    });
  };

  const historyItems = useMemo(() => {
    // Newest first — length is enough for a simple step list.
    return historyPast.map((_: unknown, i: number) => ({
      id: `h-${i}`,
      label: t('editor.historyStep', { n: historyPast.length - i }),
    }));
  }, [historyPast, t]);

  return (
    <aside
      style={mobile ? { width: 'min(20rem, 82vw)' } : { width: dockWidth }}
      className={cn(
        'relative flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--line)] bg-[var(--surface)]',
        mobile && 'shadow-[0_18px_48px_rgba(12,12,13,0.24)]'
      )}
    >
      {!mobile ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('editor.resizeLayersDock')}
          aria-valuemin={LAYER_DOCK_MIN_W}
          aria-valuemax={LAYER_DOCK_MAX_W}
          aria-valuenow={dockWidth}
          className="absolute inset-y-0 right-0 z-20 w-1.5 cursor-col-resize touch-none hover:bg-[var(--accent)]/25 active:bg-[var(--accent)]/40"
          onPointerDown={onDockResizePointerDown}
          onPointerMove={onDockResizePointerMove}
          onPointerUp={endDockResize}
          onPointerCancel={endDockResize}
          onDoubleClick={() => persistDockWidth(LAYER_DOCK_DEFAULT_W)}
        />
      ) : null}
      <div className="flex h-11 shrink-0 items-center justify-between px-3">
        <span className="text-[14px] font-semibold text-[var(--ink)]">{t('editor.layers')}</span>
        {onClose ? (
          <Tooltip tip={t('editor.closePanel')} placement="bottom">
            <button
              type="button"
              aria-label={t('editor.closePanel')}
              onClick={onClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
            >
              <LuPanelLeft className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </Tooltip>
        ) : null}
      </div>

      {/* History */}
      <div className="shrink-0 border-b border-[var(--line)] px-2 pb-2">
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-md px-1 py-1.5 text-left text-[12px] font-medium text-[var(--ink)] hover:bg-[var(--accent-soft)]"
        >
          <span>{t('editor.history')}</span>
          {historyOpen ? (
            <HiOutlineChevronUp className="h-3.5 w-3.5 text-[var(--muted)]" />
          ) : (
            <HiOutlineChevronDown className="h-3.5 w-3.5 text-[var(--muted)]" />
          )}
        </button>
        {historyOpen ? (
          <div className="mt-1 h-[120px] overflow-y-auto">
            {historyItems.length ? (
              <ul className="space-y-0.5">
                {historyItems.map((item) => (
                  <li
                    key={item.id}
                    className="truncate rounded-md px-2 py-1.5 text-[12px] text-[var(--muted)]"
                  >
                    {item.label}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--muted)]">
                <HiOutlinePhoto className="h-8 w-8 opacity-40" />
                <p className="text-[12px]">{t('editor.noHistory')}</p>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Layer rows — top of list = front of stack (virtualized) */}
      <VirtualList
        ref={layerListRef}
        items={layerRows}
        estimateSize={LAYER_ROW_ESTIMATE_PX}
        overscan={10}
        getItemKey={(row) => `${row.kind}-${row.id}`}
        className="py-1"
        empty={
          <p className="px-3 py-8 text-center text-[12px] text-[var(--muted)]">
            {t('editor.noLayers')}
          </p>
        }
      >
        {(row) => {
          const selected =
            row.kind === 'frame'
              ? selectedFrameIds.includes(row.id) ||
                (!selectedFrameIds.length && activeFrameId === row.id)
              : selectedNodeId === row.id;
          return (
            <LayerStackRowView
              row={row}
              frame={row.kind === 'frame' ? frameById.get(row.id) : undefined}
              node={row.kind === 'node' ? nodeById.get(row.id) : undefined}
              selected={selected}
              onSelectFrame={onSelectFrame}
              onSelectNode={onSelectNode}
            />
          );
        }}
      </VirtualList>
    </aside>
  );
}

export default memo(LayerPanel);
