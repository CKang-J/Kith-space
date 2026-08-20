/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/FlipRotateToolbar.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { memo, type ReactNode } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineArrowPath,
  HiOutlineArrowsRightLeft,
  HiOutlineArrowsUpDown,
} from 'react-icons/hi2';
import { BiExit } from 'react-icons/bi';
import { MdOutlineFlip } from 'react-icons/md';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { closeImageToolPanel, patchDocumentNode } from '@recombyn-native/store/modules/editor';
import { cn } from '@recombyn-native/utils/classnames';
import { imageToolBtn, ImageToolSep } from './imageToolbarShared';

type Props = {
  nodeId: string;
  angle: number;
  flipX: boolean;
  flipY: boolean;
  /** Video: flip only — hide angle readout + 90° rotate. */
  hideRotate?: boolean;
};

function normAngle(deg: number) {
  const n = ((Number(deg) || 0) % 360) + 360;
  return Number((n % 360).toFixed(2));
}

/**
 * Flip & rotate strip: title on the left, exit (chat-style) on the right.
 * No download / fullscreen here — those stay on the main selection toolbar.
 */
function FlipRotateToolbar({
  nodeId,
  angle,
  flipX,
  flipY,
  hideRotate = false,
}: Props): ReactNode {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const displayAngle = Math.round(normAngle(angle));

  const patch = (attrs: Record<string, unknown>) => {
    dispatch(patchDocumentNode({ nodeId, patch: { attrs } }));
  };

  const title = hideRotate
    ? t('editor.imageToolbar.flip')
    : t('editor.imageToolbar.flipRotate');
  const exitLabel = t('editor.exit');
  const flipH = t('editor.imageToolbar.flipHorizontal');
  const flipV = t('editor.imageToolbar.flipVertical');
  const rotate90 = t('editor.imageToolbar.rotate90');
  const currentAngle = t('editor.imageToolbar.currentAngle');

  return (
    <>
      <span className="inline-flex h-8 items-center gap-1.5 px-1.5 text-[12px] font-medium text-[var(--ink)]">
        <MdOutlineFlip className="h-4 w-4 shrink-0" aria-hidden />
        <span>{title}</span>
      </span>

      <ImageToolSep />

      {hideRotate ? null : (
        <>
          <Tooltip tip={currentAngle} placement="top">
            <span className="inline-flex h-8 items-center gap-1 px-1.5 text-[12px] tabular-nums text-[var(--ink)]">
              <span className="relative inline-flex h-3.5 w-3.5 items-end justify-start" aria-hidden>
                <span className="absolute bottom-0 left-0 h-[10px] w-[10px] rounded-bl-[1px] border-b-2 border-l-2 border-[var(--ink)]" />
                <span className="absolute bottom-[1px] left-[1px] h-2 w-2 rounded-bl-full border-b border-l border-[var(--ink)] opacity-70" />
              </span>
              <span>
                {displayAngle}
                {' °'}
              </span>
            </span>
          </Tooltip>

          <ImageToolSep />

          <Tooltip tip={rotate90} placement="top">
            <button
              type="button"
              aria-label={rotate90}
              className={imageToolBtn}
              onClick={() => patch({ angle: normAngle(angle + 90) })}
            >
              <HiOutlineArrowPath className="h-4 w-4" />
            </button>
          </Tooltip>
        </>
      )}
      <Tooltip tip={flipH} placement="top">
        <button
          type="button"
          aria-label={flipH}
          className={cn(imageToolBtn, flipX && 'bg-[var(--accent-soft)]')}
          aria-pressed={flipX}
          onClick={() => patch({ flipX: flipX ? 'false' : 'true' })}
        >
          <HiOutlineArrowsRightLeft className="h-4 w-4" />
        </button>
      </Tooltip>
      <Tooltip tip={flipV} placement="top">
        <button
          type="button"
          aria-label={flipV}
          className={cn(imageToolBtn, flipY && 'bg-[var(--accent-soft)]')}
          aria-pressed={flipY}
          onClick={() => patch({ flipY: flipY ? 'false' : 'true' })}
        >
          <HiOutlineArrowsUpDown className="h-4 w-4" />
        </button>
      </Tooltip>

      <ImageToolSep />

      <Tooltip tip={exitLabel} placement="top">
        <button
          type="button"
          aria-label={exitLabel}
          className={imageToolBtn}
          onClick={() => dispatch(closeImageToolPanel())}
        >
          <BiExit className="h-[18px] w-[18px]" />
        </button>
      </Tooltip>
    </>
  );
}

export default memo(FlipRotateToolbar);
