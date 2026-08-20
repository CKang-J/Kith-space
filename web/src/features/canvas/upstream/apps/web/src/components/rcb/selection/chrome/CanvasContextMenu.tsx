/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/chrome/CanvasContextMenu.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  memo,
} from 'react';
import { createPortal } from '@/features/canvas/adapters/recombynReactDom';
import { getRecombynPortalRoot } from '@/features/canvas/adapters/recombynFloatingUi';
import {
  clampPortalMenuPos,
  portalFlyoutFromAnchor,
  viewportToPortalPoint,
} from '@/features/canvas/adapters/recombynPortalMenuPosition';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineArrowUturnLeft,
  HiOutlineArrowUturnRight,
  HiOutlineChatBubbleLeftRight,
  HiOutlineChevronDoubleDown,
  HiOutlineChevronDoubleUp,
  HiOutlineChevronDown,
  HiOutlineChevronRight,
  HiOutlineChevronUp,
  HiOutlineClipboard,
  HiOutlineClipboardDocument,
  HiOutlineEye,
  HiOutlineEyeSlash,
  HiOutlineLockClosed,
  HiOutlineLockOpen,
  HiOutlinePhoto,
  HiOutlineArrowDownTray,
  HiOutlineArrowUpTray,
  HiOutlineScissors,
  HiOutlineSparkles,
  HiOutlineSquare2Stack,
  HiOutlineTrash,
} from 'react-icons/hi2';
import { LuAudioLines, LuClapperboard, LuImagePlus } from 'react-icons/lu';
import { RiVideoAiLine } from 'react-icons/ri';
import { Icon } from '@recombyn-native/components/base';

/** Absorb the browser click that lands under a just-unmounted menu / backdrop. */
const CLICK_THROUGH_GUARD_MS = 320;

type CtxAction =
  | 'upload'
  | 'replace'
  | 'addToChat'
  | 'spawnImageGenerator'
  | 'spawnVideoGenerator'
  | 'spawnLottieGenerator'
  | 'spawnAudioGenerator'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'group'
  | 'ungroup'
  | 'front'
  | 'forward'
  | 'backward'
  | 'back'
  | 'toggleHidden'
  | 'toggleLocked'
  | 'exportPng'
  | 'exportJpg'
  | 'exportSvg'
  | 'exportMp4'
  | 'exportMp3'
  | 'delete';

type GeneratorPickAction =
  | 'spawnImageGenerator'
  | 'spawnVideoGenerator'
  | 'spawnLottieGenerator'
  | 'spawnAudioGenerator';

export type ContextMenuState = {
  clientX: number;
  clientY: number;
  sceneX: number;
  sceneY: number;
  nodeId: string | null;
  /** Artboard under cursor / selected when opening the menu. */
  frameId?: string | null;
};

type CanvasContextMenuProps = {
  menu: ContextMenuState | null;
  hasNode: boolean;
  /** Enable 「替换」 for a single image / video node. */
  canReplace?: boolean;
  /** Enable 「添加到 Chat」 for selected node or artboard. */
  canAddToChat?: boolean;
  /** Nodes or active artboard frame. */
  canDelete?: boolean;
  /** Show/hide + lock — node or frame target. */
  canLayerActions?: boolean;
  /** Export selection — false for image/video-generator plates (no pixels to export). */
  canExport?: boolean;
  /** Show/hide — false for generator-only selection. */
  canToggleHidden?: boolean;
  /** Lock — false for generator-only selection (frames still ok). */
  canToggleLocked?: boolean;
  /** Current visibility of the menu target (all hidden → show action). */
  targetHidden?: boolean;
  /** Current lock of the menu target (all locked → unlock action). */
  targetLocked?: boolean;
  /** Video-only selection → MP4 / MP3 instead of PNG / JPG / SVG. */
  exportKind?: 'image' | 'video';
  /** Box / multi-select that is not already one shared group. */
  canGroup?: boolean;
  /** Selection is exactly one shared group. */
  canUngroup?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canPaste?: boolean;
  modLabel: string;
  onAction: (action: CtxAction) => void;
  onClose: () => void;
};

const ICON_CLASS = 'h-3.5 w-3.5 shrink-0 text-[var(--muted)]';

const itemClass =
  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--ink)] hover:bg-[var(--accent-soft)] disabled:pointer-events-none disabled:opacity-40';

const PAD = 8;

type ExportPickAction =
  | 'exportPng'
  | 'exportJpg'
  | 'exportSvg'
  | 'exportMp4'
  | 'exportMp3';

function placeMenuInPortal(
  clientX: number,
  clientY: number,
  menuW: number,
  menuH: number
): { left: number; top: number } {
  const origin = viewportToPortalPoint(
    clientX,
    clientY,
    getRecombynPortalRoot().getBoundingClientRect()
  );
  return clampPortalMenuPos({
    left: origin.left,
    top: origin.top,
    menuW,
    menuH,
    viewW: origin.viewW,
    viewH: origin.viewH,
    pad: PAD,
  });
}

function placeFlyoutInPortal(
  anchor: DOMRect,
  flyoutW: number,
  flyoutH: number
): { left: number; top: number } {
  return portalFlyoutFromAnchor({
    anchor,
    portal: getRecombynPortalRoot().getBoundingClientRect(),
    flyoutW,
    flyoutH,
    pad: PAD,
  });
}

function exportFlyoutHeight(kind: 'image' | 'video') {
  return kind === 'video' ? 88 : 120;
}

function ExportFormatButtons({
  kind,
  onPick,
}: {
  kind: 'image' | 'video';
  onPick: (action: ExportPickAction) => void;
}) {
  if (kind === 'video') {
    return (
      <>
        <button type="button" className={itemClass} onClick={() => onPick('exportMp4')}>
          MP4
        </button>
        <button type="button" className={itemClass} onClick={() => onPick('exportMp3')}>
          MP3
        </button>
      </>
    );
  }
  return (
    <>
      <button type="button" className={itemClass} onClick={() => onPick('exportPng')}>
        PNG
      </button>
      <button type="button" className={itemClass} onClick={() => onPick('exportJpg')}>
        JPG
      </button>
      <button type="button" className={itemClass} onClick={() => onPick('exportSvg')}>
        SVG
      </button>
    </>
  );
}

function MenuItem({
  icon,
  label,
  shortcut,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={itemClass}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? (
        <kbd className="shrink-0 font-[system-ui] text-[10px] text-[var(--muted)]">{shortcut}</kbd>
      ) : null}
    </button>
  );
}

function GeneratorFlyoutButtons({
  onPick,
}: {
  onPick: (action: GeneratorPickAction) => void;
}) {
  const { t } = useTranslation();
  const rows: Array<{ action: GeneratorPickAction; label: string; icon: ReactNode }> = [
    {
      action: 'spawnImageGenerator',
      label: t('editor.tools.imageGenerator'),
      icon: <LuImagePlus className={ICON_CLASS} strokeWidth={1.75} />,
    },
    {
      action: 'spawnVideoGenerator',
      label: t('editor.tools.videoGenerator'),
      icon: <RiVideoAiLine className={`${ICON_CLASS} opacity-[0.72]`} />,
    },
    {
      action: 'spawnLottieGenerator',
      label: t('editor.tools.lottieGenerator'),
      icon: <LuClapperboard className={ICON_CLASS} strokeWidth={1.75} />,
    },
    {
      action: 'spawnAudioGenerator',
      label: t('editor.tools.audioGenerator'),
      icon: <LuAudioLines className={ICON_CLASS} strokeWidth={1.75} />,
    },
  ];
  return (
    <>
      {rows.map((row) => (
        <button
          key={row.action}
          type="button"
          className={itemClass}
          onClick={() => onPick(row.action)}
        >
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
            {row.icon}
          </span>
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
        </button>
      ))}
    </>
  );
}

function GeneratorSubmenu({
  onPick,
}: {
  onPick: (action: GeneratorPickAction) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ left: number; top: number } | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current == null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, 120);
  };

  const openMenu = () => {
    clearCloseTimer();
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open || !rowRef.current) {
      setFlyoutPos(null);
      return;
    }
    setFlyoutPos(placeFlyoutInPortal(rowRef.current.getBoundingClientRect(), 176, 152));
  }, [open]);

  useEffect(
    () => () => {
      clearCloseTimer();
    },
    []
  );

  const pick = (action: GeneratorPickAction) => {
    clearCloseTimer();
    setOpen(false);
    onPick(action);
  };

  const showFlyout = open && flyoutPos;

  return (
    <div
      ref={rowRef}
      className="relative"
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={itemClass}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) {
            setOpen(false);
            return;
          }
          openMenu();
        }}
      >
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
          <HiOutlineSparkles className={ICON_CLASS} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1 truncate">{t('editor.contextMenu.generators')}</span>
        <HiOutlineChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
      </button>
      {showFlyout
        ? createPortal(
            <div
              role="menu"
              data-ctx-menu-flyout
              className="pointer-events-auto absolute z-[80] min-w-[11rem] overflow-hidden rounded-xl bg-[var(--surface)] py-1 shadow-lg ring-1 ring-[var(--line)]"
              style={{ left: flyoutPos.left, top: flyoutPos.top }}
              onMouseEnter={openMenu}
              onMouseLeave={scheduleClose}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <GeneratorFlyoutButtons onPick={pick} />
            </div>,
            window.document.body
          )
        : null}
    </div>
  );
}

function ExportSubmenu({
  disabled,
  kind = 'image',
  onPick,
}: {
  disabled?: boolean;
  kind?: 'image' | 'video';
  onPick: (action: ExportPickAction) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ left: number; top: number } | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current == null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, 120);
  };

  const openMenu = () => {
    if (disabled) return;
    clearCloseTimer();
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open || !rowRef.current) {
      setFlyoutPos(null);
      return;
    }
    setFlyoutPos(
      placeFlyoutInPortal(rowRef.current.getBoundingClientRect(), 128, exportFlyoutHeight(kind))
    );
  }, [kind, open]);

  useEffect(
    () => () => {
      clearCloseTimer();
    },
    []
  );

  const pick = (action: ExportPickAction) => {
    clearCloseTimer();
    setOpen(false);
    onPick(action);
  };

  const showFlyout = open && !disabled && flyoutPos;

  return (
    <div
      ref={rowRef}
      className="relative"
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={itemClass}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open && !disabled}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (disabled) return;
          if (open) {
            setOpen(false);
            return;
          }
          openMenu();
        }}
      >
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
          <HiOutlineArrowDownTray className={ICON_CLASS} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1 truncate">{t('editor.contextMenu.export')}</span>
        <HiOutlineChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
      </button>
      {showFlyout
        ? createPortal(
            <div
              role="menu"
              data-ctx-menu-flyout
              className="pointer-events-auto absolute z-[80] min-w-[8rem] overflow-hidden rounded-xl bg-[var(--surface)] py-1 shadow-lg ring-1 ring-[var(--line)]"
              style={{ left: flyoutPos.left, top: flyoutPos.top }}
              onMouseEnter={openMenu}
              onMouseLeave={scheduleClose}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <ExportFormatButtons kind={kind} onPick={pick} />
            </div>,
            window.document.body
          )
        : null}
    </div>
  );
}

/** Right-click menu — `fixed` on body with viewport client coords (not scene space). */
function CanvasContextMenu({
  menu,
  hasNode,
  canReplace = false,
  canAddToChat,
  canDelete,
  canLayerActions,
  canExport,
  canToggleHidden,
  canToggleLocked,
  targetHidden = false,
  targetLocked = false,
  exportKind = 'image',
  canGroup = false,
  canUngroup = false,
  canUndo,
  canRedo,
  canPaste = false,
  modLabel,
  onAction,
  onClose,
}: CanvasContextMenuProps) {
  const { t } = useTranslation();
  const deleteEnabled = canDelete ?? hasNode;
  const addToChatEnabled = canAddToChat ?? hasNode;
  const layerEnabled = canLayerActions ?? hasNode;
  const exportEnabled = canExport ?? layerEnabled;
  const hideEnabled = canToggleHidden ?? hasNode;
  const lockEnabled = canToggleLocked ?? layerEnabled;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    srcX: number;
    srcY: number;
  } | null>(null);
  // Keep a full-screen shield after dismiss so the leftover click cannot hit
  // the bottom tool strip under Delete / Export (classic menu click-through).
  const [guardOpen, setGuardOpen] = useState(false);
  const guardTimerRef = useRef<number | null>(null);

  const armClickThroughGuard = () => {
    setGuardOpen(true);
    if (guardTimerRef.current != null) window.clearTimeout(guardTimerRef.current);
    guardTimerRef.current = window.setTimeout(() => {
      guardTimerRef.current = null;
      setGuardOpen(false);
    }, CLICK_THROUGH_GUARD_MS);
  };

  const runAction = (action: CtxAction) => {
    armClickThroughGuard();
    onAction(action);
  };

  const dismiss = () => {
    armClickThroughGuard();
    onClose();
  };

  const stopPanelPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

  const onBackdropPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('[data-ctx-menu-flyout]')) return;
    if (menu) dismiss();
  };

  const visibilityIcon = targetHidden ? (
    <HiOutlineEyeSlash className={ICON_CLASS} strokeWidth={1.75} />
  ) : (
    <HiOutlineEye className={ICON_CLASS} strokeWidth={1.75} />
  );
  const visibilityLabel = targetHidden
    ? t('editor.contextMenu.show')
    : t('editor.contextMenu.hide');
  const lockIcon = targetLocked ? (
    <HiOutlineLockClosed className={ICON_CLASS} strokeWidth={1.75} />
  ) : (
    <HiOutlineLockOpen className={ICON_CLASS} strokeWidth={1.75} />
  );
  const lockLabel = targetLocked
    ? t('editor.contextMenu.unlock')
    : t('editor.contextMenu.lock');

  useLayoutEffect(() => {
    if (!menu) {
      setPos(null);
      return;
    }
    const el = panelRef.current;
    const next = placeMenuInPortal(
      menu.clientX,
      menu.clientY,
      el?.offsetWidth || 200,
      el?.offsetHeight || 420
    );
    setPos({ ...next, srcX: menu.clientX, srcY: menu.clientY });
  }, [menu]);

  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      armClickThroughGuard();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // armClickThroughGuard is local and always fresh enough for Escape dismiss
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, onClose]);

  useEffect(
    () => () => {
      if (guardTimerRef.current != null) window.clearTimeout(guardTimerRef.current);
    },
    []
  );

  if (!menu && !guardOpen) return null;

  const placed =
    menu && pos && pos.srcX === menu.clientX && pos.srcY === menu.clientY
      ? pos
      : menu
        ? placeMenuInPortal(menu.clientX, menu.clientY, 200, 420)
        : null;

  return createPortal(
    <>
      <div
        data-ctx-menu
        className="pointer-events-auto absolute inset-0 z-[60]"
        onPointerDown={onBackdropPointerDown}
        aria-hidden
      />
      {menu ? (
        <div
          ref={panelRef}
          data-ctx-menu
          className="pointer-events-auto absolute z-[70] min-w-[200px] overflow-hidden rounded-xl bg-[var(--surface)] py-1 shadow-lg ring-1 ring-[var(--line)]"
          style={{
            left: placed?.left ?? 0,
            top: placed?.top ?? 0,
          }}
          onPointerDown={stopPanelPointer}
          onPointerUp={stopPanelPointer}
        >
          <MenuItem
            icon={<HiOutlineChatBubbleLeftRight className={ICON_CLASS} strokeWidth={1.75} />}
            label={t('editor.contextMenu.addToChat')}
            shortcut={`${modLabel}+Shift+L`}
            disabled={!addToChatEnabled}
            onClick={() => runAction('addToChat')}
          />
          <MenuItem
            icon={<HiOutlinePhoto className={ICON_CLASS} strokeWidth={1.75} />}
            label={t('editor.contextMenu.uploadMedia')}
            shortcut={`${modLabel}+Shift+I`}
            disabled={Boolean(menu.nodeId)}
            onClick={() => runAction('upload')}
          />
          {canReplace ? (
            <MenuItem
              icon={<HiOutlineArrowUpTray className={ICON_CLASS} strokeWidth={1.75} />}
              label={t('editor.contextMenu.replaceMedia')}
              onClick={() => runAction('replace')}
            />
          ) : null}
          <GeneratorSubmenu onPick={(action) => runAction(action)} />
          <MenuItem
            icon={<HiOutlineArrowUturnLeft className={ICON_CLASS} strokeWidth={1.75} />}
            label={t('editor.contextMenu.undo')}
            shortcut={`${modLabel}+Z`}
            disabled={!canUndo}
            onClick={() => runAction('undo')}
          />
          <MenuItem
            icon={<HiOutlineArrowUturnRight className={ICON_CLASS} strokeWidth={1.75} />}
            label={t('editor.contextMenu.redo')}
            shortcut={`${modLabel}+Y`}
            disabled={!canRedo}
            onClick={() => runAction('redo')}
          />
          <div className="my-1 h-px bg-[var(--line)]" />
          <MenuItem
            icon={<HiOutlineScissors className={ICON_CLASS} strokeWidth={1.75} />}
            label={t('editor.contextMenu.cut')}
            shortcut={`${modLabel}+X`}
            disabled={!hasNode}
            onClick={() => runAction('cut')}
          />
          <MenuItem
            icon={<HiOutlineClipboardDocument className={ICON_CLASS} strokeWidth={1.75} />}
            label={t('editor.contextMenu.copy')}
            shortcut={`${modLabel}+C`}
            disabled={!hasNode}
            onClick={() => runAction('copy')}
          />
          <MenuItem
            icon={<HiOutlineSquare2Stack className={ICON_CLASS} strokeWidth={1.75} />}
            label={t('editor.contextMenu.duplicate')}
            shortcut={`${modLabel}+D`}
            disabled={!hasNode}
            onClick={() => runAction('duplicate')}
          />
          <MenuItem
            icon={<HiOutlineClipboard className={ICON_CLASS} strokeWidth={1.75} />}
            label={t('editor.contextMenu.paste')}
            shortcut={`${modLabel}+V`}
            disabled={!canPaste}
            onClick={() => runAction('paste')}
          />
          <div className="my-1 h-px bg-[var(--line)]" />
          <MenuItem
            icon={<Icon name="editor-group" width={14} height={14} className={ICON_CLASS} />}
            label={t('editor.contextMenu.group')}
            shortcut={`${modLabel}+G`}
            disabled={!canGroup}
            onClick={() => runAction('group')}
          />
          <MenuItem
            icon={<Icon name="editor-ungroup" width={14} height={14} className={ICON_CLASS} />}
            label={t('editor.contextMenu.ungroup')}
            shortcut={`${modLabel}+Shift+G`}
            disabled={!canUngroup}
            onClick={() => runAction('ungroup')}
          />
          <div className="my-1 h-px bg-[var(--line)]" />
          <MenuItem
            icon={<HiOutlineChevronDoubleUp className={ICON_CLASS} strokeWidth={1.75} />}
            label={t('editor.contextMenu.bringToFront')}
            shortcut="]"
            disabled={!hasNode}
            onClick={() => runAction('front')}
          />
          <MenuItem
            icon={<HiOutlineChevronUp className={ICON_CLASS} strokeWidth={1.75} />}
            label={t('editor.contextMenu.bringForward')}
            shortcut={`${modLabel}+]`}
            disabled={!hasNode}
            onClick={() => runAction('forward')}
          />
          <MenuItem
            icon={<HiOutlineChevronDown className={ICON_CLASS} strokeWidth={1.75} />}
            label={t('editor.contextMenu.sendBackward')}
            shortcut={`${modLabel}+[`}
            disabled={!hasNode}
            onClick={() => runAction('backward')}
          />
          <MenuItem
            icon={<HiOutlineChevronDoubleDown className={ICON_CLASS} strokeWidth={1.75} />}
            label={t('editor.contextMenu.sendToBack')}
            shortcut="["
            disabled={!hasNode}
            onClick={() => runAction('back')}
          />
          <div className="my-1 h-px bg-[var(--line)]" />
          <MenuItem
            icon={visibilityIcon}
            label={visibilityLabel}
            shortcut={`${modLabel}+Shift+H`}
            disabled={!hideEnabled}
            onClick={() => runAction('toggleHidden')}
          />
          <MenuItem
            icon={lockIcon}
            label={lockLabel}
            shortcut={`${modLabel}+Shift+K`}
            disabled={!lockEnabled}
            onClick={() => runAction('toggleLocked')}
          />
          <div className="my-1 h-px bg-[var(--line)]" />
          <ExportSubmenu
            disabled={!exportEnabled}
            kind={exportKind}
            onPick={(action) => runAction(action)}
          />
          <div className="my-1 h-px bg-[var(--line)]" />
          <MenuItem
            icon={<HiOutlineTrash className={ICON_CLASS} strokeWidth={1.75} />}
            label={t('editor.contextMenu.delete')}
            shortcut="Del"
            disabled={!deleteEnabled}
            onClick={() => runAction('delete')}
          />
        </div>
      ) : null}
    </>,
    document.body
  );
}

export type { CtxAction };

export default memo(CanvasContextMenu);
