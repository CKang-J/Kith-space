/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/tools/ImagePlaceFeature.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  useRcbScreenToScene,
} from '../camera/context';
import { useEffect, memo } from 'react';

type ImagePlaceFeatureProps = {
  enabled: boolean;
  artboard: { width: number; height: number };
  paperEl: HTMLElement | null;
  stageEl?: HTMLElement | null;
  pendingSrc: string | null;
  onPlace: (src: string, x: number, y: number) => void;
};

/** Click-to-place pending image. */
function ImagePlaceFeature({
  enabled,
  artboard,
  paperEl,
  stageEl = null,
  pendingSrc,
  onPlace,
}: ImagePlaceFeatureProps) {
  const toScene = useRcbScreenToScene();
  useEffect(() => {
    const hitEl = stageEl || paperEl;
    if (!enabled || !hitEl || !pendingSrc) return undefined;
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const p = toScene(e.clientX, e.clientY);
      onPlace(pendingSrc, p.x, p.y);
    };
    hitEl.addEventListener('click', onClick);
    return () => hitEl.removeEventListener('click', onClick);
  }, [enabled, paperEl, stageEl, toScene, pendingSrc, onPlace]);

  return null;
}

export default memo(ImagePlaceFeature);
