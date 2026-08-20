/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/chrome/EditorShortcutsPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useRef, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineXMark } from 'react-icons/hi2';
import { cn } from '@recombyn-native/utils/classnames';

function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-[4px]',
        'border border-[var(--line)] bg-[var(--canvas)] px-1.5',
        'text-[11px] font-medium tabular-nums text-[var(--ink)]',
        className
      )}
    >
      {children}
    </kbd>
  );
}

function KeyCombo({ parts }: { parts: ReactNode[] }) {
  return (
    <span className="inline-flex shrink-0 flex-nowrap items-center justify-end gap-1">
      {parts.map((part, i) => (
        <span key={i} className="inline-flex flex-nowrap items-center gap-1">
          {i > 0 ? <span className="text-[11px] text-[var(--muted)]">+</span> : null}
          {part}
        </span>
      ))}
    </span>
  );
}

function ShortcutRow({ label, keys }: { label: string; keys: ReactNode }) {
  return (
    <div className="flex w-full flex-nowrap items-center justify-between gap-8 py-1.5">
      <span className="min-w-0 whitespace-nowrap text-[12px] leading-5 text-[var(--ink)]">
        {label}
      </span>
      <div className="shrink-0">{keys}</div>
    </div>
  );
}

function ShortcutSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="w-full">
      <h3 className="mb-1.5 whitespace-nowrap text-[13px] font-semibold text-[var(--ink)]">
        {title}
      </h3>
      <div className="flex w-full flex-col">{children}</div>
    </section>
  );
}

type Props = {
  onClose: () => void;
};

/**
 * Bottom-left HUD shortcuts cheatsheet — only lists bindings that exist in-app.
 */
function EditorShortcutsPanel({ onClose }: Props): ReactNode {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const mod =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
      ? '⌘'
      : 'Ctrl';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const el = rootRef.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (target && el.contains(target)) return;
      if (target instanceof Element && target.closest('[data-shortcuts-toggle]')) return;
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={t('editor.shortcuts.title')}
      className="pointer-events-auto relative mb-2 w-max max-w-[calc(100vw-2rem)] rounded-xl bg-[var(--surface)] px-6 py-5 shadow-[0_12px_40px_rgba(15,23,42,0.18)] ring-1 ring-[var(--line)]"
    >
      <button
        type="button"
        aria-label={t('editor.shortcuts.close')}
        onClick={onClose}
        className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded text-[var(--muted)] transition-colors hover:bg-[var(--canvas)] hover:text-[var(--ink)]"
      >
        <HiOutlineXMark className="h-4 w-4" strokeWidth={2} />
      </button>

      {/* Stretch columns so dividers run full height; each col width = widest row. */}
      <div className="flex flex-col gap-6 pr-6 sm:flex-row sm:items-stretch sm:gap-0">
        {/* Canvas + tools — EditorPage zoom + RcbCanvas pan + EditorToolStrip */}
        <div className="flex min-w-max max-w-full flex-col gap-5 sm:pr-8">
          <ShortcutSection title={t('editor.shortcuts.canvasNav')}>
            <ShortcutRow
              label={t('editor.shortcuts.pan')}
              keys={
                <KeyCombo
                  parts={[
                    <Kbd key="space">{t('editor.shortcuts.keys.space')}</Kbd>,
                    <Kbd key="drag">{t('editor.shortcuts.keys.drag')}</Kbd>,
                  ]}
                />
              }
            />
            <ShortcutRow
              label={t('editor.shortcuts.zoom100')}
              keys={<KeyCombo parts={[<Kbd key="m">{mod}</Kbd>, <Kbd key="0">0</Kbd>]} />}
            />
            <ShortcutRow
              label={t('editor.zoomIn')}
              keys={<KeyCombo parts={[<Kbd key="m">{mod}</Kbd>, <Kbd key="plus">+</Kbd>]} />}
            />
            <ShortcutRow
              label={t('editor.zoomOut')}
              keys={<KeyCombo parts={[<Kbd key="m">{mod}</Kbd>, <Kbd key="minus">-</Kbd>]} />}
            />
            <ShortcutRow
              label={t('editor.shortcuts.zoomFit')}
              keys={
                <KeyCombo
                  parts={[
                    <Kbd key="shift">{t('editor.shortcuts.keys.shift')}</Kbd>,
                    <Kbd key="1">1</Kbd>,
                  ]}
                />
              }
            />
            <ShortcutRow
              label={t('editor.shortcuts.save')}
              keys={<KeyCombo parts={[<Kbd key="m">{mod}</Kbd>, <Kbd key="s">S</Kbd>]} />}
            />
          </ShortcutSection>

          <ShortcutSection title={t('editor.shortcuts.tools')}>
            <ShortcutRow label={t('editor.shortcuts.selectTool')} keys={<Kbd>V</Kbd>} />
            <ShortcutRow label={t('editor.shortcuts.handTool')} keys={<Kbd>H</Kbd>} />
            <ShortcutRow label={t('editor.shortcuts.frameTool')} keys={<Kbd>F</Kbd>} />
            <ShortcutRow label={t('editor.shortcuts.textTool')} keys={<Kbd>T</Kbd>} />
            <ShortcutRow label={t('editor.shortcuts.penTool')} keys={<Kbd>P</Kbd>} />
          </ShortcutSection>
        </div>

        {/* Edit + layers — SvgCanvas */}
        <div className="flex min-w-max max-w-full flex-col gap-5 sm:border-l sm:border-[var(--line)] sm:px-8">
          <ShortcutSection title={t('editor.shortcuts.nodeEdit')}>
            <ShortcutRow
              label={t('editor.shortcuts.copy')}
              keys={<KeyCombo parts={[<Kbd key="m">{mod}</Kbd>, <Kbd key="c">C</Kbd>]} />}
            />
            <ShortcutRow
              label={t('editor.shortcuts.cut')}
              keys={<KeyCombo parts={[<Kbd key="m">{mod}</Kbd>, <Kbd key="x">X</Kbd>]} />}
            />
            <ShortcutRow
              label={t('editor.shortcuts.paste')}
              keys={<KeyCombo parts={[<Kbd key="m">{mod}</Kbd>, <Kbd key="v">V</Kbd>]} />}
            />
            <ShortcutRow
              label={t('editor.shortcuts.duplicate')}
              keys={<KeyCombo parts={[<Kbd key="m">{mod}</Kbd>, <Kbd key="d">D</Kbd>]} />}
            />
            <ShortcutRow
              label={t('editor.undo')}
              keys={<KeyCombo parts={[<Kbd key="m">{mod}</Kbd>, <Kbd key="z">Z</Kbd>]} />}
            />
            <ShortcutRow
              label={t('editor.redo')}
              keys={
                <KeyCombo
                  parts={[
                    <Kbd key="m">{mod}</Kbd>,
                    <Kbd key="shift">{t('editor.shortcuts.keys.shift')}</Kbd>,
                    <Kbd key="z">Z</Kbd>,
                  ]}
                />
              }
            />
            <ShortcutRow
              label={t('editor.shortcuts.delete')}
              keys={<Kbd>{t('editor.shortcuts.keys.delete')}</Kbd>}
            />
          </ShortcutSection>

          <ShortcutSection title={t('editor.shortcuts.layerOrder')}>
            <ShortcutRow label={t('editor.shortcuts.bringToFront')} keys={<Kbd>]</Kbd>} />
            <ShortcutRow label={t('editor.shortcuts.sendToBack')} keys={<Kbd>[</Kbd>} />
            <ShortcutRow
              label={t('editor.shortcuts.bringForward')}
              keys={<KeyCombo parts={[<Kbd key="m">{mod}</Kbd>, <Kbd key="]">]</Kbd>]} />}
            />
            <ShortcutRow
              label={t('editor.shortcuts.sendBackward')}
              keys={<KeyCombo parts={[<Kbd key="m">{mod}</Kbd>, <Kbd key="[">[</Kbd>]} />}
            />
            <ShortcutRow
              label={t('editor.shortcuts.toggleHidden')}
              keys={
                <KeyCombo
                  parts={[
                    <Kbd key="m">{mod}</Kbd>,
                    <Kbd key="shift">{t('editor.shortcuts.keys.shift')}</Kbd>,
                    <Kbd key="h">H</Kbd>,
                  ]}
                />
              }
            />
            <ShortcutRow
              label={t('editor.shortcuts.toggleLocked')}
              keys={
                <KeyCombo
                  parts={[
                    <Kbd key="m">{mod}</Kbd>,
                    <Kbd key="shift">{t('editor.shortcuts.keys.shift')}</Kbd>,
                    <Kbd key="k">K</Kbd>,
                  ]}
                />
              }
            />
          </ShortcutSection>
        </div>

        {/* Chat — AgentComposerInput + AgentDock @ model panel + SvgCanvas add-to-chat */}
        <div className="flex min-w-max max-w-full flex-col gap-5 sm:border-l sm:border-[var(--line)] sm:pl-8">
          <ShortcutSection title={t('editor.shortcuts.chat')}>
            <ShortcutRow label={t('editor.shortcuts.chatModel')} keys={<Kbd>@</Kbd>} />
            <ShortcutRow
              label={t('editor.shortcuts.chatPaste')}
              keys={<KeyCombo parts={[<Kbd key="m">{mod}</Kbd>, <Kbd key="v">V</Kbd>]} />}
            />
            <ShortcutRow
              label={t('editor.shortcuts.chatSend')}
              keys={<Kbd>{t('editor.shortcuts.keys.enter')}</Kbd>}
            />
            <ShortcutRow
              label={t('editor.shortcuts.chatNewline')}
              keys={
                <KeyCombo
                  parts={[
                    <Kbd key="shift">{t('editor.shortcuts.keys.shift')}</Kbd>,
                    <Kbd key="enter">{t('editor.shortcuts.keys.enter')}</Kbd>,
                  ]}
                />
              }
            />
            <ShortcutRow
              label={t('editor.shortcuts.chatAddSelection')}
              keys={
                <KeyCombo
                  parts={[
                    <Kbd key="m">{mod}</Kbd>,
                    <Kbd key="shift">{t('editor.shortcuts.keys.shift')}</Kbd>,
                    <Kbd key="l">L</Kbd>,
                  ]}
                />
              }
            />
            <ShortcutRow
              label={t('editor.shortcuts.chatEscape')}
              keys={<Kbd>{t('editor.shortcuts.keys.esc')}</Kbd>}
            />
          </ShortcutSection>
        </div>
      </div>
    </div>
  );
}

export default memo(EditorShortcutsPanel);
