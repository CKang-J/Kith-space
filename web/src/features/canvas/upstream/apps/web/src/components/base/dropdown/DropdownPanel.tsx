/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/dropdown/DropdownPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  forwardRef,
  memo,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@recombyn-native/utils/classnames';

type DropdownPanelProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

/**
 * Shared floating menu shell — xl radius (size / agent popovers), opaque fill + shadow.
 */
export const DropdownPanel = memo(
  forwardRef<HTMLDivElement, DropdownPanelProps>(function DropdownPanel(
    { className, children, style, ...rest },
    ref
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-col gap-0.5 overflow-hidden rounded-xl bg-[var(--surface)] p-1',
          'shadow-[0_8px_28px_rgba(15,23,42,0.16)] ring-1 ring-[var(--line)]',
          'focus:outline-none focus-visible:outline-none',
          className
        )}
        // Inline surface so canvas chrome under the same z-band cannot show through.
        style={{ backgroundColor: 'var(--surface)', ...(style as CSSProperties | undefined) }}
        {...rest}
      >
        {children}
      </div>
    );
  })
);

type DropdownPanelItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  children: ReactNode;
};

/** Menu row — full-width soft selected fill, fixed height. */
export const DropdownPanelItem = memo(
  forwardRef<HTMLButtonElement, DropdownPanelItemProps>(function DropdownPanelItem(
    { selected = false, className, children, type = 'button', disabled, ...rest },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        aria-selected={selected}
        className={cn(
          'flex h-8 w-full shrink-0 items-center gap-2 rounded-lg px-2.5 text-left text-[12px] font-medium text-[var(--ink)] transition-colors',
          disabled && 'cursor-not-allowed opacity-50',
          !disabled && (selected ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--accent-soft)]'),
          className
        )}
        {...rest}
      >
        {children}
      </button>
    );
  })
);
