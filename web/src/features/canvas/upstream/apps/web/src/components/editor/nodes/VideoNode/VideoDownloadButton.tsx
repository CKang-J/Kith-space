/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/VideoNode/VideoDownloadButton.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useCallback, useState, type CSSProperties, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowDownTray } from 'react-icons/hi2';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from '@/features/canvas/adapters/recombynFloatingUi';
import { message, Tooltip } from '@recombyn-native/components/base';
import { DropdownPanel, DropdownPanelItem } from '@recombyn-native/components/base/dropdown/DropdownPanel';
import { exportVideoAudio } from '@recombyn-native/utils/audioExporter';
import { imageSrcToFile } from '@recombyn-native/utils/uploadImage';
import { cn } from '@recombyn-native/utils/classnames';
import { downloadFileBlob } from '@recombyn-native/components/rcb/scene/paint/exportImage';
import { videoToolBtn } from './videoToolbarShared';

type CropFractions = { x: number; y: number; w: number; h: number };

function readCrop(attrs: {
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
}): CropFractions | null {
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
  // Full-frame crop → treat as no crop.
  if (x <= 0.001 && y <= 0.001 && w >= 0.999 && h >= 0.999) return null;
  return { x, y, w, h };
}

function pickRecorderMime(): { mime: string; ext: string } {
  const candidates: { mime: string; ext: string }[] = [
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
    { mime: 'video/mp4', ext: 'mp4' },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime)) {
      return c;
    }
  }
  return { mime: 'video/webm', ext: 'webm' };
}

function waitEvent(el: HTMLMediaElement, type: string, timeoutMs = 12_000) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const onOk = () => {
      cleanup();
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const onErr = () => {
      cleanup();
      if (!settled) {
        settled = true;
        reject(new Error('media error'));
      }
    };
    const cleanup = () => {
      el.removeEventListener(type, onOk);
      el.removeEventListener('error', onErr);
      window.clearTimeout(timer);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      if (!settled) {
        settled = true;
        // Seeked often never fires when currentTime is already near the target.
        resolve();
      }
    }, timeoutMs);
    el.addEventListener(type, onOk, { once: true });
    el.addEventListener('error', onErr, { once: true });
  });
}

/**
 * Re-encode display crop + flip (+ optional trim) via canvas + MediaRecorder.
 * Crops are fractions of the source frame (same as node attrs).
 */
export async function exportCroppedVideoBlob(opts: {
  file: File;
  crop: CropFractions | null;
  flipX?: boolean;
  flipY?: boolean;
  trimStart?: number;
  trimEnd?: number;
}): Promise<{ blob: Blob; ext: string }> {
  const objectUrl = URL.createObjectURL(opts.file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = objectUrl;

  try {
    await waitEvent(video, 'loadedmetadata');
    if (video.readyState < 2) {
      video.load();
      await waitEvent(video, 'loadeddata');
    }

    const duration = Number(video.duration) || 0;
    let start = Number.isFinite(opts.trimStart) ? Math.max(0, Number(opts.trimStart)) : 0;
    let end =
      Number.isFinite(opts.trimEnd) && Number(opts.trimEnd) > 0
        ? Math.min(duration, Number(opts.trimEnd))
        : duration;
    if (!duration || end <= start + 0.05) {
      start = 0;
      end = duration;
    }

    const vw = Math.max(1, video.videoWidth || 1);
    const vh = Math.max(1, video.videoHeight || 1);
    const crop = opts.crop || { x: 0, y: 0, w: 1, h: 1 };
    const sx = Math.max(0, Math.min(vw - 1, crop.x * vw));
    const sy = Math.max(0, Math.min(vh - 1, crop.y * vh));
    const sw = Math.max(2, Math.min(vw - sx, crop.w * vw));
    const sh = Math.max(2, Math.min(vh - sy, crop.h * vh));

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(sw));
    canvas.height = Math.max(2, Math.round(sh));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unsupported');

    const canvasStream = canvas.captureStream(30);
    // Prefer live audio from the playing element when the browser allows it.
    try {
      const mediaStream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
      mediaStream?.getAudioTracks().forEach((track) => {
        canvasStream.addTrack(track);
      });
    } catch {
      /* silent video export is still useful */
    }

    const { mime, ext } = pickRecorderMime();
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(canvasStream, { mimeType: mime });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const done = new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error('recorder error'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
    });

    video.currentTime = start;
    // If already near `start`, `seeked` may never fire — waitEvent times out as resolve.
    if (Math.abs((Number(video.currentTime) || 0) - start) > 0.04) {
      await waitEvent(video, 'seeked', 8_000);
    }

    recorder.start(200);
    await video.play();

    const clipMs = Math.max(200, (end - start) * 1000);
    await new Promise<void>((resolve, reject) => {
      let stopped = false;
      const finish = () => {
        if (stopped) return;
        stopped = true;
        window.clearTimeout(watchdog);
        try {
          video.pause();
        } catch {
          /* ignore */
        }
        try {
          if (recorder.state !== 'inactive') recorder.stop();
        } catch {
          /* ignore */
        }
        resolve();
      };

      // Hard stop so export never hangs forever if frame callbacks stall.
      const watchdog = window.setTimeout(finish, clipMs + 4_000);

      const flipX = opts.flipX === true;
      const flipY = opts.flipY === true;
      const paint = () => {
        if (stopped) return;
        try {
          ctx.save();
          if (flipX || flipY) {
            ctx.translate(flipX ? canvas.width : 0, flipY ? canvas.height : 0);
            ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
          }
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          ctx.restore();
        } catch (err) {
          reject(err instanceof Error ? err : new Error('draw failed'));
          finish();
          return;
        }
        if (video.ended || video.currentTime >= end - 0.04) {
          finish();
          return;
        }
        const rvfc = (
          video as HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: () => void) => number;
          }
        ).requestVideoFrameCallback;
        if (typeof rvfc === 'function') rvfc.call(video, paint);
        else requestAnimationFrame(paint);
      };

      video.addEventListener(
        'ended',
        () => {
          finish();
        },
        { once: true }
      );
      paint();
    });

    const blob = await done;
    if (!blob.size) throw new Error('empty export');
    return { blob, ext };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

function baseName(name?: string) {
  return (name || 'video').replace(/\.[^.]+$/, '') || 'video';
}

export type VideoNodeDownloadOpts = {
  src: string;
  name?: string;
  uploadKey?: string | null;
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
  trimStart?: number;
  trimEnd?: number;
  flipX?: boolean;
  flipY?: boolean;
};

/** Programmatic MP4 / audio download for toolbar + context menu. */
export async function downloadVideoNodeAsset(
  opts: VideoNodeDownloadOpts & { mode?: 'video' | 'audio' }
): Promise<'video' | 'audio'> {
  const url = String(opts.src || '').trim();
  if (!url) throw new Error('missing src');
  const mode = opts.mode === 'audio' ? 'audio' : 'video';
  const crop = readCrop({
    cropX: opts.cropX,
    cropY: opts.cropY,
    cropW: opts.cropW,
    cropH: opts.cropH,
  });
  const mirroredX = opts.flipX === true;
  const mirroredY = opts.flipY === true;
  const hasFlip = mirroredX || mirroredY;
  const hasTrim =
    (Number.isFinite(opts.trimStart) && Number(opts.trimStart) > 0) ||
    (Number.isFinite(opts.trimEnd) && Number(opts.trimEnd) > 0);
  const needsVideoExport = Boolean(crop) || hasFlip || hasTrim;
  const file = await imageSrcToFile(url, `${baseName(opts.name)}.mp4`, {
    uploadKey: opts.uploadKey || null,
  });

  if (mode === 'audio') {
    const { blob, ext } = await exportVideoAudio({
      file,
      trimStart: opts.trimStart,
      trimEnd: opts.trimEnd,
    });
    await downloadFileBlob(blob, `${baseName(opts.name)}.${ext}`);
    return 'audio';
  }

  if (!needsVideoExport) {
    await downloadFileBlob(file, `${baseName(opts.name)}.mp4`);
    return 'video';
  }

  const { blob, ext } = await exportCroppedVideoBlob({
    file,
    crop,
    flipX: mirroredX,
    flipY: mirroredY,
    trimStart: opts.trimStart,
    trimEnd: opts.trimEnd,
  });
  await downloadFileBlob(blob, `${baseName(opts.name)}-edit.${ext}`);
  return 'video';
}

/** Download trigger — dropdown with MP4 / MP3 (crop/flip/trim re-encodes when needed). */
function VideoDownloadButton({
  src,
  name,
  uploadKey,
  cropX,
  cropY,
  cropW,
  cropH,
  trimStart,
  trimEnd,
  flipX,
  flipY,
}: {
  src?: string | null;
  name?: string;
  uploadKey?: string | null;
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
  trimStart?: number;
  trimEnd?: number;
  flipX?: boolean;
  flipY?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const url = String(src || '').trim();

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
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
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

  const onDownload = useCallback(
    async (mode: 'video' | 'audio') => {
      if (busy || !url) return;
      setOpen(false);
      setBusy(true);
      const hideLoading = message.loading(
        t(
          mode === 'audio'
            ? 'editor.videoToolbar.exportingAudio'
            : 'editor.videoToolbar.exporting',
          {
            defaultValue: mode === 'audio' ? '正在导出音频…' : '正在导出视频…',
          }
        ),
        0
      );
      try {
        await downloadVideoNodeAsset({
          src: url,
          name,
          uploadKey,
          cropX,
          cropY,
          cropW,
          cropH,
          trimStart,
          trimEnd,
          flipX,
          flipY,
          mode,
        });
        hideLoading();
        message.success(
          t(mode === 'audio' ? 'editor.exportedAudio' : 'editor.exportedVideo', {
            defaultValue: mode === 'audio' ? '已导出音频' : '已导出视频',
          })
        );
      } catch (err) {
        hideLoading();
        console.warn('[video-download]', err);
        if (mode === 'audio') {
          const detail = err instanceof Error ? err.message : String(err || '');
          message.error(
            t('editor.videoToolbar.exportAudioFail', {
              defaultValue: '音频导出失败',
            }) + (detail ? `：${detail}` : '')
          );
          return;
        }
        // Fall back to original file so download still works if re-encode fails.
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          await downloadFileBlob(blob, `${baseName(name)}.mp4`);
          message.warning(
            t('editor.videoToolbar.exportFallback', {
              defaultValue: '裁剪导出失败，已下载原视频',
            })
          );
        } catch {
          try {
            window.open(url, '_blank', 'noopener,noreferrer');
          } catch {
            message.error(t('editor.videoToolbar.downloadFail', { defaultValue: '下载失败' }));
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      url,
      name,
      uploadKey,
      cropX,
      cropY,
      cropW,
      cropH,
      trimStart,
      trimEnd,
      flipX,
      flipY,
      t,
    ]
  );

  if (!url) return null;

  return (
    <>
      <Tooltip
        tip={t('editor.videoToolbar.download', { defaultValue: '下载' })}
        placement="top"
        disabled={open}
      >
        <button
          type="button"
          ref={refs.setReference}
          aria-label={t('editor.videoToolbar.download', { defaultValue: '下载' })}
          aria-expanded={open}
          disabled={busy}
          className={cn(videoToolBtn, (busy || open) && 'opacity-50', open && 'bg-[var(--accent-soft)]')}
          {...getReferenceProps({
            onClick: () => {
              if (busy) return;
              setOpen((v) => !v);
            },
          })}
        >
          <HiOutlineArrowDownTray className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        </button>
      </Tooltip>

      <FloatingPortal>
        {open ? (
          <div
            ref={refs.setFloating}
            style={floatingStyles as CSSProperties}
            className="z-[80]"
            data-video-download-menu=""
            {...getFloatingProps()}
          >
            <DropdownPanel className="min-w-[7.5rem]">
              <DropdownPanelItem
                disabled={busy}
                onClick={() => void onDownload('video')}
              >
                MP4
              </DropdownPanelItem>
              <DropdownPanelItem
                disabled={busy}
                onClick={() => void onDownload('audio')}
              >
                MP3
              </DropdownPanelItem>
            </DropdownPanel>
          </div>
        ) : null}
      </FloatingPortal>
    </>
  );
}

export default memo(VideoDownloadButton);
