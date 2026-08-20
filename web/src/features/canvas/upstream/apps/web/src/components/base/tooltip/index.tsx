/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/tooltip/index.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { OffsetOptions, Placement } from '@/features/canvas/adapters/recombynFloatingUi';
import {
  FloatingPortal,
  useFloating,
  useInteractions,
  useHover,
  useClick,
  useDismiss,
  offset,
  autoUpdate,
  flip,
  shift,
} from '@/features/canvas/adapters/recombynFloatingUi';
import type { FC, ReactNode } from 'react';
import { memo } from 'react';
import { useBoolean } from 'ahooks';
import * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@recombyn-native/utils/classnames';
import { tooltipManager } from './TooltipManager';

export type TooltipProps = {
  /** Preferred content prop (alias of title). */
  tip?: ReactNode;
  /** @deprecated Prefer `tip`. */
  title?: ReactNode;
  placement?: Placement;
  trigger?: 'hover' | 'click';
  disabled?: boolean;
  triggerClassName?: string;
  popupClassName?: string;
  offset?: OffsetOptions;
  /** Hover: delay before close when pointer leaves */
  needsDelay?: boolean;
  /** Inline-block wrapper when true */
  asChild?: boolean;
  /** Controlled open. Omit for hover/click internal state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
};

const Tooltip: FC<TooltipProps> = ({
  placement = 'top',
  trigger = 'hover',
  disabled = false,
  tip,
  title,
  children,
  triggerClassName,
  popupClassName,
  offset: offsetValue = 8,
  asChild = true,
  needsDelay = true,
  open: openProp,
  onOpenChange,
}) => {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? Boolean(openProp) : uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const prev = isControlled ? Boolean(openProp) : uncontrolledOpen;
      const value = typeof next === 'function' ? next(prev) : next;
      if (!isControlled) setUncontrolledOpen(value);
      onOpenChange?.(value);
    },
    [isControlled, openProp, uncontrolledOpen, onOpenChange]
  );
  const content = tip ?? title;

  const [isHoverPopup, { setTrue: setHoverPopup, setFalse: setNotHoverPopup }] = useBoolean(false);
  const isHoverPopupRef = useRef(isHoverPopup);
  useEffect(() => {
    isHoverPopupRef.current = isHoverPopup;
  }, [isHoverPopup]);

  const [isHoverTrigger, { setTrue: setHoverTrigger, setFalse: setNotHoverTrigger }] = useBoolean(false);
  const isHoverTriggerRef = useRef(isHoverTrigger);
  useEffect(() => {
    isHoverTriggerRef.current = isHoverTrigger;
  }, [isHoverTrigger]);

  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearCloseTimeout();
    };
  }, [clearCloseTimeout]);

  const close = useCallback(() => setOpen(false), []);

  const handleLeave = useCallback(
    (isTrigger: boolean) => {
      if (isTrigger) setNotHoverTrigger();
      else setNotHoverPopup();

      // give time to move to the popup
      if (needsDelay) {
        clearCloseTimeout();
        closeTimeoutRef.current = setTimeout(() => {
          closeTimeoutRef.current = null;
          if (!isHoverPopupRef.current && !isHoverTriggerRef.current) {
            setOpen(false);
            tooltipManager.clear(close);
          }
        }, 300);
      } else {
        clearCloseTimeout();
        setOpen(false);
        tooltipManager.clear(close);
      }
    },
    [needsDelay, clearCloseTimeout, close, setNotHoverTrigger, setNotHoverPopup]
  );

  let computedOffset: OffsetOptions;
  if (typeof offsetValue === 'number') {
    computedOffset = offsetValue + 4;
  } else if (typeof offsetValue === 'object' && offsetValue !== null) {
    computedOffset = {
      mainAxis: ((offsetValue as { mainAxis?: number }).mainAxis ?? 8) + 4,
      crossAxis: (offsetValue as { crossAxis?: number }).crossAxis,
    };
  } else {
    computedOffset = 12;
  }

  const { refs, floatingStyles, context } = useFloating({
    open: disabled ? false : open,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(computedOffset), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, {
    enabled: trigger === 'hover' && !disabled && !isControlled,
  });

  const click = useClick(context, {
    enabled: trigger === 'click' && !disabled && !isControlled,
  });

  const dismiss = useDismiss(context);

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, click, dismiss]);

  const handleMouseEnter = useCallback(() => {
    if (isControlled) return;
    if (trigger === 'hover' && !disabled) {
      clearCloseTimeout();
      setHoverTrigger();
      tooltipManager.register(close);
      setOpen(true);
    }
  }, [isControlled, trigger, disabled, clearCloseTimeout, setHoverTrigger, close, setOpen]);

  const handleMouseLeave = useCallback(() => {
    if (isControlled) return;
    if (trigger === 'hover') {
      handleLeave(true);
    }
  }, [isControlled, trigger, handleLeave]);

  const handleClick = useCallback(() => {
    if (isControlled) return;
    if (trigger === 'click' && !disabled) {
      setOpen((v) => !v);
    }
  }, [isControlled, trigger, disabled, setOpen]);

  const handlePopupMouseEnter = useCallback(() => {
    if (trigger === 'hover') {
      clearCloseTimeout();
      setHoverPopup();
    }
  }, [trigger, clearCloseTimeout, setHoverPopup]);

  const handlePopupMouseLeave = useCallback(() => {
    if (trigger === 'hover') {
      handleLeave(false);
    }
  }, [trigger, handleLeave]);

  if (!content) {
    return <>{children}</>;
  }

  const triggerElement = (
    <div
      {...getReferenceProps()}
      ref={refs.setReference}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(asChild && 'inline-block', triggerClassName)}
    >
      {children}
    </div>
  );

  return (
    <>
      {triggerElement}
      {!disabled && open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-[1000]"
            onMouseEnter={handlePopupMouseEnter}
            onMouseLeave={handlePopupMouseLeave}
          >
            <div
              className={cn(
                // Modest radius (not pill). Height/nowrap suit short labels;
                // long content overrides via popupClassName (e.g. asset titles).
                'relative flex h-[26px] w-auto items-center justify-center whitespace-nowrap rounded-md bg-[#2C2C2C] px-2.5 text-[12px] leading-none text-white shadow-[0_2px_8px_rgba(31,35,41,0.16)]',
                popupClassName
              )}
            >
              {content}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
};

export default memo(Tooltip);
