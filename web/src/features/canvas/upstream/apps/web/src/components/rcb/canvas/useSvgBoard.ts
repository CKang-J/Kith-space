/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/canvas/useSvgBoard.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createSvgBoard } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import { setSvgBoard, type SvgBoardHandle } from './svgBoardRegistry';

/**
 * Mount pure-SVG board onto a host element and register it for export.
 */
export function useSvgBoard(
  hostRef: RefObject<HTMLElement | null>,
  paperW: number,
  paperH: number,
  opts?: { infinite?: boolean; enabled?: boolean }
) {
  const boardRef = useRef<SvgBoardHandle | null>(null);
  const [boardEpoch, setBoardEpoch] = useState(0);
  const infinite = Boolean(opts?.infinite);
  const enabled = opts?.enabled !== false;

  useEffect(() => {
    if (!enabled) {
      boardRef.current = null;
      setSvgBoard(null);
      setBoardEpoch((n) => n + 1);
      return undefined;
    }
    const host = hostRef.current;
    if (!host) return undefined;
    const { root, layer } = createSvgBoard(host, paperW, paperH, { infinite });
    const handle: SvgBoardHandle = {
      root,
      layer,
      nodeEls: new Map(),
      getSvgElement: () => root,
      toSvgString: () => {
        const clone = root.cloneNode(true) as SVGSVGElement;
        return new XMLSerializer().serializeToString(clone);
      },
    };
    boardRef.current = handle;
    setSvgBoard(handle);
    setBoardEpoch((n) => n + 1);

    return () => {
      if (boardRef.current === handle) {
        setSvgBoard(null);
        boardRef.current = null;
      }
      root.remove();
    };
    // Remount when infinite mode flips; paper size for finite boards is applied elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infinite, enabled]);

  return { boardRef, boardEpoch };
}
