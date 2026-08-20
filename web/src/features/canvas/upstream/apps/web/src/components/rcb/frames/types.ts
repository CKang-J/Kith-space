/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/frames/types.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/** Editor artboard frame (document.frames). Canvas domain — not Redux-specific. */

/**
 * Idle artboard plate chrome — screen-constant hairline (not closed-rect #333).
 * World camera uses CSS `scale(zoom)`, so `vector-effect: non-scaling-stroke`
 * still thickens under zoom. Paint stroke in **scene** units = CSS_px / zoom.
 */
export const FRAME_PLATE_STROKE = 'color-mix(in srgb, var(--ink) 28%, transparent)';
/** Target hairline in CSS px after camera scale. */
export const FRAME_PLATE_STROKE_WIDTH = 1;

/** Scene stroke width so CSS `scale(zoom)` yields ~FRAME_PLATE_STROKE_WIDTH CSS px. */
export function framePlateStrokeSceneWidth(zoom: number): number {
  return FRAME_PLATE_STROKE_WIDTH / Math.max(0.05, Number(zoom) || 1);
}

export type ArtboardFrame = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor: string;
  /** Legacy alias some exporters still read; prefer backgroundColor. */
  fill?: string;
  layoutMode?: 'auto' | 'manual';
  /** When true, frame cannot be moved or resized. */
  locked?: boolean;
  /** When true, artboard plate + chrome are hidden (layer panel eye). */
  hidden?: boolean;
  /** When true, drag-resize / W·H edits keep width:height (Shift temporarily unlocks). */
  lockAspect?: boolean;
  /** When true, content outside the frame bounds is clipped (hidden). */
  clipContent?: boolean;
  /** Size before first ratio preset — restored by 「原始」. */
  aspectOriginalWidth?: number;
  aspectOriginalHeight?: number;
  /**
   * Legacy artboard generating chrome. AI overlay now lives in editor
   * `aiOperationState` (ephemeral). Kept so old Yjs/clipboard docs can strip it.
   */
  processStatus?: 'running' | null;
  processLabel?: string;
  processKind?: 'design' | 'import' | string;
};
