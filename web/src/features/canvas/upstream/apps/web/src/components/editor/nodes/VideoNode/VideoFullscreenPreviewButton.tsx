/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/VideoNode/VideoFullscreenPreviewButton.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode, memo } from 'react';
import { createPortal } from '@/features/canvas/adapters/recombynReactDom';
import { useTranslation } from 'react-i18next';
import { HiOutlineXMark } from 'react-icons/hi2';
import { RiFullscreenFill } from 'react-icons/ri';
import Tooltip from '@recombyn-native/components/base/tooltip';
import PreviewToolbar from '@recombyn-native/components/base/image/PreviewToolbar';
import VideoJsPlayer, {
  usePlayableVideoSrc,
  type VideoCropNorm,
} from '@recombyn-native/components/editor/nodes/VideoNode/VideoJsPlayer';
import { videoToolBtn } from './videoToolbarShared';

const MIN_SCALE = 0.5;
const MAX_SCALE = 5;
/** Same default box as Image lightbox (`Image.tsx` preview). */
const PREVIEW_MAX_PX = 700;

function readCrop(attrs: {
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
}): VideoCropNorm | null {
  const x = Number(attrs.cropX);
  const y = Number(attrs.cropY);
  const w = Number(attrs.cropW);
  const h = Number(attrs.cropH);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w <= 0 ||
    h <= 0
  ) {
    return null;
  }
  if (x <= 0.001 && y <= 0.001 && w >= 0.999 && h >= 0.999) return null;
  return { x, y, w, h };
}

export type VideoFullscreenPreviewProps = {
  open: boolean;
  onClose: () => void;
  src?: string | null;
  poster?: string | null;
  uploadKey?: string | null;
  aspectWidth?: number;
  aspectHeight?: number;
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
  trimStart?: number;
  trimEnd?: number;
  flipX?: boolean;
  flipY?: boolean;
  duration?: number;
};

/**
 * Fullscreen lightbox portal — used by toolbar button and hover playback bar.
 */
export function VideoFullscreenPreview({
  open,
  onClose,
  src,
  poster,
  uploadKey,
  aspectWidth,
  aspectHeight,
  cropX,
  cropY,
  cropW,
  cropH,
  trimStart,
  trimEnd,
  flipX,
  flipY,
  duration,
}: VideoFullscreenPreviewProps): ReactNode {
  const [scale, setScale] = useState(1);
  // Intrinsic media size — prefer props, then decoded video (never default to 9:16).
  const [mediaSize, setMediaSize] = useState<{ width: number; height: number } | null>(
    () => {
      const aw = Number(aspectWidth);
      const ah = Number(aspectHeight);
      if (aw > 0 && ah > 0) return { width: aw, height: ah };
      return null;
    }
  );
  const url = String(src || '').trim();
  const playSrc = usePlayableVideoSrc(url, uploadKey);
  const crop = readCrop({ cropX, cropY, cropW, cropH });
  const posterUrl = String(poster || '').trim() || undefined;

  useEffect(() => {
    const aw = Number(aspectWidth);
    const ah = Number(aspectHeight);
    if (aw > 0 && ah > 0) setMediaSize({ width: aw, height: ah });
  }, [aspectWidth, aspectHeight]);

  const aw = Math.max(1, mediaSize?.width || 16);
  const ah = Math.max(1, mediaSize?.height || 9);

  const close = useCallback(() => {
    setScale(1);
    onClose();
  }, [onClose]);

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(s * 1.2, MAX_SCALE));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((s) => Math.max(s / 1.2, MIN_SCALE));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setScale((s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s + delta)));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) setScale(1);
  }, [open]);

  if (!open || !url || typeof document === 'undefined') return null;

  const fit = Math.min(PREVIEW_MAX_PX / aw, PREVIEW_MAX_PX / ah);
  const baseW = aw * fit;
  const baseH = ah * fit;
  const frameStyle: CSSProperties = {
    width: baseW,
    height: baseH,
    transform: `scale(${scale})`,
    transformOrigin: 'center center',
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[2500]"
      onClick={close}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation?.();
      }}
    >
      <div className="fixed inset-0 bg-black/50" />
      <button
        type="button"
        aria-label="Close"
        className="absolute right-4 top-4 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
        onClick={close}
      >
        <HiOutlineXMark className="h-5 w-5" />
      </button>
      <div className="pointer-events-none fixed inset-0 flex items-center justify-center overflow-hidden">
        <div
          className="pointer-events-auto relative overflow-hidden rounded-lg bg-black shadow-2xl"
          style={frameStyle}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="absolute inset-0 overflow-hidden">
            {playSrc ? (
              <VideoJsPlayer
                src={playSrc}
                poster={posterUrl}
                layout="fill"
                objectFit="contain"
                controlsMode="hover"
                muted
                crop={crop}
                flipX={flipX === true}
                flipY={flipY === true}
                trimStart={Number.isFinite(Number(trimStart)) ? Number(trimStart) : undefined}
                trimEnd={Number.isFinite(Number(trimEnd)) ? Number(trimEnd) : undefined}
                knownDuration={
                  Number.isFinite(Number(duration)) && Number(duration) > 0
                    ? Number(duration)
                    : undefined
                }
                onMediaSize={(size) => {
                  if (!(size.width > 0 && size.height > 0)) return;
                  setMediaSize((prev) => {
                    if (
                      prev &&
                      Math.abs(prev.width - size.width) < 1 &&
                      Math.abs(prev.height - size.height) < 1
                    ) {
                      return prev;
                    }
                    return { width: size.width, height: size.height };
                  });
                }}
                className="absolute inset-0 h-full w-full"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[12px] text-white/60">
                …
              </div>
            )}
          </div>
        </div>
      </div>
      <PreviewToolbar scale={scale} onZoomIn={zoomIn} onZoomOut={zoomOut} />
    </div>,
    document.body
  );
}

/**
 * Toolbar fullscreen trigger + lightbox.
 */
function VideoFullscreenPreviewButton({
  src,
  poster,
  uploadKey,
  aspectWidth,
  aspectHeight,
  cropX,
  cropY,
  cropW,
  cropH,
  trimStart,
  trimEnd,
  flipX,
  flipY,
  duration,
}: Omit<VideoFullscreenPreviewProps, 'open' | 'onClose'>): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const url = String(src || '').trim();

  if (!url) return null;

  return (
    <>
      <Tooltip tip={t('editor.videoToolbar.fullscreen', { defaultValue: '全屏' })} placement="top">
        <button
          type="button"
          aria-label={t('editor.videoToolbar.fullscreen', { defaultValue: '全屏' })}
          className={videoToolBtn}
          onClick={() => setOpen(true)}
        >
          <RiFullscreenFill className="h-4 w-4 shrink-0" />
        </button>
      </Tooltip>
      <VideoFullscreenPreview
        open={open}
        onClose={() => setOpen(false)}
        src={src}
        poster={poster}
        uploadKey={uploadKey}
        aspectWidth={aspectWidth}
        aspectHeight={aspectHeight}
        cropX={cropX}
        cropY={cropY}
        cropW={cropW}
        cropH={cropH}
        trimStart={trimStart}
        trimEnd={trimEnd}
        flipX={flipX}
        flipY={flipY}
        duration={duration}
      />
    </>
  );
}

export default memo(VideoFullscreenPreviewButton);
