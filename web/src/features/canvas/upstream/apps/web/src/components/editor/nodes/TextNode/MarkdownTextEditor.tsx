/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/TextNode/MarkdownTextEditor.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import MDEditor, { commands } from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import { cn } from '@recombyn-native/utils/classnames';

type Props = {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  /** Fill available dialog height. */
  fill?: boolean;
};

function readColorMode(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/**
 * Markdown editor via @uiw/react-md-editor (toolbar + live preview).
 */
function MarkdownTextEditor({ value, onChange, className, fill }: Props) {
  const { t } = useTranslation();
  const [colorMode, setColorMode] = useState<'light' | 'dark'>(readColorMode);

  useEffect(() => {
    const sync = () => setColorMode(readColorMode());
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    return () => obs.disconnect();
  }, []);

  return (
    <div
      data-color-mode={colorMode}
      className={cn(
        'rcb-md-editor-host min-h-0 w-full overflow-hidden rounded-[4px] border border-[var(--line)] bg-[var(--surface)]',
        '[&_.w-md-editor]:rounded-[4px] [&_.w-md-editor]:border-0 [&_.w-md-editor]:shadow-none',
        '[&_.w-md-editor-toolbar]:border-b [&_.w-md-editor-toolbar]:border-[var(--line)]',
        fill && 'flex h-full flex-1 flex-col [&_.w-md-editor]:h-full [&_.w-md-editor]:flex-1',
        className
      )}
    >
      <MDEditor
        value={value}
        onChange={(next) => onChange(next ?? '')}
        height={fill ? '100%' : 320}
        visibleDragbar={false}
        overflow={false}
        preview="live"
        textareaProps={{
          placeholder: t('editor.mdPlaceholder'),
          spellCheck: false,
        }}
        extraCommands={[commands.codeEdit, commands.codeLive, commands.codePreview]}
      />
    </div>
  );
}

export default memo(MarkdownTextEditor);
