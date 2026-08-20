/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/AudioNode/AudioToolbarEditTools.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Audio selection toolbar — 快速编辑 / 截取 / 变速.
 */
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineClock, HiOutlineScissors, HiOutlineSparkles } from 'react-icons/hi2';
import { cn } from '@recombyn-native/utils/classnames';
import { videoToolBtn, VideoToolSep } from '@recombyn-native/components/editor/nodes/VideoNode/videoToolbarShared';

const TOOL_ICON_SLOT =
  'pointer-events-none inline-flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:block [&>svg]:h-full [&>svg]:w-full';
const TOOL_ICON_STROKE = 1.75;

function ToolIconSlot({ children }: { children: ReactNode }) {
  return <span className={TOOL_ICON_SLOT}>{children}</span>;
}

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
      className={cn(videoToolBtn, active && 'bg-[var(--accent-soft)]')}
      onClick={onClick}
    >
      <ToolIconSlot>{children}</ToolIconSlot>
      <span>{label}</span>
    </button>
  );
}

function AudioToolbarEditTools({
  onQuickEdit,
  onTrim,
  onSpeed,
}: {
  onQuickEdit?: () => void;
  onTrim?: () => void;
  onSpeed?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      {onQuickEdit ? (
        <>
          <Tool label={t('editor.imageToolbar.chat')} onClick={onQuickEdit}>
            <HiOutlineSparkles className="h-4 w-4" strokeWidth={2} />
          </Tool>
          <VideoToolSep />
        </>
      ) : null}
      <Tool
        label={t('editor.audioToolbar.trim', { defaultValue: '截取' })}
        onClick={onTrim}
      >
        <HiOutlineScissors strokeWidth={TOOL_ICON_STROKE} />
      </Tool>
      <Tool
        label={t('editor.audioToolbar.speed', { defaultValue: '变速' })}
        onClick={onSpeed}
      >
        <HiOutlineClock strokeWidth={TOOL_ICON_STROKE} />
      </Tool>
    </>
  );
}

export default memo(AudioToolbarEditTools);
