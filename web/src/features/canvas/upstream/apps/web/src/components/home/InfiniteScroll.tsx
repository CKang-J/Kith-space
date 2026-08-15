/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/home/InfiniteScroll.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, type ReactNode, type RefObject, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandWordmarkLoader } from '@recombyn-native/components/base/AppLogo';
import { cn } from '@recombyn-native/utils/classnames';

/** Walk up to the nearest overflow scroll container (Home / Me nested panels). */
export function nearestScrollRoot(el: HTMLElement | null): Element | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

type ScrollLoadMoreOptions = {
  hasMore: boolean;
  /** Initial / blocking load — do not fire load-more. */
  loading?: boolean;
  loadingMore?: boolean;
  onLoadMore: () => void;
  rootMargin?: string;
};

/**
 * IntersectionObserver against the nearest scroll parent.
 * Call `onLoadMore` when the sentinel enters the viewport (with rootMargin prefetch).
 */
export function useScrollLoadMore({
  hasMore,
  loading = false,
  loadingMore = false,
  onLoadMore,
  rootMargin = '320px 0px',
}: ScrollLoadMoreOptions) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading || loadingMore) return undefined;
    const root = nearestScrollRoot(el);
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        onLoadMoreRef.current();
      },
      { root, rootMargin, threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, loadingMore, rootMargin]);

  return sentinelRef;
}

type ScrollLoadFooterProps = {
  sentinelRef: RefObject<HTMLDivElement | null>;
  hasMore: boolean;
  loadingMore?: boolean;
  className?: string;
};

/** Bottom sentinel — brand wordmark while the next page is fetching. */
function ScrollLoadFooter({
  sentinelRef,
  hasMore,
  loadingMore = false,
  className,
}: ScrollLoadFooterProps) {
  const { t } = useTranslation();
  if (!hasMore && !loadingMore) return null;
  return (
    <div
      ref={sentinelRef}
      className={cn('flex h-14 w-full items-center justify-center', className)}
      aria-busy={loadingMore || undefined}
      aria-hidden={!loadingMore}
    >
      {loadingMore ? (
        <BrandWordmarkLoader label={t('common.loading')} />
      ) : null}
    </div>
  );
}

type InfiniteScrollSectionProps = {
  loading: boolean;
  loadingMore?: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  isEmpty?: boolean;
  empty?: ReactNode;
  /** Shown while `loading` (usually a grid of skeletons). */
  skeleton: ReactNode;
  gridClassName?: string;
  className?: string;
  children: ReactNode;
};

/**
 * Shared list shell: initial skeleton → empty → grid + scroll-load footer.
 * Used by Home plaza, Projects, and Me.
 */
function InfiniteScrollSection({
  loading,
  loadingMore = false,
  hasMore,
  onLoadMore,
  isEmpty = false,
  empty = null,
  skeleton,
  gridClassName,
  className,
  children,
}: InfiniteScrollSectionProps) {
  const sentinelRef = useScrollLoadMore({
    hasMore,
    loading,
    loadingMore,
    onLoadMore,
  });

  if (loading) {
    return (
      <div className={cn(className)}>
        <div className={cn(gridClassName)}>{skeleton}</div>
      </div>
    );
  }

  if (isEmpty) {
    return <div className={cn(className)}>{empty}</div>;
  }

  return (
    <div className={cn(className)}>
      <div className={cn(gridClassName)}>{children}</div>
      <ScrollLoadFooter
        sentinelRef={sentinelRef}
        hasMore={hasMore}
        loadingMore={loadingMore}
      />
    </div>
  );
}

type SkeletonGridProps = {
  count: number;
  className?: string;
  children: (index: number) => ReactNode;
};

/** Renders `count` skeleton placeholders inside an optional grid class. */
function SkeletonGrid({ count, className, children }: SkeletonGridProps) {
  return (
    <div className={cn(className)} aria-busy="true">
      {Array.from({ length: count }, (_, i) => children(i))}
    </div>
  );
}

/** Default skeleton card count — ~2 rows on a 5-column home grid. */
export const GRID_SKELETON_COUNT = 10;

const MemoizedScrollLoadFooter = memo(ScrollLoadFooter);
export { MemoizedScrollLoadFooter as ScrollLoadFooter };
const MemoizedInfiniteScrollSection = memo(InfiniteScrollSection);
export { MemoizedInfiniteScrollSection as InfiniteScrollSection };
const MemoizedSkeletonGrid = memo(SkeletonGrid);
export { MemoizedSkeletonGrid as SkeletonGrid };
