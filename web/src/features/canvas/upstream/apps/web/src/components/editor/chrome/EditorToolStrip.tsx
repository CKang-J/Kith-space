/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/chrome/EditorToolStrip.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type SVGProps, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  LuArrowUpRight,
  LuCircle,
  LuFrame,
  LuHand,
  LuHexagon,
  LuImage,
  LuImagePlus,
  LuImageUp,
  LuMinus,
  LuMousePointer2,
  LuPenTool,
  LuPencil,
  LuSquare,
  LuStar,
  LuTriangle,
  LuType,
  LuVideo,
} from 'react-icons/lu';
import { RiImageUploadLine, RiVideoUploadLine } from 'react-icons/ri';
import { Dropdown, Tooltip, message } from '@recombyn-native/components/base';
import type { MenuItemType } from '@recombyn-native/components/base/dropdown/MenuItem';
import { FloatingToolbar } from '@recombyn-native/components/editor/chrome/FloatingToolbar';
import {
  uploadImageFile,
  readFileAsDataUrl,
  beginNodeUpload,
  finishNodeUpload,
  isUploadAbortError,
  waitForImageReady,
} from '@recombyn-native/utils/uploadImage';
import store from '@recombyn-native/store';
import {
  setActiveTool,
  setShapeKind,
  startImageUploadPlaceholder,
  startVideoUploadPlaceholder,
  spawnImageGenerator,
  spawnVideoGenerator,
  finishImageProcess,
  failImageProcess,
} from '@recombyn-native/store/modules/editor';
import {
  ensureCanvasPlugins,
  listCanvasToolbarButtons,
  buildCanvasPluginRuntime,
  type CanvasToolbarButton,
} from '@recombyn-native/plugins/canvas/host';
import {
  fitImageSize,
  measureImageNaturalSize,
  prepareVideoUploadPreview
} from '@recombyn-native/components/rcb/scene/document/nodeFactories';
import { sceneToDocumentCoords } from '@recombyn-native/components/rcb/scene/paint/svgToScene';
import {
  rcbLayoutGeneratorPlate,
  rcbScreenToScene,
  GENERATOR_EMPTY_STROKE_OUTSET,
  type RcbCamera,
} from '@recombyn-native/components/rcb';
import {
  getDocumentGridSize,
} from '@recombyn-native/components/rcb/selection/alignGuides';
import { cn } from '@recombyn-native/utils/classnames';
import { getHttpErrorMessage } from '@recombyn-native/service/client';
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';

const MENU_ICON_CLASS = 'h-4 w-4';
const TOOL_ICON_CLASS = 'h-4 w-4 shrink-0';
const STROKE = 1.5;
const MENU_POPUP = 'min-w-[168px]';

/**
 * Fit a generator plate into the visible stage, center it, snap painted outer
 * ink to the document grid (then inset 0.5 for the empty-state center stroke).
 */
function layoutGeneratorPlateInView(opts: {
  document: SceneDocument;
  camera: RcbCamera;
  stageEl: HTMLElement;
  natural: { width: number; height: number };
  fit?: { minRatio?: number; maxRatio?: number };
}): { x: number; y: number; width: number; height: number; debug: Record<string, number> } {
  const view = opts.stageEl.getBoundingClientRect();
  const zoom = Math.max(0.05, opts.camera.zoom || 1);
  const center = rcbScreenToScene(
    opts.camera,
    opts.stageEl,
    view.left + view.width / 2,
    view.top + view.height / 2
  );
  const gridSize = getDocumentGridSize(opts.document);
  const laid = rcbLayoutGeneratorPlate({
    natural: opts.natural,
    viewport: { width: view.width, height: view.height },
    zoom,
    center,
    gridSize,
    visualOutset: GENERATOR_EMPTY_STROKE_OUTSET,
    fit: opts.fit,
  });
  const origin = sceneToDocumentCoords(opts.document, laid.left, laid.top);
  const debug = {
    zoom,
    viewW: view.width,
    viewH: view.height,
    sceneViewW: view.width / zoom,
    sceneViewH: view.height / zoom,
    geomW: laid.width,
    geomH: laid.height,
    visualL: laid.visual.left,
    visualT: laid.visual.top,
    visualW: laid.visual.width,
    visualH: laid.visual.height,
    x: origin.x,
    y: origin.y,
    gridSize,
  };
  if (typeof window !== 'undefined' && (window as any).__RCB_GENERATOR_PLACE_DEBUG__) {
    // eslint-disable-next-line no-console
    console.log('[rcb:generator-place]', debug);
  }
  return {
    x: origin.x,
    y: origin.y,
    width: laid.width,
    height: laid.height,
    debug,
  };
}

type LayerIconComponent = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

/** Layer glyphs share one stroke weight / optical size. */
const layerIconByKind: Record<string, LayerIconComponent> = {
  text: LuType,
  image: LuImage,
  rect: LuSquare,
  line: LuMinus,
  arrow: LuArrowUpRight,
  circle: LuCircle,
  triangle: LuTriangle,
  star: LuStar,
  polygon: LuHexagon,
  pen: LuPenTool,
  pencil: LuPencil,
  path: LuPenTool,
};

function MenuLabel({
  iconKey,
  label,
  icon,
}: {
  iconKey?: string;
  label: string;
  icon?: ReactNode;
}) {
  const IconComp = iconKey ? layerIconByKind[iconKey] || layerIconByKind.rect : null;
  return (
    <span className="flex w-full items-center gap-2">
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[var(--ink)]">
        {icon ||
          (IconComp ? (
            <IconComp className={cn('block shrink-0', MENU_ICON_CLASS)} strokeWidth={STROKE} />
          ) : null)}
      </span>
      <span className="flex-1 text-[12px] text-[var(--ink)]">{label}</span>
    </span>
  );
}

function ToolIcon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'pointer-events-none inline-flex items-center justify-center',
        TOOL_ICON_CLASS,
        '[&>svg]:block [&>svg]:h-full [&>svg]:w-full',
        className
      )}
    >
      {children}
    </span>
  );
}

function ToolBtn({
  tip,
  ariaLabel,
  active,
  disabled,
  onClick,
  children,
}: {
  /** When omitted, no hover tip (use for tools that open a secondary panel). */
  tip?: string;
  ariaLabel?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const label = ariaLabel || tip;
  const btn = (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
        disabled && 'pointer-events-none opacity-40',
        active
          ? 'bg-[var(--ink)] text-[var(--on-brand)]'
          : 'text-[var(--ink)] hover:bg-[var(--accent-soft)]'
      )}
    >
      {children}
    </button>
  );
  if (!tip) return btn;
  return (
    <Tooltip tip={tip} placement="top">
      {btn}
    </Tooltip>
  );
}

/** Click activates tool; hover shows variant panel (no corner chevron). No tip — panel is the hint. */
function SplitToolButton({
  tip,
  active,
  disabled,
  menuOpen,
  onMenuOpenChange,
  items,
  selectedKeys,
  onMenuPick,
  onPrimaryClick,
  menuOffset = 10,
  children,
}: {
  /** Accessible name only; no hover tip (dropdown is the secondary panel). */
  tip: string;
  active?: boolean;
  disabled?: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  items: MenuItemType[];
  selectedKeys: string[];
  onMenuPick: (key: string) => void;
  /** Click the icon → select / re-activate the current sub-tool. */
  onPrimaryClick: () => void;
  /** Gap between trigger and dropdown (px). */
  menuOffset?: number;
  children: ReactNode;
}) {
  return (
    <Dropdown
      trigger="hover"
      open={disabled ? false : menuOpen}
      onOpenChange={(open) => {
        if (disabled) return;
        onMenuOpenChange(open);
      }}
      placement="top"
      offset={menuOffset}
      items={items}
      selectedKeys={selectedKeys}
      onClick={onMenuPick}
      popupClassName={MENU_POPUP}
      floatingClassName="z-50"
      referenceClassName={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
        disabled && 'pointer-events-none opacity-40',
        active
          ? 'bg-[var(--ink)] text-[var(--on-brand)]'
          : 'text-[var(--ink)] hover:bg-[var(--accent-soft)]'
      )}
    >
      <button
        type="button"
        aria-label={tip}
        disabled={disabled}
        onClick={(e) => {
          e.preventDefault();
          if (disabled) return;
          onPrimaryClick();
        }}
        className="inline-flex size-full items-center justify-center"
      >
        {children}
      </button>
    </Dropdown>
  );
}

/**
 * Bottom-center tool dock:
 * Select · 形状 · 钢笔 · 画笔 · 文字 · 智能画板 · 图片
 */
function EditorToolStrip({
  className,
  camera,
  stageEl = null,
  compact = false,
  selectOnly = false,
}: {
  className?: string;
  /** Used to place toolbar image uploads at the visible viewport center. */
  camera?: RcbCamera;
  stageEl?: HTMLElement | null;
  compact?: boolean;
  /** Preview / inspect: keep the dock visible but only Select / Pan stay active. */
  selectOnly?: boolean;
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const activeTool = useSelector((state: any) => state.editor.activeTool);
  const shapeKind = useSelector((state: any) => state.editor.shapeKind);
  const document = useSelector((state: any) => state.editor.document);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [pluginButtons, setPluginButtons] = useState<CanvasToolbarButton[]>([]);
  const toolsLocked = Boolean(selectOnly);

  useEffect(() => {
    let cancelled = false;
    async function loadPlugins() {
      await ensureCanvasPlugins();
      if (cancelled) return;
      setPluginButtons(listCanvasToolbarButtons());
    }
    void loadPlugins();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toolsLocked) return;
    if (activeTool === 'select' || activeTool === 'pan') return;
    dispatch(setActiveTool('select'));
  }, [toolsLocked, activeTool, dispatch]);

  const L = useMemo(
    () => ({
      select: t('editor.tools.select'),
      pan: t('editor.tools.pan'),
      frame: t('editor.tools.frame'),
      shape: t('editor.tools.shape'),
      pen: t('editor.tools.pen'),
      pencil: t('editor.tools.pencil'),
      text: t('editor.tools.text'),
      rect: t('editor.tools.rect'),
      line: t('editor.tools.line'),
      arrow: t('editor.tools.arrow'),
      circle: t('editor.tools.circle'),
      polygon: t('editor.tools.polygon'),
      star: t('editor.tools.star'),
      uploadImage: t('editor.tools.uploadImage'),
      uploadVideo: t('editor.tools.uploadVideo', {
        defaultValue: '视频上传',
      }),
      uploadMedia: t('editor.tools.uploadMedia', {
        defaultValue: '上传文件',
      }),
      imageGenerator: t('editor.tools.imageGenerator'),
      videoGenerator: t('editor.tools.videoGenerator'),
      uploading: t('editor.tools.uploading'),
      uploadFail: t('editor.tools.uploadFail'),
    }),
    [t]
  );

  const selectItems: MenuItemType[] = useMemo(
    () => [
      {
        key: 'select',
        label: (
          <MenuLabel
            label={L.select}
            icon={<LuMousePointer2 className={MENU_ICON_CLASS} strokeWidth={STROKE} />}
          />
        ),
      },
      {
        key: 'pan',
        label: (
          <MenuLabel
            label={L.pan}
            icon={<LuHand className={MENU_ICON_CLASS} strokeWidth={STROKE} />}
          />
        ),
      },
    ],
    [L.pan, L.select]
  );

  const shapeItems: MenuItemType[] = useMemo(
    () => [
      { key: 'rect', label: <MenuLabel iconKey="rect" label={L.rect} /> },
      { key: 'line', label: <MenuLabel iconKey="line" label={L.line} /> },
      { key: 'arrow', label: <MenuLabel iconKey="arrow" label={L.arrow} /> },
      { key: 'circle', label: <MenuLabel iconKey="circle" label={L.circle} /> },
      { key: 'polygon', label: <MenuLabel iconKey="polygon" label={L.polygon} /> },
      { key: 'star', label: <MenuLabel iconKey="star" label={L.star} /> },
    ],
    [L.arrow, L.circle, L.line, L.polygon, L.rect, L.star]
  );

  const uploadItems: MenuItemType[] = useMemo(
    () => [
      {
        key: 'image',
        label: (
          <MenuLabel
            label={L.uploadImage}
            icon={<RiImageUploadLine className={MENU_ICON_CLASS} />}
          />
        ),
      },
      {
        key: 'video',
        label: (
          <MenuLabel
            label={L.uploadVideo}
            icon={<RiVideoUploadLine className={MENU_ICON_CLASS} />}
          />
        ),
      },
    ],
    [L.uploadImage, L.uploadVideo]
  );

  const spawnImageGeneratorAtView = () => {
    if (!document) return;
    let width = 360;
    let height = 360;
    let x = 40;
    let y = 40;
    if (camera && stageEl) {
      const view = stageEl.getBoundingClientRect();
      if (view.width > 0 && view.height > 0) {
        const laid = layoutGeneratorPlateInView({
          document,
          camera,
          stageEl,
          natural: { width: 1024, height: 1024 },
          fit: { minRatio: 0.28, maxRatio: 0.42 },
        });
        width = laid.width;
        height = laid.height;
        x = laid.x;
        y = laid.y;
      }
    }
    dispatch(
      spawnImageGenerator({
        x,
        y,
        width,
        height,
        name: L.imageGenerator,
      })
    );
  };

  const spawnVideoGeneratorAtView = () => {
    if (!document) return;
    let width = 640;
    let height = 360;
    let x = 40;
    let y = 40;
    if (camera && stageEl) {
      const view = stageEl.getBoundingClientRect();
      if (view.width > 0 && view.height > 0) {
        const laid = layoutGeneratorPlateInView({
          document,
          camera,
          stageEl,
          natural: { width: 1280, height: 720 },
          fit: { minRatio: 0.28, maxRatio: 0.48 },
        });
        width = laid.width;
        height = laid.height;
        x = laid.x;
        y = laid.y;
      }
    }
    dispatch(
      spawnVideoGenerator({
        x,
        y,
        width,
        height,
        name: L.videoGenerator,
      })
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable ||
        target?.closest?.(
          '[contenteditable="true"],[data-agent-composer],[data-image-generator],[data-video-generator],[data-lottie-generator],[data-audio-generator]'
        )
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'v' && !e.shiftKey) {
        window.dispatchEvent(new Event('resume:exit-path-edit'));
        dispatch(setActiveTool('select'));
      }
      if (key === 'h' && !e.shiftKey) {
        window.dispatchEvent(new Event('resume:exit-path-edit'));
        dispatch(setActiveTool('pan'));
      }
      if (toolsLocked) {
        if (key === 'escape') {
          window.dispatchEvent(new Event('resume:exit-path-edit'));
          dispatch(setActiveTool('select'));
        }
        return;
      }
      if (key === 'f' && !e.shiftKey) dispatch(setActiveTool('frame'));
      if (key === 't' && !e.shiftKey) dispatch(setActiveTool('text'));
      if (key === 'r' && !e.shiftKey) dispatch(setShapeKind('rect'));
      if (key === 'l' && !e.shiftKey) dispatch(setShapeKind('line'));
      if (key === 'l' && e.shiftKey) dispatch(setShapeKind('arrow'));
      if (key === 'o' && !e.shiftKey) dispatch(setShapeKind('circle'));
      if (key === 'i' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setOpenMenu('upload');
      }
      if (key === 'a' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        spawnImageGeneratorAtView();
      }
      if (key === 'a' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        spawnVideoGeneratorAtView();
      }
      if (key === 'p' && !e.shiftKey) dispatch(setActiveTool('pen'));
      if (key === 'p' && e.shiftKey) dispatch(setActiveTool('pencil'));
      if (key === 'escape') {
        window.dispatchEvent(new Event('resume:exit-path-edit'));
        dispatch(setActiveTool('select'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Intentionally stable: always call latest spawn via closure from this render's effect re-run when deps change.
  }, [
    camera,
    dispatch,
    document,
    L.imageGenerator,
    L.videoGenerator,
    stageEl,
    toolsLocked,
  ]);

  const placeAtViewportCenter = (
    natural: { width: number; height: number }
  ): { width: number; height: number; x?: number; y?: number } => {
    const view = stageEl?.getBoundingClientRect() || null;
    const placeable =
      camera && stageEl && document && view && view.width > 0 && view.height > 0
        ? { camera, stageEl, document, view }
        : null;
    if (placeable) {
      const laid = layoutGeneratorPlateInView({
        document: placeable.document,
        camera: placeable.camera,
        stageEl: placeable.stageEl,
        natural,
      });
      return { width: laid.width, height: laid.height, x: laid.x, y: laid.y };
    }
    const { width, height } = fitImageSize(natural.width, natural.height, 2400);
    return { width, height };
  };

  const onPickImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const preview = await readFileAsDataUrl(file);
      const natural = await measureImageNaturalSize(preview);
      const { width, height, x, y } = placeAtViewportCenter(natural);
      dispatch(
        startImageUploadPlaceholder({
          src: preview,
          width,
          height,
          x,
          y,
          label: L.uploading,
          name: file.name?.replace(/\.[^.]+$/, '') || 'Image',
        })
      );
      const spawnedId = String(
        (store.getState() as any).editor?.pendingImageProcessId || ''
      );
      const signal = spawnedId ? beginNodeUpload(spawnedId) : undefined;
      try {
        const uploaded = await uploadImageFile(file, { signal });
        if (signal?.aborted) return;
        const remoteReady = await waitForImageReady(uploaded.url, { signal });
        if (signal?.aborted) return;
        dispatch(
          finishImageProcess({
            nodeId: spawnedId || undefined,
            ...(remoteReady ? { src: uploaded.url } : {}),
            attrs: uploaded.key ? { uploadKey: uploaded.key } : undefined,
          })
        );
      } finally {
        finishNodeUpload(spawnedId);
      }
    } catch (err: any) {
      if (isUploadAbortError(err)) return;
      dispatch(failImageProcess({}));
      message.error(getHttpErrorMessage(err, L.uploadFail));
    }
  };

  const onPickVideo = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const prepared = await prepareVideoUploadPreview(file);
      const { width, height, x, y } = placeAtViewportCenter({
        width: prepared.width,
        height: prepared.height,
      });
      dispatch(
        startVideoUploadPlaceholder({
          src: prepared.preview,
          poster: prepared.poster,
          width,
          height,
          x,
          y,
          label: L.uploading,
          name: prepared.name,
          duration: prepared.duration,
        })
      );
      const uploaded = await uploadImageFile(file);
      dispatch(
        finishImageProcess({
          src: uploaded.url,
          attrs: {
            ...(uploaded.key ? { uploadKey: uploaded.key } : {}),
            ...(prepared.poster ? { poster: prepared.poster } : {}),
            ...(Number.isFinite(prepared.duration) && prepared.duration > 0
              ? { duration: prepared.duration }
              : {}),
            assetKind: 'video',
          },
        })
      );
    } catch (err: any) {
      dispatch(failImageProcess({}));
      message.error(getHttpErrorMessage(err, L.uploadFail));
    }
  };

  const openImageUpload = () => {
    imageInputRef.current?.click();
  };

  const openVideoUpload = () => {
    videoInputRef.current?.click();
  };

  const pickUpload = (key: string) => {
    setOpenMenu(null);
    if (key === 'video') {
      openVideoUpload();
      return;
    }
    openImageUpload();
  };

  const pickSelect = (key: string) => {
    // Bottom Select / Pan: leave path-edit if open (✓ / Esc also exit).
    window.dispatchEvent(new Event('resume:exit-path-edit'));
    dispatch(setActiveTool(key === 'pan' ? 'pan' : 'select'));
  };
  const pickShape = (id: string) => {
    if (id === 'image') return;
    dispatch(setShapeKind(id));
  };

  const shapeIconKind =
    shapeKind && shapeKind !== 'image' && layerIconByKind[shapeKind] ? shapeKind : 'rect';
  const ShapeIcon = layerIconByKind[shapeIconKind];
  const PenIcon = layerIconByKind.pen;
  const PencilIcon = layerIconByKind.pencil;
  const TextIcon = layerIconByKind.text;

  const selectOrPan = activeTool === 'select' || activeTool === 'pan';
  const selectActive = selectOrPan;
  const frameActive = activeTool === 'frame';
  const shapeActive = activeTool === 'shape';
  const imageActive = activeTool === 'image';
  const penActive = activeTool === 'pen';
  const pencilActive = activeTool === 'pencil';
  const textActive = activeTool === 'text';

  return (
    <div className="relative">
      <FloatingToolbar
        className={cn(compact ? 'gap-1.5 px-2.5 py-1.5' : 'gap-2.5 px-3.5 py-2', className)}
      >
      {/* Select / Move — click selects, hover for 选择/移动 */}
      <SplitToolButton
        tip={`${L.select} / ${L.pan}`}
        active={selectActive}
        menuOpen={openMenu === 'select'}
        onMenuOpenChange={(open) => {
          setOpenMenu(open ? 'select' : null);
        }}
        items={selectItems}
        selectedKeys={[activeTool === 'pan' ? 'pan' : 'select']}
        onMenuPick={pickSelect}
        onPrimaryClick={() =>
          dispatch(setActiveTool(activeTool === 'pan' ? 'pan' : 'select'))
        }
      >
        <ToolIcon>
          {activeTool === 'pan' ? (
            <LuHand className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
          ) : (
            <LuMousePointer2 className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
          )}
        </ToolIcon>
      </SplitToolButton>

      {/* 形状 — click draws current shape, hover to switch */}
      <SplitToolButton
        tip={L.shape}
        active={shapeActive}
        disabled={toolsLocked}
        menuOpen={openMenu === 'shape'}
        onMenuOpenChange={(open) => {
          setOpenMenu(open ? 'shape' : null);
        }}
        items={shapeItems}
        selectedKeys={[shapeKind]}
        onMenuPick={pickShape}
        onPrimaryClick={() =>
          dispatch(setShapeKind(shapeKind && shapeKind !== 'image' ? shapeKind : 'rect'))
        }
      >
        <ToolIcon>
          <ShapeIcon className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
        </ToolIcon>
      </SplitToolButton>

      {!compact ? (
        <>
          {/* 钢笔 — options dock at page top-center while active */}
          <ToolBtn
            tip={L.pen}
            ariaLabel={L.pen}
            active={penActive}
            disabled={toolsLocked}
            onClick={() => dispatch(setActiveTool('pen'))}
          >
            <ToolIcon>
              <PenIcon className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
            </ToolIcon>
          </ToolBtn>

          {/* 画笔 — options dock at page top-center while active */}
          <ToolBtn
            tip={L.pencil}
            ariaLabel={L.pencil}
            active={pencilActive}
            disabled={toolsLocked}
            onClick={() => dispatch(setActiveTool('pencil'))}
          >
            <ToolIcon>
              <PencilIcon className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
            </ToolIcon>
          </ToolBtn>
        </>
      ) : null}

      {/* 文字 */}
      <ToolBtn
        tip={L.text}
        active={textActive}
        disabled={toolsLocked}
        onClick={() => dispatch(setActiveTool('text'))}
      >
        <ToolIcon>
          <TextIcon className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
        </ToolIcon>
      </ToolBtn>

      {/* 智能画板 — free-draw; toolbar appears on the frame after commit */}
      <ToolBtn
        tip={L.frame}
        active={frameActive}
        disabled={toolsLocked}
        onClick={() => dispatch(setActiveTool('frame'))}
      >
        <ToolIcon className="h-3.5 w-3.5">
          <LuFrame className="h-full w-full" strokeWidth={STROKE} />
        </ToolIcon>
      </ToolBtn>

      <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--line)]" aria-hidden />

      {/* 图片/视频上传 — hover opens panel (同形状工具) */}
      <SplitToolButton
        tip={L.uploadMedia}
        active={imageActive}
        disabled
        menuOpen={openMenu === 'upload'}
        onMenuOpenChange={(open) => {
          setOpenMenu(open ? 'upload' : null);
        }}
        items={uploadItems}
        selectedKeys={[]}
        onMenuPick={pickUpload}
        onPrimaryClick={() => {
          /* Toolbar icon only opens the panel; upload runs from menu rows. */
        }}
      >
        <ToolIcon>
          <LuImageUp className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
        </ToolIcon>
      </SplitToolButton>

      {/* 图片/视频生成器 — adjacent native controls; A / Shift+A. */}
      <ToolBtn
        tip={`${L.imageGenerator} (A)`}
        disabled={toolsLocked}
        onClick={spawnImageGeneratorAtView}
      >
        <ToolIcon>
          <LuImagePlus className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
        </ToolIcon>
      </ToolBtn>

      <ToolBtn
        tip={`${L.videoGenerator} (Shift+A)`}
        disabled={toolsLocked}
        onClick={spawnVideoGeneratorAtView}
      >
        <ToolIcon>
          <LuVideo className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
        </ToolIcon>
      </ToolBtn>

      {pluginButtons.map((btn) => (
        <ToolBtn
          key={btn.id}
          tip={btn.tip}
          disabled={toolsLocked}
          onClick={() => {
            const runtime = buildCanvasPluginRuntime(dispatch as any, () => store.getState(), {
              camera,
              stageEl,
            });
            btn.onClick(runtime);
          }}
        >
          <ToolIcon>
            {btn.icon ? (
              btn.icon
            ) : btn.iconSrc ? (
              <img src={btn.iconSrc} alt="" className={TOOL_ICON_CLASS} />
            ) : (
              <LuHexagon className={TOOL_ICON_CLASS} strokeWidth={STROKE} />
            )}
          </ToolIcon>
        </ToolBtn>
      ))}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickImage}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={onPickVideo}
      />
      </FloatingToolbar>
    </div>
  );
}

export default memo(EditorToolStrip);
