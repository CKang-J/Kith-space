/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/canvas/RcbSvgDefs.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { memo } from 'react';
/**
 * Optional shared SVG defs for the host app (markers / patterns).
 * Pass as `defs={<RcbSvgDefs />}` or your own defs node.
 */
function RcbSvgDefs() {
  return (
    <svg className="pointer-events-none absolute left-0 top-0 h-0 w-0 overflow-hidden" aria-hidden>
      <defs>
        <marker id="ic-arrowhead-dot" refX="3" refY="3" orient="0" markerWidth="6" markerHeight="6">
          <circle cx="3" cy="3" r="2" fill="currentColor" />
        </marker>
        <marker
          id="ic-arrowhead-cross"
          refX="3"
          refY="3"
          orient="auto"
          markerWidth="6"
          markerHeight="6"
        >
          <line x1="1.5" y1="1.5" x2="4.5" y2="4.5" stroke="currentColor" strokeWidth="1" />
          <line x1="1.5" y1="4.5" x2="4.5" y2="1.5" stroke="currentColor" strokeWidth="1" />
        </marker>
        <pattern id="ic-dot-grid" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.7" fill="currentColor" opacity="0.35" />
        </pattern>
      </defs>
    </svg>
  );
}

export default memo(RcbSvgDefs);
