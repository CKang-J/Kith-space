/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/input/index.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import React, { forwardRef } from 'react';
import { Input as HeadlessInput } from '@headlessui/react';
import { memo, type InputHTMLAttributes } from 'react';
import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';
import { cn } from '@recombyn-native/utils/classnames';
import { Icon } from '@recombyn-native/components/base/icon';

export const inputVariants = cva(
  '',
  {
    variants: {
      size: {
        small: 'h-6 px-2 text-xs',
        middle: 'h-8 px-3 text-sm',
        large: 'h-10 px-4 text-base',
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

type InputVariantProps = VariantProps<typeof inputVariants>;

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix' | 'type'> {
  size?: InputVariantProps['size'];
  type?: InputVariantProps['type'];
  /** Native `input` type */
  inputType?: InputHTMLAttributes<HTMLInputElement>['type'];
  disabled?: boolean;
  allowClear?: boolean;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  showCount?: boolean;
  maxLength?: number;
  onClear?: () => void;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      size,
      type,
      inputType,
      disabled = false,
      allowClear = false,
      prefix,
      suffix,
      showCount = false,
      maxLength,
      onClear,
      className,
      value,
      onChange,
      ...rest
    },
    ref
  ) => {
    const hasPrefix = Boolean(prefix);
    const hasSuffix = Boolean(suffix) || allowClear || showCount;
    const displayValue = String(value ?? '');
    const showClearIcon = allowClear && value && !disabled;
    const inputTypeValue = type ?? 'outlined';

    const handleClear = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onClear?.();
      if (onChange) {
        const syntheticEvent = {
          target: { value: '' },
          currentTarget: { value: '' },
        } as React.ChangeEvent<HTMLInputElement>;
        onChange(syntheticEvent);
      }
    };

    const inputElement = (
      <HeadlessInput
        ref={ref}
        type={inputType}
        disabled={disabled}
        className={cn(
          'w-full appearance-none outline-none',
          'bg-[var(--color-background-default-secondary)] text-[var(--color-text-default-base)]',
          'placeholder:text-[var(--color-text-default-tertiary)]',
          inputVariants({ size, type }),
          inputType === 'number' &&
            '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          inputTypeValue === 'outlined' &&
            'rounded-xl border-[0.5px] border-[var(--color-border-default-base)]',
          inputTypeValue === 'outlined' && 'data-focus:border-[var(--color-brand-base)] data-focus:ring-1 data-focus:ring-[var(--color-brand-base)]',
          inputTypeValue === 'outlined' && 'data-hover:border-[var(--color-border-default-base-hover)]',
          inputTypeValue === 'filled' && 'border-0 rounded-xl',
          inputTypeValue === 'borderless' && 'rounded-xl',
          inputTypeValue === 'underlined' && 'rounded-none border-b-[var(--color-border-default-base)] data-focus:border-b-[var(--color-brand-base)]',
          hasPrefix && size === 'small' && 'pl-6',
          hasPrefix && size === 'middle' && 'pl-8',
          hasPrefix && size === 'large' && 'pl-10',
          hasSuffix && size === 'small' && 'pr-6',
          hasSuffix && size === 'middle' && 'pr-8',
          hasSuffix && size === 'large' && 'pr-10',
          'data-disabled:cursor-not-allowed data-disabled:bg-[var(--color-background-neutral-tertiary)] data-disabled:text-[var(--color-text-default-tertiary)] data-disabled:opacity-60',
          className
        )}
        value={value}
        onChange={onChange}
        maxLength={maxLength}
        {...rest}
      />
    );

    if (!hasPrefix && !hasSuffix) {
      return inputElement;
    }

    return (
      <div
        className={cn(
          'relative inline-flex min-w-0 items-center',
          // Prefer width from className (e.g. w-[52px]); only stretch when caller didn't size it
          !(typeof className === 'string' && /(^|\s)!?w-/.test(className)) && 'w-full'
        )}
      >
        {prefix && (
          <span className={cn(
            'absolute left-0 flex items-center text-[var(--color-text-default-tertiary)] pointer-events-none',
            size === 'small' && 'left-2',
            size === 'middle' && 'left-3',
            size === 'large' && 'left-4'
          )}>
            {prefix}
          </span>
        )}
        {inputElement}
        {suffix && (
          <span className={cn(
            'absolute right-0 flex items-center text-[var(--color-text-default-tertiary)] pointer-events-none',
            size === 'small' && 'right-2',
            size === 'middle' && 'right-3',
            size === 'large' && 'right-4'
          )}>
            {suffix}
          </span>
        )}
        {showClearIcon && (
          <span
            className={cn(
              'absolute right-0 flex items-center cursor-pointer',
              size === 'small' && 'right-2',
              size === 'middle' && 'right-3',
              size === 'large' && 'right-4'
            )}
            onClick={handleClear}
          >
            <Icon
              name='base-close-icon'
              width={14}
              height={14}
              color='var(--color-text-default-tertiary)'
            />
          </span>
        )}
        {showCount && maxLength && (
          <span className={cn(
            'absolute right-0 flex items-center text-[var(--color-text-default-tertiary)] text-xs pointer-events-none',
            size === 'small' && 'right-2 bottom-[-18px]',
            size === 'middle' && 'right-3 bottom-[-18px]',
            size === 'large' && 'right-4 bottom-[-18px]'
          )}>
            {displayValue.length} / {maxLength}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export type InputRef = React.RefObject<HTMLInputElement>;

export { Input };
export default memo(Input);