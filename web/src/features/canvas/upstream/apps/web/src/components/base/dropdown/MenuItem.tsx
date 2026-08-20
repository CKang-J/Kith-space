/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/dropdown/MenuItem.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { FC, ReactNode } from 'react';
import { useCallback, memo } from 'react';
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useHover,
  useInteractions,
  FloatingPortal,
} from '@/features/canvas/adapters/recombynFloatingUi';
import { Icon } from '@recombyn-native/components/base/icon';
import { cn } from '@recombyn-native/utils/classnames';
import { DropdownPanel, DropdownPanelItem } from './DropdownPanel';

export type MenuItemType = {
  key: string;
  label: ReactNode;
  disabled?: boolean;
  children?: MenuItemType[];
  type?: 'divider';
  /** Hover/click behavior; default true */
  interactive?: boolean;
};

export type MenuItemProps = {
  item: MenuItemType;
  selectedKeys?: string[];
  onClick?: (key: string, item: MenuItemType) => void;
  expandIcon?: ReactNode;
  itemClassName?: string;
  onSubMenuOpenChange?: (key: string, open: boolean) => void;
  activeSubMenuKey?: string | null;
};

/** One menu row; optional nested submenu. */
const MenuItem: FC<MenuItemProps> = ({
  item,
  selectedKeys = [],
  onClick,
  expandIcon,
  itemClassName,
  onSubMenuOpenChange,
  activeSubMenuKey,
}) => {
  const hasChildren = item.children && item.children.length > 0;
  const isSelected = selectedKeys.includes(item.key);
  const isInteractive = item.interactive !== false;
  const isSubMenuOpen = activeSubMenuKey === item.key;

  const { refs, floatingStyles, context } = useFloating({
    open: isSubMenuOpen,
    onOpenChange: (open) => onSubMenuOpenChange?.(item.key, open),
    placement: 'right-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(25),
      flip({
        padding: 5,
      }),
      shift({ padding: 5 }),
    ],
  });

  const hover = useHover(context, {
    enabled: hasChildren && !item.disabled,
    move: true,
    delay: {
      open: 0,
      close: 100,
    },
  });

  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss]);

  const handleClick = useCallback(() => {
    if (!isInteractive || item.disabled) return;
    if (!hasChildren && onClick) {
      onClick(item.key, item);
    }
  }, [isInteractive, item, hasChildren, onClick]);

  const handleMouseEnter = useCallback(() => {
    if (hasChildren && !item.disabled) {
      onSubMenuOpenChange?.(item.key, true);
    }
  }, [hasChildren, item.disabled, item.key, onSubMenuOpenChange]);

  if (item.type === 'divider') {
    return (
      <div
        className="mx-1 my-0.5 h-px shrink-0 bg-[var(--line)]"
        role="separator"
      />
    );
  }

  return (
    <div className="relative">
      <div
        ref={refs.setReference}
        {...getReferenceProps({
          onMouseEnter: handleMouseEnter,
        })}
      >
        <DropdownPanelItem
          selected={isSelected}
          disabled={item.disabled}
          className={cn(
            !isInteractive && 'pointer-events-none cursor-default hover:bg-transparent',
            itemClassName
          )}
          onClick={() => handleClick()}
        >
          <div
            className={cn(
              'flex w-full flex-1 items-center justify-start',
              itemClassName?.includes('justify-center') && 'justify-center'
            )}
          >
            {item.label}
          </div>
          {hasChildren ? (
            <div className="ml-2 flex-shrink-0">
              {expandIcon || (
                <Icon
                  name="base-chevron-right-icon"
                  width={5}
                  height={9}
                  color="var(--color-text-default-base)"
                />
              )}
            </div>
          ) : null}
        </DropdownPanelItem>
      </div>
      {hasChildren ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              visibility: isSubMenuOpen ? 'visible' : 'hidden',
              pointerEvents: isSubMenuOpen ? 'auto' : 'none',
            }}
            className="z-[1000]"
            {...getFloatingProps()}
          >
            <DropdownPanel
              className={cn(
                'min-w-[120px]',
                isSubMenuOpen ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
              )}
              onMouseEnter={() => {
                onSubMenuOpenChange?.(item.key, true);
              }}
              onMouseLeave={() => {
                onSubMenuOpenChange?.(item.key, false);
              }}
            >
              {item.children!.map((child) => (
                <DropdownPanelItem
                  key={child.key}
                  selected={selectedKeys.includes(child.key)}
                  disabled={child.disabled}
                  onClick={() => {
                    if (!child.disabled && onClick) {
                      onClick(child.key, child);
                      onSubMenuOpenChange?.(item.key, false);
                    }
                  }}
                >
                  {child.label}
                </DropdownPanelItem>
              ))}
            </DropdownPanel>
          </div>
        </FloatingPortal>
      ) : null}
    </div>
  );
};

export default memo(MenuItem);