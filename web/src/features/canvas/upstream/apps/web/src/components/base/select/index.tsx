/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/select/index.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import React, { forwardRef, useState, memo } from 'react';
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size as sizeMiddleware,
  useDismiss,
  useFloating,
  useInteractions,
  FloatingPortal,
  type Placement,
} from '@/features/canvas/adapters/recombynFloatingUi';
import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';
import { cn } from '@recombyn-native/utils/classnames';
import { Icon } from '@recombyn-native/components/base/icon';

export const selectVariants = cva('', {
  variants: {
    size: {
      small: 'h-7 px-2 text-xs',
      middle: 'h-7 px-2.5 text-[12px]',
      large: 'h-9 px-4 text-sm',
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
});

type SelectVariantProps = VariantProps<typeof selectVariants>;

export interface SelectOption {
  value: string | number;
  label: React.ReactNode;
  disabled?: boolean;

  data?: any;
}

export interface SelectProps {
  size?: SelectVariantProps['size'];
  type?: SelectVariantProps['type'];
  disabled?: boolean;
  invalid?: boolean;
  options: SelectOption[];
  value?: string | number;
  onChange?: (value: string | number) => void;
  placeholder?: string;
  className?: string;
  labelRender?: (option: SelectOption | undefined) => React.ReactNode;
  optionRender?: (option: SelectOption, selected: boolean) => React.ReactNode;
  getPopupContainer?: () => HTMLElement;
  placement?: Placement;
  /** Portal popup z-index; default above Headless dialogs (z-[8900]/[9000]). */
  floatingClassName?: string;
}

const Select = forwardRef<HTMLDivElement, SelectProps>(
  (
    {
      size,
      type,
      disabled = false,
      invalid = false,
      className,
      options,
      value,
      onChange,
      placeholder,
      labelRender,
      optionRender,
      getPopupContainer,
      placement = 'bottom-start',
      floatingClassName,
    },
    ref
  ) => {
    const [open, setOpen] = useState(false);

    const selectTypeValue = type ?? 'outlined';

    const selectedOption = options.find((opt) => opt.value === value);

    const { refs, floatingStyles, context } = useFloating({
      open,
      onOpenChange: setOpen,
      placement,
      strategy: 'fixed',
      whileElementsMounted: autoUpdate,
      middleware: [
        offset(4),
        flip({
          padding: 5,
        }),
        shift({ padding: 5 }),
        sizeMiddleware({

          apply({ rects, elements }: any) {
            Object.assign(elements.floating.style, {
              width: `${rects.reference.width}px`,
            });
          },
        }),
      ],
    });

    const dismiss = useDismiss(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

    const defaultLabelRender = (option: SelectOption | undefined) => {
      if (!option) return placeholder || 'Select';
      return option.label;
    };

    const defaultOptionRender = (option: SelectOption, _selected: boolean) => {
      return (
        <div className="flex items-center text-[var(--ink)]">
          {option.label}
        </div>
      );
    };

    const handleOptionClick = (option: SelectOption) => {
      if (!disabled && !option.disabled) {
        onChange?.(option.value);
        setOpen(false);
      }
    };

    return (
      <div className='relative'>
        <div
          ref={(node) => {
            if (typeof ref === 'function') {
              ref(node);
            } else if (ref) {
              ref.current = node;
            }
            refs.setReference(node);
          }}
          role='button'
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          onClick={() => {
            if (!disabled) {
              setOpen(!open);
            }
          }}
          onKeyDown={(e) => {
            if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              setOpen(!open);
            }
          }}
          className={cn(
            'w-full appearance-none outline-none relative cursor-pointer flex items-center select-none',
            'bg-[var(--color-background-default-secondary)] text-[var(--color-text-default-base)]',
            selectVariants({ size, type }),
            selectTypeValue === 'outlined' && 'border-[0.5px] border-[var(--color-border-default-base)] rounded',
            selectTypeValue === 'filled' && 'border-0 rounded',
            selectTypeValue === 'borderless' && 'rounded',
            selectTypeValue === 'underlined' && 'rounded-none border-b-[var(--color-border-default-base)]',
            disabled && 'cursor-not-allowed bg-[var(--color-background-neutral-tertiary)] text-[var(--color-text-default-tertiary)] opacity-60',
            invalid && 'border-[var(--color-error-base)]',
            className
          )}
          {...getReferenceProps()}
        >
          <span
            className={cn(
              'block truncate text-left',
              open && 'opacity-70'
            )}
          >
            {labelRender ? labelRender(selectedOption) : defaultLabelRender(selectedOption)}
          </span>
          <span className='pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5'>
            <Icon
              name='base-chevron-down-icon'
              width={10}
              height={10}
              className={cn('transition-transform duration-150', open ? 'rotate-0' : 'rotate-180')}
              color='var(--color-icon-base)'
            />
          </span>
        </div>

        <FloatingPortal root={getPopupContainer?.()}>
          <div
            ref={refs.setFloating}
            data-select-dropdown
            style={{
              ...floatingStyles,
              visibility: open ? 'visible' : 'hidden',
              pointerEvents: open ? 'auto' : 'none',
            }}
            className={cn('z-[9500]', floatingClassName)}
            {...getFloatingProps()}
          >
            <div
              className={cn(
                'max-h-60 w-full overflow-auto rounded',
                'bg-[var(--color-background-default-base)]',
                'border border-[var(--color-border-default-base)]',
                'shadow-lg focus:outline-none focus-visible:outline-none',
                'p-1 text-sm',
                open
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 -translate-y-2'
              )}
              style={{ marginTop: '4px' }}
              onWheel={(e) => {
                e.stopPropagation();
              }}
              onTouchMove={(e) => {
                e.stopPropagation();
              }}
            >
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <div
                    key={option.value}
                    onClick={() => handleOptionClick(option)}
                    className={cn(
                      'relative cursor-pointer select-none rounded px-4 py-2 transition-colors',
                      'hover:bg-[var(--accent-soft)]',
                      selected && 'bg-[var(--accent-soft)] font-medium',
                      option.disabled && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    {optionRender
                      ? optionRender(option, selected)
                      : defaultOptionRender(option, selected)}
                  </div>
                );
              })}
            </div>
          </div>
        </FloatingPortal>
      </div>
    );
  }
);

Select.displayName = 'Select';

export default memo(Select);