/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/LottieNode/LottieToolbarEditTools.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Selection toolbar for Lottie plates — play/loop/speed + export.
 * Replace JSON / labeled download removed (export icon covers download).
 */
import { memo, useEffect, useState, type ReactNode } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineArrowPath,
  HiOutlinePause,
  HiOutlinePlay,
  HiOutlineSparkles,
} from 'react-icons/hi2';
import { Dropdown } from '@recombyn-native/components/base';
import type { MenuItemType } from '@recombyn-native/components/base/dropdown';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { ExportSelectionPopover } from '@recombyn-native/components/editor/panels/ExportSelectionPanel';
import { imageToolBtn, ImageToolSep } from '@recombyn-native/components/editor/nodes/ImageNode/imageToolbarShared';
import { getLottieHost } from '@recombyn-native/components/editor/nodes/LottieNode/LottieNodeOverlay';
import { openImageToolPanel, patchDocumentNode } from '@recombyn-native/store/modules/editor';
import { cn } from '@recombyn-native/utils/classnames';

const TOOL_ICON_SLOT =
  'pointer-events-none inline-flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:block [&>svg]:h-full [&>svg]:w-full';

function ToolIconSlot({ children }: { children: ReactNode }) {
  return <span className={TOOL_ICON_SLOT}>{children}</span>;
}

function Tool({
  label,
  onClick,
  children,
  active,
  tip,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  active?: boolean;
  tip?: string;
}) {
  const btn = (
    <button
      type="button"
      className={cn(imageToolBtn, active && 'bg-[var(--accent-soft)]')}
      onClick={onClick}
    >
      <ToolIconSlot>{children}</ToolIconSlot>
      <span>{label}</span>
    </button>
  );
  if (!tip) return btn;
  return (
    <Tooltip tip={tip} placement="top">
      {btn}
    </Tooltip>
  );
}

function LottieToolbarEditTools({
  nodeId,
  loop,
  speed,
}: {
  nodeId: string;
  loop: boolean;
  speed: number;
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const sync = () => {
      const host = getLottieHost(nodeId);
      setPaused(Boolean(host?.isPaused()));
    };
    sync();
    const id = window.setInterval(sync, 400);
    return () => window.clearInterval(id);
  }, [nodeId]);

  const speedItems: MenuItemType[] = [
    { key: '0.5', label: '0.5×' },
    { key: '1', label: '1×' },
    { key: '1.5', label: '1.5×' },
    { key: '2', label: '2×' },
  ];

  const onTogglePlay = () => {
    const host = getLottieHost(nodeId);
    if (!host) return;
    if (host.isPaused()) {
      host.play();
      setPaused(false);
    } else {
      host.pause();
      setPaused(true);
    }
  };

  const onToggleLoop = () => {
    const next = !loop;
    dispatch(patchDocumentNode({ nodeId, patch: { attrs: { lottieLoop: next ? 'true' : 'false' } } }));
    getLottieHost(nodeId)?.setLoop(next);
  };

  const onSpeed = (key: string) => {
    const next = Number(key) || 1;
    dispatch(patchDocumentNode({ nodeId, patch: { attrs: { lottieSpeed: next } } }));
    getLottieHost(nodeId)?.setSpeed(next);
  };

  const speedLabel = `${Number.isFinite(speed) && speed > 0 ? speed : 1}×`;

  return (
    <>
      <Tool
        label={t('editor.imageToolbar.chat')}
        tip={t('editor.imageToolbar.chat', { defaultValue: '快速编辑' })}
        onClick={() => dispatch(openImageToolPanel({ nodeId, kind: 'quickEdit' }))}
      >
        <HiOutlineSparkles className="h-4 w-4" strokeWidth={2} />
      </Tool>
      <ImageToolSep />
      <Tool
        label={
          paused
            ? t('editor.lottieToolbar.play', { defaultValue: '播放' })
            : t('editor.lottieToolbar.pause', { defaultValue: '暂停' })
        }
        onClick={onTogglePlay}
      >
        {paused ? (
          <HiOutlinePlay className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <HiOutlinePause className="h-4 w-4" strokeWidth={1.75} />
        )}
      </Tool>
      <Tool
        label={t('editor.lottieToolbar.loop', { defaultValue: '循环' })}
        active={loop}
        onClick={onToggleLoop}
      >
        <HiOutlineArrowPath className="h-4 w-4" strokeWidth={1.75} />
      </Tool>
      <Dropdown
        trigger="click"
        placement="top"
        strategy="fixed"
        items={speedItems}
        onClick={(key) => onSpeed(String(key))}
        floatingClassName="z-[520]"
        referenceClassName="inline-flex"
      >
        <button type="button" className={imageToolBtn}>
          <span className="tabular-nums">{speedLabel}</span>
        </button>
      </Dropdown>
      <ImageToolSep />
      <ExportSelectionPopover nodeIds={[nodeId]} triggerClassName={imageToolBtn} />
    </>
  );
}

export default memo(LottieToolbarEditTools);
