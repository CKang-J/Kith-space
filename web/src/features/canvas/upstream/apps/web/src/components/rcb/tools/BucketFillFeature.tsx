/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/tools/BucketFillFeature.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, memo } from 'react';
import {
  rcbResolveViewportEl,
  rcbScreenToScene,
} from '../core/math';
import {
  useRcbCamera,
  useRcbViewportEl,
} from '../camera/context';

function clientToPaperScene(
  paperEl: HTMLElement | null,
  artboard: { width: number; height: number },
  clientX: number,
  clientY: number
) {
  if (!paperEl) return { x: 0, y: 0 };
  const rect = paperEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  const w = Math.max(1, artboard.width);
  const h = Math.max(1, artboard.height);
  return {
    x: ((clientX - rect.left) / rect.width) * w,
    y: ((clientY - rect.top) / rect.height) * h,
  };
}

type Props = {
  enabled: boolean;
  artboard: { width: number; height: number };
  paperEl: HTMLElement | null;
  stageEl?: HTMLElement | null;
  fillColor: string;
  hitTest: (x: number, y: number, screen?: { clientX: number; clientY: number }) => string | null;
  onFill: (nodeId: string) => void;
};

/**
 * Paint-bucket: click a shape → apply current FillPanel value.
 */
function BucketFillFeature({
  enabled,
  artboard,
  paperEl,
  stageEl = null,
  fillColor,
  hitTest,
  onFill,
}: Props) {
  const camera = useRcbCamera();
  const viewportEl = useRcbViewportEl();
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const hitRef = useRef(hitTest);
  const onFillRef = useRef(onFill);
  hitRef.current = hitTest;
  onFillRef.current = onFill;

  useEffect(() => {
    const hitEl = rcbResolveViewportEl(viewportEl, stageEl, paperEl);
    if (!enabled || !hitEl) return undefined;

    const toScene = (clientX: number, clientY: number) => {
      const stage = rcbResolveViewportEl(viewportEl, stageEl);
      if (stage) return rcbScreenToScene(cameraRef.current, stage, clientX, clientY);
      return clientToPaperScene(paperEl, artboard, clientX, clientY);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target as Element | null;
      if (
        t?.closest?.(
          '[data-sel-toolbar],[data-frame-toolbar],[data-ctx-menu],[data-image-tool-panel],[data-shape-style-panel],[data-color-panel]'
        )
      ) {
        return;
      }
      const p = toScene(e.clientX, e.clientY);
      const id = hitRef.current(p.x, p.y, { clientX: e.clientX, clientY: e.clientY });
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      onFillRef.current(id);
    };

    hitEl.addEventListener('pointerdown', onDown, true);
    return () => {
      hitEl.removeEventListener('pointerdown', onDown, true);
    };
  }, [enabled, paperEl, stageEl, viewportEl, artboard]);

  // Keep fillColor in the dependency list for future cursor tint; unused for hit logic.
  void fillColor;

  return null;
}

export default memo(BucketFillFeature);
