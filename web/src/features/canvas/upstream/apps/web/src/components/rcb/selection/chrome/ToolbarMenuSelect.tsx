/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/chrome/ToolbarMenuSelect.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useState, type ReactNode, memo } from 'react';
import { HiOutlineChevronDown } from 'react-icons/hi2';
import { Dropdown } from '@recombyn-native/components/base';
import type { MenuItemType } from '@recombyn-native/components/base/dropdown';
import { cn } from '@recombyn-native/utils/classnames';

export type ToolbarMenuOption = {
  value: string;
  label: ReactNode;
};

type Props = {
  value: string;
  options: ToolbarMenuOption[];
  onChange: (value: string) => void;
  /** Visible label for the trigger; defaults to matching option label or value */
  displayLabel?: ReactNode;
  className?: string;
  /** Min trigger width */
  minWidth?: string;
  /**
   * Combobox mode: type a custom value, chevron still opens the preset list.
   * Used for font size.
   */
  editable?: boolean;
  /** Clamp typed number when `editable` (inclusive). */
  inputMin?: number;
  inputMax?: number;
};

/**
 * Compact dropdown for floating selection chrome.
 * Optional `editable` turns the label into an input (presets + custom).
 */
function ToolbarMenuSelect({
  value,
  options,
  onChange,
  displayLabel,
  className,
  minWidth,
  editable = false,
  inputMin = 1,
  inputMax = 400,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const selected = options.find((o) => o.value === value);
  const label = displayLabel ?? selected?.label ?? value;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const items: MenuItemType[] = options.map((o) => ({
    key: o.value,
    label: o.label,
  }));

  const commitDraft = () => {
    const n = Number(String(draft).trim());
    if (!Number.isFinite(n)) {
      setDraft(value);
      return;
    }
    const clamped = Math.max(inputMin, Math.min(inputMax, Math.round(n)));
    const next = String(clamped);
    setDraft(next);
    if (next !== value) onChange(next);
  };

  const shellClass = cn(
    'inline-flex h-8 max-w-[10rem] items-center gap-0.5 rounded-lg px-1.5 text-[12px] text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)]',
    open && 'bg-[var(--accent-soft)]',
    className
  );

  return (
    <Dropdown
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      offset={6}
      strategy="fixed"
      items={items}
      selectedKeys={[value]}
      referenceToggle={!editable}
      onClick={(key) => {
        onChange(key);
        setOpen(false);
      }}
      popupClassName="min-w-[7rem]"
      floatingClassName="z-[80]"
      referenceClassName="inline-flex"
    >
      {editable ? (
        <div className={shellClass} style={minWidth ? { minWidth } : undefined}>
          <input
            type="text"
            inputMode="decimal"
            aria-label="Font size"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onFocus={(e) => e.target.select()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                commitDraft();
                (e.target as HTMLInputElement).blur();
                setOpen(false);
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(value);
                setOpen(false);
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
              }
            }}
            className="w-[2.25rem] min-w-0 bg-transparent text-center text-[12px] tabular-nums outline-none"
          />
          <button
            type="button"
            aria-label="Font size presets"
            aria-expanded={open}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-current"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            <HiOutlineChevronDown
              className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}
            />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={shellClass}
          style={minWidth ? { minWidth } : undefined}
        >
          <span className="inline-grid max-w-[8.5rem] items-center">
            <span
              aria-hidden
              className="invisible col-start-1 row-start-1 whitespace-pre truncate px-0.5"
            >
              {label}
            </span>
            <span className="col-start-1 row-start-1 truncate px-0.5 text-left">{label}</span>
          </span>
          <HiOutlineChevronDown
            className={cn(
              'h-3 w-3 shrink-0 text-current transition-transform',
              open && 'rotate-180'
            )}
          />
        </button>
      )}
    </Dropdown>
  );
}

export default memo(ToolbarMenuSelect);
