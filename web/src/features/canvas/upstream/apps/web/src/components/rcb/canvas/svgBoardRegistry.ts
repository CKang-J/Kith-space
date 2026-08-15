/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/canvas/svgBoardRegistry.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Live editor paint board handle (runtime only — not Redux / document state).
 */
export type SvgBoardHandle = {
  root: SVGSVGElement;
  /** Layer that holds scene nodes (excludes chrome). */
  layer: SVGGElement;
  /** nodeId → SVG paint element */
  nodeEls: Map<string, SVGElement>;
  loadSeq?: number;
  getSvgElement: () => SVGSVGElement | null;
  /** Serialize scene layer for export (no UI chrome). */
  toSvgString: () => string;
};

let board: SvgBoardHandle | null = null;

export function setSvgBoard(next: SvgBoardHandle | null) {
  board = next;
}

export function getSvgBoard() {
  return board;
}
