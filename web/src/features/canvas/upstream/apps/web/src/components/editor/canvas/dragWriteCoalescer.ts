/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/canvas/dragWriteCoalescer.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { VideoGeomOverride } from '@recombyn-native/components/editor/nodes/VideoNode/VideoNodeOverlay';

export type FrameGeomLive = { id: string; x: number; y: number; width: number; height: number };

/**
 * Coalesce high-frequency frame Redux writes to one rAF.
 * Video live geom applies synchronously — SVG preview is already sync, and
 * rAF-throttled HTML plates leave a second visible layer (SVG poster vs
 * `<video>`) while moving.
 */
export function createDragWriteCoalescer(
  apply: (batch: {
    frames: FrameGeomLive[];
    videoGeom?: Record<string, VideoGeomOverride> | null;
  }) => void
) {
  let raf = 0;
  const pendingFrames = new Map<string, FrameGeomLive>();
  /** Latest intended video overrides (kept for merge-on-move / angle preview). */
  let pendingVideo: Record<string, VideoGeomOverride> | null = null;

  const runFlush = () => {
    raf = 0;
    const frames = [...pendingFrames.values()];
    pendingFrames.clear();
    if (!frames.length) return;
    apply({ frames });
  };

  return {
    queueFrames(frames: FrameGeomLive[]) {
      for (const f of frames) pendingFrames.set(f.id, f);
      if (!raf) raf = requestAnimationFrame(runFlush);
    },
    queueVideoGeom(next: Record<string, VideoGeomOverride> | null) {
      pendingVideo = next;
      apply({ frames: [], videoGeom: next });
    },
    getPendingVideoGeom() {
      return pendingVideo;
    },
    /** Drop pending work without applying (commit owns the final document). */
    cancel() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      pendingFrames.clear();
      pendingVideo = null;
    },
  };
}
