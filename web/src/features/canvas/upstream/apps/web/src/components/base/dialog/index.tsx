/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/dialog/index.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { ElementType, ReactNode } from 'react';
import { Dialog as HeadlessDialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { Fragment, useCallback, useLayoutEffect, memo } from 'react';
import { HiOutlineXMark } from 'react-icons/hi2';
import { cn } from '@recombyn-native/utils/classnames';

type DialogProps = {
  className?: string;
  titleClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  titleAs?: ElementType;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  show: boolean;
  onClose?: () => void;
  closable?: boolean;
  width?: number;
  style?: React.CSSProperties;
};

/** Headless UI marks the portal aria-hidden/inert while focus may still sit on a child. */
function blurFocusedDialogDescendant() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  if (!active.closest('[role="dialog"], [data-headlessui-portal]')) return;
  active.blur();
}

const Dialog = ({
  className,
  titleClassName,
  bodyClassName,
  footerClassName,
  titleAs,
  title,
  children,
  footer,
  show,
  onClose,
  closable = true,
  width,
  style,
}: DialogProps) => {
  const close = useCallback(() => {
    blurFocusedDialogDescendant();
    onClose?.();
  }, [onClose]);

  // Covers external close paths (e.g. Cancel calling parent setOpen(false) directly).
  useLayoutEffect(() => {
    if (!show) blurFocusedDialogDescendant();
  }, [show]);

  return (
    <Transition appear show={show} as={Fragment}>
      <HeadlessDialog className="relative z-[9000]" onClose={close}>
        <TransitionChild
          enter="duration-0"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="duration-0"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-[var(--color-shadow-overlay)] backdrop-blur-[6px]" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <TransitionChild
              enter="duration-0"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="duration-0"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel
                className={cn(
                  'relative w-full overflow-hidden rounded-xl border-[0.5px] border-[var(--color-border-default-base)] bg-[var(--color-background-default-base)] p-6 shadow-[0px_4px_4px_-4px_rgba(12,12,13,0.05)] shadow-[0px_16px_32px_-4px_rgba(12,12,13,0.10)] shadow-[0px_0px_4px_-1px_rgba(12,12,13,0.05)]',
                  !width && 'max-w-[800px]',
                  className
                )}
                style={width ? { maxWidth: width, ...style } : style}
              >
                {closable && onClose && (
                  <button
                    type="button"
                    onClick={close}
                    className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center rounded text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
                    aria-label="Close"
                  >
                    <HiOutlineXMark className="h-5 w-5" strokeWidth={1.75} />
                  </button>
                )}
                {Boolean(title) && (
                  <DialogTitle
                    as={titleAs || 'h3'}
                    className={cn(
                      'pb-3 pr-10 text-2xl font-semibold text-[var(--color-text-default-base)]',
                      titleClassName
                    )}
                  >
                    {title}
                  </DialogTitle>
                )}
                <div className={cn(bodyClassName)}>{children}</div>
                {Boolean(footer) && (
                  <div className={cn('flex items-center justify-end gap-2 pt-3', footerClassName)}>
                    {footer}
                  </div>
                )}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </HeadlessDialog>
    </Transition>
  );
};

Dialog.displayName = 'Dialog';

export default memo(Dialog);
export type { DialogProps };
