/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/checkbox/Checkbox.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import React, { forwardRef, memo, useContext, useState, useImperativeHandle, useRef } from 'react';
import { Checkbox as HeadlessCheckbox } from '@headlessui/react';
import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';
import { cn } from '@recombyn-native/utils/classnames';
import { CheckboxGroupContext } from './CheckboxGroupContext';

export interface CheckboxChangeEvent {
  target: {
    checked: boolean;
  };
  stopPropagation: () => void;
  preventDefault: () => void;
  nativeEvent: MouseEvent;
}

export interface CheckboxGroupContextValue {
  value?: (string | number)[];
  onChange?: (checkedValue: (string | number)[]) => void;
  disabled?: boolean;
  name?: string;
}

export interface CheckboxGroupOption {
  label: React.ReactNode;
  value: string | number;
  disabled?: boolean;
}

const checkboxVariants = cva(
  'group relative inline-flex items-center justify-center cursor-pointer',
  {
    variants: {
      size: {
        small: 'size-4',
        medium: 'size-5',
        large: 'size-6',
      },
      type: {
        default:
          'border-[0.5px] border-[var(--color-border-default-base)] bg-[var(--color-background-default-secondary)]',
        filled: 'border-0 bg-[var(--color-background-default-secondary)]',
        outlined: 'border-[0.5px] border-[var(--color-border-default-base)] bg-transparent',
      },
      shape: {
        square: 'rounded-sm',
        circle: 'rounded-full',
      },
    },
    defaultVariants: {
      size: 'medium',
      type: 'default',
      shape: 'square',
    },
  }
);

type CheckboxVariantProps = VariantProps<typeof checkboxVariants>;

export interface CheckboxProps {
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  /** Visual-only indeterminate state */
  indeterminate?: boolean;
  onChange?: (e: CheckboxChangeEvent) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  /** @default 'medium' */
  size?: CheckboxVariantProps['size'];
  /** @default 'default' */
  type?: CheckboxVariantProps['type'];
  /** @default 'square' */
  shape?: CheckboxVariantProps['shape'];
  className?: string;
  style?: React.CSSProperties;
  value?: string | number;
  icon?: React.ReactNode;
  /** @default true */
  showIcon?: boolean;
  children?: React.ReactNode;
}

/**
 * Single checkbox; pairs with `CheckboxGroup` via context.
 *
 * @example
 * ```tsx
 * const [checked, setChecked] = useState(false);
 * <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} />
 * ```
 */
export const Checkbox = memo(forwardRef<HTMLSpanElement, CheckboxProps>(
  (
    {
      size = 'medium',
      type = 'default',
      shape = 'square',
      disabled = false,
      indeterminate = false,
      className,
      icon,
      showIcon = true,
      checked: controlledChecked,
      defaultChecked,
      onChange,
      onBlur,
      onFocus,
      value,
      style,
      children,
      ...rest
    },
    ref
  ) => {
    const groupContext = useContext(CheckboxGroupContext);
    const internalRef = useRef<HTMLSpanElement>(null);
    const [uncontrolledChecked, setUncontrolledChecked] = useState(defaultChecked || false);

    const isInGroup = groupContext !== null;
    const groupValue = groupContext?.value || [];
    const groupOnChange = groupContext?.onChange;
    const groupDisabled = groupContext?.disabled;
    const groupName = groupContext?.name;

    const isControlled = controlledChecked !== undefined;
    const actualChecked = isInGroup
      ? value !== undefined && groupValue.includes(value)
      : isControlled
        ? controlledChecked
        : uncontrolledChecked;

    const actualDisabled = disabled || groupDisabled || false;

    const handleChange = (newChecked: boolean) => {
      if (isInGroup && value !== undefined && groupOnChange) {
        const newValue = [...groupValue];
        if (newChecked) {
          if (!newValue.includes(value)) {
            newValue.push(value);
          }
        } else {
          const index = newValue.indexOf(value);
          if (index > -1) {
            newValue.splice(index, 1);
          }
        }
        groupOnChange(newValue);
      } else if (!isControlled) {
        setUncontrolledChecked(newChecked);
      }

      if (onChange) {
        const syntheticEvent: CheckboxChangeEvent = {
          target: {
            checked: newChecked,
          },
          stopPropagation: () => {},
          preventDefault: () => {},
          nativeEvent: new MouseEvent('change'),
        };
        onChange(syntheticEvent);
      }
    };

    useImperativeHandle(ref, () => {
      const element = internalRef.current;
      return {
        blur: () => {
          element?.blur();
          onBlur?.();
        },
        focus: () => {
          element?.focus();
          onFocus?.();
        },
        nativeElement: element,
      } as HTMLSpanElement & {
        blur: () => void;
        focus: () => void;
        nativeElement: HTMLSpanElement | null;
      };
    }, [onBlur, onFocus]);

    const renderIcon = () => {
      if (!showIcon) return null;

      if (icon) {
        return icon;
      }

      const iconSizeMap = {
        small: 10,
        medium: 12,
        large: 14,
      };
      const iconSize = iconSizeMap[size || 'medium'];

      if (indeterminate) {
        return (
          <div
            className={cn(
              'absolute inset-0 flex items-center justify-center pointer-events-none z-10',
              'opacity-100'
            )}
          >
            <div
              className={cn(
                'h-0.5 bg-current',
                size === 'small' && 'w-2',
                size === 'medium' && 'w-2.5',
                size === 'large' && 'w-3'
              )}
            />
          </div>
        );
      }

      return (
        <span
          className={cn(
            'absolute inset-0 flex items-center justify-center pointer-events-none z-10',
            actualChecked ? 'opacity-100' : 'opacity-0'
          )}
        >
          <svg
            width={iconSize}
            height={iconSize}
            viewBox='0 0 48 48'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
          >
            <path
              d='M10 24L20 34L40 14'
              stroke='currentColor'
              strokeWidth='4'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </svg>
        </span>
      );
    };

    const checkboxElement = (
      <HeadlessCheckbox
        ref={internalRef}
        checked={actualChecked}
        onChange={handleChange}
        disabled={actualDisabled}
        indeterminate={indeterminate}
        name={groupName}
        className={cn(
          checkboxVariants({ size, type, shape }),
          'text-[var(--color-text-default-secondary)]',
          shape === 'circle'
            ? [
                'data-checked:border-[var(--ink)] data-checked:bg-[var(--ink)] data-checked:text-white',
                'data-checked:data-hover:border-[var(--ink)] data-checked:data-hover:bg-[var(--ink)]',
                'data-indeterminate:border-[var(--ink)] data-indeterminate:bg-[var(--ink)] data-indeterminate:text-white',
              ]
            : [
                'data-checked:border-[var(--color-brand-base)] data-checked:bg-[var(--color-brand-base)] data-checked:text-[var(--color-text-on-button-base)]',
                'data-checked:data-hover:bg-[var(--color-brand-base-hover)] data-checked:data-hover:border-[var(--color-brand-base-hover)]',
                'data-indeterminate:bg-[var(--color-brand-base)] data-indeterminate:border-[var(--color-brand-base)] data-indeterminate:text-[var(--color-text-on-button-base)]',
              ],
          'data-focus:outline data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-[var(--color-brand-base)]',
          'data-hover:border-[var(--color-border-default-base-hover)]',
          'data-disabled:cursor-not-allowed data-disabled:opacity-50',
          'data-disabled:bg-[var(--color-background-neutral-tertiary)]',
          'data-checked:data-disabled:bg-[var(--color-background-neutral-tertiary)] data-checked:data-disabled:border-[var(--color-border-default-base)]',
          className
        )}
        style={style}
        {...rest}
      >
        {renderIcon()}
      </HeadlessCheckbox>
    );

    if (children) {
      return (
        <label
          className={cn(
            'inline-flex items-center gap-2 cursor-pointer',
            actualDisabled && 'cursor-not-allowed opacity-50'
          )}
          style={style}
        >
          {checkboxElement}
          <span className='text-[var(--color-text-default-base)]'>{children}</span>
        </label>
      );
    }

    return checkboxElement;
  }
));

Checkbox.displayName = 'Checkbox';
