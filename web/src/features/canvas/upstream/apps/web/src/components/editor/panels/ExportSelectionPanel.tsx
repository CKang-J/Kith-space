/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/panels/ExportSelectionPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useCallback, useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode, memo } from 'react';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  type Placement,
} from '@/features/canvas/adapters/recombynFloatingUi';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { EMPTY_ID_LIST } from '@recombyn-native/store/modules/editor';
import {
  HiOutlineArrowDownTray,
  HiOutlineArrowUpTray,
  HiOutlineCodeBracket,
  HiOutlineDocument,
  HiOutlineDocumentDuplicate,
  HiOutlineInformationCircle,
} from 'react-icons/hi2';
import { Checkbox } from '@recombyn-native/components/base/checkbox';
import Select from '@recombyn-native/components/base/select';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { message } from '@recombyn-native/components/base/message';
import { DropdownPanel, DropdownPanelItem } from '@recombyn-native/components/base/dropdown/DropdownPanel';
import {
  exportSelectionSlots,
  exportCropSlots,
  exportDocumentJson,
  downloadFileBlob,
  isExportScaleSafe,
  clampExportScale,
  type ExportAffixMode,
  type ExportImageFormat,
  type ExportSlotConfig,
} from '@recombyn-native/components/rcb/scene/paint/exportImage';
import {
  normalizeDocument
} from '@recombyn-native/components/rcb/scene/document/sceneDocument';
import {
  isExportableSceneNode,
  isVideoNode,
  isLottieNode
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import {
  parseLottieAnimationData
} from '@recombyn-native/components/rcb/scene/document/nodeFactories';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import { downloadVideoNodeAsset } from '@recombyn-native/components/editor/nodes/VideoNode/VideoDownloadButton';
import { cn } from '@recombyn-native/utils/classnames';
import { SEL_ICON_BTN } from '@recombyn-native/components/rcb/selection/chrome/ToolbarValueSlider';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

type VideoExportFormat = 'mp4' | 'mp3';
type LottieExportFormat = 'json';

const VIDEO_FORMAT_OPTIONS: { value: VideoExportFormat; label: string }[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mp3', label: 'MP3' },
];

const LOTTIE_FORMAT_OPTIONS: { value: LottieExportFormat; label: string }[] = [
  { value: 'json', label: 'JSON' },
];

function videoNodesForExport(document: SceneDocument, ids: string[]) {
  return ids
    .map((id) => document?.deltaSetLike?.[id])
    .filter((node: SceneNodeInput) => isVideoNode(node) && String(node?.attrs?.src || '').trim());
}

function lottieNodesForExport(document: SceneDocument, ids: string[]) {
  return ids
    .map((id) => document?.deltaSetLike?.[id])
    .filter(
      (node: SceneNodeInput) =>
        isLottieNode(node) && Boolean(parseLottieAnimationData(node?.attrs?.animationData))
    );
}

function isVideoOnlyExport(document: SceneDocument, ids: string[], hasCrop: boolean): boolean {
  if (hasCrop || ids.length === 0) return false;
  const videos = videoNodesForExport(document, ids);
  return videos.length === ids.length && videos.length > 0;
}

function isLottieOnlyExport(document: SceneDocument, ids: string[], hasCrop: boolean): boolean {
  if (hasCrop || ids.length === 0) return false;
  const nodes = lottieNodesForExport(document, ids);
  return nodes.length === ids.length && nodes.length > 0;
}

async function downloadLottieJson(node: SceneNodeInput, fallbackName: string) {
  const data = parseLottieAnimationData(node?.attrs?.animationData);
  if (!data) throw new Error('invalid lottie');
  const raw = JSON.stringify(data);
  const blob = new Blob([raw], { type: 'application/json' });
  const base = String(node?.attrs?.name || node?.name || fallbackName || 'lottie')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .trim() || 'lottie';
  const filename = base.toLowerCase().endsWith('.json') ? base : `${base}.json`;
  const result = await downloadFileBlob(blob, filename);
  if (result !== 'saved') throw new Error(result === 'cancelled' ? 'download cancelled' : 'download failed');
}

function videoExportMode(format: VideoExportFormat): 'audio' | 'video' {
  return format === 'mp3' ? 'audio' : 'video';
}

function videoExportCopy(
  mode: 'audio' | 'video',
  t: (key: string, opts?: Record<string, string>) => string
) {
  if (mode === 'audio') {
    return {
      loading: t('editor.videoToolbar.exportingAudio', { defaultValue: '正在导出音频…' }),
      success: t('editor.exportedAudio', { defaultValue: '已导出音频' }),
      fail: t('editor.videoToolbar.exportAudioFail', {
        defaultValue: '音频导出失败（可能无音轨）',
      }),
    };
  }
  return {
    loading: t('editor.videoToolbar.exporting', { defaultValue: '正在导出视频…' }),
    success: t('editor.exportedVideo', { defaultValue: '已导出视频' }),
    fail: t('editor.videoToolbar.downloadFail', { defaultValue: '下载失败' }),
  };
}

function isAttrFlagTrue(value: unknown) {
  return value === true || value === 'true';
}

const SCALE_OPTIONS = [
  { value: 0.5, label: '0.5x' },
  { value: 1, label: '1x' },
  { value: 2, label: '2x' },
  { value: 3, label: '3x' },
  { value: 4, label: '4x' },
];

const RASTER_FORMAT_OPTIONS: { value: ExportImageFormat; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPG' },
];

const VECTOR_FORMAT_OPTIONS: { value: ExportImageFormat; label: string }[] = [
  ...RASTER_FORMAT_OPTIONS,
  { value: 'svg', label: 'SVG' },
];

const selectFieldClass =
  '!box-border !flex !h-7 !w-full !min-w-0 !rounded-xl !border-0 !bg-[color-mix(in_srgb,var(--muted)_12%,var(--surface))] !px-1.5 !pr-5 !text-[11px] !ring-1 !ring-[var(--line)]';

export type ExportCropRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor?: string;
};

function defaultSlot(format: ExportImageFormat = 'png'): ExportSlotConfig {
  return {
    id: 'default',
    scale: 1,
    affixMode: 'suffix',
    affix: '',
    format,
  };
}

function scaleAffixLabel(scale: number): string {
  return `@${scale}x`;
}

function resolveExportScale(format: ExportImageFormat, scale: number): number {
  if (format === 'svg') return 1;
  return scale;
}

/** Prefer explicit affix; otherwise auto `@Nx` when scale ≠ 1 (raster only). */
function resolveExportAffix(
  slot: Pick<ExportSlotConfig, 'affix' | 'scale'>,
  format: ExportImageFormat
): string {
  const custom = String(slot.affix || '').trim();
  if (custom) return custom;
  if (format === 'svg' || slot.scale === 1) return '';
  return scaleAffixLabel(slot.scale);
}

function resolveExportSlot(slot: ExportSlotConfig): ExportSlotConfig {
  const format = slot.format;
  return {
    ...slot,
    format,
    scale: resolveExportScale(format, slot.scale),
    affix: resolveExportAffix(slot, format),
  };
}

function parseExportFormat(value: string): ExportImageFormat {
  if (value === 'svg') return 'svg';
  if (value === 'jpeg') return 'jpeg';
  return 'png';
}

function parseAffixMode(value: string): ExportAffixMode {
  if (value === 'prefix') return 'prefix';
  return 'suffix';
}

export type NamedExportCrop = ExportCropRegion & { name?: string };

/** Union AABB of exportable nodes; null when none qualify. */
function unionExportableBounds(
  document: SceneDocument,
  ids: string[]
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hit = false;
  for (const id of ids) {
    const node = document?.deltaSetLike?.[id];
    if (!isExportableSceneNode(node)) continue;
    const { left, top } = nodeLeftTop(document, node);
    const w = Number(node.width);
    const h = Number(node.height);
    if (![left, top, w, h].every(Number.isFinite) || !(w > 0) || !(h > 0)) continue;
    hit = true;
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, left + w);
    maxY = Math.max(maxY, top + h);
  }
  if (!hit) return null;
  return { minX, minY, maxX, maxY };
}

/** When there are no artboard frames, crop to scene content (or document size). */
function contentCropFallback(document: SceneDocument, name: string): NamedExportCrop | null {
  if (!document) return null;
  const children = document?.deltaSetLike?.ROOT?.children;
  if (Array.isArray(children)) {
    const bounds = unionExportableBounds(document, children.map(String));
    if (bounds) {
      const pad = 8;
      return {
        x: bounds.minX - pad,
        y: bounds.minY - pad,
        width: Math.max(1, bounds.maxX - bounds.minX + pad * 2),
        height: Math.max(1, bounds.maxY - bounds.minY + pad * 2),
        backgroundColor: document.backgroundColor,
        name,
      };
    }
  }
  const w = Math.max(0, Number(document.width) || 0);
  const h = Math.max(0, Number(document.height) || 0);
  if (w > 1 && h > 1) {
    return {
      x: Number(document.x) || 0,
      y: Number(document.y) || 0,
      width: w,
      height: h,
      backgroundColor: document.backgroundColor,
      name,
    };
  }
  return null;
}

/** Scene pixel size of the export target (largest crop, or union of nodes). */
function exportSourceSize(
  document: SceneDocument,
  ids: string[],
  cropList: NamedExportCrop[]
): { width: number; height: number } {
  if (cropList.length) {
    let width = 1;
    let height = 1;
    for (const c of cropList) {
      width = Math.max(width, Math.max(1, Number(c.width) || 1));
      height = Math.max(height, Math.max(1, Number(c.height) || 1));
    }
    return { width, height };
  }
  const bounds = unionExportableBounds(document, ids);
  if (!bounds) return { width: 1, height: 1 };
  return {
    width: Math.max(1, bounds.maxX - bounds.minX),
    height: Math.max(1, bounds.maxY - bounds.minY),
  };
}

function ExportSelectionPanel({
  nodeIds,
  crop,
  crops,
  baseName,
  onClose,
  className,
  /** Flat embed (inspect sidebar) — no floating card chrome / title. */
  variant = 'popover',
}: {
  nodeIds?: string[];
  /** Artboard / frame region export (scene crop). */
  crop?: ExportCropRegion | null;
  /** Multiple artboards (e.g. export all pages). */
  crops?: NamedExportCrop[] | null;
  baseName?: string;
  onClose?: () => void;
  className?: string;
  variant?: 'popover' | 'inline';
}) {
  const { t } = useTranslation();
  const tipId = useId();
  const document = useSelector((s: any) => s.editor.document);
  const ids = useMemo(() => {
    const raw = nodeIds || [];
    return raw.filter((id) => {
      if (!id) return false;
      const node = document?.deltaSetLike?.[id];
      // Missing node (e.g. stale id) — keep and let export fail softly.
      if (!node) return true;
      return isExportableSceneNode(node);
    });
  }, [document, nodeIds]);
  const cropList = useMemo((): NamedExportCrop[] => {
    if (crops?.length) return crops;
    if (crop) return [{ ...crop }];
    return [];
  }, [crop, crops]);
  const [slot, setSlot] = useState<ExportSlotConfig>(() => defaultSlot());
  const [videoFormat, setVideoFormat] = useState<VideoExportFormat>('mp4');
  const [compress, setCompress] = useState(false);
  const [busy, setBusy] = useState(false);
  const inline = variant === 'inline';
  const canExport = cropList.length > 0 || ids.length > 0;
  const videoOnly = isVideoOnlyExport(document, ids, cropList.length > 0);
  const lottieOnly = isLottieOnlyExport(document, ids, cropList.length > 0);
  const isSvg = slot.format === 'svg';
  const isJpeg = slot.format === 'jpeg';
  const format = slot.format;
  const sourceSize = useMemo(
    () => exportSourceSize(document, ids, cropList),
    [document, ids, cropList]
  );
  const scaleOptions = useMemo(() => {
    if (isSvg) return SCALE_OPTIONS;
    return SCALE_OPTIONS.map((opt) => ({
      ...opt,
      disabled: !isExportScaleSafe(sourceSize.width, sourceSize.height, opt.value),
    }));
  }, [isSvg, sourceSize.height, sourceSize.width]);
  const scaleSafe =
    isSvg || isExportScaleSafe(sourceSize.width, sourceSize.height, slot.scale);

  // Drop to the largest safe preset when the current scale no longer fits.
  useEffect(() => {
    if (isSvg || scaleSafe) return;
    const next = clampExportScale(sourceSize.width, sourceSize.height, slot.scale);
    const pick =
      SCALE_OPTIONS.map((o) => o.value)
        .filter(
          (v) =>
            v <= next + 1e-6 && isExportScaleSafe(sourceSize.width, sourceSize.height, v)
        )
        .pop() || 1;
    if (pick !== slot.scale) setSlot((s) => ({ ...s, scale: pick }));
  }, [isSvg, scaleSafe, slot.scale, sourceSize.height, sourceSize.width]);

  const name = baseName || t('editor.selectionExportName');
  const affixOptions = [
    { value: 'prefix', label: t('editor.exportPrefix') },
    { value: 'suffix', label: t('editor.exportSuffix') },
  ];

  const runVideoExport = async () => {
    const nodes = videoNodesForExport(document, ids);
    if (!nodes.length) {
      message.warning(t('editor.noSelectionExport'));
      return;
    }
    const mode = videoExportMode(videoFormat);
    const copy = videoExportCopy(mode, t);
    setBusy(true);
    const hideLoading = message.loading(copy.loading, 0);
    try {
      for (const node of nodes) {
        const attrs = node?.attrs || {};
        await downloadVideoNodeAsset({
          src: String(attrs.src || ''),
          name: String(node?.name || attrs.name || name || 'video'),
          uploadKey: attrs.uploadKey != null ? String(attrs.uploadKey) : null,
          cropX: Number(attrs.cropX) || 0,
          cropY: Number(attrs.cropY) || 0,
          cropW: Number(attrs.cropW) || 0,
          cropH: Number(attrs.cropH) || 0,
          trimStart: Number(attrs.trimStart) || 0,
          trimEnd: Number(attrs.trimEnd) || 0,
          flipX: isAttrFlagTrue(attrs.flipX),
          flipY: isAttrFlagTrue(attrs.flipY),
          mode,
        });
      }
      hideLoading();
      message.success(copy.success);
      onClose?.();
    } catch (err) {
      hideLoading();
      console.warn('[export-video]', err);
      message.error(copy.fail);
    } finally {
      setBusy(false);
    }
  };

  const runLottieExport = async () => {
    const nodes = lottieNodesForExport(document, ids);
    if (!nodes.length) {
      message.warning(t('editor.noSelectionExport'));
      return;
    }
    setBusy(true);
    const hideLoading = message.loading(
      t('editor.exportingLottie', { defaultValue: '正在导出 Lottie…' }),
      0
    );
    try {
      for (const node of nodes) {
        await downloadLottieJson(node, name);
      }
      hideLoading();
      message.success(t('editor.exportedLottie', { defaultValue: '已导出 Lottie JSON' }));
      try {
        onClose?.();
      } catch {
        /* ignore */
      }
    } catch (err) {
      hideLoading();
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'download cancelled') return;
      console.warn('[export-lottie]', err);
      message.error(t('editor.exportFailed'));
    } finally {
      setBusy(false);
    }
  };

  const runExport = async () => {
    if (!canExport) {
      message.warning(t('editor.noSelectionExport'));
      return;
    }
    if (videoOnly) {
      await runVideoExport();
      return;
    }
    if (lottieOnly) {
      await runLottieExport();
      return;
    }
    if (!isSvg && !isExportScaleSafe(sourceSize.width, sourceSize.height, slot.scale)) {
      message.warning(t('editor.exportScaleTooLarge'));
      return;
    }
    setBusy(true);
    let saved = 0;
    let cancelled = 0;
    let failed = 0;
    try {
      const resolved = resolveExportSlot({ ...slot, format });
      const useCompress = isJpeg && compress;
      if (cropList.length > 0) {
        for (let i = 0; i < cropList.length; i += 1) {
          const region = cropList[i];
          const pageName =
            region.name ||
            (cropList.length > 1 ? `${name}-${i + 1}` : name);
          const tally = await exportCropSlots({
            crop: region,
            backgroundColor: region.backgroundColor,
            baseName: pageName,
            compress: useCompress,
            slots: [resolved],
            document,
          });
          saved += tally.saved;
          cancelled += tally.cancelled;
          failed += tally.failed;
        }
      } else {
        const tally = await exportSelectionSlots({
          nodeIds: ids,
          baseName: name,
          compress: useCompress,
          slots: [resolved],
          document,
        });
        saved = tally.saved;
        cancelled = tally.cancelled;
        failed = tally.failed;
      }
    } catch (err) {
      console.warn('[export]', err);
      message.error(t('editor.exportFailed'));
      setBusy(false);
      return;
    }
    setBusy(false);
    if (saved > 0) {
      message.success(t(isSvg ? 'editor.exportedSvg' : 'editor.exportedImage'));
      try {
        onClose?.();
      } catch {
        /* closing popover must not look like export failure */
      }
      return;
    }
    if (cancelled > 0 && failed === 0) return;
    message.error(t('editor.exportFailed'));
  };

  return (
    <div
      data-export-panel
      className={cn(
        inline
          ? 'w-full'
          : 'w-[280px] rounded-xl bg-[var(--surface)] p-3 shadow-lg ring-1 ring-[var(--line)]',
        className
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {!inline ? (
        <div className="mb-2.5">
          <span className="text-[13px] font-medium text-[var(--ink)]">{t('editor.export')}</span>
        </div>
      ) : null}

      {videoOnly ? (
        <Select
          size="small"
          type="filled"
          value={videoFormat}
          options={VIDEO_FORMAT_OPTIONS}
          onChange={(v) =>
            setVideoFormat(String(v) === 'mp3' ? 'mp3' : 'mp4')
          }
          className={selectFieldClass}
          placement="bottom-start"
        />
      ) : lottieOnly ? (
        <Select
          size="small"
          type="filled"
          value="json"
          options={LOTTIE_FORMAT_OPTIONS}
          className={selectFieldClass}
          placement="bottom-start"
        />
      ) : (
        <>
          <div className={cn('grid grid-cols-3 gap-1.5', inline && 'gap-2')}>
            <Select
              size="small"
              type="filled"
              value={isSvg ? 1 : slot.scale}
              options={scaleOptions}
              disabled={isSvg}
              onChange={(v) => setSlot((s) => ({ ...s, scale: Number(v) || 1 }))}
              className={selectFieldClass}
              placement="bottom-start"
            />
            <Select
              size="small"
              type="filled"
              value={slot.affixMode}
              options={affixOptions}
              onChange={(v) =>
                setSlot((s) => ({
                  ...s,
                  affixMode: parseAffixMode(String(v)),
                }))
              }
              className={selectFieldClass}
              placement="bottom-start"
            />
            <Select
              size="small"
              type="filled"
              value={slot.format}
              options={VECTOR_FORMAT_OPTIONS}
              onChange={(v) => {
                const next = parseExportFormat(String(v));
                setSlot((s) => ({ ...s, format: next }));
                if (next !== 'jpeg') setCompress(false);
              }}
              className={selectFieldClass}
              placement="bottom-start"
            />
          </div>

          {isJpeg ? (
            <div className="mt-3 flex items-center gap-1.5 text-[12px] text-[var(--ink)]">
              <Checkbox
                size="small"
                checked={compress}
                onChange={(e) => setCompress(e.target.checked)}
              >
                {t('editor.exportCompress')}
              </Checkbox>
              <Tooltip tip={t('editor.exportCompressTip')} placement="top">
                <button
                  type="button"
                  id={tipId}
                  className="inline-flex text-[var(--muted)]"
                  aria-label={t('editor.exportCompressTip')}
                >
                  <HiOutlineInformationCircle className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>
          ) : null}
        </>
      )}

      <button
        type="button"
        disabled={busy || !canExport || (!videoOnly && !lottieOnly && !scaleSafe)}
        onClick={() => runExport()}
        className="mt-3 flex h-7 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--ink)] text-[12px] font-medium text-[var(--surface)] disabled:opacity-40"
      >
        <HiOutlineArrowDownTray className="h-3.5 w-3.5" />
        {t('editor.export')}
      </button>
    </div>
  );
}

export type ExportSelectionPopoverProps = {
  nodeIds?: string[];
  /** Artboard / frame region export (scene crop). */
  crop?: ExportCropRegion | null;
  baseName?: string;
  placement?: Placement;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  children?: ReactNode;
};

/** Download trigger: scale / format / compress panel. */
function ExportSelectionPopover({
  nodeIds,
  crop,
  baseName,
  placement = 'bottom-end',
  disabled = false,
  className,
  triggerClassName,
  children,
}: ExportSelectionPopoverProps) {
  const { t } = useTranslation();
  const document = useSelector((s: any) => s.editor.document);
  const [open, setOpen] = useState(false);
  const ids = useMemo(() => {
    const raw = nodeIds || [];
    return raw.filter((id) => {
      if (!id) return false;
      const node = document?.deltaSetLike?.[id];
      if (!node) return true;
      return isExportableSceneNode(node);
    });
  }, [document, nodeIds]);
  const canExport = Boolean(crop) || ids.length > 0;

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({
        padding: 12,
        fallbackPlacements: ['top-end', 'bottom-start', 'top-start'],
      }),
      shift({ padding: 12 }),
    ],
  });
  const dismiss = useDismiss(context, {
    outsidePress: (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[data-export-panel]')) return false;
      // Select dropdown portals to body — keep export panel open.
      if (target?.closest?.('[data-select-dropdown]')) return false;
      return true;
    },
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

  const onTriggerClick = useCallback(() => {
    if (disabled || !canExport) return;
    setOpen((v) => !v);
  }, [canExport, disabled]);

  return (
    <>
      <Tooltip
        tip={t('editor.exportImage')}
        placement="top"
        disabled={disabled || !canExport || open}
      >
        <button
          type="button"
          ref={refs.setReference}
          disabled={disabled || !canExport}
          aria-label={t('editor.exportImage')}
          aria-expanded={open}
          className={cn(triggerClassName || SEL_ICON_BTN, className)}
          {...getReferenceProps({
            onClick: onTriggerClick,
          })}
        >
          {children ?? <HiOutlineArrowDownTray className="h-4 w-4 shrink-0" strokeWidth={1.75} />}
        </button>
      </Tooltip>

      <FloatingPortal>
        {open ? (
          <div
            ref={refs.setFloating}
            style={floatingStyles as CSSProperties}
            className="z-[80]"
            {...getFloatingProps()}
          >
            <ExportSelectionPanel
              nodeIds={ids}
              crop={crop}
              baseName={baseName}
              onClose={() => setOpen(false)}
            />
          </div>
        ) : null}
      </FloatingPortal>
    </>
  );
}

type ExportMode = 'all' | 'selected';

/** Top-bar Export: All Pages / Selected (PNG·JPG·SVG) + JSON. */
function EditorTopExportButton({
  className,
  iconOnly = false,
}: {
  className?: string;
  /** Compact top bars — icon only, text stays in aria-label. */
  iconOnly?: boolean;
}) {
  const { t } = useTranslation();
  const document = useSelector((s: any) => s.editor.document);
  const selectedNodeIds = useSelector(
    (s: any) => (s.editor.selectedNodeIds as string[]) ?? EMPTY_ID_LIST
  );
  const projectName = useSelector((s: any) => {
    const id = s.editor.currentId;
    const row = (s.editor.templates || []).find((item: any) => item.id === id);
    return String(row?.name || '').trim() || t('editor.selectionExportName');
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [mode, setMode] = useState<ExportMode | null>(null);
  const [busy, setBusy] = useState(false);

  const frames = useMemo(
    () => (Array.isArray(document?.frames) ? document.frames : []) as any[],
    [document]
  );

  const pageCrops = useMemo((): NamedExportCrop[] => {
    const fromFrames = frames
      .filter((f) => f && Number(f.width) > 0 && Number(f.height) > 0)
      .map((f, i) => ({
        x: Number(f.x) || 0,
        y: Number(f.y) || 0,
        width: Math.max(1, Number(f.width) || 1),
        height: Math.max(1, Number(f.height) || 1),
        backgroundColor: f.backgroundColor,
        name: String(f.name || '').trim() || `${t('editor.pageExportName')}-${i + 1}`,
      }));
    if (fromFrames.length) return fromFrames;
    // Infinite canvas without frames: export the content bounding box as one page.
    const fallback = contentCropFallback(document, t('editor.pageExportName'));
    return fallback ? [fallback] : [];
  }, [document, frames, t]);

  const exportableSelectedIds = useMemo(
    () =>
      selectedNodeIds.filter((id) => isExportableSceneNode(document?.deltaSetLike?.[id])),
    [document, selectedNodeIds]
  );

  const floatingOpen = menuOpen || panelOpen;
  const { refs, floatingStyles, context } = useFloating({
    open: floatingOpen,
    onOpenChange: (next) => {
      if (!next) {
        setMenuOpen(false);
        setPanelOpen(false);
        setMode(null);
      }
    },
    placement: 'bottom-end',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({
        padding: 12,
        fallbackPlacements: ['bottom-start', 'top-end', 'top-start'],
      }),
      shift({ padding: 12 }),
    ],
  });
  const dismiss = useDismiss(context, {
    outsidePress: (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[data-export-panel]')) return false;
      if (target?.closest?.('[data-select-dropdown]')) return false;
      return true;
    },
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

  const openMode = useCallback(
    (next: ExportMode) => {
      if (next === 'all') {
        if (!pageCrops.length) {
          message.warning(t('editor.noPagesExport'));
          setMenuOpen(false);
          return;
        }
      } else if (!exportableSelectedIds.length) {
        message.warning(t('editor.noSelectionExport'));
        setMenuOpen(false);
        return;
      }
      setMode(next);
      setMenuOpen(false);
      setPanelOpen(true);
    },
    [exportableSelectedIds.length, pageCrops.length, t]
  );

  const runExportJson = useCallback(() => {
    setMenuOpen(false);
    const doc = document;
    if (!doc) {
      message.error(t('editor.exportFailed'));
      return;
    }
    async function run() {
      try {
        const result = await exportDocumentJson(normalizeDocument(doc), projectName);
        if (result === 'saved') message.success(t('editor.exportedJson'));
        else if (result !== 'cancelled') message.error(t('editor.exportFailed'));
      } catch (err) {
        console.warn('[export-json]', err);
        message.error(t('editor.exportFailed'));
      }
    }
    void run();
  }, [document, projectName, t]);

  const panelNodeIds = mode === 'selected' ? exportableSelectedIds : undefined;
  const panelCrops = mode === 'all' ? pageCrops : undefined;
  const panelBaseName = mode === 'all' ? t('editor.pageExportName') : t('editor.selectionExportName');

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        aria-label={t('editor.export')}
        aria-expanded={floatingOpen}
        aria-haspopup="menu"
        disabled={busy}
        className={cn(
          'inline-flex h-8 items-center justify-center rounded-xl bg-[var(--surface)] text-[13px] font-medium text-[var(--ink)] shadow-sm ring-1 ring-[var(--line)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50',
          iconOnly ? 'w-8 px-0' : 'gap-1.5 px-3',
          className
        )}
        {...getReferenceProps({
          onClick: () => {
            if (busy) return;
            if (panelOpen) {
              setPanelOpen(false);
              setMode(null);
              setMenuOpen(false);
              return;
            }
            setMenuOpen((v) => !v);
          },
        })}
      >
        <HiOutlineArrowUpTray className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        {iconOnly ? null : t('editor.export')}
      </button>

      <FloatingPortal>
        {menuOpen ? (
          <div
            ref={refs.setFloating}
            style={floatingStyles as CSSProperties}
            className="z-[80]"
            {...getFloatingProps()}
          >
            <DropdownPanel role="menu" className="min-w-[200px] p-1">
              <DropdownPanelItem
                role="menuitem"
                disabled
                onClick={() => openMode('all')}
                className="gap-2.5 hover:text-[var(--accent)] [&:hover_svg]:text-[var(--accent)]"
              >
                <HiOutlineDocumentDuplicate className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                {t('editor.exportAllPages')}
              </DropdownPanelItem>
              <DropdownPanelItem
                role="menuitem"
                disabled
                onClick={() => openMode('selected')}
                className="gap-2.5 hover:text-[var(--accent)] [&:hover_svg]:text-[var(--accent)]"
              >
                <HiOutlineDocument className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                {t('editor.exportSelected')}
              </DropdownPanelItem>
              <DropdownPanelItem
                role="menuitem"
                disabled
                onClick={runExportJson}
                className="gap-2.5 hover:text-[var(--accent)] [&:hover_svg]:text-[var(--accent)]"
              >
                <HiOutlineCodeBracket className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                {t('editor.exportJson')}
              </DropdownPanelItem>
            </DropdownPanel>
          </div>
        ) : null}

        {panelOpen && mode ? (
          <div
            ref={refs.setFloating}
            style={floatingStyles as CSSProperties}
            className="z-[80]"
            {...getFloatingProps()}
          >
            <ExportSelectionPanel
              nodeIds={panelNodeIds}
              crops={panelCrops}
              baseName={panelBaseName}
              onClose={() => {
                setPanelOpen(false);
                setMode(null);
              }}
            />
          </div>
        ) : null}
      </FloatingPortal>
    </>
  );
}

export default memo(ExportSelectionPanel);
const MemoizedExportSelectionPanel = memo(ExportSelectionPanel);
export { MemoizedExportSelectionPanel as ExportSelectionPanel };
const MemoizedExportSelectionPopover = memo(ExportSelectionPopover);
export { MemoizedExportSelectionPopover as ExportSelectionPopover };
const MemoizedEditorTopExportButton = memo(EditorTopExportButton);
export { MemoizedEditorTopExportButton as EditorTopExportButton };
