/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/TextNode/FontFamilyPicker.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useState, type ReactNode, memo } from 'react';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from '@/features/canvas/adapters/recombynFloatingUi';
import { HiOutlineChevronDown, HiOutlineMagnifyingGlass } from 'react-icons/hi2';
import {
  applyFontFamilySelection,
  getBaseFontFamily,
  getFontCatalogSync,
  getPreviewFontFamily,
  loadFontCatalog,
  type FontFamilyNode,
} from '@recombyn-native/components/rcb/scene/document/fontCatalog';
import { DropdownPanelItem } from '@recombyn-native/components/base';
import { cn } from '@recombyn-native/utils/classnames';
import { SEL_TOOL_BTN } from '@recombyn-native/components/rcb/selection/chrome/ToolbarValueSlider';

type Props = {
  value: string;
  onChange: (next: { fontFamily: string; fontWeight: string }) => void;
  className?: string;
};

/** Font picker: loads catalog from API only (managed in admin). */
function FontFamilyPicker({ value, onChange, className }: Props): ReactNode {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<FontFamilyNode[]>(() => getFontCatalogSync());
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      const list = await loadFontCatalog();
      if (!cancelled) setCatalog(list);
    }
    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  const fonts = catalog;
  const base = getBaseFontFamily(value, fonts);
  const triggerLabel =
    fonts.find((f) => f.family === base)?.displayName || base || '字体';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fonts;
    return fonts.filter(
      (f) =>
        f.family.toLowerCase().includes(q) || f.displayName.toLowerCase().includes(q)
    );
  }, [fonts, query]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next) => {
      setOpen(next);
      if (!next) setQuery('');
    },
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12 })],
  });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

  const pick = (font: FontFamilyNode) => {
    onChange(applyFontFamilySelection(font.family, fonts));
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        {...getReferenceProps({
          onClick: () => setOpen((v) => !v),
        })}
        className={cn(SEL_TOOL_BTN, 'max-w-[9rem]', open && 'bg-[var(--accent-soft)]', className)}
        aria-label={triggerLabel}
      >
        <span
          className="truncate"
          style={{
            fontFamily: getPreviewFontFamily(
              fonts.find((f) => f.family === base) || {
                family: base,
                displayName: base,
                children: [],
              }
            ),
          }}
        >
          {triggerLabel}
        </span>
        <HiOutlineChevronDown
          className={cn(
            'h-3 w-3 shrink-0 text-current transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-[80] w-[240px] overflow-hidden rounded-[4px] bg-[var(--surface)] shadow-[0_12px_40px_rgba(15,23,42,0.18)] ring-1 ring-[var(--line)]"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="px-2.5 pb-2 pt-2.5">
              <label className="flex h-8 items-center gap-1.5 rounded-lg bg-[var(--canvas)] px-2.5 text-[var(--muted)]">
                <HiOutlineMagnifyingGlass className="h-3.5 w-3.5 shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索字体"
                  className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
                />
              </label>
            </div>

            <div className="max-h-[280px] overflow-y-auto px-1 py-0.5">
              {filtered.length === 0 ? (
                <p className="px-2 py-6 text-center text-[12px] text-[var(--muted)]">无匹配字体</p>
              ) : (
                filtered.map((font) => {
                  const selected = font.family === base;
                  const preview = getPreviewFontFamily(font);
                  return (
                    <DropdownPanelItem
                      key={font.family}
                      selected={selected}
                      onClick={() => pick(font)}
                      className="text-[14px]"
                      style={{ fontFamily: `'${preview}', ${preview}, sans-serif` }}
                    >
                      {font.displayName || font.family}
                    </DropdownPanelItem>
                  );
                })
              )}
            </div>
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

export default memo(FontFamilyPicker);
