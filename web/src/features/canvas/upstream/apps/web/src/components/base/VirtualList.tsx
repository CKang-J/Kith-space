/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/VirtualList.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  forwardRef,
  memo,
  useImperativeHandle,
  useRef,
  type ReactNode,
  type Ref,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@recombyn-native/utils/classnames';

export type VirtualListHandle = {
  /** Scroll element (overflow container). */
  getScrollElement: () => HTMLDivElement | null;
  /** Jump to end — chat stick-to-bottom. */
  scrollToBottom: () => void;
  /** Scroll a row into view. */
  scrollToIndex: (index: number, opts?: { align?: 'start' | 'center' | 'end' | 'auto' }) => void;
};

type VirtualListProps<T> = {
  items: T[];
  /** Approximate row height before measure (px). */
  estimateSize?: number | ((index: number) => number);
  overscan?: number;
  /** Gap between rows (px). */
  gap?: number;
  getItemKey?: (item: T, index: number) => string | number;
  className?: string;
  contentClassName?: string;
  /** Shown when `items` is empty (still fills the overflow shell). */
  empty?: ReactNode;
  children: (item: T, index: number) => ReactNode;
};

/**
 * Virtual list (windowing): only mounts rows in/near the viewport.
 * Outer shell is `overflow-y-auto` + `min-h-0` for flex layouts.
 */
function VirtualListInner<T>(
  {
    items,
    estimateSize = 140,
    overscan = 6,
    gap = 0,
    getItemKey,
    className,
    contentClassName,
    empty = null,
    children,
  }: VirtualListProps<T>,
  ref: Ref<VirtualListHandle>
) {
  const parentRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize:
      typeof estimateSize === 'function' ? estimateSize : () => estimateSize,
    overscan,
    gap,
    getItemKey: getItemKey
      ? (index) => getItemKey(items[index]!, index)
      : (index) => index,
  });

  useImperativeHandle(
    ref,
    () => ({
      getScrollElement: () => parentRef.current,
      scrollToBottom: () => {
        const el = parentRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
      },
      scrollToIndex: (index, opts) => {
        virtualizer.scrollToIndex(index, { align: opts?.align ?? 'auto' });
      },
    }),
    [virtualizer]
  );

  if (items.length === 0) {
    return (
      <div
        ref={parentRef}
        className={cn(
          'relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto',
          className
        )}
      >
        {empty}
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className={cn(
        'relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto',
        className
      )}
    >
      <div
        className={cn('relative w-full', contentClassName)}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${row.start}px)` }}
          >
            {children(items[row.index]!, row.index)}
          </div>
        ))}
      </div>
    </div>
  );
}

export const VirtualList = memo(forwardRef(VirtualListInner)) as <T>(
  props: VirtualListProps<T> & { ref?: Ref<VirtualListHandle> }
) => ReactNode;
