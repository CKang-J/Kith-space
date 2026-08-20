/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/ImageRemoveBgMenu.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, useState, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, DropdownPanel, DropdownPanelItem } from '@recombyn-native/components/base';
import { cn } from '@recombyn-native/utils/classnames';
import { imageToolBtn } from './imageToolbarShared';

const TOOL_ICON_SIZE = 16;

export type RemoveBgMode = 'hair' | 'product';

/**
 * Remove-bg mode menu: hair/portrait (default) vs product hard edge.
 * Stay inside the selection toolbar chrome — RCB activates toolbar buttons
 * with a synthetic click, and the Stage 1 Floating UI portal sits under the
 * scene overlay so portaled items never receive the pointer.
 */
function ImageRemoveBgMenu({
  onPick,
  disabled = false,
}: {
  onPick: (mode: RemoveBgMode) => void;
  disabled?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const modes: { key: RemoveBgMode; titleKey: string; hintKey: string }[] = [
    {
      key: 'hair',
      titleKey: 'editor.imageToolbar.removeBgHair',
      hintKey: 'editor.imageToolbar.removeBgHairHint',
    },
    {
      key: 'product',
      titleKey: 'editor.imageToolbar.removeBgProduct',
      hintKey: 'editor.imageToolbar.removeBgProductHint',
    },
  ];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        className={cn(imageToolBtn, disabled && 'cursor-not-allowed opacity-50', open && 'bg-[var(--accent-soft)]')}
        onClick={() => {
          if (disabled) return;
          setOpen((value) => !value);
        }}
      >
        <Icon
          name="editor-remove_bg"
          width={TOOL_ICON_SIZE}
          height={TOOL_ICON_SIZE}
          className="text-current"
        />
        <span>{t('editor.imageToolbar.removeBg')}</span>
      </button>
      {open ? (
        <DropdownPanel
          role="menu"
          className="absolute left-0 top-[calc(100%+8px)] z-[80] min-w-[11.5rem]"
        >
          {modes.map((m) => (
            <DropdownPanelItem
              key={m.key}
              role="menuitem"
              className="h-auto min-h-8 items-start py-1.5"
              onClick={() => {
                onPick(m.key);
                setOpen(false);
              }}
            >
              <span className="flex flex-col gap-0.5 text-left">
                <span className="text-[13px] font-semibold text-[var(--ink)]">
                  {t(m.titleKey)}
                </span>
                <span className="text-[11px] font-normal leading-snug text-[var(--muted)]">
                  {t(m.hintKey)}
                </span>
              </span>
            </DropdownPanelItem>
          ))}
        </DropdownPanel>
      ) : null}
    </div>
  );
}

export default memo(ImageRemoveBgMenu);
