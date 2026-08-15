/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/VideoNode/VideoJsPlayer.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  memo,
} from 'react';
import { cn } from '@recombyn-native/utils/classnames';
import { toDisplayMediaUrl } from '@recombyn-native/utils/uploadImage';
import VideoPlaybackBar, {
  videoChromeLayout,
  videoMediaFromElement,
  videoPlaybackBarScale,
  type VideoMediaControl,
} from '@recombyn-native/components/editor/nodes/VideoNode/VideoPlaybackBar';
import './VideoJsPlayer.css';

function resolveAbsoluteHref(href: string): string {
  try {
    return new URL(href, window.location.href).href;
  } catch {
    return href;
  }
}

function resolveVideoElementAbsSrc(el: HTMLVideoElement): string {
  try {
    if (el.currentSrc) return el.currentSrc;
    const attr = el.getAttribute('src') || '';
    return attr ? new URL(attr, window.location.href).href : '';
  } catch {
    return el.getAttribute('src') || '';
  }
}

/** Canvas / upload video `src` → browser-playable URL (no auth blob round-trip). */
export function usePlayableVideoSrc(src: string, uploadKey?: string | null): string {
  return toDisplayMediaUrl(src, uploadKey);
}

export type VideoCropNorm = { x: number; y: number; w: number; h: number };

export type VideoJsPlayerProps = {
  src: string;
  poster?: string;
  className?: string;
  style?: CSSProperties;
  /** Fill parent box (canvas node). Default fluid for previews. */
  layout?: 'fill' | 'fluid';
  /**
   * How the video paints inside the shell.
   * Canvas nodes use `fill` (match plate). Previews should use `contain`.
   */
  objectFit?: 'fill' | 'contain' | 'cover';
  /**
   * `always` / `hover` — shared React playback bar.
   * `none` — no bar (caller may portal / embed `VideoPlaybackBar`).
   */
  controlsMode?: 'always' | 'hover' | 'none';
  /** Force bar visible when `controlsMode === 'hover'`. */
  controlsVisible?: boolean;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  /** Keep playback inside [trimStart, trimEnd]. */
  trimStart?: number;
  trimEnd?: number;
  /** Stored media length (seconds) from upload / node attrs. */
  knownDuration?: number;
  /** Normalized crop — applied to the media surface only. */
  crop?: VideoCropNorm | null;
  flipX?: boolean;
  flipY?: boolean;
  /** When true, video surface ignores pointer (canvas selection). Bar stays clickable. */
  videoPointerNone?: boolean;
  /** Optional start time after src binds (trim / preview resume). */
  initialTime?: number;
  onReady?: (media: VideoMediaControl) => void;
  /** Fired once intrinsic video size is known (preview aspect). */
  onMediaSize?: (size: { width: number; height: number }) => void;
};

function cropCssVars(crop?: VideoCropNorm | null): CSSProperties | undefined {
  if (!crop || !(crop.w > 0) || !(crop.h > 0)) return undefined;
  return {
    ['--rcb-crop-left' as string]: `${(-crop.x / crop.w) * 100}%`,
    ['--rcb-crop-top' as string]: `${(-crop.y / crop.h) * 100}%`,
    ['--rcb-crop-w' as string]: `${(1 / crop.w) * 100}%`,
    ['--rcb-crop-h' as string]: `${(1 / crop.h) * 100}%`,
  };
}

/**
 * Native `<video>` player — canvas nodes, attachment hover preview, fullscreen, trim.
 * Chrome uses `VideoPlaybackBar` (never browser default controls).
 */
function VideoJsPlayer({
  src,
  poster,
  className,
  style,
  layout = 'fluid',
  objectFit = 'fill',
  controlsMode = 'always',
  controlsVisible = false,
  autoplay = false,
  muted = false,
  loop = false,
  trimStart,
  trimEnd,
  knownDuration,
  crop,
  flipX = false,
  flipY = false,
  videoPointerNone = false,
  initialTime,
  onReady,
  onMediaSize,
}: VideoJsPlayerProps): ReactNode {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const mediaRef = useRef<VideoMediaControl | null>(null);
  const [media, setMedia] = useState<VideoMediaControl | null>(null);
  const [shellHovered, setShellHovered] = useState(false);
  const [barScale, setBarScale] = useState(1);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onMediaSizeRef = useRef(onMediaSize);
  onMediaSizeRef.current = onMediaSize;
  const trimStartRef = useRef(trimStart);
  const trimEndRef = useRef(trimEnd);
  trimStartRef.current = trimStart;
  trimEndRef.current = trimEnd;
  const initialTimeRef = useRef(initialTime);
  initialTimeRef.current = initialTime;
  const playable = String(src || '').trim();
  const cropVars = cropCssVars(crop);
  const hasCrop = Boolean(cropVars);
  const barVisible =
    controlsMode === 'always' ||
    (controlsMode === 'hover' && (controlsVisible || shellHovered));
  const showBar = controlsMode !== 'none' && barScale > 0;
  const fit = hasCrop ? 'fill' : objectFit;

  // Bind media once per element mount — do not recreate on selection re-renders.
  // Canvas (controlsMode none): never auto-seek / clamp — leave currentTime alone.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const control = videoMediaFromElement(el);
    mediaRef.current = control;
    setMedia(control);
    onReadyRef.current?.(control);

    if (controlsMode === 'none') {
      return () => {
        mediaRef.current = null;
        setMedia(null);
      };
    }

    const clampTrim = () => {
      if (control.isPaused()) return;
      const d = control.getDuration();
      const hasStart = Number.isFinite(trimStartRef.current);
      const hasEnd = Number.isFinite(trimEndRef.current);
      if (!hasStart && !hasEnd) return;
      let start = hasStart ? Math.max(0, Number(trimStartRef.current)) : 0;
      let end = hasEnd ? Math.min(d || Number(trimEndRef.current), Number(trimEndRef.current)) : d;
      if (d > 0) {
        start = Math.max(0, Math.min(start, d));
        end = Math.max(0, Math.min(end, d));
      }
      if (end <= start) return;
      const t = control.getCurrentTime();
      if (t < start - 0.02) control.setCurrentTime(start);
      else if (t >= end - 0.04) control.setCurrentTime(start);
    };

    control.on('timeupdate', clampTrim);
    return () => {
      control.off('timeupdate', clampTrim);
      mediaRef.current = null;
      setMedia(null);
    };
    // controlsMode is fixed for a given mount site (canvas vs preview)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Imperative src only — never put `src`/`poster` on JSX.
   * React re-applying those attrs on selection re-renders reloads the media → frame 0.
   */
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !playable) return;
    const abs = resolveAbsoluteHref(playable);
    const currentAbs = resolveVideoElementAbsSrc(el);
    if (currentAbs === abs) return;

    // Real src change only — do not try to restore previous currentTime.
    el.src = playable;
    const want = Number(initialTimeRef.current);
    if (!(Number.isFinite(want) && want > 0.04)) return;

    const apply = () => {
      try {
        if (Math.abs((Number(el.currentTime) || 0) - want) > 0.08) {
          el.currentTime = want;
        }
      } catch {
        /* ignore */
      }
    };
    el.addEventListener('loadeddata', apply, { once: true });
    el.addEventListener('loadedmetadata', apply, { once: true });
    window.setTimeout(apply, 120);
    window.setTimeout(apply, 400);
  }, [playable]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = Boolean(muted);
  }, [muted]);

  // Poster only for non-canvas previews; never re-touch once a frame is showing.
  useEffect(() => {
    if (controlsMode === 'none') return;
    const el = videoRef.current;
    if (!el) return;
    const next = String(poster || '').trim();
    if (!next) return;
    if (el.getAttribute('poster') === next) return;
    if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
    el.setAttribute('poster', next);
  }, [poster, controlsMode]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.loop = Boolean(loop);
  }, [loop]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !autoplay) return;
    async function tryAutoplay() {
      try {
        await el.play();
      } catch {
        /* ignore autoplay rejection */
      }
    }
    void tryAutoplay();
  }, [autoplay, playable]);

  useEffect(() => {
    const el = shellRef.current;
    if (!el || controlsMode === 'none') return;
    const sync = () => {
      const rect = el.getBoundingClientRect();
      const chrome = videoChromeLayout(rect.width, rect.height);
      setBarScale(chrome.visible ? videoPlaybackBarScale(rect.width) * chrome.fit : 0);
    };
    sync();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [controlsMode, playable]);

  const videoStyle = useMemo((): CSSProperties => {
    if (!hasCrop || !cropVars) {
      return { width: '100%', height: '100%', objectFit: fit };
    }
    return {
      position: 'absolute',
      left: cropVars['--rcb-crop-left' as string] as string,
      top: cropVars['--rcb-crop-top' as string] as string,
      width: cropVars['--rcb-crop-w' as string] as string,
      height: cropVars['--rcb-crop-h' as string] as string,
      maxWidth: 'none',
      objectFit: 'fill',
    };
  }, [hasCrop, cropVars, fit]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const report = () => {
      const w = el.videoWidth;
      const h = el.videoHeight;
      if (w > 0 && h > 0) onMediaSizeRef.current?.({ width: w, height: h });
    };
    if (el.videoWidth > 0) report();
    el.addEventListener('loadedmetadata', report);
    return () => el.removeEventListener('loadedmetadata', report);
  }, [playable]);

  if (!playable) {
    return (
      <div
        className={cn('flex items-center justify-center bg-black/80 text-[11px] text-white/60', className)}
        style={style}
      >
        …
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      className={cn(
        'rcb-video relative min-h-0 min-w-0 overflow-hidden bg-[#111827]',
        layout === 'fill' && 'h-full w-full',
        hasCrop && 'rcb-video--cropped',
        flipX && 'rcb-video--flip-x',
        flipY && 'rcb-video--flip-y',
        videoPointerNone && 'pointer-events-none',
        className
      )}
      style={style}
      onPointerEnter={() => {
        if (controlsMode === 'hover') setShellHovered(true);
      }}
      onPointerLeave={() => setShellHovered(false)}
      onPointerDown={(e) => {
        if (videoPointerNone) return;
        e.stopPropagation();
      }}
    >
      <video
        ref={videoRef}
        className={cn(
          'rcb-video__tech block',
          videoPointerNone && 'pointer-events-none',
          layout === 'fill' && !hasCrop && 'h-full w-full'
        )}
        style={videoStyle}
        playsInline
        preload="auto"
        muted={muted}
        loop={loop}
        controls={false}
      />
      {controlsMode === 'hover' && videoPointerNone ? (
        <div className="absolute inset-0 z-[1]" aria-hidden />
      ) : null}
      {showBar ? (
        <VideoPlaybackBar
          media={media}
          visible={barVisible}
          trimStart={trimStart}
          trimEnd={trimEnd}
          knownDuration={knownDuration}
          scale={barScale}
          className="absolute inset-x-0 bottom-0 z-[2]"
        />
      ) : null}
    </div>
  );
}

export default memo(VideoJsPlayer, (prev, next) => {
  return (
    prev.src === next.src &&
    prev.poster === next.poster &&
    prev.className === next.className &&
    prev.layout === next.layout &&
    prev.objectFit === next.objectFit &&
    prev.controlsMode === next.controlsMode &&
    prev.controlsVisible === next.controlsVisible &&
    prev.autoplay === next.autoplay &&
    prev.muted === next.muted &&
    prev.loop === next.loop &&
    prev.trimStart === next.trimStart &&
    prev.trimEnd === next.trimEnd &&
    prev.knownDuration === next.knownDuration &&
    prev.flipX === next.flipX &&
    prev.flipY === next.flipY &&
    prev.videoPointerNone === next.videoPointerNone &&
    prev.crop === next.crop &&
    // onReady is ref-driven — ignore identity churn from parents.
    prev.style === next.style
  );
});
