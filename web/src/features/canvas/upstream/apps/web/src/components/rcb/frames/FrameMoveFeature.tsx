/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/frames/FrameMoveFeature.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, memo } from 'react';
import type { RcbCamera } from '../core/types';
import { rcbResolveViewportEl, rcbScreenToScene } from '../core/math';
import type { ArtboardFrame } from '@recombyn-native/components/rcb/frames/types';
import { bridgeSceneHitTest } from '@recombyn-native/components/rcb/scene/document/sceneHitBridge';

/** Soft-click deselect threshold (CSS px²). */
const DRAG_DISTANCE_SQUARED = 16;

type Props = {
  enabled: boolean;
  frames: ArtboardFrame[];
  camera: RcbCamera;
  stageEl: HTMLElement | null;
  /** Soft-click on empty stage (no frame / content) — clear node + frame focus. */
  onClearSelection?: () => void;
};

function clientToWorld(
  stageEl: HTMLElement,
  camera: RcbCamera,
  clientX: number,
  clientY: number
) {
  return rcbScreenToScene(camera, stageEl, clientX, clientY);
}

function hitFrame(frames: ArtboardFrame[], x: number, y: number): ArtboardFrame | null {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const f = frames[i];
    if (x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height) return f;
  }
  return null;
}

const SKIP_SELECTOR = [
  '[data-scene-node-id]',
  '[data-sel-box]',
  '[data-sel-handle]',
  '[data-sel-toolbar]',
  '[data-frame-toolbar]',
  '[data-frame-label]',
  '[data-image-label]',
  '[data-ctx-menu]',
  '[data-text-inline-editor]',
  '[data-crop-expand-overlay]',
  '[data-crop-expand-toolbar]',
  '[data-image-tool-panel]',
  '[data-shape-style-panel]',
].join(',');

/**
 * Select tool: soft-click empty stage to clear selection.
 * Marquee / soft-click→select-frame / resize live in SelectionFeature;
 * artboard move is via the frame title label (HtmlArtboardFrame).
 */
function FrameMoveFeature({ enabled, frames, camera, stageEl, onClearSelection }: Props) {
  const dragRef = useRef<{ clientX0: number; clientY0: number } | null>(null);
  const framesRef = useRef(frames);
  const cameraRef = useRef(camera);
  const onClearSelectionRef = useRef(onClearSelection);
  framesRef.current = frames;
  cameraRef.current = camera;
  onClearSelectionRef.current = onClearSelection;

  useEffect(() => {
    const liveStage = rcbResolveViewportEl(stageEl);
    if (!enabled || !liveStage) return undefined;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as Element | null;
      if (target?.closest?.(SKIP_SELECTOR)) return;

      const p = clientToWorld(liveStage, cameraRef.current, e.clientX, e.clientY);
      if (bridgeSceneHitTest(p.x, p.y, { clientX: e.clientX, clientY: e.clientY })) return;
      if (hitFrame(framesRef.current, p.x, p.y)) return;

      const ae = document.activeElement;
      if (ae instanceof HTMLElement && ae.closest('[data-text-inline-editor]')) {
        ae.blur();
      }
      dragRef.current = { clientX0: e.clientX, clientY0: e.clientY };
    };

    const onMoveWin = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const distSq = (e.clientX - drag.clientX0) ** 2 + (e.clientY - drag.clientY0) ** 2;
      if (distSq > DRAG_DISTANCE_SQUARED) dragRef.current = null;
    };

    // Surviving soft-click deselect only — past-threshold moves already cleared dragRef.
    const onUp = (e: PointerEvent) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      if (e.type === 'pointerup') onClearSelectionRef.current?.();
    };

    liveStage.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMoveWin);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      liveStage.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMoveWin);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [enabled, stageEl]);

  return null;
}

/** True when world point under cursor is inside any frame (for blocking empty-canvas pan). */
export function clientHitsFrame(
  stageEl: HTMLElement,
  camera: RcbCamera,
  frames: ArtboardFrame[],
  clientX: number,
  clientY: number
) {
  const p = clientToWorld(stageEl, camera, clientX, clientY);
  return Boolean(hitFrame(frames, p.x, p.y));
}

export default memo(FrameMoveFeature);
