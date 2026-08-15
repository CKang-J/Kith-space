/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/panels/agent/AgentComposerShell.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode, type Ref, memo } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  type Placement,
} from '@/features/canvas/adapters/recombynFloatingUi';
import {
  HiArrowUp,
  HiCheck,
  HiOutlineBolt,
  HiOutlineViewfinderCircle,
  HiOutlineDocument,
  HiOutlineMusicalNote,
  HiOutlinePhoto,
  HiOutlineFilm,
  HiOutlinePlay,
  HiOutlinePlus,
  HiOutlineXMark,
  HiChevronUp,
  HiChevronDown,
} from 'react-icons/hi2';
import { LuInfinity, LuMessageSquare } from 'react-icons/lu';
import { Dropdown, DropdownPanel, DropdownPanelItem } from '@recombyn-native/components/base';
import { Icon } from '@recombyn-native/components/base/icon';
import Tooltip from '@recombyn-native/components/base/tooltip';
import AgentComposerInput, {
  type AgentComposerHandle,
  type ComposerContext,
} from '@recombyn-native/components/editor/panels/AgentComposerInput';
import VideoJsPlayer, {
  usePlayableVideoSrc,
} from '@recombyn-native/components/editor/nodes/VideoNode/VideoJsPlayer';
import ImageAspectRatioPicker, {
  AspectRatioGlyph,
} from '@recombyn-native/components/editor/panels/agent/ImageAspectRatioPicker';
import {
  isCanvasSizeAutoHint,
} from '@recombyn-native/components/editor/chrome/SizePresetPanel';
import { useBillingEnabled } from '@recombyn-native/service/wallet';
import { cn } from '@recombyn-native/utils/classnames';

/** Run mode — Auto toggle = agent; image/video models still use composerMode for gen UI. */
export type ComposerRunMode = 'agent' | 'image' | 'video';

/** Agent = edit canvas; Ask = propose / clarify first; Image / Video = direct gen in chat. */
export type ComposerInteractionMode = 'agent' | 'ask' | 'image' | 'video';

const DEFAULT_INTERACTION_MODES: ComposerInteractionMode[] = ['agent', 'image', 'video'];

/** Controls shown when `interactionMode === 'image'` (mirrors ImageGeneratorCard footer). */
export type ImageModeComposerControls = {
  resolution: string;
  aspectRatio: string;
  imageCount: number;
  onResolutionChange: (resolution: string) => void;
  onAspectRatioChange: (ratio: string) => void;
  onImageCountChange: (count: number) => void;
  /** Catalog limits for the selected image model (resolutions / pixel floor). */
  imageLimits?: import('@recombyn-native/service/chat').ImageLimits | null;
  creditCost: number;
  /** Full model name — tooltip / aria only (trigger is icon-only). */
  modelLabel: string;
  modelIcon?: ReactNode;
  modelPanel: ReactNode;
  modelOpen: boolean;
  onModelOpenChange: (open: boolean) => void;
};

/** Controls shown when `interactionMode === 'video'` (mirrors VideoGeneratorCard footer). */
export type VideoModeComposerControls = {
  resolution: string;
  aspectRatio: string;
  duration: number;
  onResolutionChange: (resolution: string) => void;
  onAspectRatioChange: (ratio: string) => void;
  onDurationChange: (duration: number) => void;
  creditCost: number;
  modelLabel: string;
  modelIcon?: ReactNode;
  modelPanel: ReactNode;
  modelOpen: boolean;
  onModelOpenChange: (open: boolean) => void;
};

const VIDEO_COMPOSER_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
const VIDEO_COMPOSER_RESOLUTIONS = ['480p', '720p', '1080p'] as const;
const VIDEO_COMPOSER_DURATIONS = [4, 5, 6, 7, 8, 10, 12, 15] as const;

function VideoComposerSegmentPill({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex min-w-[2.75rem] flex-1 items-center justify-center rounded-lg px-2 py-2 text-[12px] font-medium tabular-nums transition disabled:opacity-40',
        active
          ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
          : 'bg-transparent text-[var(--muted)] hover:text-[var(--ink)]'
      )}
    >
      {children}
    </button>
  );
}

/** Aspect / resolution / duration — same layout as VideoGeneratorCard settings. */
function VideoComposerSettingsPanel({
  aspectRatio,
  resolution,
  duration,
  onAspectRatioChange,
  onResolutionChange,
  onDurationChange,
  disabled,
}: {
  aspectRatio: string;
  resolution: string;
  duration: number;
  onAspectRatioChange: (ratio: string) => void;
  onResolutionChange: (resolution: string) => void;
  onDurationChange: (duration: number) => void;
  disabled?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[12px] font-medium text-[var(--muted)]">{t('agent.chooseRatio')}</p>
        <div className="flex items-start justify-between gap-0.5 rounded-xl bg-[var(--rail)] p-1">
          {VIDEO_COMPOSER_ASPECTS.map((ratio) => {
            const active = aspectRatio === ratio;
            return (
              <button
                key={ratio}
                type="button"
                disabled={disabled}
                title={ratio}
                onClick={(e) => {
                  e.stopPropagation();
                  onAspectRatioChange(ratio);
                }}
                className={cn(
                  'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-0.5 py-1.5 transition-colors disabled:opacity-40',
                  active
                    ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                )}
              >
                <AspectRatioGlyph ratio={ratio} size={20} />
                <span className="max-w-full truncate text-[10px] font-medium tabular-nums">
                  {ratio}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-2 text-[12px] font-medium text-[var(--muted)]">
          {t('agent.chooseResolution')}
        </p>
        <div className="flex flex-wrap gap-1 rounded-xl bg-[var(--rail)] p-1">
          {VIDEO_COMPOSER_RESOLUTIONS.map((r) => (
            <VideoComposerSegmentPill
              key={r}
              active={resolution === r}
              disabled={disabled}
              onClick={() => onResolutionChange(r)}
            >
              {r}
            </VideoComposerSegmentPill>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-[12px] font-medium text-[var(--muted)]">
          {t('editor.tools.videoDuration')}
        </p>
        <div className="flex flex-wrap gap-1 rounded-xl bg-[var(--rail)] p-1">
          {VIDEO_COMPOSER_DURATIONS.map((n) => (
            <VideoComposerSegmentPill
              key={n}
              active={duration === n}
              disabled={disabled}
              onClick={() => onDurationChange(n)}
            >
              {t('editor.tools.videoDurationNs', { n })}
            </VideoComposerSegmentPill>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Ghost toolbar controls — icon only, no border / fill. */
const TOOL_ICON_BTN =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)] disabled:opacity-40';
const TOOL_ICON_BTN_ACTIVE = 'bg-[var(--accent-soft)] text-[var(--ink)]';

type Props = {
  inputRef?: Ref<AgentComposerHandle>;
  contexts: ComposerContext[];
  onContextsChange: (next: ComposerContext[]) => void;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** While a turn is running — show stop instead of send. */
  sending?: boolean;
  onStop?: () => void;
  onEscape?: () => void;
  disabled?: boolean;
  placeholder: string;
  /** Left toolbar extras (e.g. 取消 / 还原 when editing). */
  leadingActions?: ReactNode;
  canSend: boolean;
  /** Tooltip when send is disabled or models are unhealthy. */
  sendDisabledReason?: string;
  /** Open OS file picker and receive selected files (images). */
  onAttachFiles?: (files: File[], opts?: { mention?: boolean }) => void;
  /** Tooltip for the attach (+) button. */
  attachTooltip?: string;
  /**
   * Enter canvas pick mode (Add to Chat) — click a node/group on the board to
   * insert a context chip. When set, a pick button is shown next to +.
   */
  onPickFromCanvas?: () => void;
  /** Highlight the pick button while canvas pick mode is active. */
  pickingFromCanvas?: boolean;
  /** Tooltip for the canvas-pick button. */
  pickFromCanvasTooltip?: string;
  /** Canvas→composer fly land (`agent` | `node:<id>`). */
  flyLandId?: string;
  /**
   * When true (default), show design canvas size chip.
   * Image quality / ratio / count are LLM-inferred — never shown as a manual panel.
   */
  showDesignSizePicker?: boolean;
  /** When set with onImageAspectRatioChange, show design canvas size button. */
  imageAspectRatio?: string | null;
  onImageAspectRatioChange?: (ratio: string) => void;
  /**
   * Where the size / aspect panel opens relative to the trigger.
   * Home hero: `bottom-start` (open downward). Agent dock footer: `top-start`.
   */
  aspectMenuPlacement?: Placement;
  /** When both are set, show the Agent / Ask / Image / Video switch in the toolbar. */
  interactionMode?: ComposerInteractionMode;
  onInteractionModeChange?: (mode: ComposerInteractionMode) => void;
  allowedInteractionModes?: ComposerInteractionMode[];
  /** Image-mode settings / model / credit send (Image Generator鈥搒tyle chrome). */
  imageModeControls?: ImageModeComposerControls | null;
  /** Video-mode settings / model / credit send (Video Generator鈥搒tyle chrome). */
  videoModeControls?: VideoModeComposerControls | null;
  modelButtonProps: {
    open: boolean;
    /** Preferred: Dropdown-hosted primary panel (flip / shift, stable anchor). */
    panel?: ReactNode;
    onOpenChange?: (open: boolean) => void;
    /** Dropdown placement when using `panel`. @default top-start */
    panelPlacement?: Placement;
    /** @deprecated Prefer `panel` + `onOpenChange` (legacy floating-ui refs). */
    ref?: (node: HTMLElement | null) => void;
    onClick?: () => void;
    getReferenceProps?: (userProps?: Record<string, unknown>) => Record<string, unknown>;
    /** Optional brand icon for the selected LLM (from assets/model). */
    icon?: ReactNode;
    /** Short label shown in the pill (e.g. Auto / DeepSeek). */
    label?: string;
    /** Optional muted trailing chip text (e.g. design intensity short). */
    labelSuffix?: string;
    /**
     * `icon` — cube only (editor default).
     * `chip` — bordered pill with icon + label (home “智能设计系统”).
     */
    variant?: 'icon' | 'chip';
  };
  className?: string;
  /** Home hero: text CTA instead of icon-only send. */
  submitLabel?: string;
  /** Hide Agent / Ask / Image / Video picker (home category lives in the headline). */
  showInteractionModePicker?: boolean;
  /** Hide the model / route-prefs control. @default true */
  showModelButton?: boolean;
  /**
   * Send affordance: circular ink (editor default) vs rounded square (home).
   * @default 'circle'
   */
  sendVariant?: 'circle' | 'square';
  /**
   * Square send fill: home CTA blue vs theme ink.
   * @default 'cta'
   */
  sendTone?: 'cta' | 'ink';
  /** Extra controls in the right cluster, before attach / send (home design-system CTA). */
  trailingActions?: ReactNode;
  /** Attach control glyph. @default 'plus' */
  attachIcon?: 'plus' | 'image';
};


const ATTACH_PREVIEW_WIDTH = 160;
/** Cap tall previews by shrinking width so aspect stays true. */
const ATTACH_PREVIEW_MAX_HEIGHT = 360;

function fitAttachPreviewPanel(vw: number, vh: number): { w: number; h: number } {
  let w = ATTACH_PREVIEW_WIDTH;
  let h = Math.round((ATTACH_PREVIEW_WIDTH * vh) / Math.max(1, vw));
  if (h > ATTACH_PREVIEW_MAX_HEIGHT) {
    h = ATTACH_PREVIEW_MAX_HEIGHT;
    w = Math.max(72, Math.round((ATTACH_PREVIEW_MAX_HEIGHT * vw) / Math.max(1, vh)));
  }
  return { w, h };
}

function formatAudioTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function attachmentPreviewKind(a: ComposerContext): 'image' | 'audio' | 'video' | null {
  const data = String(a.dataUrl || '').trim();
  const thumb = String(a.thumbUrl || '').trim();
  const payload = String(a.payload || '');
  const blob = `${data} ${thumb} ${payload}`;

  // Images first: uploads often keep a data:image thumb while dataUrl is https.
  // That must not be treated as "video + poster".
  if (data.startsWith('data:image/') || thumb.startsWith('data:image/')) {
    if (data.startsWith('data:video/') || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(data)) {
      return 'video';
    }
    if (/\[Canvas video\]/i.test(payload) || /\[Attached video\]/i.test(payload)) {
      return 'video';
    }
    return 'image';
  }
  if (/\[Canvas image\]/i.test(payload) || /\[Attached image\]/i.test(payload)) return 'image';
  if (/"key"\s*:\s*"image"/i.test(payload)) return 'image';
  if (/\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(data)) return 'image';

  // Explicit video markers / mime / extensions.
  if (data.startsWith('data:video/') || thumb.startsWith('data:video/')) return 'video';
  if (/\[Canvas video\]/i.test(payload) || /\[Attached video\]/i.test(payload)) return 'video';
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(blob)) return 'video';
  if (/"key"\s*:\s*"video"/i.test(payload)) return 'video';

  // Canvas video without extension: https/blob media + separate still poster (JPEG/PNG data URL).
  if (
    data &&
    thumb &&
    thumb !== data &&
    thumb.startsWith('data:image/') &&
    (data.startsWith('http://') ||
      data.startsWith('https://') ||
      data.startsWith('/') ||
      data.startsWith('blob:')) &&
    !/\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(data)
  ) {
    return 'video';
  }

  if (data.startsWith('data:audio/') || thumb.startsWith('data:audio/')) return 'audio';
  if (/\[Attached audio\]/i.test(payload) || /\[Canvas audio\]/i.test(payload)) return 'audio';
  if (/\.(mp3|wav|m4a|aac|ogg|flac)(\?|#|$)/i.test(blob)) return 'audio';
  if (/"key"\s*:\s*"audio"/i.test(payload)) return 'audio';
  if (
    data.startsWith('http://') ||
    data.startsWith('https://') ||
    data.startsWith('/') ||
    thumb.startsWith('http://') ||
    thumb.startsWith('https://') ||
    thumb.startsWith('/')
  ) {
    return 'image';
  }
  return null;
}

/** Prefer a still poster for the chip; fall back to image/http refs. */
function attachmentThumbSrc(a: ComposerContext): string {
  const thumb = String(a.thumbUrl || '').trim();
  if (thumb.startsWith('data:image/')) return thumb;
  if (thumb.startsWith('http://') || thumb.startsWith('https://') || thumb.startsWith('/')) {
    if (!/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(thumb)) return thumb;
  }
  const ref = String(a.dataUrl || '').trim();
  if (ref.startsWith('data:image/')) return ref;
  if (ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('/')) {
    if (!/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(ref) && !ref.startsWith('data:video/')) return ref;
  }
  return '';
}

function attachmentMediaSrc(a: ComposerContext): string {
  const data = String(a.dataUrl || '').trim();
  if (data) return data;
  return String(a.thumbUrl || '').trim();
}

function attachmentCanPreview(opts: {
  uploading: boolean;
  previewKind: 'image' | 'audio' | 'video' | null;
  thumbSrc: string;
  mediaSrc: string;
}): boolean {
  const { uploading, previewKind, thumbSrc, mediaSrc } = opts;
  if (uploading || !previewKind) return false;
  if (previewKind === 'video') return Boolean(mediaSrc);
  return Boolean(thumbSrc || mediaSrc);
}

function attachmentChipTip(opts: {
  uploading: boolean;
  canPreview: boolean;
  label: string;
  uploadingLabel: string;
}): string {
  const { uploading, canPreview, label, uploadingLabel } = opts;
  if (uploading) return uploadingLabel;
  if (canPreview) return `预览 ${label}`;
  return label;
}

function AttachmentImagePreview({ src, label }: { src: string; label: string }): ReactNode {
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled && img.naturalWidth > 0) {
        setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
      }
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Fixed width; height from image aspect. If too tall, shrink width to keep ratio.
  let panelW = ATTACH_PREVIEW_WIDTH;
  let panelH = Math.round(ATTACH_PREVIEW_WIDTH * 1.25);
  if (imgSize && imgSize.w > 0) {
    panelH = Math.round((ATTACH_PREVIEW_WIDTH * imgSize.h) / imgSize.w);
    if (panelH > ATTACH_PREVIEW_MAX_HEIGHT) {
      panelH = ATTACH_PREVIEW_MAX_HEIGHT;
      panelW = Math.max(72, Math.round((ATTACH_PREVIEW_MAX_HEIGHT * imgSize.w) / imgSize.h));
    }
  }

  return (
    <div
      className="relative overflow-hidden rounded-xl bg-[var(--surface)] shadow-[0_8px_24px_rgba(12,12,13,0.16)] ring-1 ring-[var(--line)]"
      style={{ width: panelW, height: panelH }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <img src={src} alt={label} className="h-full w-full object-cover" draggable={false} />
    </div>
  );
}

function AttachmentVideoPreview({
  src,
  poster,
  uploadKey,
}: {
  src: string;
  poster?: string;
  uploadKey?: string | null;
}): ReactNode {
  const playSrc = usePlayableVideoSrc(src, uploadKey);
  const [panel, setPanel] = useState({ w: ATTACH_PREVIEW_WIDTH, h: Math.round(ATTACH_PREVIEW_WIDTH * 1.25) });

  useEffect(() => {
    let cancelled = false;
    const posterUrl = String(poster || '').trim();
    if (!posterUrl || posterUrl.startsWith('data:video/')) return;
    const img = new window.Image();
    img.onload = () => {
      if (cancelled || !(img.naturalWidth > 0)) return;
      setPanel(fitAttachPreviewPanel(img.naturalWidth, img.naturalHeight));
    };
    img.src = posterUrl;
    return () => {
      cancelled = true;
    };
  }, [poster]);

  return (
    <div
      className="relative overflow-hidden rounded-xl bg-black shadow-[0_8px_24px_rgba(12,12,13,0.16)] ring-1 ring-[var(--line)]"
      style={{ width: panel.w, height: panel.h }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {playSrc ? (
        <VideoJsPlayer
          src={playSrc}
          poster={poster}
          layout="fill"
          objectFit="contain"
          controlsMode="always"
          muted
          className="h-full w-full"
          onMediaSize={({ width, height }) => {
            if (width > 0 && height > 0) setPanel(fitAttachPreviewPanel(width, height));
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[11px] text-white/60">…</div>
      )}
    </div>
  );
}

function AttachmentAudioPreview({ src }: { src: string }): ReactNode {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState({ current: 0, duration: 0 });

  const toggleAudio = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  return (
    <div
      className="flex h-11 items-center gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 shadow-[0_8px_24px_rgba(12,12,13,0.14)]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label={
          playing
            ? t('agent.previewPause', { defaultValue: 'Pause' })
            : t('agent.previewPlay', { defaultValue: 'Play' })
        }
        onClick={toggleAudio}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--canvas)] text-[var(--ink)] ring-1 ring-[var(--line)]"
      >
        {playing ? (
          <span className="h-2.5 w-2.5 rounded-[2px] bg-current" aria-hidden />
        ) : (
          <HiOutlinePlay className="h-4 w-4" />
        )}
      </button>
      <span className="text-[12px] tabular-nums text-[var(--muted)]">
        {formatAudioTime(audioTime.current)} / {formatAudioTime(audioTime.duration || 0)}
      </span>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- attachment audio preview, not dialogue */}
      <audio
        ref={audioRef}
        src={src}
        className="hidden"
        onTimeUpdate={() => {
          const el = audioRef.current;
          if (!el) return;
          setAudioTime({ current: el.currentTime, duration: el.duration || 0 });
        }}
        onLoadedMetadata={() => {
          const el = audioRef.current;
          if (!el) return;
          setAudioTime({ current: 0, duration: el.duration || 0 });
        }}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}

function AttachmentUploadSpinner(): ReactNode {
  return (
    <span
      className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-black/35"
      aria-hidden
    >
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
    </span>
  );
}

/** Soft circular footprint for attach / pick actions. */
export const COMPOSER_ATTACHMENT_CHIP_CLASS = 'h-9 w-9 shrink-0 rounded-xl';

const COMPOSER_ATTACH_ACTION_CLASS =
  'h-9 w-9 shrink-0 rounded-full inline-flex items-center justify-center transition disabled:opacity-40';
const COMPOSER_ATTACH_ACTION_IDLE =
  'bg-[var(--canvas)] text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]';
const COMPOSER_ATTACH_ACTION_ACTIVE =
  'bg-[var(--ink)] text-[var(--surface)] hover:bg-[var(--ink)] hover:text-[var(--surface)]';

/** Circular upload / pick-from-canvas button chrome (image & video generators share this). */
export function composerAttachActionClass(active = false): string {
  return cn(
    COMPOSER_ATTACH_ACTION_CLASS,
    active ? COMPOSER_ATTACH_ACTION_ACTIVE : COMPOSER_ATTACH_ACTION_IDLE
  );
}

/**
 * One composer attachment square — thumbnail, upload spinner, remove badge and
 * hover preview. Exported so other composers (e.g. the image generator node)
 * get identical chips.
 */
function ComposerAttachmentChip({
  attachment: a,
  disabled,
  removable = true,
  onRemove,
}: {
  attachment: ComposerContext;
  disabled?: boolean;
  /** When false, hide the remove badge (e.g. locked subject node). */
  removable?: boolean;
  onRemove: (key: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  const previewKind = attachmentPreviewKind(a);
  const thumbSrc = attachmentThumbSrc(a);
  const mediaSrc = attachmentMediaSrc(a);
  const uploading = a.uploadStatus === 'uploading';
  const canPreview = attachmentCanPreview({ uploading, previewKind, thumbSrc, mediaSrc });
  const tip = attachmentChipTip({
    uploading,
    canPreview,
    label: a.label,
    uploadingLabel: t('agent.attachUploading', { name: a.label }),
  });
  const chipVisual =
    previewKind === 'video' && thumbSrc ? (
      <span className="relative block h-full w-full">
        <img
          src={thumbSrc}
          alt={a.label}
          className={cn('h-full w-full object-cover', uploading && 'opacity-70')}
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
          <HiOutlinePlay className="h-3.5 w-3.5 text-white drop-shadow" />
        </span>
      </span>
    ) : previewKind === 'image' && thumbSrc ? (
      <img
        src={thumbSrc}
        alt={a.label}
        className={cn('h-full w-full object-cover', uploading && 'opacity-70')}
      />
    ) : previewKind === 'video' && mediaSrc ? (
      <span className="relative block h-full w-full bg-black">
        <video
          src={mediaSrc}
          muted
          playsInline
          preload="metadata"
          className={cn('h-full w-full object-cover', uploading && 'opacity-70')}
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
          <HiOutlinePlay className="h-3.5 w-3.5 text-white drop-shadow" />
        </span>
      </span>
    ) : previewKind === 'audio' ? (
      <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-0.5 text-[var(--muted)]">
        <HiOutlineMusicalNote
          className={cn('h-3.5 w-3.5', uploading && 'opacity-70')}
          strokeWidth={1.75}
        />
        <span className="w-full truncate text-center text-[8px] leading-tight">{a.label}</span>
      </span>
    ) : (
      <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-0.5 text-[var(--muted)]">
        <HiOutlineDocument className="h-3.5 w-3.5" />
        <span className="w-full truncate text-center text-[8px] leading-tight">{a.label}</span>
      </span>
    );

  const thumb = (
    <div className={cn('group relative', COMPOSER_ATTACHMENT_CHIP_CLASS)}>
      <button
        type="button"
        disabled={disabled || uploading || !canPreview}
        aria-label={tip}
        aria-busy={uploading || undefined}
        className={cn(
          'relative h-full w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]',
          'outline-none ring-0 focus:outline-none focus-visible:outline-none focus-visible:ring-0',
          canPreview && 'cursor-zoom-in hover:border-[var(--ink)]/30',
          (uploading || !canPreview) && 'cursor-default'
        )}
      >
        {chipVisual}
        {uploading ? <AttachmentUploadSpinner /> : null}
      </button>
      {removable ? (
        <button
          type="button"
          aria-label={`移除 ${a.label}`}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(a.key);
          }}
          className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] opacity-0 shadow-sm transition-opacity hover:text-[var(--ink)] group-hover:opacity-100 focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-0"
        >
          <HiOutlineXMark className="h-2.5 w-2.5" />
        </button>
      ) : null}
    </div>
  );

  if (!canPreview) return thumb;

  return (
    <Dropdown
      trigger="hover"
      placement="top"
      strategy="fixed"
      offset={8}
      items={[]}
      floatingClassName="z-[90]"
      referenceClassName="inline-flex outline-none ring-0 focus:outline-none focus-visible:outline-none"
      popupRender={() =>
        previewKind === 'audio' ? (
          <AttachmentAudioPreview src={mediaSrc} />
        ) : previewKind === 'video' ? (
          <AttachmentVideoPreview
            src={mediaSrc}
            poster={thumbSrc || undefined}
            uploadKey={a.uploadKey}
          />
        ) : (
          <AttachmentImagePreview src={thumbSrc || mediaSrc} label={a.label} />
        )
      }
    >
      {thumb}
    </Dropdown>
  );
}

function AttachmentStrip({
  attachments,
  disabled,
  onRemove,
}: {
  attachments: ComposerContext[];
  disabled?: boolean;
  onRemove: (key: string) => void;
}): ReactNode {
  if (!attachments.length) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5 pb-0.5">
      {attachments.map((a) => (
        <ComposerAttachmentChip
          key={a.key}
          attachment={a}
          disabled={disabled}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function interactionModeLabel(
  mode: ComposerInteractionMode,
  t: (key: string) => string
): string {
  if (mode === 'video') return t('agent.interactionVideo');
  if (mode === 'image') return t('agent.interactionImage');
  if (mode === 'ask') return t('agent.interactionAsk');
  return t('agent.interactionAgent');
}

function interactionModeIcon(mode: ComposerInteractionMode): ReactNode {
  if (mode === 'video') {
    return <HiOutlineFilm className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />;
  }
  if (mode === 'image') {
    return <HiOutlinePhoto className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />;
  }
  if (mode === 'ask') {
    return <LuMessageSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />;
  }
  return <LuInfinity className="h-4 w-4 shrink-0" strokeWidth={2.25} />;
}

function buildInteractionModeOptions(
  allowedModes: ComposerInteractionMode[],
  t: (key: string) => string
): Array<{ key: ComposerInteractionMode; label: string; icon: ReactNode }> {
  const all: Array<{ key: ComposerInteractionMode; label: string; icon: ReactNode }> = [
    {
      key: 'agent',
      label: t('agent.interactionAgent'),
      icon: <LuInfinity className="h-4 w-4 shrink-0" strokeWidth={2.25} />,
    },
    {
      key: 'ask',
      label: t('agent.interactionAsk'),
      icon: <LuMessageSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />,
    },
    {
      key: 'image',
      label: t('agent.interactionImage'),
      icon: <HiOutlinePhoto className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />,
    },
    {
      key: 'video',
      label: t('agent.interactionVideo'),
      icon: <HiOutlineFilm className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />,
    },
  ];
  return all.filter((item) => allowedModes.includes(item.key));
}

function ComposerInteractionModePicker({
  interactionMode,
  disabled,
  modeMenuOpen,
  onModeMenuOpenChange,
  onInteractionModeChange,
  allowedModes,
  t,
}: {
  interactionMode: ComposerInteractionMode;
  disabled?: boolean;
  modeMenuOpen: boolean;
  onModeMenuOpenChange: (open: boolean) => void;
  onInteractionModeChange: (mode: ComposerInteractionMode) => void;
  allowedModes: ComposerInteractionMode[];
  t: (key: string) => string;
}): ReactNode {
  const modes = buildInteractionModeOptions(allowedModes, t);
  if (modes.length <= 1) return null;
  return (
    <Dropdown
      trigger="click"
      placement="top-start"
      strategy="fixed"
      offset={8}
      open={modeMenuOpen}
      onOpenChange={onModeMenuOpenChange}
      items={[]}
      floatingClassName="z-[90]"
      referenceClassName="inline-flex"
      popupRender={() => (
        <DropdownPanel className="min-w-[9.5rem] p-1">
          {modes.map((m) => {
            const active = interactionMode === m.key;
            return (
              <DropdownPanelItem
                key={m.key}
                selected={active}
                className="gap-2 pr-2"
                onClick={() => {
                  onInteractionModeChange(m.key);
                  onModeMenuOpenChange(false);
                }}
              >
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center justify-center',
                    active ? 'text-[var(--ink)]' : 'text-[var(--ink)]/75'
                  )}
                >
                  {m.icon}
                </span>
                <span className="min-w-0 flex-1 truncate text-left">{m.label}</span>
                {active ? (
                  <HiCheck
                    className="h-3.5 w-3.5 shrink-0 text-[var(--ink)]"
                    strokeWidth={2}
                    aria-hidden
                  />
                ) : (
                  <span className="inline-block h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
              </DropdownPanelItem>
            );
          })}
        </DropdownPanel>
      )}
    >
      <button
        type="button"
        aria-label={interactionModeLabel(interactionMode, t)}
        aria-expanded={modeMenuOpen}
        disabled={disabled}
        className={cn(
          'inline-flex h-7 max-w-[9.5rem] shrink-0 items-center gap-1 rounded-xl px-2 text-[12px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)] disabled:opacity-40',
          modeMenuOpen && TOOL_ICON_BTN_ACTIVE
        )}
      >
        {interactionModeIcon(interactionMode)}
        <span className="min-w-0 truncate">{interactionModeLabel(interactionMode, t)}</span>
        {modeMenuOpen ? (
          <HiChevronUp className="h-3 w-3 shrink-0 opacity-70" strokeWidth={2} aria-hidden />
        ) : (
          <HiChevronDown className="h-3 w-3 shrink-0 opacity-70" strokeWidth={2} aria-hidden />
        )}
      </button>
    </Dropdown>
  );
}

function buildAttachPlusButton(opts: {
  genMediaMode: boolean;
  disabled?: boolean;
  sending?: boolean;
  onAttachFiles?: (files: File[], opts?: { mention?: boolean }) => void;
  attachTooltip?: string;
  t: (key: string) => string;
  onClick: () => void;
  icon?: 'plus' | 'image';
}): ReactNode {
  const IconGlyph = opts.icon === 'image' ? HiOutlinePhoto : HiOutlinePlus;
  return (
    <button
      type="button"
      disabled={opts.disabled || opts.sending || !opts.onAttachFiles}
      aria-label={opts.attachTooltip || opts.t('agent.uploadImage')}
      onClick={opts.onClick}
      className={opts.genMediaMode ? composerAttachActionClass() : TOOL_ICON_BTN}
    >
      <IconGlyph className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}

function buildPickFromCanvasButton(opts: {
  genMediaMode: boolean;
  disabled?: boolean;
  sending?: boolean;
  active?: boolean;
  tooltip: string;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      disabled={opts.disabled || opts.sending}
      aria-label={opts.tooltip}
      aria-pressed={opts.active || false}
      onClick={opts.onClick}
      className={
        opts.genMediaMode
          ? composerAttachActionClass(opts.active)
          : cn(TOOL_ICON_BTN, opts.active && TOOL_ICON_BTN_ACTIVE)
      }
    >
      <HiOutlineViewfinderCircle className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}

/**
 * Shared agent composer card — input + toolbar (attach / model / send).
 * Used for both the dock footer and in-place message edit.
 */
function AgentComposerShell({
  inputRef,
  contexts,
  onContextsChange,
  value,
  onChange,
  onSubmit,
  sending = false,
  onStop,
  onEscape,
  disabled,
  placeholder,
  leadingActions,
  canSend,
  sendDisabledReason,
  onAttachFiles,
  attachTooltip,
  onPickFromCanvas,
  pickingFromCanvas = false,
  pickFromCanvasTooltip,
  flyLandId,
  showDesignSizePicker = true,
  imageAspectRatio,
  onImageAspectRatioChange,
  aspectMenuPlacement = 'bottom-start',
  interactionMode,
  onInteractionModeChange,
  allowedInteractionModes,
  imageModeControls = null,
  videoModeControls = null,
  modelButtonProps,
  className,
  submitLabel,
  showInteractionModePicker = true,
  showModelButton = true,
  sendVariant = 'circle',
  sendTone = 'ink',
  trailingActions,
  attachIcon = 'plus',
}: Props): ReactNode {
  const { t } = useTranslation();
  const billingEnabled = useBillingEnabled();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [aspectOpen, setAspectOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
  const [videoSettingsOpen, setVideoSettingsOpen] = useState(false);
  const allowedModes =
    allowedInteractionModes && allowedInteractionModes.length
      ? allowedInteractionModes
      : DEFAULT_INTERACTION_MODES;

  const sendButtonTitle = sendDisabledReason || t('agent.send');

  const attachments = contexts.filter((c) => c.kind === 'attachment');
  // Keep the same array identity when there are no attachments so the
  // contenteditable sync effect does not re-fire on every parent render.
  const inlineContexts =
    attachments.length === 0
      ? contexts
      : contexts.filter((c) => c.kind !== 'attachment');
  const isImageMode = interactionMode === 'image' && Boolean(imageModeControls);
  const isVideoMode = interactionMode === 'video' && Boolean(videoModeControls);
  const isGenMediaMode = isImageMode || isVideoMode;
  // Top attach strip (image/video mode always, or agent/ask after upload) must not steal typing height.
  const hasTopAttachRow = isGenMediaMode || attachments.length > 0;
  const inputMinClass = hasTopAttachRow ? 'min-h-[72px]' : 'min-h-[26px]';
  const showAspectBtn =
    !isGenMediaMode &&
    showDesignSizePicker &&
    typeof imageAspectRatio === 'string' &&
    typeof onImageAspectRatioChange === 'function';

  const imageSettingsSummary = imageModeControls
    ? `${imageModeControls.resolution} · ${
        String(imageModeControls.aspectRatio).trim() === 'smart'
          ? t('agent.ratioSmart')
          : imageModeControls.aspectRatio
      } · ${t('agent.genCountN', { count: imageModeControls.imageCount })}`
    : '';

  const videoSettingsSummary = videoModeControls
    ? `${videoModeControls.resolution} · ${videoModeControls.aspectRatio} · ${videoModeControls.duration}s`
    : '';

  const aspectFloating = useFloating({
    open: aspectOpen,
    onOpenChange: setAspectOpen,
    placement: aspectMenuPlacement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({
        padding: 12,
        fallbackPlacements:
          aspectMenuPlacement.startsWith('bottom')
            ? ['bottom-end', 'top-start', 'top-end']
            : ['top-end', 'bottom-start', 'bottom-end'],
      }),
      shift({ padding: 12 }),
    ],
  });
  const aspectIx = useInteractions([
    useClick(aspectFloating.context),
    useDismiss(aspectFloating.context),
  ]);

  useEffect(() => {
    if (!showAspectBtn) setAspectOpen(false);
  }, [showAspectBtn]);

  useEffect(() => {
    if (allowedModes.length <= 1) setModeMenuOpen(false);
  }, [allowedModes]);

  useEffect(() => {
    if (!isImageMode) setImageSettingsOpen(false);
    if (!isVideoMode) setVideoSettingsOpen(false);
  }, [isImageMode, isVideoMode]);

  const removeAttachment = (key: string) => {
    onContextsChange(contexts.filter((c) => c.key !== key));
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) onAttachFiles?.(files);
  };

  const onPasteImages = (files: File[]) => {
    if (!files.length || !onAttachFiles) return;
    // Attachment strip only — do not insert inline @ mention chips.
    onAttachFiles(files);
  };

  const attachPlusBtn = buildAttachPlusButton({
    genMediaMode: isGenMediaMode,
    disabled,
    sending,
    onAttachFiles,
    attachTooltip,
    t,
    onClick: () => fileInputRef.current?.click(),
    icon: attachIcon,
  });

  const pickCanvasTooltip =
    pickFromCanvasTooltip || t('agent.pickFromCanvas');
  const pickFromCanvasBtn = onPickFromCanvas
    ? buildPickFromCanvasButton({
        genMediaMode: isGenMediaMode,
        disabled,
        sending,
        active: pickingFromCanvas,
        tooltip: pickCanvasTooltip,
        onClick: onPickFromCanvas,
      })
    : null;

  const sendFill =
    sendTone === 'ink'
      ? 'bg-[var(--ink)] text-[var(--on-brand)]'
      : 'bg-[var(--home-cta)] text-white';
  const squareSendBtn = cn(
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-opacity',
    sendFill
  );
  const circleSendBtn = cn(
    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-opacity',
    sendFill
  );
  /** Icon send / stop — shape from sendVariant; color from sendTone. */
  const iconSendBtn = sendVariant === 'square' ? squareSendBtn : circleSendBtn;
  /** Credit send pill — same tone as icon send. */
  const creditSendBtn = cn(
    'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold transition disabled:opacity-40',
    sendFill
  );

  const aspectButton = showAspectBtn ? (
    <button
      type="button"
      ref={aspectFloating.refs.setReference}
      aria-label={t('agent.designCanvasSizeAria')}
      aria-expanded={aspectOpen}
      aria-haspopup="dialog"
      disabled={disabled}
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)] disabled:opacity-40',
        aspectOpen && TOOL_ICON_BTN_ACTIVE
      )}
      {...aspectIx.getReferenceProps()}
    >
      <AspectRatioGlyph
        ratio={isCanvasSizeAutoHint(imageAspectRatio) ? 'smart' : String(imageAspectRatio || '1:1')}
        size={14}
        className="shrink-0"
      />
    </button>
  ) : null;

  return (
    <div
      className={cn(
        'flex flex-col px-3.5 pb-2 pt-2',
        className,
        // Keep typing room when a top attach row is present (after className so callers can't shrink it).
        hasTopAttachRow && 'min-h-[180px]'
      )}
    >
      {isGenMediaMode ? (
        // Same top attach row as the canvas Image / Video Generator card.
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5 pb-0.5">
          {attachments.map((a) => (
            <ComposerAttachmentChip
              key={a.key}
              attachment={a}
              disabled={disabled || sending}
              onRemove={removeAttachment}
            />
          ))}
          <Tooltip
            tip={
              attachTooltip ||
              (isVideoMode ? t('editor.tools.videoGenRef') : t('agent.uploadImage'))
            }
            placement="top"
          >
            {attachPlusBtn}
          </Tooltip>
          {pickFromCanvasBtn ? (
            <Tooltip tip={pickCanvasTooltip} placement="top">
              {pickFromCanvasBtn}
            </Tooltip>
          ) : null}
        </div>
      ) : (
        <AttachmentStrip
          attachments={attachments}
          disabled={disabled}
          onRemove={removeAttachment}
        />
      )}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer padding to focus; keyboard tabs into contenteditable */}
      <div
        className={cn('flex flex-1 cursor-text items-start', inputMinClass, 'max-h-[140px] overflow-hidden')}
        onClick={(e) => {
          // Clicks inside the contenteditable already place the caret — don't steal it to end.
          if ((e.target as HTMLElement | null)?.closest?.('[data-agent-composer]')) return;
          const r = inputRef as { current?: AgentComposerHandle | null } | null;
          r?.current?.focus();
        }}
      >
        <AgentComposerInput
          ref={inputRef}
          contexts={inlineContexts}
          onContextsChange={(next) => {
            onContextsChange([...attachments, ...next]);
          }}
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          onEscape={onEscape}
          disabled={disabled}
          placeholder={placeholder}
          flyLandId={flyLandId}
          onPasteImages={onAttachFiles ? onPasteImages : undefined}
          className={hasTopAttachRow ? 'min-h-[72px]' : undefined}
        />
      </div>
      <div className="mt-1 flex w-full items-center gap-1.5">
        {showInteractionModePicker && interactionMode && onInteractionModeChange ? (
          <ComposerInteractionModePicker
            interactionMode={interactionMode}
            disabled={disabled}
            modeMenuOpen={modeMenuOpen}
            onModeMenuOpenChange={setModeMenuOpen}
            onInteractionModeChange={onInteractionModeChange}
            allowedModes={allowedModes}
            t={t}
          />
        ) : null}
        {aspectButton}
        {leadingActions}

        {isImageMode && imageModeControls ? (
          <Dropdown
            trigger="click"
            placement="top-start"
            strategy="fixed"
            offset={8}
            open={imageSettingsOpen}
            onOpenChange={setImageSettingsOpen}
            items={[]}
            floatingClassName="z-[90]"
            referenceClassName="inline-flex min-w-0"
            popupRender={() => (
              <DropdownPanel
                className="w-[min(26rem,calc(100vw-2rem))] p-3"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <p className="mb-2.5 text-[13px] font-semibold text-[var(--ink)]">
                  {t('editor.tools.imageSettings')}
                </p>
                <ImageAspectRatioPicker
                  variant="image"
                  resolution={imageModeControls.resolution}
                  aspectRatio={imageModeControls.aspectRatio}
                  imageCount={imageModeControls.imageCount}
                  imageLimits={imageModeControls.imageLimits}
                  onResolutionChange={imageModeControls.onResolutionChange}
                  onAspectRatioChange={imageModeControls.onAspectRatioChange}
                  onImageCountChange={imageModeControls.onImageCountChange}
                  disabled={disabled || sending}
                />
              </DropdownPanel>
            )}
          >
            <button
              type="button"
              disabled={disabled || sending}
              aria-label={t('editor.tools.imageSettings')}
              aria-expanded={imageSettingsOpen}
              className={cn(
                'inline-flex h-7 max-w-[min(100%,12rem)] shrink-0 items-center gap-1 truncate rounded-xl px-2 text-[12px] font-medium tabular-nums transition-colors disabled:opacity-40',
                imageSettingsOpen
                  ? 'bg-[var(--accent-soft)] text-[var(--ink)]'
                  : 'text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]'
              )}
            >
              <span className="truncate">{imageSettingsSummary}</span>
            </button>
          </Dropdown>
        ) : null}

        {isVideoMode && videoModeControls ? (
          <Dropdown
            trigger="click"
            placement="top-start"
            strategy="fixed"
            offset={8}
            open={videoSettingsOpen}
            onOpenChange={setVideoSettingsOpen}
            items={[]}
            floatingClassName="z-[90]"
            referenceClassName="inline-flex min-w-0"
            popupRender={() => (
              <DropdownPanel
                className="w-[min(26rem,calc(100vw-2rem))] p-3"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <p className="mb-2.5 text-[13px] font-semibold text-[var(--ink)]">
                  {t('editor.tools.videoSettings')}
                </p>
                <VideoComposerSettingsPanel
                  aspectRatio={videoModeControls.aspectRatio}
                  resolution={videoModeControls.resolution}
                  duration={videoModeControls.duration}
                  onAspectRatioChange={videoModeControls.onAspectRatioChange}
                  onResolutionChange={videoModeControls.onResolutionChange}
                  onDurationChange={videoModeControls.onDurationChange}
                  disabled={disabled || sending}
                />
              </DropdownPanel>
            )}
          >
            <button
              type="button"
              disabled={disabled || sending}
              aria-label={t('editor.tools.videoSettings')}
              aria-expanded={videoSettingsOpen}
              className={cn(
                'inline-flex h-7 max-w-[min(100%,12rem)] shrink-0 items-center gap-1 truncate rounded-xl px-2 text-[12px] font-medium tabular-nums transition-colors disabled:opacity-40',
                videoSettingsOpen
                  ? 'bg-[var(--accent-soft)] text-[var(--ink)]'
                  : 'text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]'
              )}
            >
              <span className="truncate">{videoSettingsSummary}</span>
            </button>
          </Dropdown>
        ) : null}

        {!isGenMediaMode &&
        showModelButton &&
        modelButtonProps.variant !== 'chip' &&
        modelButtonProps.panel != null &&
        modelButtonProps.onOpenChange ? (
          <Dropdown
            trigger="click"
            placement={modelButtonProps.panelPlacement ?? 'top-start'}
            strategy="fixed"
            offset={8}
            open={modelButtonProps.open}
            onOpenChange={modelButtonProps.onOpenChange}
            items={[]}
            nestedDismissGuard="[data-agent-route-submenu], .rcb-agent-route-submenu-popup"
            floatingClassName="z-[80]"
            referenceClassName="inline-flex"
            popupRender={() => (
              <div className="max-w-full" onPointerDown={(e) => e.stopPropagation()}>
                {modelButtonProps.panel}
              </div>
            )}
          >
            <button
              type="button"
              aria-label={modelButtonProps.label || t('agent.selectModel')}
              aria-expanded={modelButtonProps.open}
              className={cn(TOOL_ICON_BTN, modelButtonProps.open && TOOL_ICON_BTN_ACTIVE)}
            >
              {modelButtonProps.icon ?? (
                <Icon name="editor-model-cube" width={16} height={16} />
              )}
            </button>
          </Dropdown>
        ) : !isGenMediaMode && showModelButton && modelButtonProps.variant !== 'chip' ? (
          <button
            type="button"
            ref={modelButtonProps.ref}
            aria-label={modelButtonProps.label || t('agent.selectModel')}
            aria-expanded={modelButtonProps.open}
            className={cn(TOOL_ICON_BTN, modelButtonProps.open && TOOL_ICON_BTN_ACTIVE)}
            {...(modelButtonProps.getReferenceProps?.({
              onClick: modelButtonProps.onClick,
            }) ?? { onClick: modelButtonProps.onClick })}
          >
            {modelButtonProps.icon ?? (
              <Icon name="editor-model-cube" width={16} height={16} />
            )}
          </button>
        ) : null}

        {!isGenMediaMode &&
        showModelButton &&
        modelButtonProps.variant === 'chip' &&
        modelButtonProps.panel != null &&
        modelButtonProps.onOpenChange ? (
          <Dropdown
            trigger="click"
            placement={modelButtonProps.panelPlacement ?? 'top-start'}
            strategy="fixed"
            offset={8}
            open={modelButtonProps.open}
            onOpenChange={modelButtonProps.onOpenChange}
            items={[]}
            nestedDismissGuard="[data-agent-route-submenu], .rcb-agent-route-submenu-popup"
            floatingClassName="z-[80]"
            referenceClassName="inline-flex"
            popupRender={() => (
              <div className="max-w-full" onPointerDown={(e) => e.stopPropagation()}>
                {modelButtonProps.panel}
              </div>
            )}
          >
            <button
              type="button"
              aria-label={modelButtonProps.label || t('agent.selectModel')}
              aria-expanded={modelButtonProps.open}
              className={
                modelButtonProps.label
                  ? cn(
                      'inline-flex h-7 max-w-[14rem] shrink-0 items-center rounded-xl px-2 text-[12px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]',
                      modelButtonProps.open && TOOL_ICON_BTN_ACTIVE
                    )
                  : cn(TOOL_ICON_BTN, modelButtonProps.open && TOOL_ICON_BTN_ACTIVE)
              }
            >
              {modelButtonProps.label ? (
                <span className="inline-flex max-w-[14rem] items-center gap-1 truncate">
                  <span className="truncate">{modelButtonProps.label}</span>
                  {modelButtonProps.labelSuffix ? (
                    <span className="shrink-0 text-[11px] font-normal opacity-70">
                      {modelButtonProps.labelSuffix}
                    </span>
                  ) : null}
                </span>
              ) : (
                modelButtonProps.icon ?? (
                  <Icon name="editor-model-cube" width={16} height={16} />
                )
              )}
            </button>
          </Dropdown>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          {trailingActions}
          {!isGenMediaMode ? (
            <>
              <Tooltip tip={attachTooltip || t('agent.uploadImage')} placement="top">
                {attachPlusBtn}
              </Tooltip>
              {pickFromCanvasBtn ? (
                <Tooltip tip={pickCanvasTooltip} placement="top">
                  {pickFromCanvasBtn}
                </Tooltip>
              ) : null}
            </>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept={
              isVideoMode
                ? 'image/*,video/*,.mp4,.webm,.mov,.m4v'
                : interactionMode === 'ask' || isImageMode
                  ? 'image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.svg'
                  : 'image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml,video/*,.png,.jpg,.jpeg,.webp,.gif,.svg,.mp4,.webm,.mov,.m4v'
            }
            multiple
            className="hidden"
            onChange={onFileChange}
          />
          {isImageMode && imageModeControls ? (
            <>
              <Dropdown
                trigger="click"
                placement="top-end"
                strategy="fixed"
                offset={8}
                open={imageModeControls.modelOpen}
                onOpenChange={imageModeControls.onModelOpenChange}
                items={[]}
                floatingClassName="z-[90]"
                referenceClassName="inline-flex"
                popupRender={() => (
                  <div className="max-w-full" onPointerDown={(e) => e.stopPropagation()}>
                    {imageModeControls.modelPanel}
                  </div>
                )}
              >
                <button
                  type="button"
                  disabled={disabled || sending}
                  title={imageModeControls.modelLabel}
                  aria-label={imageModeControls.modelLabel}
                  className={cn(TOOL_ICON_BTN, 'disabled:opacity-40')}
                >
                  {imageModeControls.modelIcon}
                </button>
              </Dropdown>
              {sending ? (
                <button
                  type="button"
                  aria-label={t('agent.stop')}
                  title={t('agent.stop')}
                  onClick={() => onStop?.()}
                  className={billingEnabled ? creditSendBtn : cn(iconSendBtn, 'hover:opacity-90')}
                >
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-current" aria-hidden />
                </button>
              ) : billingEnabled ? (
                <button
                  type="button"
                  aria-label={t('agent.send')}
                  disabled={!canSend}
                  onClick={onSubmit}
                  title={
                    sendDisabledReason ||
                    t('wallet.creditCostTip', {
                      count: imageModeControls.creditCost,
                    })
                  }
                  className={creditSendBtn}
                >
                  <HiOutlineBolt className="h-3.5 w-3.5" strokeWidth={2} />
                  <span className="tabular-nums">{imageModeControls.creditCost}</span>
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={t('agent.send')}
                  title={sendButtonTitle}
                  disabled={!canSend}
                  onClick={onSubmit}
                  className={cn(iconSendBtn, 'hover:opacity-90 disabled:opacity-35')}
                >
                  <HiArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              )}
            </>
          ) : isVideoMode && videoModeControls ? (
            <>
              <Dropdown
                trigger="click"
                placement="top-end"
                strategy="fixed"
                offset={8}
                open={videoModeControls.modelOpen}
                onOpenChange={videoModeControls.onModelOpenChange}
                items={[]}
                floatingClassName="z-[90]"
                referenceClassName="inline-flex"
                popupRender={() => (
                  <div className="max-w-full" onPointerDown={(e) => e.stopPropagation()}>
                    {videoModeControls.modelPanel}
                  </div>
                )}
              >
                <button
                  type="button"
                  disabled={disabled || sending}
                  title={videoModeControls.modelLabel}
                  aria-label={videoModeControls.modelLabel}
                  className={cn(TOOL_ICON_BTN, 'disabled:opacity-40')}
                >
                  {videoModeControls.modelIcon}
                </button>
              </Dropdown>
              {sending ? (
                <button
                  type="button"
                  aria-label={t('agent.stop')}
                  title={t('agent.stop')}
                  onClick={() => onStop?.()}
                  className={billingEnabled ? creditSendBtn : cn(iconSendBtn, 'hover:opacity-90')}
                >
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-current" aria-hidden />
                </button>
              ) : billingEnabled ? (
                <button
                  type="button"
                  aria-label={t('agent.send')}
                  disabled={!canSend}
                  onClick={onSubmit}
                  title={
                    sendDisabledReason ||
                    t('wallet.creditCostTip', {
                      count: videoModeControls.creditCost,
                    })
                  }
                  className={creditSendBtn}
                >
                  <HiOutlineBolt className="h-3.5 w-3.5" strokeWidth={2} />
                  <span className="tabular-nums">{videoModeControls.creditCost}</span>
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={t('agent.send')}
                  title={sendButtonTitle}
                  disabled={!canSend}
                  onClick={onSubmit}
                  className={cn(iconSendBtn, 'hover:opacity-90 disabled:opacity-35')}
                >
                  <HiArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              )}
            </>
          ) : sending ? (
            <button
              type="button"
              aria-label={t('agent.stop')}
              title={t('agent.stop')}
              onClick={() => onStop?.()}
              className={cn(iconSendBtn, 'hover:opacity-90')}
            >
              <span className="h-2.5 w-2.5 rounded-[2px] bg-current" aria-hidden />
            </button>
          ) : submitLabel ? (
            <button
              type="button"
              aria-label={submitLabel}
              title={sendDisabledReason || submitLabel}
              disabled={!canSend}
              onClick={onSubmit}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl bg-[var(--ink)] px-4 text-[13px] font-medium text-[var(--on-brand)] transition-opacity disabled:opacity-35"
            >
              {submitLabel}
            </button>
          ) : (
            <button
              type="button"
              aria-label={t('agent.send')}
              title={sendButtonTitle}
              disabled={!canSend}
              onClick={onSubmit}
              className={cn(iconSendBtn, 'hover:opacity-90 disabled:opacity-35')}
            >
              <HiArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {showAspectBtn && aspectOpen ? (
        <FloatingPortal>
          <div
            ref={aspectFloating.refs.setFloating}
            style={aspectFloating.floatingStyles}
            className="z-[80] w-max max-w-[calc(100vw-24px)]"
            {...aspectIx.getFloatingProps({
              onPointerDown: (e) => e.stopPropagation(),
            })}
          >
            <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] p-0 shadow-[0_12px_40px_rgba(0,0,0,0.18)]">
              <ImageAspectRatioPicker
                variant="design"
                aspectRatio={imageAspectRatio!}
                onAspectRatioChange={(ratio, opts) => {
                  onImageAspectRatioChange?.(ratio);
                  if (!opts?.keepOpen) setAspectOpen(false);
                }}
                disabled={disabled}
              />
            </div>
          </div>
        </FloatingPortal>
      ) : null}
    </div>
  );
}

export default memo(AgentComposerShell);

const MemoizedComposerAttachmentChip = memo(ComposerAttachmentChip);
export { MemoizedComposerAttachmentChip as ComposerAttachmentChip };
