/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/home/LazyTemplateThumb.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, useState, type ReactNode, memo } from 'react';
import { SoftGlowSurface } from '@recombyn-native/components/base';
import TemplateThumbnail from '@recombyn-native/components/templates/TemplateThumbnail';
import {
  projectThumbFrameClass,
  projectThumbZoomLayerClass,
} from '@recombyn-native/utils/projectThumb';
import { nearestScrollRoot } from '@recombyn-native/components/home/InfiniteScroll';
import { cn } from '@recombyn-native/utils/classnames';

type Props = {
  document?: unknown;
  fit?: 'contain' | 'cover';
  className?: string;
  children?: ReactNode;
  /** Keep thumb mounted once shown (default true). */
  once?: boolean;
};

/**
 * Mount TemplateThumbnail only when near viewport — avoids dozens of boards
 * rasterizing on the main thread at once for large project grids.
 */
function LazyTemplateThumb({
  document,
  fit = 'cover',
  className,
  children,
  once = true,
}: Props): ReactNode {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting);
        if (hit) {
          setActive(true);
          if (once) io.disconnect();
        } else if (!once) {
          setActive(false);
        }
      },
      { root: nearestScrollRoot(el), rootMargin: '200px 0px', threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  return (
    <div ref={rootRef} className={projectThumbFrameClass(className)}>
      <div className={cn('absolute inset-0', projectThumbZoomLayerClass)}>
        {active && document ? (
          <TemplateThumbnail document={document} fit={fit} />
        ) : (
          <SoftGlowSurface className="h-full w-full !rounded-none" seed="lazy-thumb" aria-hidden />
        )}
      </div>
      {children}
    </div>
  );
}

export default memo(LazyTemplateThumb);
