/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/canvas/SvgPaper.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { memo, type CSSProperties, ReactNode, Ref } from 'react';

type SvgPaperProps = {
  paperRef: Ref<HTMLDivElement>;
  hostRef: Ref<HTMLDivElement>;
  width: number;
  height: number;
  background: string;
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
  /**
   * shapes layer: no fixed paper size. Camera CSS on parent world
   * layer owns pan/zoom; SVG overflows visibly in scene coordinates.
   */
  infinite?: boolean;
};

/**
 * Scene shapes host. Visual zoom/pan is owned by RcbCanvas world transform.
 */
function SvgPaper({
  paperRef,
  hostRef,
  width,
  height,
  background,
  children,
  style,
  className,
  infinite = false,
}: SvgPaperProps) {
  if (infinite) {
    return (
      <div
        ref={paperRef}
        className={className || 'rcb-shapes relative overflow-visible'}
        data-rcb-shapes="1"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          overflow: 'visible',
          background: 'transparent',
          ...style,
        }}
      >
        <div
          ref={hostRef}
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          data-rcb-shapes-host="1"
          style={{ width: 0, height: 0, overflow: 'visible' }}
        />
        {children}
      </div>
    );
  }

  return (
    <div
      ref={paperRef}
      className={className || 'rcb-canvas-paper relative overflow-visible'}
      data-doc-width={width}
      data-doc-height={height}
      style={{
        width,
        height,
        background,
        overflow: 'visible',
        ...style,
      }}
    >
      <div ref={hostRef} className="absolute inset-0 overflow-visible [&>svg]:h-full [&>svg]:w-full" />
      {children}
    </div>
  );
}

export default memo(SvgPaper);
