/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/home/UserAssetMediaCard.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Shared user AI-asset card — Me profile Assets tab + editor Assets dock.
 * Natural aspect (plaza-style waterfall); title + time on the card; Tooltip
 * on the title line shows the full name when truncated (not above the whole card).
 *
 * Structure: top-of-file helpers + named subcomponents (no satellite modules).
 */
import {
  memo,
  useEffect,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from '@/features/canvas/adapters/recombynReactDom';
import { useTranslation } from 'react-i18next';
import { HiOutlinePhoto, HiOutlinePlay, HiOutlineTrash, HiOutlineXMark } from 'react-icons/hi2';
import { LuAudioLines, LuFilm } from 'react-icons/lu';
import lottie, { type AnimationItem } from 'lottie-web';
import Image from '@recombyn-native/components/base/image';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { SoftGlowSurface } from '@recombyn-native/components/base';
import { VideoFullscreenPreview } from '@recombyn-native/components/editor/nodes/VideoNode/VideoFullscreenPreviewButton';
import type { UserAsset } from '@recombyn-native/models/assets';
import { FLOW_ITEM_CLASS, FLOW_SKELETON_COUNT } from '@recombyn-native/components/home/FlowScrollSection';
import {
  parseLottieAnimationData
} from '@recombyn-native/components/rcb/scene/document/nodeFactories';
import { cn } from '@recombyn-native/utils/classnames';
import { toDisplayMediaUrl } from '@recombyn-native/utils/uploadImage';

/** Varied aspects for flow skeletons (same rhythm as plaza). */
const ASSET_SKELETON_RATIOS = ['3 / 4', '4 / 5', '1 / 1', '4 / 3', '5 / 6', '2 / 3', '5 / 4'] as const;

// --- pure helpers ----------------------------------------------------------

function formatUserAssetRelativeTime(
  ms: number | null | undefined,
  locale: string
): string {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return '';
  const diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 60) return locale.startsWith('zh') ? '刚刚' : 'just now';
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return locale.startsWith('zh') ? `${m} 分钟前` : `${m}m ago`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return locale.startsWith('zh') ? `${h} 小时前` : `${h}h ago`;
  }
  const d = Math.floor(diffSec / 86400);
  return locale.startsWith('zh') ? `${d} 天前` : `${d}d ago`;
}

function assetKindLabelKey(kind: string): string {
  if (kind === 'video') return 'me.assetKindVideo';
  if (kind === 'audio') return 'me.assetKindAudio';
  if (kind === 'lottie') return 'me.assetKindLottie';
  return 'me.assetKindImage';
}

function aspectFromAsset(asset: UserAsset): string | null {
  const w = Number(asset.width);
  const h = Number(asset.height);
  if (w > 0 && h > 0) return `${w} / ${h}`;
  return null;
}

function defaultFrameAspect(kind: string): string {
  return kind === 'audio' || kind === 'lottie' ? '1 / 1' : '3 / 4';
}

function assetDurationSeconds(asset: UserAsset): number | undefined {
  const fromMeta = Number((asset.meta as { duration?: unknown } | null)?.duration);
  if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta;
  return undefined;
}

function resolveAssetTitle(
  asset: UserAsset,
  t: (key: string, opts?: { defaultValue?: string }) => string
): string {
  const prompt = String(asset.prompt || '').trim();
  if (prompt) return prompt;
  const kind = String(asset.kind || 'image');
  return t(assetKindLabelKey(kind), { defaultValue: kind });
}

function cloneLottieData(data: Record<string, unknown>): Record<string, unknown> {
  if (typeof structuredClone === 'function') return structuredClone(data);
  return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
}

function lottieHostHasInk(host: HTMLElement): boolean {
  return host.querySelectorAll('path, ellipse, circle, rect, polygon').length > 0;
}

function markAssetCardDragging(el: HTMLElement | null) {
  const card = el?.closest('[data-asset-card]');
  if (!(card instanceof HTMLElement)) return;
  card.setAttribute('data-dragging', '');
  card.offsetWidth;
}

function clearAssetCardDragging(el: HTMLElement | null) {
  const card = el?.closest('[data-asset-card]');
  if (card instanceof HTMLElement) card.removeAttribute('data-dragging');
}

/** Prefer list-inlined ``animationData``; never refetch `.json` when present. */
function resolveAssetLottieData(asset: UserAsset): Record<string, unknown> | null {
  const embedded = asset.animationData ?? asset.meta?.animationData;
  return parseLottieAnimationData(embedded);
}

function mountLottieOnHost(
  host: HTMLElement,
  data: Record<string, unknown>
): AnimationItem {
  host.innerHTML = '';
  return lottie.loadAnimation({
    container: host,
    renderer: 'svg',
    loop: true,
    autoplay: true,
    animationData: cloneLottieData(data),
    rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
  });
}

// --- hooks -----------------------------------------------------------------

/** Display URL as-is (bare storage keys → /api/v1/uploads/files/…). */
function useDisplayMediaSrc(
  url: string,
  uploadKey: string | undefined,
  _fileName?: string,
  enabled = true
): string {
  if (!enabled || !url) return '';
  return toDisplayMediaUrl(url, uploadKey);
}

function useEscapeToClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}

// --- thumbnails ------------------------------------------------------------

function PlaceholderThumb({ kind }: { kind: string }): ReactNode {
  if (kind === 'audio') return <LuAudioLines className="h-6 w-6" strokeWidth={1.75} />;
  if (kind === 'video') return <LuFilm className="h-6 w-6" strokeWidth={1.75} />;
  return <HiOutlinePhoto className="h-6 w-6" strokeWidth={1.75} />;
}

function ImageThumb({
  src,
  onNatural,
}: {
  src: string;
  onNatural: (w: number, h: number) => void;
}): ReactNode {
  return (
    // onLoad reports natural size for aspect ratio — not an interactive handler.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <img
      src={src}
      alt=""
      className="pointer-events-none h-full w-full object-cover"
      loading="lazy"
      draggable={false}
      onLoad={(e) => {
        const img = e.currentTarget;
        onNatural(img.naturalWidth, img.naturalHeight);
      }}
    />
  );
}

function VideoThumb({
  src,
  onNatural,
}: {
  src: string;
  onNatural: (w: number, h: number) => void;
}): ReactNode {
  return (
    <span className="pointer-events-none relative block h-full w-full">
      <video
        src={src}
        className="h-full w-full object-cover"
        muted
        playsInline
        preload="metadata"
        draggable={false}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          onNatural(v.videoWidth, v.videoHeight);
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white shadow-sm ring-1 ring-white/25">
          <HiOutlinePlay className="h-4 w-4 translate-x-[1px]" strokeWidth={2} />
        </span>
      </span>
    </span>
  );
}

function LottieAssetThumb({
  asset,
  onNaturalAspect,
}: {
  asset: UserAsset;
  onNaturalAspect?: (aspect: string) => void;
}): ReactNode {
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const lottieData = resolveAssetLottieData(asset);

  useEffect(() => {
    const aspect = aspectFromAsset(asset);
    if (aspect) onNaturalAspect?.(aspect);
  }, [asset.width, asset.height, onNaturalAspect, asset]);

  useEffect(() => {
    if (!hostEl) return undefined;
    if (!lottieData) {
      setFailed(true);
      return undefined;
    }
    let cancelled = false;
    let anim: AnimationItem | null = null;
    setFailed(false);
    const aw = Number(lottieData.w);
    const ah = Number(lottieData.h);
    if (aw > 0 && ah > 0) onNaturalAspect?.(`${aw} / ${ah}`);
    try {
      anim = mountLottieOnHost(hostEl, lottieData);
      requestAnimationFrame(() => {
        if (cancelled || !hostEl.isConnected) return;
        if (!lottieHostHasInk(hostEl)) setFailed(true);
      });
    } catch {
      setFailed(true);
    }
    return () => {
      cancelled = true;
      anim?.destroy();
      hostEl.innerHTML = '';
    };
  }, [hostEl, lottieData, onNaturalAspect]);

  return (
    <div className="relative h-full w-full bg-transparent" aria-hidden>
      <div ref={setHostEl} className="pointer-events-none h-full w-full bg-transparent" />
      {failed ? (
        <span className="pointer-events-none absolute inset-0 inline-flex items-center justify-center bg-[var(--canvas)] text-[var(--muted)]">
          <LuFilm className="h-6 w-6" strokeWidth={1.75} />
        </span>
      ) : null}
    </div>
  );
}

function UserAssetThumb({
  asset,
  onNaturalAspect,
}: {
  asset: UserAsset;
  onNaturalAspect?: (aspect: string) => void;
}): ReactNode {
  const url = String(asset.url || '').trim();
  const uploadKey = String(asset.objectKey || '').trim() || undefined;
  const thumbSrc = useDisplayMediaSrc(url, uploadKey, 'user-asset-thumb.bin');

  const reportNatural = (w: number, h: number) => {
    if (w > 0 && h > 0) onNaturalAspect?.(`${w} / ${h}`);
  };

  if (asset.kind === 'lottie') {
    return <LottieAssetThumb asset={asset} onNaturalAspect={onNaturalAspect} />;
  }
  if (asset.kind === 'image' && thumbSrc) {
    return <ImageThumb src={thumbSrc} onNatural={reportNatural} />;
  }
  if (asset.kind === 'video' && thumbSrc) {
    return <VideoThumb src={thumbSrc} onNatural={reportNatural} />;
  }
  return (
    <span className="inline-flex h-full w-full items-center justify-center text-[var(--muted)]">
      <PlaceholderThumb kind={String(asset.kind || 'image')} />
    </span>
  );
}

// --- card chrome -----------------------------------------------------------

function AssetCardMetaOverlay({
  title,
  when,
  dense,
}: {
  title: string;
  when: string;
  dense: boolean;
}): ReactNode {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0',
        'bg-gradient-to-t from-black/70 via-black/35 to-transparent',
        'group-data-[dragging]:!opacity-0 group-data-[dragging]:!transition-none',
        dense ? 'px-1.5 pb-1.5 pt-6' : 'px-2 pb-2 pt-8'
      )}
    >
      {/* Tip anchors to the title line — not the whole card. */}
      <Tooltip
        tip={title}
        placement="top"
        asChild={false}
        triggerClassName="pointer-events-auto block max-w-full"
        popupClassName="!h-auto !max-w-[14rem] !whitespace-normal !break-words !rounded-md !py-1.5 !leading-snug !items-start !justify-start text-left"
      >
        <p
          className={cn(
            'truncate font-medium leading-snug text-white',
            dense ? 'text-[11px]' : 'text-[12px]'
          )}
        >
          {title}
        </p>
      </Tooltip>
      {when ? (
        <p
          className={cn(
            'mt-0.5 truncate text-white/75',
            dense ? 'text-[10px]' : 'text-[11px]'
          )}
        >
          {when}
        </p>
      ) : null}
    </div>
  );
}

function UserAssetCardSkeleton({
  index = 0,
  dense = false,
}: {
  index?: number;
  dense?: boolean;
}): ReactNode {
  const ratio = ASSET_SKELETON_RATIOS[index % ASSET_SKELETON_RATIOS.length];
  return (
    <div
      className={cn(dense ? 'mb-1.5 min-w-0 break-inside-avoid' : FLOW_ITEM_CLASS)}
      aria-busy="true"
      aria-hidden
    >
      <SoftGlowSurface
        seed={index}
        className="block w-full rounded-xl shadow-none"
        style={{ aspectRatio: ratio }}
      />
    </div>
  );
}

type UserAssetCardProps = {
  asset: UserAsset;
  locale: string;
  /** Editor dock — tighter overlay + grab cursor when draggable. */
  dense?: boolean;
  deleteBusy?: boolean;
  onActivate: (asset: UserAsset) => void;
  onDelete?: (asset: UserAsset) => void;
  /** When set, card body is HTML5-draggable (Assets → canvas). */
  onDragStart?: (e: ReactDragEvent<HTMLElement>, asset: UserAsset) => void;
  onDragEnd?: () => void;
};

function handleAssetCardActivate(
  asset: UserAsset,
  url: string,
  onActivate: (asset: UserAsset) => void
) {
  if (!url && asset.kind !== 'audio') return;
  onActivate(asset);
}

function closePreviewOnBackdropClick(
  e: ReactMouseEvent<HTMLElement>,
  onClose: () => void
) {
  if (e.target === e.currentTarget) onClose();
}

function UserAssetCard({
  asset,
  locale,
  dense = false,
  deleteBusy = false,
  onActivate,
  onDelete,
  onDragStart,
  onDragEnd,
}: UserAssetCardProps): ReactNode {
  const { t } = useTranslation();
  const url = String(asset.url || '').trim();
  const when = formatUserAssetRelativeTime(asset.createdAt, locale);
  const title = resolveAssetTitle(asset, t);
  const canDrag = Boolean(onDragStart && url);
  const [naturalAspect, setNaturalAspect] = useState<string | null>(() =>
    aspectFromAsset(asset)
  );

  useEffect(() => {
    setNaturalAspect(aspectFromAsset(asset));
  }, [asset]);

  const frameStyle: CSSProperties = {
    aspectRatio: naturalAspect || defaultFrameAspect(String(asset.kind || '')),
  };

  const onBodyDragStart = (e: ReactDragEvent<HTMLButtonElement>) => {
    if (!canDrag) return;
    markAssetCardDragging(e.currentTarget);
    onDragStart?.(e, asset);
  };

  const onBodyDragEnd = (e: ReactDragEvent<HTMLButtonElement>) => {
    clearAssetCardDragging(e.currentTarget);
    onDragEnd?.();
  };

  const onDeleteClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    onDelete?.(asset);
  };

  return (
    <div
      data-asset-card
      className={cn(
        // Dock: CSS columns waterfall — keep break-inside + column gap via mb.
        dense ? 'mb-1.5 min-w-0 break-inside-avoid' : FLOW_ITEM_CLASS,
        'group relative overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--rail)]'
        // Do NOT set pointer-events-none while dragging — that cancels HTML5 drag.
      )}
    >
      <button
        type="button"
        draggable={canDrag}
        onDragStart={canDrag ? onBodyDragStart : undefined}
        onDragEnd={onBodyDragEnd}
        onClick={() => handleAssetCardActivate(asset, url, onActivate)}
        className={cn(
          'relative block w-full appearance-none border-0 bg-transparent p-0 text-left',
          canDrag && 'cursor-grab active:cursor-grabbing'
        )}
      >
        <div className="relative w-full overflow-hidden bg-[var(--canvas)]" style={frameStyle}>
          <div className="absolute inset-0">
            <UserAssetThumb asset={asset} onNaturalAspect={setNaturalAspect} />
          </div>
          <AssetCardMetaOverlay title={title} when={when} dense={dense} />
        </div>
      </button>
      {onDelete ? (
        <button
          type="button"
          disabled={deleteBusy}
          aria-label={t('me.deleteAsset', { defaultValue: '删除' })}
          onClick={onDeleteClick}
          className={cn(
            'absolute z-20 inline-flex items-center justify-center rounded-full',
            'bg-[var(--surface)] text-[var(--ink)] shadow-md ring-1 ring-black/10',
            'opacity-0 transition hover:bg-[var(--canvas)] group-hover:opacity-100 disabled:opacity-40',
            'group-data-[dragging]:!pointer-events-none group-data-[dragging]:!opacity-0 group-data-[dragging]:!transition-none',
            dense ? 'right-1.5 top-1.5 h-7 w-7' : 'right-2 top-2 h-8 w-8'
          )}
        >
          <HiOutlineTrash className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}

const MemoizedUserAssetCard = memo(UserAssetCard);
const MemoizedUserAssetCardSkeleton = memo(UserAssetCardSkeleton);

// --- previews --------------------------------------------------------------
function ImageAssetLightbox({
  asset,
  onClose,
}: {
  asset: UserAsset;
  onClose: () => void;
}): ReactNode {
  const url = String(asset.url || '').trim();
  const uploadKey = String(asset.objectKey || '').trim() || undefined;
  const src = useDisplayMediaSrc(url, uploadKey, 'user-asset-preview.bin');
  if (!src) return null;
  return (
    <Image
      src={src}
      alt=""
      lazy={false}
      preview={{
        open: true,
        onOpenChange: (open) => {
          if (!open) onClose();
        },
        previewOnClick: false,
      }}
      className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
      imgClassName="!hidden"
    />
  );
}

function AudioAssetPreview({
  open,
  src,
  uploadKey,
  title,
  onClose,
}: {
  open: boolean;
  src: string;
  uploadKey?: string | null;
  title: string;
  onClose: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const playSrc = useDisplayMediaSrc(
    src,
    uploadKey || undefined,
    'asset-audio.bin',
    open
  );
  useEscapeToClose(open, onClose);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[800] flex items-center justify-center bg-black/55 p-4"
      onClick={(e) => closePreviewOnBackdropClick(e, onClose)}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('editor.assets.preview', { defaultValue: '预览' })}
        className="relative w-full max-w-md rounded-2xl bg-[var(--surface)] p-5 shadow-[0_18px_48px_rgba(12,12,13,0.28)] ring-1 ring-[var(--line)]"
      >
        <button
          type="button"
          aria-label={t('common.close', { defaultValue: '关闭' })}
          onClick={onClose}
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
        >
          <HiOutlineXMark className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <div className="mb-4 flex items-center gap-3 pr-8">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--rail)] text-[var(--ink)]">
            <LuAudioLines className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <p className="min-w-0 truncate text-[14px] font-medium text-[var(--ink)]">
            {title}
          </p>
        </div>
        {playSrc ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption -- user asset playback, not dialogue
          <audio src={playSrc} controls autoPlay className="w-full" />
        ) : null}
      </div>
    </div>,
    document.body
  );
}

function LottieAssetPreview({
  open,
  asset,
  onClose,
}: {
  open: boolean;
  asset: UserAsset;
  onClose: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const lottieData = resolveAssetLottieData(asset);
  useEscapeToClose(open, onClose);

  useEffect(() => {
    if (!open || !hostEl || !lottieData) return undefined;
    let anim: AnimationItem | null = null;
    try {
      anim = mountLottieOnHost(hostEl, lottieData);
    } catch {
      /* empty */
    }
    return () => {
      anim?.destroy();
      hostEl.innerHTML = '';
    };
  }, [open, hostEl, lottieData]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[800] flex items-center justify-center bg-black/45 p-6"
      onClick={(e) => closePreviewOnBackdropClick(e, onClose)}
      role="presentation"
    >
      <button
        type="button"
        aria-label={t('common.close', { defaultValue: '关闭' })}
        onClick={onClose}
        className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
      >
        <HiOutlineXMark className="h-5 w-5" strokeWidth={1.75} />
      </button>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('editor.assets.preview', { defaultValue: '预览' })}
        className="relative flex h-[min(72vh,560px)] w-[min(72vw,560px)] items-center justify-center overflow-hidden bg-transparent"
      >
        <div ref={setHostEl} className="h-full w-full bg-transparent" />
      </div>
    </div>,
    document.body
  );
}

/** Image lightbox / video fullscreen / audio / lottie dialog — Me + editor Assets. */
function UserAssetMediaPreview({
  asset,
  onClose,
}: {
  asset: UserAsset | null;
  onClose: () => void;
}): ReactNode {
  const { t } = useTranslation();
  if (!asset) return null;

  const url = String(asset.url || '').trim();
  const title = resolveAssetTitle(asset, t);

  return (
    <>
      {asset.kind === 'image' && (
        <ImageAssetLightbox asset={asset} onClose={onClose} />
      )}
      <VideoFullscreenPreview
        open={asset.kind === 'video' && Boolean(url)}
        onClose={onClose}
        src={url}
        uploadKey={asset.objectKey}
        aspectWidth={asset.width || undefined}
        aspectHeight={asset.height || undefined}
        duration={assetDurationSeconds(asset)}
      />
      <AudioAssetPreview
        open={asset.kind === 'audio' && Boolean(url)}
        src={url}
        uploadKey={asset.objectKey}
        title={title}
        onClose={onClose}
      />
      <LottieAssetPreview
        open={asset.kind === 'lottie' && Boolean(resolveAssetLottieData(asset) || url)}
        asset={asset}
        onClose={onClose}
      />
    </>
  );
}

const MemoizedUserAssetMediaPreview = memo(UserAssetMediaPreview);

export {
  MemoizedUserAssetCard as UserAssetCard,
  MemoizedUserAssetCardSkeleton as UserAssetCardSkeleton,
  MemoizedUserAssetMediaPreview as UserAssetMediaPreview,
  FLOW_SKELETON_COUNT as USER_ASSET_SKELETON_COUNT,
};
