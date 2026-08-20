/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/chrome/FloatingToolbar.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { forwardRef, memo, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@recombyn-native/utils/classnames';

type FloatingToolbarProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /** Transparent / unstyled chrome (e.g. icon-only host). */
  bare?: boolean;
};

/**
 * Floating editor toolbar chrome — full pill ends (tool strips / HUD).
 */
export const FloatingToolbar = memo(
  forwardRef<HTMLDivElement, FloatingToolbarProps>(
    function FloatingToolbar({ bare = false, className, children, ...rest }, ref) {
      return (
        <div
          ref={ref}
          className={cn(
            'flex shrink-0 items-center gap-0.5 whitespace-nowrap',
            bare
              ? 'rounded-full bg-transparent p-0 shadow-none ring-0'
              : 'rounded-full bg-[var(--surface)] px-1.5 py-1 shadow-[0_8px_28px_rgba(15,23,42,0.16)] ring-1 ring-[var(--line)]',
            className
          )}
          {...rest}
        >
          {children}
        </div>
      );
    }
  )
);
