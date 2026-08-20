/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/TextNode/TextEditDialog.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, Button } from '@recombyn-native/components/base';
import MarkdownTextEditor from './MarkdownTextEditor';

type Props = {
  open: boolean;
  initialMarkdown: string;
  onClose: () => void;
  onSave: (markdown: string) => void;
};

/** Modal Markdown editor for a selected text node. */
function TextEditDialog({ open, initialMarkdown, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialMarkdown);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(initialMarkdown);
      setFullscreen(false);
    }
  }, [open, initialMarkdown]);

  return (
    <Dialog
      show={open}
      onClose={onClose}
      title={t('editor.editText')}
      width={fullscreen ? 960 : 640}
      className={fullscreen ? 'h-[min(90vh,820px)]' : undefined}
      bodyClassName={fullscreen ? 'flex min-h-0 flex-1 flex-col' : undefined}
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="text-[12px] text-[var(--muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
            onClick={() => setFullscreen((v) => !v)}
          >
            {fullscreen ? t('editor.exitFullscreen') : t('editor.fullscreen')}
          </button>
          <div className="flex items-center gap-2">
            <Button type="default" size="small" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              type="primary"
              size="small"
              onClick={() => {
                onSave(value);
                onClose();
              }}
            >
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      }
    >
      <MarkdownTextEditor
        value={value}
        onChange={setValue}
        fill={fullscreen}
        className={fullscreen ? 'min-h-[520px]' : undefined}
      />
    </Dialog>
  );
}

export default memo(TextEditDialog);
