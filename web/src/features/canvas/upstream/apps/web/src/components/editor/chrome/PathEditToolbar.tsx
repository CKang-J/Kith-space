/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/chrome/PathEditToolbar.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { HiCheck } from 'react-icons/hi2';
import { LuMousePointer2, LuPenTool } from 'react-icons/lu';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { Icon } from '@recombyn-native/components/base/icon';
import { FloatingToolbar } from '@recombyn-native/components/editor/chrome/FloatingToolbar';
import { cn } from '@recombyn-native/utils/classnames';

export type PathEditSubtool = 'select' | 'pen' | 'curve';

const PATH_EDIT_BTN =
  'inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors text-[var(--ink)] hover:bg-[var(--accent-soft)]';
const PATH_EDIT_BTN_ACTIVE = 'bg-[var(--ink)] text-[var(--on-brand)] hover:bg-[var(--ink)]';
/** Done / confirm — solid ink square with check. */
const PATH_EDIT_BTN_DONE =
  'inline-flex h-6 w-6 items-center justify-center rounded-md bg-[var(--ink)] text-[var(--on-brand)] transition-opacity hover:opacity-90';

function PathEditToolbar({
  subtool,
  onSubtoolChange,
  onExit,
}: {
  subtool: PathEditSubtool;
  onSubtoolChange: (tool: PathEditSubtool) => void;
  onExit: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <FloatingToolbar className="pointer-events-auto h-8 gap-1.5 px-2 py-0">
      <Tooltip tip={t('editor.pathEditSelect', { defaultValue: '选择' })} placement="bottom">
        <button
          type="button"
          aria-label={t('editor.pathEditSelect', { defaultValue: '选择' })}
          aria-pressed={subtool === 'select'}
          className={cn(PATH_EDIT_BTN, subtool === 'select' && PATH_EDIT_BTN_ACTIVE)}
          onClick={() => onSubtoolChange('select')}
        >
          <LuMousePointer2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </Tooltip>
      <Tooltip tip={t('editor.pathEditPen', { defaultValue: '钢笔' })} placement="bottom">
        <button
          type="button"
          aria-label={t('editor.pathEditPen', { defaultValue: '钢笔' })}
          aria-pressed={subtool === 'pen'}
          className={cn(PATH_EDIT_BTN, subtool === 'pen' && PATH_EDIT_BTN_ACTIVE)}
          onClick={() => onSubtoolChange('pen')}
        >
          <LuPenTool className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </Tooltip>
      <Tooltip tip={t('editor.pathEditCurve', { defaultValue: '曲线' })} placement="bottom">
        <button
          type="button"
          aria-label={t('editor.pathEditCurve', { defaultValue: '曲线' })}
          aria-pressed={subtool === 'curve'}
          className={cn(PATH_EDIT_BTN, subtool === 'curve' && PATH_EDIT_BTN_ACTIVE)}
          onClick={() => onSubtoolChange('curve')}
        >
          <Icon name="editor-path-curve" width={14} height={14} />
        </button>
      </Tooltip>
      <span className="mx-0.5 h-3.5 w-px shrink-0 bg-[var(--line)]" aria-hidden />
      <Tooltip tip={t('editor.pathEditDone', { defaultValue: '完成 (Esc)' })} placement="bottom">
        <button
          type="button"
          aria-label={t('editor.pathEditDone', { defaultValue: '完成' })}
          className={PATH_EDIT_BTN_DONE}
          onClick={onExit}
        >
          <HiCheck className="h-3.5 w-3.5" strokeWidth={2.25} />
        </button>
      </Tooltip>
    </FloatingToolbar>
  );
}

export default memo(PathEditToolbar);
