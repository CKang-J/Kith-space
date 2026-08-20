/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/VideoNode/VideoPlaybackBar.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  memo,
} from 'react';
import {
  HiOutlinePause,
  HiOutlinePlay,
  HiOutlineSpeakerWave,
  HiOutlineSpeakerXMark,
} from 'react-icons/hi2';
import { RiFullscreenFill } from 'react-icons/ri';
import { cn } from '@recombyn-native/utils/classnames';

/** Horizontal padding; bar is full-bleed with bottom gradient. */
const EDGE_PAD = 10;
/** Single-row chrome height (screen CSS px when not camera-compensated). */
export const VIDEO_PLAYBACK_BAR_H = 36;
const BAR_H = VIDEO_PLAYBACK_BAR_H;
/** Layout width that fits play · times · track · vol · fs before uniform scale. */
const FULL_LAYOUT_W = 240;
/** Hide bar + replace when fitted bar is shorter than this (screen px). */
const CHROME_HIDE_MIN_PX = 16;

/** Full-chrome layout + fit for a plate’s on-screen size (shared by bar + replace). */
export function videoChromeLayout(screenW: number, screenH: number) {
  const w = Math.max(1, screenW);
  const h = Math.max(1, screenH);
  const layoutW = Math.max(w, FULL_LAYOUT_W);
  const fit = Math.min(1, h / VIDEO_PLAYBACK_BAR_H, w / layoutW);
  const barScreenH = VIDEO_PLAYBACK_BAR_H * fit;
  return {
    layoutW,
    fit,
    barScreenH,
    visible: barScreenH >= CHROME_HIDE_MIN_PX,
  };
}
/** Uniform gap between play · time · track · time · volume · fullscreen. */
const ITEM_GAP = 10;
const ICON = 15;
const BTN = ICON + 8;
const TIME_SIZE = 11;
const TRACK_H = 28;
const RAIL = 3;
const THUMB = 10;

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function progressRatio(current: number, duration: number) {
  if (!duration || duration <= 0) return 0;
  return Math.max(0, Math.min(1, current / duration));
}

function resolveTrimWindow(
  mediaDuration: number,
  trimStart?: number,
  trimEnd?: number
) {
  const d = Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : 0;
  let start = Number.isFinite(trimStart) ? Math.max(0, Number(trimStart)) : 0;
  // trimEnd=0 is not a valid end — treat as "no trim".
  let end =
    Number.isFinite(trimEnd) && Number(trimEnd) > 0 ? Number(trimEnd) : d || 0;
  if (d > 0) {
    start = Math.max(0, Math.min(start, d));
    end = Math.max(0, Math.min(end || d, d));
  }
  if (end <= start) end = d > 0 ? d : start;
  return { start, end };
}

/** Finite positive duration only — MP4/WebM often report Infinity until probed. */
function readElementDuration(el: HTMLVideoElement): number {
  const d = Number(el.duration);
  if (Number.isFinite(d) && d > 0 && d < 60 * 60 * 12) return d;
  try {
    // seekable.end is ok only when finite — Infinity means “unknown / live-like”.
    if (el.seekable && el.seekable.length > 0) {
      const end = Number(el.seekable.end(el.seekable.length - 1));
      if (Number.isFinite(end) && end > 0 && end < 60 * 60 * 12) return end;
    }
    // Never use buffered.end — that is only how far the file has loaded, not duration.
  } catch {
    /* ignore */
  }
  return 0;
}

/**
 * Some generated / fragmented MP4s keep `duration === Infinity` until a seek
 * clamps to the real end. Prefer stored upload duration over this probe.
 */
async function probeElementDuration(el: HTMLVideoElement): Promise<number> {
  const first = readElementDuration(el);
  if (first > 0) return first;
  const prev = Number.isFinite(el.currentTime) ? el.currentTime : 0;
  const wasPaused = el.paused;
  try {
    try {
      el.pause();
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        el.removeEventListener('seeked', done);
        resolve();
      };
      el.addEventListener('seeked', done);
      try {
        el.currentTime = 1e10;
      } catch {
        done();
        return;
      }
      window.setTimeout(done, 900);
    });
    const probed = Number.isFinite(el.currentTime) ? el.currentTime : 0;
    const restoreTo = Math.max(0, Math.min(prev, probed > 0 ? Math.max(0, probed - 0.05) : 0));
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        el.removeEventListener('seeked', done);
        resolve();
      };
      el.addEventListener('seeked', done);
      try {
        el.currentTime = restoreTo;
      } catch {
        done();
        return;
      }
      window.setTimeout(done, 600);
    });
    if (!wasPaused) {
      try {
        await el.play();
      } catch {
        /* ignore play rejection */
      }
    }
    if (Number.isFinite(probed) && probed > 0) return probed;
  } catch {
    /* ignore */
  }
  return readElementDuration(el);
}

/** Shared control surface for native `<video>`. */
export type VideoMediaControl = {
  getCurrentTime: () => number;
  setCurrentTime: (t: number) => void;
  getDuration: () => number;
  /** Resolve Infinity / missing duration via seek clamp. */
  probeDuration: () => Promise<number>;
  isPaused: () => boolean;
  play: () => void;
  pause: () => void;
  isMuted: () => boolean;
  setMuted: (v: boolean) => void;
  getVolume: () => number;
  setVolume: (v: number) => void;
  on: (type: string, fn: () => void) => void;
  off: (type: string, fn: () => void) => void;
  isDead: () => boolean;
};

export function videoMediaFromElement(el: HTMLVideoElement): VideoMediaControl {
  return {
    getCurrentTime: () => Number(el.currentTime) || 0,
    setCurrentTime: (t) => {
      if (!Number.isFinite(t) || t < 0) return;
      try {
        el.currentTime = t;
      } catch {
        /* ignore non-seekable */
      }
    },
    getDuration: () => readElementDuration(el),
    probeDuration: () => probeElementDuration(el),
    isPaused: () => el.paused,
    play: () => {
      async function tryPlay() {
        try {
          await el.play();
        } catch {
          /* ignore play rejection */
        }
      }
      void tryPlay();
    },
    pause: () => el.pause(),
    isMuted: () => el.muted,
    setMuted: (v) => {
      el.muted = v;
    },
    getVolume: () => Number(el.volume) || 0,
    setVolume: (v) => {
      el.volume = v;
    },
    on: (type, fn) => el.addEventListener(type, fn),
    off: (type, fn) => el.removeEventListener(type, fn),
    isDead: () => !el.isConnected,
  };
}

/**
 * Optional grow for wide fullscreen / non-camera players (≥1).
 * Shrink-to-fit comes from `videoChromeLayout(...).fit`.
 */
export function videoPlaybackBarScale(screenWidth: number): number {
  const w = Math.max(1, screenWidth);
  return Math.min(1.15, Math.max(1, w / 420));
}

/**
 * Shared playback chrome — one row: play · current · scrub · total · volume · fullscreen.
 * Callers shrink via shell `scale(fit)` / `scale` prop — chrome stays full density.
 */
function VideoPlaybackBar({
  media,
  visible,
  trimStart,
  trimEnd,
  className,
  style,
  onHoverChange,
  nodeId,
  /** Uniform visual scale (grow or shrink). Canvas prefers shell `scale(1/zoom)`. */
  scale = 1,
  /** Stored at upload — single source of truth for total length. */
  knownDuration,
  /** When set, show fullscreen control on the right. */
  onFullscreen,
}: {
  media: VideoMediaControl | null;
  visible: boolean;
  trimStart?: number;
  trimEnd?: number;
  className?: string;
  style?: CSSProperties;
  onHoverChange?: (hovered: boolean) => void;
  nodeId?: string;
  scale?: number;
  knownDuration?: number;
  onFullscreen?: () => void;
}): ReactNode {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const scrubbingRef = useRef(false);
  const probingRef = useRef(false);
  const trimWindowRef = useRef({ start: 0, end: 0 });
  const playableRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const seekRafRef = useRef(0);
  const known =
    Number.isFinite(knownDuration) && Number(knownDuration) > 0
      ? Number(knownDuration)
      : 0;
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);
  const [paused, setPaused] = useState(true);
  const [current, setCurrent] = useState(0);
  // Only used when attrs.duration is missing (legacy nodes).
  const [fallbackDuration, setFallbackDuration] = useState(0);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [volOpen, setVolOpen] = useState(false);

  const mediaDuration = known > 0 ? known : fallbackDuration;
  const s = Math.max(0.05, Number(scale) || 1);
  const trimWindow = resolveTrimWindow(mediaDuration, trimStart, trimEnd);
  const playable = Math.max(0, trimWindow.end - trimWindow.start);
  trimWindowRef.current = trimWindow;
  playableRef.current = playable;
  const displayCurrent = Math.max(0, current - trimWindow.start);
  const ratio =
    scrubRatio != null ? scrubRatio : progressRatio(displayCurrent, playable);
  const volPct = muted ? 0 : volume;
  // Keep hit-testing while scrubbing even if hover briefly drops.
  const interactive = visible || scrubbing;

  useEffect(() => {
    if (!media || media.isDead()) return;
    let cancelled = false;
    const syncMeta = () => {
      setPaused(media.isPaused());
      setMuted(media.isMuted());
      setVolume(media.getVolume());
    };
    const syncTime = () => {
      if (scrubbingRef.current || probingRef.current) return;
      setCurrent(media.getCurrentTime());
    };
    syncMeta();
    syncTime();
    media.on('timeupdate', syncTime);
    media.on('seeked', syncTime);
    media.on('play', syncMeta);
    media.on('pause', syncMeta);
    media.on('loadedmetadata', syncMeta);
    media.on('volumechange', syncMeta);

    // attrs.duration missing — read / probe once (legacy nodes only).
    if (!(known > 0)) {
      const live = media.getDuration();
      if (live > 0) {
        setFallbackDuration(live);
      } else {
        probingRef.current = true;
        async function probeFallbackDuration() {
          const probed = await media.probeDuration();
          probingRef.current = false;
          if (cancelled || !(probed > 0)) return;
          setFallbackDuration(probed);
          setCurrent(media.getCurrentTime());
        }
        void probeFallbackDuration();
      }
    }

    return () => {
      cancelled = true;
      probingRef.current = false;
      media.off('timeupdate', syncTime);
      media.off('seeked', syncTime);
      media.off('play', syncMeta);
      media.off('pause', syncMeta);
      media.off('loadedmetadata', syncMeta);
      media.off('volumechange', syncMeta);
    };
  }, [media, known]);

  const flushSeek = () => {
    seekRafRef.current = 0;
    const t = pendingSeekRef.current;
    pendingSeekRef.current = null;
    if (t == null || !media || media.isDead()) return;
    media.setCurrentTime(t);
    setCurrent(t);
  };

  const seekFromClientX = (clientX: number) => {
    if (!media || media.isDead() || !trackRef.current) return;
    let span = playableRef.current;
    if (!(span > 0) && !(known > 0)) {
      const d = media.getDuration();
      if (d > 0) {
        setFallbackDuration(d);
        const win = resolveTrimWindow(d, trimStart, trimEnd);
        trimWindowRef.current = win;
        span = Math.max(0, win.end - win.start);
        playableRef.current = span;
      }
    }
    if (!(span > 0)) return;
    const r = trackRef.current.getBoundingClientRect();
    if (!(r.width > 0)) return;
    const ratioT = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const next = trimWindowRef.current.start + ratioT * span;
    setScrubRatio(ratioT);
    setCurrent(next);
    pendingSeekRef.current = next;
    if (!seekRafRef.current) {
      seekRafRef.current = requestAnimationFrame(flushSeek);
    }
  };

  useEffect(() => {
    const root = window.document;
    const onMove = (e: PointerEvent) => {
      if (!scrubbingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      seekFromClientX(e.clientX);
    };
    const onUp = () => {
      if (!scrubbingRef.current) return;
      scrubbingRef.current = false;
      setScrubbing(false);
      if (seekRafRef.current) {
        cancelAnimationFrame(seekRafRef.current);
        seekRafRef.current = 0;
      }
      flushSeek();
      if (media && !media.isDead()) {
        setCurrent(media.getCurrentTime());
      }
      setScrubRatio(null);
    };
    root.addEventListener('pointermove', onMove, { capture: true, passive: false });
    root.addEventListener('pointerup', onUp, { capture: true });
    root.addEventListener('pointercancel', onUp, { capture: true });
    return () => {
      root.removeEventListener('pointermove', onMove, true);
      root.removeEventListener('pointerup', onUp, true);
      root.removeEventListener('pointercancel', onUp, true);
      if (seekRafRef.current) cancelAnimationFrame(seekRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seek helpers close over latest media via refs/state setters
  }, [media, trimStart, trimEnd]);

  const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    (e.nativeEvent as any).stopImmediatePropagation?.();
    scrubbingRef.current = true;
    setScrubbing(true);
    onHoverChange?.(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    seekFromClientX(e.clientX);
  };

  const togglePlay = () => {
    if (!media || media.isDead()) return;
    if (media.isPaused()) media.play();
    else media.pause();
  };

  const toggleMute = () => {
    if (!media || media.isDead()) return;
    const next = !media.isMuted();
    media.setMuted(next);
    if (!next && media.getVolume() <= 0.01) media.setVolume(1);
  };

  const onVolumePointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!media || media.isDead()) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (r.bottom - e.clientY) / Math.max(1, r.height)));
    media.setMuted(t <= 0.01);
    media.setVolume(t);
  };

  const thumbTravel = `calc(100% - ${THUMB}px)`;
  const thumbLeft = `calc(${thumbTravel} * ${ratio})`;
  const fillW = `calc(${thumbTravel} * ${ratio} + ${THUMB / 2}px)`;
  const shownCurrent = scrubRatio != null ? scrubRatio * playable : displayCurrent;
  const grow = Math.abs(s - 1) > 0.001;
  const showFullscreen = Boolean(onFullscreen);

  return (
    <div
      data-sel-toolbar
      data-video-playback-bar
      data-video-node-id={nodeId}
      className={cn(
        // overflow-visible: vertical volume popover sits above the mute button.
        'flex max-w-full min-w-0 items-center overflow-visible text-white transition-opacity duration-150',
        interactive ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        className
      )}
      style={{
        height: BAR_H,
        paddingLeft: EDGE_PAD,
        paddingRight: EDGE_PAD,
        gap: ITEM_GAP,
        boxSizing: 'border-box',
        // One transform for the whole chrome — keeps icons / thumb / type aligned.
        ...(grow
          ? {
              transform: `scale(${s})`,
              transformOrigin: 'bottom left',
              width: `${100 / s}%`,
            }
          : { width: '100%' }),
        background:
          'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.42) 55%, rgba(0,0,0,0) 100%)',
        ...style,
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.nativeEvent as any).stopImmediatePropagation?.();
      }}
      onPointerEnter={() => onHoverChange?.(true)}
      onPointerLeave={() => {
        if (scrubbingRef.current) return;
        onHoverChange?.(false);
        setVolOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={paused ? '播放' : '暂停'}
        className="inline-flex shrink-0 items-center justify-center rounded-md hover:bg-white/10"
        style={{ width: BTN, height: BTN }}
        onClick={togglePlay}
      >
        {paused ? (
          <HiOutlinePlay style={{ width: ICON, height: ICON }} />
        ) : (
          <HiOutlinePause style={{ width: ICON, height: ICON }} />
        )}
      </button>

      <span
        className="shrink-0 tabular-nums leading-none text-white/90"
        style={{ fontSize: TIME_SIZE }}
      >
        {formatTime(shownCurrent)}
      </span>

      {/* Track absorbs width — sides stay fixed size. */}
      <div
        ref={trackRef}
        className="relative z-[1] min-w-0 flex-1 cursor-pointer touch-none"
        style={{ height: TRACK_H }}
        onPointerDown={onTrackPointerDown}
      >
        <div
          className="pointer-events-none absolute top-1/2 left-0 right-0 -translate-y-1/2 rounded-full bg-white/30"
          style={{ height: RAIL }}
        />
        <div
          className="pointer-events-none absolute top-1/2 left-0 -translate-y-1/2 rounded-full bg-white"
          style={{ height: RAIL, width: fillW }}
        />
        <div
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full bg-white shadow-sm"
          style={{ left: thumbLeft, width: THUMB, height: THUMB }}
        />
      </div>

      <span
        className="shrink-0 tabular-nums leading-none text-white/55"
        style={{ fontSize: TIME_SIZE }}
      >
        {formatTime(playable)}
      </span>

      <div
        className="relative shrink-0"
        onPointerEnter={() => setVolOpen(true)}
        onPointerLeave={() => {
          if (!scrubbingRef.current) setVolOpen(false);
        }}
      >
        {volOpen ? (
          <div
            className="absolute bottom-full left-1/2 z-20 flex -translate-x-1/2 flex-col items-center pb-0"
            data-video-volume-popover=""
          >
            <div
              className="flex items-center justify-center rounded-md bg-black/70 shadow-md"
              style={{
                height: 88,
                width: 32,
                paddingTop: 10,
                paddingBottom: 10,
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.nativeEvent as any).stopImmediatePropagation?.();
              }}
            >
              <div
                className="relative cursor-pointer touch-none"
                style={{ height: '100%', width: 28 }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  (e.nativeEvent as any).stopImmediatePropagation?.();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  onVolumePointer(e);
                }}
                onPointerMove={(e) => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                  onVolumePointer(e);
                }}
                onPointerUp={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                }}
              >
                <div
                  className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-full bg-white/30"
                  style={{ width: RAIL }}
                />
                <div
                  className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full bg-white"
                  style={{ width: RAIL, height: `${volPct * 100}%` }}
                />
                <div
                  className="pointer-events-none absolute left-1/2 -translate-x-1/2 translate-y-1/2 rounded-full bg-white shadow-sm"
                  style={{ bottom: `${volPct * 100}%`, width: THUMB, height: THUMB }}
                />
              </div>
            </div>
            {/* Hover bridge so the popover doesn’t close between slider and mute. */}
            <div style={{ height: 8, width: 32 }} aria-hidden />
          </div>
        ) : null}
        <button
          type="button"
          aria-label={muted || volume <= 0.01 ? '取消静音' : '静音'}
          className="inline-flex shrink-0 items-center justify-center rounded-md hover:bg-white/10"
          style={{ width: BTN, height: BTN }}
          onClick={toggleMute}
        >
          {muted || volume <= 0.01 ? (
            <HiOutlineSpeakerXMark style={{ width: ICON, height: ICON }} />
          ) : (
            <HiOutlineSpeakerWave style={{ width: ICON, height: ICON }} />
          )}
        </button>
      </div>

      {showFullscreen ? (
        <button
          type="button"
          aria-label="全屏"
          className="inline-flex shrink-0 items-center justify-center rounded-md hover:bg-white/10"
          style={{ width: BTN, height: BTN }}
          onClick={onFullscreen}
        >
          <RiFullscreenFill style={{ width: ICON, height: ICON }} />
        </button>
      ) : null}
    </div>
  );
}

export default memo(VideoPlaybackBar);
