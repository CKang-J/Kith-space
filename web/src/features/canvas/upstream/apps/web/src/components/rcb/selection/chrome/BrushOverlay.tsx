/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/chrome/BrushOverlay.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Marquee brush overlay.
 *
 * Same world-SVG paint contract as SelectionChrome — scene coords + `px/zoom`.
 */
import { useRcbCamera } from '@recombyn-native/components/rcb/camera/context';
import {
  CHROME_STROKE_PX,
  WorldSvgFrame,
  type SceneBox,
} from '../SelectionChrome';

const BRUSH_FILL = 'rgba(51,136,255,0.08)';
const BRUSH_STROKE = '#3388ff';

export default function BrushOverlay({ box }: { box: SceneBox | null }) {
  const camera = useRcbCamera();
  if (!box || !(box.width > 0) || !(box.height > 0)) return null;

  const z = Math.max(0.05, camera.zoom || 1);
  const stroke = CHROME_STROKE_PX / z;

  return (
    <WorldSvgFrame
      left={box.left}
      top={box.top}
      width={box.width}
      height={box.height}
      pad={stroke}
      zClass="z-[11]"
    >
      <rect
        x={box.left}
        y={box.top}
        width={Math.max(1, box.width)}
        height={Math.max(1, box.height)}
        fill={BRUSH_FILL}
        stroke={BRUSH_STROKE}
        strokeWidth={stroke}
      />
    </WorldSvgFrame>
  );
}
