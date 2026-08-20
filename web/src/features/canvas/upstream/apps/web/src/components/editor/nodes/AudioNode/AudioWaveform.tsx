/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/AudioNode/AudioWaveform.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * wavesurfer.js wrapper for audio-node plates.
 * Owns WaveSurfer lifecycle; exposes a small media handle for play / seek / speed.
 */
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react';
import WaveSurfer from 'wavesurfer.js';
import { cn } from '@recombyn-native/utils/classnames';

export type AudioWaveformHandle = {
  play: () => Promise<void>;
  pause: () => void;
  isPaused: () => boolean;
  seekTo: (time: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  setPlaybackRate: (rate: number) => void;
  getMedia: () => HTMLMediaElement | null;
  getInstance: () => WaveSurfer | null;
};

export type AudioWaveformProps = {
  /** Playable URL (blob: / data: / https). Empty → idle placeholder. */
  url: string;
  height?: number;
  waveColor?: string;
  progressColor?: string;
  cursorColor?: string;
  /** Bar width in px; 0 = continuous wave. */
  barWidth?: number;
  barGap?: number;
  barRadius?: number;
  /** Allow click-to-seek on the waveform. */
  interact?: boolean;
  className?: string;
  onReady?: (duration: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onTimeUpdate?: (time: number) => void;
  onSeek?: (time: number) => void;
  onFinish?: () => void;
};

function AudioWaveformInner(
  {
    url,
    height = 72,
    waveColor = '#c8c8c8',
    progressColor = '#8a8a8a',
    cursorColor = '#141414',
    barWidth = 3,
    barGap = 2,
    barRadius = 2,
    interact = false,
    className,
    onReady,
    onPlay,
    onPause,
    onTimeUpdate,
    onSeek,
    onFinish,
  }: AudioWaveformProps,
  ref: React.ForwardedRef<AudioWaveformHandle>
): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const readyUrlRef = useRef('');
  const cbRef = useRef({
    onReady,
    onPlay,
    onPause,
    onTimeUpdate,
    onSeek,
    onFinish,
  });
  cbRef.current = {
    onReady,
    onPlay,
    onPause,
    onTimeUpdate,
    onSeek,
    onFinish,
  };

  useImperativeHandle(
    ref,
    () => ({
      play: async () => {
        const ws = wsRef.current;
        if (!ws) return;
        await ws.play();
      },
      pause: () => wsRef.current?.pause(),
      isPaused: () => {
        const ws = wsRef.current;
        if (!ws) return true;
        return !ws.isPlaying();
      },
      seekTo: (time: number) => {
        const ws = wsRef.current;
        if (!ws || !Number.isFinite(time)) return;
        const d = ws.getDuration();
        if (!(d > 0)) return;
        const t = Math.max(0, Math.min(time, d));
        ws.setTime(t);
      },
      getCurrentTime: () => Number(wsRef.current?.getCurrentTime()) || 0,
      getDuration: () => Number(wsRef.current?.getDuration()) || 0,
      setPlaybackRate: (rate: number) => {
        const ws = wsRef.current;
        if (!ws || !Number.isFinite(rate) || rate <= 0) return;
        try {
          ws.setOptions({ audioRate: rate });
        } catch {
          const media = ws.getMediaElement?.();
          if (media) media.playbackRate = rate;
        }
      },
      getMedia: () => wsRef.current?.getMediaElement?.() || null,
      getInstance: () => wsRef.current,
    }),
    []
  );

  // Create / reload when url changes.
  useEffect(() => {
    const host = hostRef.current;
    const src = String(url || '').trim();
    if (!host || !src) {
      wsRef.current?.destroy();
      wsRef.current = null;
      readyUrlRef.current = '';
      return undefined;
    }

    let cancelled = false;
    const ws = WaveSurfer.create({
      container: host,
      height,
      waveColor,
      progressColor,
      cursorColor,
      cursorWidth: 1.5,
      barWidth,
      barGap,
      barRadius,
      interact,
      dragToSeek: interact,
      normalize: true,
      // MediaElement: reliable play/pause with blob:/https audio (WebAudio often stalls).
      backend: 'MediaElement',
      mediaControls: false,
    });
    wsRef.current = ws;

    const unsubs = [
      ws.on('ready', (duration) => {
        if (cancelled) return;
        readyUrlRef.current = src;
        cbRef.current.onReady?.(Number(duration) || ws.getDuration() || 0);
      }),
      ws.on('play', () => {
        if (!cancelled) cbRef.current.onPlay?.();
      }),
      ws.on('pause', () => {
        if (!cancelled) cbRef.current.onPause?.();
      }),
      ws.on('timeupdate', (time) => {
        if (!cancelled) cbRef.current.onTimeUpdate?.(Number(time) || 0);
      }),
      ws.on('interaction', (time) => {
        if (!cancelled) cbRef.current.onSeek?.(Number(time) || 0);
      }),
      ws.on('finish', () => {
        if (!cancelled) cbRef.current.onFinish?.();
      }),
    ];

    async function loadWaveform() {
      try {
        await ws.load(src);
      } catch (err) {
        if (!cancelled) console.warn('[AudioWaveform] load failed', err);
      }
    }
    void loadWaveform();

    return () => {
      cancelled = true;
      unsubs.forEach((off) => {
        try {
          off();
        } catch {
          /* ignore */
        }
      });
      try {
        ws.destroy();
      } catch {
        /* ignore */
      }
      if (wsRef.current === ws) wsRef.current = null;
      readyUrlRef.current = '';
    };
    // Style/height updates use setOptions below — recreate only on url / interact.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, interact]);

  // Live style / height without full reload.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || readyUrlRef.current !== String(url || '').trim()) return;
    try {
      ws.setOptions({
        height,
        waveColor,
        progressColor,
        cursorColor,
        barWidth,
        barGap,
        barRadius,
      });
    } catch {
      /* ignore mid-destroy */
    }
  }, [url, height, waveColor, progressColor, cursorColor, barWidth, barGap, barRadius]);

  return (
    <div
      ref={hostRef}
      className={cn('h-full w-full min-h-0 overflow-hidden [&_wave]:!block', className)}
      data-audio-waveform
    />
  );
}

const AudioWaveform = memo(forwardRef(AudioWaveformInner));
export default AudioWaveform;
