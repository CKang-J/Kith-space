/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/textArea/index.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import React, { forwardRef, useRef, useEffect, useCallback } from 'react';
import { Textarea as HeadlessTextarea } from '@headlessui/react';
import { memo, type TextareaHTMLAttributes } from 'react';
import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';
import { cn } from '@recombyn-native/utils/classnames';
import { useDebounceFn } from 'ahooks';

export const textAreaVariants = cva(
  '',
  {
    variants: {
      size: {
        small: 'px-2 py-1 text-xs',
        middle: 'px-3 py-2 text-sm',
        large: 'px-4 py-3 text-base',
      },
      type: {
        outlined: '',
        filled: '',
        borderless: 'border-0',
        underlined: 'border-0 border-b rounded-none',
      },
    },
    defaultVariants: {
      size: 'middle',
      type: 'outlined',
    },
  }
);

type TextAreaVariantProps = VariantProps<typeof textAreaVariants>;

export interface TextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  size?: TextAreaVariantProps['size'];
  type?: TextAreaVariantProps['type'];
  disabled?: boolean;
  showCount?: boolean;
  maxLength?: number;
  /** Auto-grow height; boolean or `{ minRows, maxRows }` */
  autoSize?: boolean | { minRows?: number; maxRows?: number };
}

const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  (
    {
      size,
      type,
      disabled = false,
      showCount = false,
      maxLength,
      autoSize,
      className,
      value,
      onChange,
      ...rest
    },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const combinedRef = (ref || textareaRef) as React.RefObject<HTMLTextAreaElement>;

    const adjustHeight = useCallback(() => {
      if (!autoSize || !combinedRef.current) return;

      const textarea = combinedRef.current;
      textarea.style.height = 'auto';
      let height = textarea.scrollHeight;

      if (typeof autoSize === 'object') {
        const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
        const minHeight = (autoSize.minRows || 2) * lineHeight;
        const maxHeight = autoSize.maxRows ? autoSize.maxRows * lineHeight : Infinity;
        height = Math.min(Math.max(height, minHeight), maxHeight);
      }

      textarea.style.height = `${height}px`;
    }, [autoSize, combinedRef]);

    const { run: debouncedAdjustHeight } = useDebounceFn(
      adjustHeight,
      {
        wait: 16,
      }
    );

    useEffect(() => {
      if (autoSize && combinedRef.current) {
        adjustHeight();
      }
    }, [autoSize, adjustHeight, combinedRef]);

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange?.(e);
        if (autoSize) {
          debouncedAdjustHeight();
        }
      },
      [onChange, autoSize, debouncedAdjustHeight]
    );

    const displayValue = String(value ?? '');

    const textareaElement = (
      <HeadlessTextarea
        ref={combinedRef}
        disabled={disabled}
        className={cn(
          'w-full appearance-none outline-none resize-none overflow-auto',
          'bg-[var(--color-background-default-secondary)] text-[var(--color-text-default-base)]',
          'placeholder:text-[var(--color-text-default-tertiary)]',
          textAreaVariants({ size, type }),
          type === 'outlined' && 'border-[0.5px] border-[var(--color-border-default-base)] rounded',
          type === 'outlined' && 'data-focus:border-[var(--color-brand-base)] data-focus:ring-1 data-focus:ring-[var(--color-brand-base)]',
          type === 'outlined' && 'data-hover:border-[var(--color-border-default-base-hover)]',
          type === 'filled' && 'border-0 rounded',
          type === 'borderless' && 'rounded',
          type === 'underlined' && 'rounded-none border-b-[var(--color-border-default-base)] data-focus:border-b-[var(--color-brand-base)]',
          'data-disabled:cursor-not-allowed data-disabled:bg-[var(--color-background-neutral-tertiary)] data-disabled:text-[var(--color-text-default-tertiary)] data-disabled:opacity-60',
          className
        )}
        value={value}
        onChange={handleChange}
        maxLength={maxLength}
        {...rest}
      />
    );

    if (!showCount) {
      return textareaElement;
    }

    return (
      <div className='relative w-full'>
        {textareaElement}
        {showCount && (
          <div className={cn(
            'absolute right-0 flex items-center text-[var(--color-text-default-tertiary)] text-xs pointer-events-none',
            size === 'small' && 'right-2 bottom-2',
            size === 'middle' && 'right-3 bottom-3',
            size === 'large' && 'right-4 bottom-4'
          )}>
            {maxLength ? `${displayValue.length} / ${maxLength}` : displayValue.length}
          </div>
        )}
      </div>
    );
  }
);

TextArea.displayName = 'TextArea';

export default memo(TextArea);