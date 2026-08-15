/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/switch/index.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import React, { memo } from 'react';
import { Switch as HeadlessSwitch } from '@headlessui/react';
import { cn } from '@recombyn-native/utils/classnames';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/** Toggle switch (Headless UI). Share-dialog palette: --switch-on / --line track, white thumb. */
const SwitchBase: React.FC<SwitchProps> = ({ checked, onChange, disabled = false, className }) => {
  return (
    <HeadlessSwitch
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors',
        'focus:outline-none data-[focus]:outline-none',
        checked ? 'bg-[var(--switch-on)]' : 'bg-[var(--line)]',
        disabled && 'cursor-not-allowed opacity-60',
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out',
          // Drive from the React `checked` prop — `group-data-[checked]` can lag /
          // miss depending on Headless UI version, leaving the thumb stuck left.
          checked ? 'translate-x-3.5' : 'translate-x-0'
        )}
      />
    </HeadlessSwitch>
  );
};

export const Switch = React.memo(SwitchBase);
export default memo(Switch);
