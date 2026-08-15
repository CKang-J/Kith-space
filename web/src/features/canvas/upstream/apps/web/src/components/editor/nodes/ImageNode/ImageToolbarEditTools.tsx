/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/ImageToolbarEditTools.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineCube, HiOutlineLanguage, HiOutlineSquare2Stack } from 'react-icons/hi2';
import { LuCrosshair, LuEraser } from 'react-icons/lu';
import { Icon } from '@recombyn-native/components/base';
import { cn } from '@recombyn-native/utils/classnames';
import ImageRemoveBgMenu, { type RemoveBgMode } from './ImageRemoveBgMenu';
import { ImageToolSep, imageToolBtn } from './imageToolbarShared';

export type { RemoveBgMode };

function Tool({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={!onClick}
      className={cn(imageToolBtn, 'relative', !onClick && 'cursor-not-allowed opacity-50', active && 'bg-[var(--accent-soft)]')}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

/** Image selection toolbar edit actions (AI tools + optional trailing slots). */
function ImageToolbarEditTools({
  onUpscale,
  onRemoveBg,
  onEraser,
  onMark,
  onReplaceText,
  onEditElements,
  onMultiAngle,
  previewSlot,
  downloadSlot,
  disabled = false,
}: {
  onUpscale: () => void;
  onRemoveBg: (mode: RemoveBgMode) => void;
  onEraser: () => void;
  onMark?: () => void;
  onReplaceText?: () => void;
  onEditElements?: () => void;
  onMultiAngle: () => void;
  previewSlot?: ReactNode;
  downloadSlot?: ReactNode;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const hasTrailing = Boolean(previewSlot || downloadSlot);
  return (
    <>
      <Tool label={t('editor.imageToolbar.upscale')} onClick={disabled ? undefined : onUpscale}>
        <Icon name="editor-upscale" width={16} height={16} className="text-current" />
      </Tool>
      <ImageRemoveBgMenu onPick={onRemoveBg} disabled={disabled} />
      <Tool label={t('editor.imageToolbar.eraser')} onClick={disabled ? undefined : onEraser}>
        <LuEraser className="h-4 w-4" />
      </Tool>
      {onMark ? (
        <Tool label={t('editor.imageToolbar.mark')} onClick={disabled ? undefined : onMark}>
          <LuCrosshair className="h-4 w-4" strokeWidth={2} />
        </Tool>
      ) : null}
      {onReplaceText ? (
        <Tool label={t('editor.imageToolbar.replaceText')} onClick={disabled ? undefined : onReplaceText}>
          <HiOutlineLanguage className="h-4 w-4" />
        </Tool>
      ) : null}
      {onEditElements ? (
        <Tool label={t('editor.imageToolbar.editElements')} onClick={disabled ? undefined : onEditElements}>
          <HiOutlineSquare2Stack className="h-4 w-4" />
        </Tool>
      ) : null}
      <Tool label={t('editor.imageToolbar.multiAngle')} onClick={disabled ? undefined : onMultiAngle}>
        <HiOutlineCube className="h-4 w-4" />
      </Tool>
      {hasTrailing ? (
        <>
          <ImageToolSep />
          {previewSlot}
          {downloadSlot}
        </>
      ) : null}
    </>
  );
}

export default memo(ImageToolbarEditTools);
