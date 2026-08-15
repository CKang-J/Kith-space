/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/checkbox/CheckboxGroup.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import React, { useState } from 'react';
import { cn } from '@recombyn-native/utils/classnames';
import { CheckboxGroupContext } from './CheckboxGroupContext';
import { Checkbox } from './Checkbox';
import type { CheckboxGroupContextValue, CheckboxGroupOption } from './Checkbox';

/**
 * Vertical group; pass `options` or `children` with `Checkbox` + `value`.
 */
export interface CheckboxGroupProps {
  defaultValue?: (string | number)[];
  value?: (string | number)[];
  disabled?: boolean;
  name?: string;
  options?: (string | number)[] | CheckboxGroupOption[];
  onChange?: (checkedValue: (string | number)[]) => void;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export const CheckboxGroup: React.FC<CheckboxGroupProps> = ({
  defaultValue,
  value,
  onChange,
  disabled = false,
  name,
  className,
  style,
  children,
  options,
}) => {
  const [internalValue, setInternalValue] = useState<(string | number)[]>(
    defaultValue || []
  );

  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;

  const handleChange = (newValue: (string | number)[]) => {
    if (!isControlled) {
      setInternalValue(newValue);
    }
    onChange?.(newValue);
  };

  const contextValue: CheckboxGroupContextValue = {
    value: currentValue,
    onChange: handleChange,
    disabled,
    name,
  };

  if (options && Array.isArray(options) && options.length > 0) {
    const isSimpleArray = typeof options[0] === 'string' || typeof options[0] === 'number';
    const optionList: CheckboxGroupOption[] = isSimpleArray
      ? (options as (string | number)[]).map((opt) => ({ label: opt, value: opt, disabled: false }))
      : (options as CheckboxGroupOption[]);

    return (
      <CheckboxGroupContext.Provider value={contextValue}>
        <div className={cn('flex flex-col gap-2', className)} style={style}>
          {optionList.map((option) => (
            <Checkbox
              key={option.value}
              value={option.value}
              disabled={option.disabled || disabled}
            >
              {option.label}
            </Checkbox>
          ))}
        </div>
      </CheckboxGroupContext.Provider>
    );
  }

  return (
    <CheckboxGroupContext.Provider value={contextValue}>
      <div className={cn('flex flex-col gap-2', className)} style={style}>
        {children}
      </div>
    </CheckboxGroupContext.Provider>
  );
};

CheckboxGroup.displayName = 'CheckboxGroup';
