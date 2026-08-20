/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/VideoNode/VideoHoverPlayback.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  memo,
} from 'react';
import { createPortal } from '@/features/canvas/adapters/recombynReactDom';
import { usePlayableVideoSrc } from '@recombyn-native/components/editor/nodes/VideoNode/VideoJsPlayer';
import VideoPlaybackBar, {
  videoMediaFromElement,
  videoChromeLayout,
  VIDEO_PLAYBACK_BAR_H,
  type VideoMediaControl,
} from '@recombyn-native/components/editor/nodes/VideoNode/VideoPlaybackBar';
import { VideoFullscreenPreview } from '@recombyn-native/components/editor/nodes/VideoNode/VideoFullscreenPreviewButton';

function pointInRect(x: number, y: number, r: DOMRect) {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function readCropNorm(opts: {
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
}): { x: number; y: number; w: number; h: number } | null {
  const x = Number(opts.cropX);
  const y = Number(opts.cropY);
  const w = Number(opts.cropW);
  const h = Number(opts.cropH);
  if (
    ![x, y, w, h].every(Number.isFinite) ||
    !(w > 0) ||
    !(h > 0) ||
    (x === 0 && y === 0 && w === 1 && h === 1)
  ) {
    return null;
  }
  return { x, y, w, h };
}

function mediaCropStyle(crop: { x: number; y: number; w: number; h: number } | null): CSSProperties {
  if (!crop) {
    return { width: '100%', height: '100%', objectFit: 'fill' };
  }
  return {
    position: 'absolute',
    left: `${(-crop.x / crop.w) * 100}%`,
    top: `${(-crop.y / crop.h) * 100}%`,
    width: `${(1 / crop.w) * 100}%`,
    height: `${(1 / crop.h) * 100}%`,
    objectFit: 'fill',
  };
}

/** Freeze the current decoded video frame as a JPEG data URL. */
export function captureFrameFromVideoEl(video: HTMLVideoElement): string | null {
  if (video.readyState < 2) return null;
  const w = Math.max(1, video.videoWidth || 1);
  const h = Math.max(1, video.videoHeight || 1);
  if (w <= 1 || h <= 1) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}

type VideoHoverHost = {
  getVideo: () => HTMLVideoElement | null;
  getWrap: () => HTMLElement | null;
  getFreezeUrl: () => string;
  getFreezeAt: () => number;
  getMediaTime: () => number;
};

const videoHoverHosts = new Map<string, VideoHoverHost>();

/** Live plate host registered by VideoHoverPlayback (blob-backed `<video>`). */
export function getVideoHoverHost(nodeId: string): VideoHoverHost | null {
  return videoHoverHosts.get(String(nodeId)) || null;
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

type ScenePlate = CSSProperties & {
  left: number;
  top: number;
  width: number;
  height: number;
};

type VideoHoverPlaybackProps = {
  nodeId: string;
  scenePlate: ScenePlate;
  zoom: number;
  /** Portal into shared SVG layer mount (unified stackOrder). */
  svgMount?: HTMLElement | null;
  src: string;
  poster?: string;
  uploadKey?: string | null;
  hidden?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  trimStart?: number;
  trimEnd?: number;
  /** Stored media length (seconds) from node attrs. */
  knownDuration?: number;
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
};

/**
 * Playing → live `<video>`.
 * Paused → freeze-frame `<img>` only when it matches currentTime (scrubber);
 * otherwise keep the paused `<video>` so seek/switch lands on the right frame.
 */
function VideoHoverPlayback({
  nodeId,
  scenePlate,
  zoom,
  svgMount = null,
  src,
  poster,
  uploadKey,
  hidden,
  trimStart,
  trimEnd,
  knownDuration,
  flipX,
  flipY,
  cropX,
  cropY,
  cropW,
  cropH,
}: VideoHoverPlaybackProps): ReactNode {
  const plateRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoWrapRef = useRef<HTMLDivElement | null>(null);
  const freezeGenRef = useRef(0);
  const freezeUrlRef = useRef(String(poster || '').trim());
  const freezeAtRef = useRef(0);
  const mediaTimeRef = useRef(0);
  /** Track mount — public URLs set playSrc before the <video> ref exists. */
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [media, setMedia] = useState<VideoMediaControl | null>(null);
  const [barHovered, setBarHovered] = useState(false);
  const [plateHovered, setPlateHovered] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [fsOpen, setFsOpen] = useState(false);
  /** Mirrors video.currentTime so scrubber vs freeze can diverge and show live video. */
  const [mediaTime, setMediaTime] = useState(0);
  /** Frozen still + the mediaTime it was captured at. */
  const [freeze, setFreeze] = useState<{ url: string; at: number }>(() => ({
    url: String(poster || '').trim(),
    at: 0,
  }));
  const playSrc = usePlayableVideoSrc(src, uploadKey);
  const showUi = !hidden;
  const z = Math.max(0.05, zoom || 1);
  const posterUrl = String(poster || '').trim();
  freezeUrlRef.current = freeze.url;
  freezeAtRef.current = freeze.at;
  mediaTimeRef.current = mediaTime;
  const showUiRef = useRef(showUi);
  showUiRef.current = showUi;

  const setVideoNodeRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    setVideoEl(el);
  }, []);

  // Flip media pixels only — keep the playback bar upright.
  const mediaFlip =
    flipX || flipY
      ? (`scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` as const)
      : undefined;

  useEffect(() => {
    const id = String(nodeId);
    videoHoverHosts.set(id, {
      getVideo: () => videoRef.current,
      getWrap: () => videoWrapRef.current,
      getFreezeUrl: () => freezeUrlRef.current,
      getFreezeAt: () => freezeAtRef.current,
      getMediaTime: () => mediaTimeRef.current,
    });
    return () => {
      if (videoHoverHosts.get(id)?.getVideo() === videoRef.current) {
        videoHoverHosts.delete(id);
      }
    };
  }, [nodeId]);

  useEffect(() => {
    const next = String(poster || '').trim();
    if (!next) return;
    setFreeze((prev) => (prev.url ? prev : { url: next, at: 0 }));
  }, [poster]);

  // Bind src once — never via React `src={}`. Re-run when the element mounts.
  useEffect(() => {
    const el = videoEl;
    if (!el || !playSrc) return;
    if (el.getAttribute('src') === playSrc || el.currentSrc === playSrc) return;
    try {
      if (el.currentSrc && new URL(el.currentSrc).href === new URL(playSrc, window.location.href).href) {
        return;
      }
    } catch {
      /* ignore */
    }
    freezeGenRef.current += 1;
    setFreeze({ url: posterUrl, at: 0 });
    el.src = playSrc;
  }, [playSrc, posterUrl, videoEl]);

  useEffect(() => {
    const el = videoEl;
    if (!el) return;
    setMedia(videoMediaFromElement(el));
  }, [videoEl]);

  // Capture still after pause / seek — wait for a decoded frame, briefly reveal video if hidden.
  useEffect(() => {
    const el = videoRef.current as VideoWithFrameCallback | null;
    if (!el) return;

    let vfc = 0;
    let raf = 0;

    const freezeNow = () => {
      if (!el.paused && !el.ended) return;
      const wrap = videoWrapRef.current;
      const prevVis = wrap?.style.visibility;
      // Hidden videos often won't decode the seeked frame — reveal for capture.
      // Never punch through a layer-hidden plate (child visibility:visible wins
      // over parent visibility:hidden in CSS).
      if (wrap && showUiRef.current) wrap.style.visibility = 'visible';

      const gen = ++freezeGenRef.current;
      const finish = () => {
        if (gen !== freezeGenRef.current) return;
        const shot = captureFrameFromVideoEl(el);
        if (shot) {
          const at = Number(el.currentTime) || 0;
          setMediaTime(at);
          setFreeze({ url: shot, at });
        }
        if (wrap) {
          wrap.style.visibility = showUiRef.current ? prevVis ?? '' : 'hidden';
        }
      };

      if (typeof el.requestVideoFrameCallback === 'function') {
        vfc = el.requestVideoFrameCallback(() => finish());
      } else {
        raf = requestAnimationFrame(() => {
          raf = requestAnimationFrame(finish);
        });
      }
    };

    el.addEventListener('pause', freezeNow);
    el.addEventListener('seeked', freezeNow);
    el.addEventListener('loadeddata', freezeNow);
    const syncTime = () => setMediaTime(Number(el.currentTime) || 0);
    el.addEventListener('timeupdate', syncTime);
    el.addEventListener('seeked', syncTime);
    freezeNow();
    syncTime();
    return () => {
      el.removeEventListener('pause', freezeNow);
      el.removeEventListener('seeked', freezeNow);
      el.removeEventListener('loadeddata', freezeNow);
      el.removeEventListener('timeupdate', syncTime);
      el.removeEventListener('seeked', syncTime);
      cancelAnimationFrame(raf);
      if (vfc && typeof el.cancelVideoFrameCallback === 'function') {
        el.cancelVideoFrameCallback(vfc);
      }
    };
  }, [playSrc]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const plate = plateRef.current;
      if (!plate || !showUi) {
        setPlateHovered(false);
        return;
      }
      setPlateHovered(pointInRect(e.clientX, e.clientY, plate.getBoundingClientRect()));
    };
    const onLeave = () => setPlateHovered(false);
    document.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('blur', onLeave);
    return () => {
      document.removeEventListener('pointermove', onMove);
      window.removeEventListener('blur', onLeave);
    };
  }, [showUi, scenePlate.left, scenePlate.top, scenePlate.width, scenePlate.height]);

  useEffect(() => {
    if (!media || media.isDead()) {
      setPlaying(false);
      return;
    }
    const sync = () => {
      try {
        setPlaying(!media.isPaused());
      } catch {
        setPlaying(false);
      }
    };
    sync();
    media.on('play', sync);
    media.on('pause', sync);
    media.on('ended', sync);
    return () => {
      media.off('play', sync);
      media.off('pause', sync);
      media.off('ended', sync);
    };
  }, [media]);

  if (!src) return null;
  // Wait for SVG foreignObject mount so we never fall back to a parallel CSS stack.
  if (!svgMount) return null;

  // Still only when it matches scrubber time — otherwise show paused video at currentTime.
  const freezeMatches = Boolean(freeze.url) && Math.abs(mediaTime - freeze.at) <= 0.12;
  const showStill = !playing && freezeMatches;
  const showVideo = playing || !showStill;
  const barVisible = showUi && (plateHovered || barHovered || playing);
  const screenW = Math.max(1, scenePlate.width * z);
  const screenH = Math.max(1, scenePlate.height * z);
  const chrome = videoChromeLayout(screenW, screenH);

  const plate = (
    <div
      ref={plateRef}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        borderRadius: scenePlate.borderRadius,
        // opacity — not visibility. Child visibility:visible punches through
        // parent visibility:hidden (freeze / playing video wrap).
        opacity: showUi ? 1 : 0,
      }}
      aria-hidden={showUi ? undefined : true}
      data-video-hover-plate=""
      data-video-node-id={nodeId}
    >
      {showStill ? (
        <img
          src={freeze.url}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{
            objectFit: 'fill',
            transform: mediaFlip,
            transformOrigin: 'center center',
          }}
        />
      ) : null}

      <div
        ref={videoWrapRef}
        className="pointer-events-none absolute left-0 top-0 overflow-hidden"
        style={{
          width: scenePlate.width * z,
          height: scenePlate.height * z,
          transform: `scale(${1 / z})`,
          transformOrigin: '0 0',
          visibility: showUi && showVideo ? 'visible' : 'hidden',
        }}
      >
        <video
          ref={setVideoNodeRef}
          className="pointer-events-none block h-full w-full"
          style={{
            objectFit: 'fill',
            background: '#111827',
            transform: mediaFlip,
            transformOrigin: 'center center',
          }}
          playsInline
          preload="auto"
          muted
          controls={false}
          draggable={false}
        />
      </div>

      {showUi && chrome.visible ? (
        // Full plate + overflow visible so the vertical volume slider above mute isn’t clipped
        // by a bar-height-only wrapper (overflow-hidden + short height hid it entirely).
        <div
          className="pointer-events-none absolute inset-0 z-[2] overflow-visible"
          style={{ width: scenePlate.width, height: scenePlate.height }}
        >
          <div
            className="pointer-events-none absolute bottom-0 left-0 overflow-visible"
            style={{
              width: chrome.layoutW,
              height: VIDEO_PLAYBACK_BAR_H,
              transform: `scale(${chrome.fit / z})`,
              transformOrigin: '0 100%',
            }}
          >
            <VideoPlaybackBar
              nodeId={nodeId}
              media={media}
              visible={barVisible}
              trimStart={trimStart}
              trimEnd={trimEnd}
              knownDuration={knownDuration}
              scale={1}
              onFullscreen={() => setFsOpen(true)}
              className="pointer-events-auto absolute inset-x-0 bottom-0"
              onHoverChange={setBarHovered}
            />
          </div>
        </div>
      ) : null}

      <VideoFullscreenPreview
        open={fsOpen}
        onClose={() => setFsOpen(false)}
        src={src}
        poster={poster}
        uploadKey={uploadKey}
        aspectWidth={scenePlate.width}
        aspectHeight={scenePlate.height}
        cropX={cropX}
        cropY={cropY}
        cropW={cropW}
        cropH={cropH}
        trimStart={trimStart}
        trimEnd={trimEnd}
        flipX={flipX}
        flipY={flipY}
        duration={knownDuration}
      />
    </div>
  );

  return createPortal(plate, svgMount);
}

function propsEqual(prev: VideoHoverPlaybackProps, next: VideoHoverPlaybackProps): boolean {
  return (
    prev.nodeId === next.nodeId &&
    prev.zoom === next.zoom &&
    prev.svgMount === next.svgMount &&
    prev.src === next.src &&
    prev.poster === next.poster &&
    prev.uploadKey === next.uploadKey &&
    prev.hidden === next.hidden &&
    prev.trimStart === next.trimStart &&
    prev.trimEnd === next.trimEnd &&
    prev.knownDuration === next.knownDuration &&
    prev.flipX === next.flipX &&
    prev.flipY === next.flipY &&
    prev.cropX === next.cropX &&
    prev.cropY === next.cropY &&
    prev.cropW === next.cropW &&
    prev.cropH === next.cropH &&
    prev.scenePlate.left === next.scenePlate.left &&
    prev.scenePlate.top === next.scenePlate.top &&
    prev.scenePlate.width === next.scenePlate.width &&
    prev.scenePlate.height === next.scenePlate.height &&
    prev.scenePlate.borderRadius === next.scenePlate.borderRadius &&
    prev.scenePlate.transform === next.scenePlate.transform
  );
}

export default memo(VideoHoverPlayback, propsEqual);
