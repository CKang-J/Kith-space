/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/VideoNode/VideoToolbarEditTools.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineCamera,
  HiOutlineChevronDown,
  HiOutlineScissors,
  HiOutlineSparkles,
} from 'react-icons/hi2';
import { LuCrop } from 'react-icons/lu';
import { MdOutlineFlip } from 'react-icons/md';
import { Dropdown, message } from '@recombyn-native/components/base';
import type { MenuItemType } from '@recombyn-native/components/base/dropdown';
import {
  captureVideoPosterFrame
} from '@recombyn-native/components/rcb/scene/document/nodeFactories';
import {
  captureFrameFromVideoEl,
  getVideoHoverHost,
} from '@recombyn-native/components/editor/nodes/VideoNode/VideoHoverPlayback';
import {
  failImageProcess,
  finishImageProcess,
  startImageUploadPlaceholder,
} from '@recombyn-native/store/modules/editor';
import {
  beginNodeUpload,
  finishNodeUpload,
  isUploadAbortError,
  uploadImageFromSrc,
  imageSrcToFile,
} from '@recombyn-native/utils/uploadImage';
import store from '@recombyn-native/store';
import { cn } from '@recombyn-native/utils/classnames';
import { videoToolBtn, VideoToolSep } from './videoToolbarShared';

/** Same 16×16 optical slot as image toolbar. */
const TOOL_ICON_SLOT =
  'pointer-events-none inline-flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:block [&>svg]:h-full [&>svg]:w-full';
const TOOL_ICON_STROKE = 1.75;
const SIBLING_GAP = 16;
const SEEK_TIMEOUT_MS = 700;

type ExtractMode = 'first' | 'at' | 'current';

function ToolIconSlot({ children }: { children: ReactNode }) {
  return <span className={TOOL_ICON_SLOT}>{children}</span>;
}

function Tool({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(videoToolBtn, active && 'bg-[var(--accent-soft)]')}
      onClick={onClick}
    >
      <ToolIconSlot>{children}</ToolIconSlot>
      <span>{label}</span>
    </button>
  );
}

function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const v = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = window.setTimeout(finish, 250);
    if (typeof v.requestVideoFrameCallback === 'function') {
      v.requestVideoFrameCallback(() => {
        window.clearTimeout(timer);
        finish();
      });
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.clearTimeout(timer);
        finish();
      });
    });
  });
}

function seekVideoEl(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve) => {
    const duration = Number(video.duration);
    const maxT =
      Number.isFinite(duration) && duration > 0 ? Math.max(0, duration - 0.05) : seconds;
    const target = Math.min(Math.max(0, seconds), maxT);
    if (Math.abs((Number(video.currentTime) || 0) - target) <= 0.04) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onDone);
      window.clearTimeout(timer);
      resolve();
    };
    const onSeeked = () => finish();
    const onDone = () => finish();
    const timer = window.setTimeout(finish, SEEK_TIMEOUT_MS);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onDone);
    try {
      video.currentTime = target;
    } catch {
      finish();
    }
  });
}

/** Capture the decoded frame at `atSeconds` from the live plate (playhead / first / scrub). */
async function captureFromLiveHost(
  nodeId: string,
  atSeconds: number
): Promise<string | null> {
  const host = getVideoHoverHost(nodeId);
  if (!host) return null;

  const target = Math.max(0, Number(atSeconds) || 0);

  // Only reuse freeze when it was captured at this playhead — never the stale poster.
  const freeze = String(host.getFreezeUrl() || '').trim();
  const freezeAt = Number(host.getFreezeAt()) || 0;
  if (
    (freeze.startsWith('data:') || freeze.startsWith('blob:')) &&
    Math.abs(freezeAt - target) <= 0.12
  ) {
    return freeze;
  }

  const video = host.getVideo();
  if (!video) return null;

  const wrap = host.getWrap();
  const prevVis = wrap?.style.visibility;
  // Hidden <video> often keeps an old decoded frame — force paint before capture.
  if (wrap) wrap.style.visibility = 'visible';

  const restore = Number(video.currentTime) || 0;
  const needSeek = Math.abs(restore - target) > 0.04;

  try {
    if (needSeek) await seekVideoEl(video, target);
    await waitForVideoFrame(video);
    // Second paint after seek — first RVFC can still be the previous frame on some browsers.
    if (needSeek) await waitForVideoFrame(video);
    const shot = captureFrameFromVideoEl(video);
    if (shot) return shot;

    const playable = String(video.currentSrc || video.src || '').trim();
    if (playable.startsWith('blob:') || playable.startsWith('data:')) {
      return await captureVideoPosterFrame(playable, target <= 0.01 ? 0.05 : target);
    }
    return null;
  } catch {
    return null;
  } finally {
    if (needSeek) {
      try {
        video.currentTime = restore;
      } catch {
        /* ignore */
      }
    }
    if (wrap) wrap.style.visibility = prevVis ?? '';
  }
}

/**
 * Always fetch via upload helpers (Bearer) then capture — never draw raw COS/CDN URLs
 * (CORS taints canvas / auth uploads 401).
 */
async function captureViaResolvedSrc(
  src: string,
  atSeconds: number,
  uploadKey?: string | null
): Promise<string> {
  const s = String(src || '').trim();
  if (!s) throw new Error('empty video src');
  if (s.startsWith('data:') || s.startsWith('blob:')) {
    return captureVideoPosterFrame(s, atSeconds);
  }
  const file = await imageSrcToFile(s, 'capture.mp4', { uploadKey });
  const playable = URL.createObjectURL(file);
  try {
    return await captureVideoPosterFrame(playable, atSeconds);
  } finally {
    URL.revokeObjectURL(playable);
  }
}

async function captureExtractDataUrl(opts: {
  nodeId: string;
  src: string;
  mode: ExtractMode;
  trimStart?: number;
  uploadKey?: string | null;
  poster?: string;
}): Promise<string> {
  const src = String(opts.src || '').trim();
  if (!src) throw new Error('empty video src');

  const firstT = Math.max(0, Number(opts.trimStart) || 0);
  const host = getVideoHoverHost(opts.nodeId);
  const video = host?.getVideo();
  // Prefer live element time (playback bar scrub) over possibly-stale React state.
  const playhead = Math.max(
    0,
    Number(video?.currentTime ?? host?.getMediaTime()) || 0
  );

  const target =
    opts.mode === 'first' ? (firstT <= 0.01 ? 0 : firstT) : playhead;

  const live = await captureFromLiveHost(opts.nodeId, target);
  if (live) return live;

  if (opts.mode === 'current') {
    const poster = String(opts.poster || '').trim();
    // Poster is first-frame only — only OK when playhead is at start.
    if (
      (poster.startsWith('data:') || poster.startsWith('blob:')) &&
      playhead <= 0.12
    ) {
      return poster;
    }
  }

  return captureViaResolvedSrc(
    src,
    target <= 0.01 ? 0.05 : target,
    opts.uploadKey
  );
}

function ExtractFrameMenu({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const document = useSelector((s: any) => s.editor.document);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const node = document?.deltaSetLike?.[nodeId];
  const src = String(node?.attrs?.src || '').trim();
  const trimStart = Number(node?.attrs?.trimStart);
  const uploadKey = String(node?.attrs?.uploadKey || node?.attrs?.key || '').trim() || null;
  const poster = String(node?.attrs?.poster || '').trim();

  const spawnFrameImage = useCallback(
    async (mode: ExtractMode) => {
      if (!document || !node || node.key !== 'video' || !src || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setOpen(false);
      try {
        const dataUrl = await captureExtractDataUrl({
          nodeId,
          src,
          mode,
          trimStart: Number.isFinite(trimStart) ? trimStart : undefined,
          uploadKey,
          poster,
        });
        if (!dataUrl) throw new Error('empty frame');

        const width = Math.max(1, Math.round(Number(node.width) || 200));
        const height = Math.max(1, Math.round(Number(node.height) || 200));
        const x = Math.round((Number(node.x) || 0) + width + SIBLING_GAP);
        const y = Math.round(Number(node.y) || 0);

        dispatch(
          startImageUploadPlaceholder({
            src: dataUrl,
            width,
            height,
            x,
            y,
            name: t('editor.videoToolbar.extractFrameName'),
            label: t('editor.uploading'),
          })
        );

        const spawnedId = String(
          (store.getState() as any).editor?.pendingImageProcessId || ''
        );
        const signal = spawnedId ? beginNodeUpload(spawnedId) : undefined;
        try {
          const uploaded = await uploadImageFromSrc(dataUrl, 'video-frame.jpg', { signal });
          if (signal?.aborted) return;
          if (!uploaded?.url) throw new Error('upload returned no url');
          dispatch(
            finishImageProcess({
              nodeId: spawnedId || undefined,
              src: uploaded.url,
              attrs: uploaded.key ? { uploadKey: uploaded.key } : undefined,
            })
          );
        } catch (uploadErr) {
          if (isUploadAbortError(uploadErr)) return;
          // Keep local preview; clear "上传中" chrome.
          dispatch(finishImageProcess({ nodeId: spawnedId || undefined }));
          message.warning(t('editor.uploadFail'));
        } finally {
          finishNodeUpload(spawnedId);
        }
      } catch (err) {
        if (isUploadAbortError(err)) return;
        console.warn('[video] extract frame failed', err);
        message.error(t('editor.videoToolbar.extractFrameFail'));
        dispatch(failImageProcess({}));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [dispatch, document, node, nodeId, poster, src, t, trimStart, uploadKey]
  );

  const items: MenuItemType[] = useMemo(
    () => [
      {
        key: 'first',
        label: t('editor.videoToolbar.extractFirst'),
        disabled: busy,
      },
      {
        key: 'at',
        label: t('editor.videoToolbar.extractAt'),
        disabled: busy,
      },
      {
        key: 'current',
        label: t('editor.videoToolbar.extractCurrent'),
        disabled: busy,
      },
    ],
    [busy, t]
  );

  return (
    <Dropdown
      trigger="click"
      open={open}
      onOpenChange={(next) => {
        if (!busyRef.current) setOpen(next);
      }}
      placement="bottom-start"
      offset={8}
      strategy="fixed"
      items={items}
      onClick={(key) => {
        if (key === 'first' || key === 'at' || key === 'current') {
          void spawnFrameImage(key);
        }
      }}
      popupClassName="min-w-[11.5rem]"
      floatingClassName="z-[520]"
      referenceClassName="inline-flex"
    >
      <button
        type="button"
        className={cn(videoToolBtn, (open || busy) && 'bg-[var(--accent-soft)]')}
        aria-label={t('editor.videoToolbar.extractFrame')}
        disabled={busy || !src}
      >
        <ToolIconSlot>
          <HiOutlineCamera strokeWidth={TOOL_ICON_STROKE} />
        </ToolIconSlot>
        <span>{t('editor.videoToolbar.extractFrame')}</span>
        <HiOutlineChevronDown className="h-3 w-3 opacity-70" strokeWidth={2} />
      </button>
    </Dropdown>
  );
}

/**
 * Video selection toolbar — quick edit / trim / crop / flip / extract frame / fullscreen / download.
 */
function VideoToolbarEditTools({
  nodeId,
  onQuickEdit,
  onTrim,
  onCrop,
  onFlipRotate,
  downloadSlot,
  fullscreenSlot,
}: {
  nodeId: string;
  onQuickEdit?: () => void;
  onTrim?: () => void;
  onCrop?: () => void;
  onFlipRotate?: () => void;
  downloadSlot?: ReactNode;
  fullscreenSlot?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <>
      {onQuickEdit ? (
        <>
          <Tool label={t('editor.imageToolbar.chat')} onClick={onQuickEdit}>
            <HiOutlineSparkles className="h-4 w-4" strokeWidth={2} />
          </Tool>
          <VideoToolSep />
        </>
      ) : null}
      <Tool label={t('editor.videoToolbar.trim')} onClick={onTrim}>
        <HiOutlineScissors strokeWidth={TOOL_ICON_STROKE} />
      </Tool>
      <Tool label={t('editor.videoToolbar.crop')} onClick={onCrop}>
        <LuCrop strokeWidth={TOOL_ICON_STROKE} />
      </Tool>
      {onFlipRotate ? (
        <Tool label={t('editor.videoToolbar.flip')} onClick={onFlipRotate}>
          <MdOutlineFlip />
        </Tool>
      ) : null}
      {nodeId ? <ExtractFrameMenu nodeId={nodeId} /> : null}
      {downloadSlot || fullscreenSlot ? (
        <>
          <VideoToolSep />
          {fullscreenSlot}
          {downloadSlot}
        </>
      ) : null}
    </>
  );
}

export default memo(VideoToolbarEditTools);
