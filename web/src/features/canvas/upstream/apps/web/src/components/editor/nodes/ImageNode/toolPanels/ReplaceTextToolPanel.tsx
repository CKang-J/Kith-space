/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/toolPanels/ReplaceTextToolPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useMemo, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import ImageToolPanelShell, {
  IMAGE_TOOL_TOKEN_COST,
  PanelFooterActions,
} from './ImageToolPanelShell';

/** Replace lettering on an AI image that recorded `letteringText`. */
function ReplaceTextToolPanel({
  initialOriginal = '',
  onCancel,
  onConfirm,
}: {
  /** Prefill from attrs.letteringText when known. */
  initialOriginal?: string;
  onCancel: () => void;
  onConfirm: (opts: { originalText: string; newText: string }) => void;
}) {
  const { t } = useTranslation();
  const [originalText, setOriginalText] = useState(initialOriginal);
  const [newText, setNewText] = useState('');
  const [busy, setBusy] = useState(false);

  const canSubmit = useMemo(() => {
    const a = originalText.trim();
    const b = newText.trim();
    return Boolean(a && b && a !== b);
  }, [originalText, newText]);

  const fieldClass =
    'mt-1 w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--canvas)] px-2.5 py-1.5 text-[12px] text-[var(--ink)] outline-none ring-0 placeholder:text-[var(--muted)] focus:border-[var(--line)] focus:outline-none focus:ring-0 focus-visible:outline-none';

  return (
    <ImageToolPanelShell
      title={t('editor.imageToolbar.replaceText')}
      onClose={onCancel}
      width={272}
      footer={
        <PanelFooterActions
          onCancel={onCancel}
          confirmLabel={t('editor.imageToolbar.replaceTextConfirm')}
          confirmDisabled={!canSubmit}
          confirmBusy={busy}
          confirmCost={IMAGE_TOOL_TOKEN_COST.replaceText}
          onConfirm={() => {
            if (!canSubmit || busy) return;
            setBusy(true);
            onConfirm({
              originalText: originalText.trim(),
              newText: newText.trim(),
            });
          }}
        />
      }
    >
      <label className="block">
        <span className="text-[12px] text-[var(--ink)]">
          {t('editor.imageToolbar.replaceTextOriginal')}
        </span>
        <textarea
          rows={2}
          value={originalText}
          onChange={(e) => setOriginalText(e.target.value)}
          className={fieldClass}
          placeholder={t('editor.imageToolbar.replaceTextOriginalPh')}
        />
      </label>
      <label className="mt-2.5 block">
        <span className="text-[12px] text-[var(--ink)]">
          {t('editor.imageToolbar.replaceTextNew')}
        </span>
        <textarea
          rows={2}
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          className={fieldClass}
          placeholder={t('editor.imageToolbar.replaceTextNewPh')}
          autoFocus
        />
      </label>
    </ImageToolPanelShell>
  );
}

export default memo(ReplaceTextToolPanel);
