/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/chrome/AspectRatioPresetMenu.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useMemo, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineChevronDown } from 'react-icons/hi2';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  type Placement,
} from '@/features/canvas/adapters/recombynFloatingUi';
import { DropdownPanel, DropdownPanelItem } from '@recombyn-native/components/base';
import { cn } from '@recombyn-native/utils/classnames';

export const ELEMENT_ASPECT_PRESETS: { id: string; label: string; w: number; h: number }[] = [
  { id: 'original', label: 'Free', w: 0, h: 0 },
  { id: '1:1', label: '1:1', w: 1, h: 1 },
  { id: '4:3', label: '4:3', w: 4, h: 3 },
  { id: '3:4', label: '3:4', w: 3, h: 4 },
  { id: '16:9', label: '16:9', w: 16, h: 9 },
  { id: '9:16', label: '9:16', w: 9, h: 16 },
];

function presetGlyphSize(preset: { id: string; w: number; h: number }, box = 12) {
  if (preset.id === 'original' || !(preset.w > 0) || !(preset.h > 0)) {
    return { w: box, h: box };
  }
  const max = Math.max(preset.w, preset.h);
  return {
    w: Math.max(6, Math.round((preset.w / max) * box)),
    h: Math.max(6, Math.round((preset.h / max) * box)),
  };
}

/** Original = dashed free frame; locked ratios = solid proportional box. */
function AspectPresetGlyph({
  preset,
  className,
  box = 12,
}: {
  preset: { id: string; w: number; h: number };
  className?: string;
  box?: number;
}) {
  const { w, h } = presetGlyphSize(preset, box);
  const original = preset.id === 'original';
  return (
    <span
      className={cn(
        'inline-block shrink-0 rounded-[2px] border border-current',
        original ? 'border-dashed opacity-90' : 'opacity-80',
        className
      )}
      style={{ width: w, height: h }}
      aria-hidden
    />
  );
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeId: string;
  onPick: (preset: (typeof ELEMENT_ASPECT_PRESETS)[number]) => void;
  triggerClassName?: string;
  placement?: Placement;
  /** Compact trigger for inline toolbars (crop bar style). */
  variant?: 'inline' | 'icon';
};

/**
 * Preset aspect ratio dropdown: free (unlocked) + common ratios with shape icons.
 */
function AspectRatioPresetMenu({
  open,
  onOpenChange,
  activeId,
  onPick,
  triggerClassName,
  placement = 'bottom-start',
  variant = 'inline',
}: Props): ReactNode {
  const { t } = useTranslation();
  const labelOf = (id: string, fallback: string) =>
    id === 'original' ? t('editor.frameToolbar.original') : fallback;

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12 })],
  });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

  const label = useMemo(() => {
    const p =
      ELEMENT_ASPECT_PRESETS.find((x) => x.id === activeId) || ELEMENT_ASPECT_PRESETS[0];
    return p.id === 'original' ? t('editor.frameToolbar.original') : p.label;
  }, [activeId, t]);

  const activePreset = useMemo(() => {
    return (
      ELEMENT_ASPECT_PRESETS.find((x) => x.id === activeId) || ELEMENT_ASPECT_PRESETS[0]
    );
  }, [activeId]);

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        aria-expanded={open}
        aria-label={t('editor.frameToolbar.ratioPresets')}
        className={cn(
          variant === 'inline'
            ? 'inline-flex h-8 items-center gap-1.5 rounded-[4px] px-2 text-[12px] font-medium text-[var(--ink)] transition hover:bg-[var(--accent-soft)]'
            : 'inline-flex h-8 w-8 items-center justify-center rounded-[4px] text-[var(--ink)] transition hover:bg-[var(--accent-soft)]',
          open && 'bg-[var(--accent-soft)]',
          triggerClassName
        )}
        {...getReferenceProps({ onClick: () => onOpenChange(!open) })}
      >
        <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[var(--muted)]">
          <AspectPresetGlyph preset={activePreset} box={12} />
        </span>
        {variant === 'inline' ? (
          <>
            <span className="max-w-[5rem] truncate">{label}</span>
            <HiOutlineChevronDown className="h-3 w-3 shrink-0 text-[var(--muted)]" />
          </>
        ) : null}
      </button>
      <FloatingPortal>
        {open ? (
          <DropdownPanel
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-[90] min-w-[168px]"
            data-sel-toolbar
            {...getFloatingProps({
              onPointerDown: (e) => e.stopPropagation(),
            })}
          >
            {ELEMENT_ASPECT_PRESETS.map((p) => {
              const selected = activeId === p.id;
              return (
                <DropdownPanelItem
                  key={p.id}
                  selected={selected}
                  onClick={() => {
                    onPick(p);
                    onOpenChange(false);
                  }}
                >
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-[var(--muted)]">
                    <AspectPresetGlyph preset={p} box={12} />
                  </span>
                  {labelOf(p.id, p.label)}
                </DropdownPanelItem>
              );
            })}
          </DropdownPanel>
        ) : null}
      </FloatingPortal>
    </>
  );
}

export default memo(AspectRatioPresetMenu);

const MemoizedAspectPresetGlyph = memo(AspectPresetGlyph);
export { MemoizedAspectPresetGlyph as AspectPresetGlyph };
