/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/UpscaleSessionHost.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useState, type ReactNode, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { HiOutlineChevronDown } from 'react-icons/hi2';
import { BiExit } from 'react-icons/bi';
import { DropdownPanel, DropdownPanelItem, Icon, Tooltip } from '@recombyn-native/components/base';
import {
  PanelConfirmCost,
  IMAGE_TOOL_TOKEN_COST,
} from '@recombyn-native/components/editor/nodes/ImageNode/toolPanels/ImageToolPanelShell';
import {
  RcbOverlayPortal,
  rcbScreenPxToScene,
  useRcbCamera,
  useRcbScreenToolbarStyle,
} from '@recombyn-native/components/rcb';
import { FloatingToolbar } from '@recombyn-native/components/editor/chrome/FloatingToolbar';
import {
  closeImageToolPanel,
  startImageProcess,
} from '@recombyn-native/store/modules/editor';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import { cn } from '@recombyn-native/utils/classnames';
import { imageToolBtn, ImageToolSep } from './imageToolbarShared';
import type { SceneDocument, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

export type UpscaleResolution = '2K' | '4K';

export type UpscalePreset = {
  key: string;
  title: string;
  hintKey: string;
  resolution: UpscaleResolution;
  width: number;
  height: number;
};

/** Seedream upscale tiers — model max 4K. */
export const UPSCALE_PRESETS: UpscalePreset[] = [
  {
    key: '2k',
    title: '2K',
    hintKey: 'editor.imageToolbar.upscale2kHint',
    resolution: '2K',
    width: 2048,
    height: 2048,
  },
  {
    key: '4k',
    title: '4K',
    hintKey: 'editor.imageToolbar.upscale4kHint',
    resolution: '4K',
    width: 4096,
    height: 4096,
  },
];

const UPSCALE_COST = IMAGE_TOOL_TOKEN_COST.upscale;

function nodeBox(document: SceneDocument, node: SceneNodeInput) {
  if (!node) return null;
  const { left, top } = nodeLeftTop(document, node);
  return {
    left,
    top,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
}

/**
 * Upscale session: compact bar under the image (same chrome as expand).
 * Resolution dropdown keeps the prior panel style; confirm + credits live on the bar.
 */
function UpscaleSessionHost({ document }: { document: SceneDocument }): ReactNode {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const camera = useRcbCamera();
  const panel = useSelector(
    (s: any) => s.editor.imageToolPanel as null | { nodeId: string; kind: string }
  );
  const selectedNodeId = useSelector((s: any) => s.editor.selectedNodeId as string | null);

  const active = panel?.kind === 'upscale';
  const nodeId = active ? panel!.nodeId : null;
  const node = nodeId ? document?.deltaSetLike?.[nodeId] : null;
  const box = useMemo(() => nodeBox(document, node), [document, node]);

  const [selectedKey, setSelectedKey] = useState(UPSCALE_PRESETS[1]?.key ?? '4k');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!active) {
      setMenuOpen(false);
      return;
    }
    setSelectedKey(UPSCALE_PRESETS[1]?.key ?? '4k');
    setMenuOpen(false);
  }, [active, nodeId]);

  useEffect(() => {
    if (!active || !nodeId) return;
    if (!selectedNodeId || selectedNodeId !== nodeId) {
      dispatch(closeImageToolPanel());
    }
  }, [selectedNodeId, active, nodeId, dispatch]);

  useEffect(() => {
    if (!active || !nodeId) return;
    if (!node || node.key !== 'image') {
      dispatch(closeImageToolPanel());
    }
  }, [document, active, nodeId, node, dispatch]);

  const z = Math.max(0.05, camera.zoom || 1);
  const toolbarGap = rcbScreenPxToScene(10, z);
  const toolbarStyle = useRcbScreenToolbarStyle({
    left: box ? box.left + box.width / 2 : 0,
    top: box ? box.top + box.height + toolbarGap : 0,
    anchor: 'top',
  });

  if (!active || !nodeId || !box) return null;

  const selected =
    UPSCALE_PRESETS.find((p) => p.key === selectedKey) ?? UPSCALE_PRESETS[1] ?? UPSCALE_PRESETS[0];

  const close = () => dispatch(closeImageToolPanel());

  const onConfirm = () => {
    if (!selected) return;
    dispatch(
      startImageProcess({
        sourceId: nodeId,
        kind: 'upscale',
        label: t('editor.imageToolbar.processingUpscale'),
        targetWidth: selected.width,
        targetHeight: selected.height,
        meta: { resolution: selected.resolution },
      })
    );
    close();
  };

  return (
    <RcbOverlayPortal>
      <div
        data-upscale-toolbar
        data-sel-toolbar
        className="pointer-events-auto absolute z-[37]"
        style={toolbarStyle}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <FloatingToolbar className="relative">
          <span className="inline-flex h-8 items-center gap-1.5 px-1.5 text-[12px] font-medium text-[var(--ink)]">
            <Icon name="editor-upscale" width={16} height={16} className="text-current" />
            <span>{t('editor.imageToolbar.upscale')}</span>
          </span>

          <ImageToolSep />

          <button
            type="button"
            className={cn(imageToolBtn, 'gap-1.5 font-medium', menuOpen && 'bg-[var(--accent-soft)]')}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="tabular-nums">{selected?.title ?? '4K'}</span>
            <HiOutlineChevronDown className="h-3 w-3 text-[var(--muted)]" />
          </button>

          <ImageToolSep />

          <button
            type="button"
            className="mx-[10px] inline-flex h-7 min-w-[52px] items-center justify-center gap-1 rounded-xl px-2.5 text-[12px] font-medium bg-[var(--ink)] text-[var(--on-brand)] transition hover:opacity-90"
            onClick={onConfirm}
          >
            <span>{t('editor.imageToolbar.upscaleConfirm')}</span>
            <PanelConfirmCost amount={UPSCALE_COST} />
          </button>

          <Tooltip tip={'退出'} placement="top">
            <button
              type="button"
              aria-label={'退出'}
              className={imageToolBtn}
              onClick={close}
            >
              <BiExit className="h-[18px] w-[18px]" />
            </button>
          </Tooltip>

          {menuOpen ? (
            <DropdownPanel className="absolute bottom-[calc(100%+6px)] left-1/2 z-50 w-[13.5rem] -translate-x-1/2 gap-1 p-1.5">
              <p className="px-2 pb-0.5 pt-1 text-[11px] leading-snug text-[var(--muted)]">
                {t('editor.imageToolbar.upscaleHint')}
              </p>
              {UPSCALE_PRESETS.map((p) => (
                <DropdownPanelItem
                  key={p.key}
                  selected={p.key === selected?.key}
                  className="h-auto min-h-8 items-start py-1.5"
                  onClick={() => {
                    setSelectedKey(p.key);
                    setMenuOpen(false);
                  }}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                    <span className="text-[13px] font-semibold text-[var(--ink)]">{p.title}</span>
                    <span className="text-[11px] font-normal leading-snug text-[var(--muted)]">
                      {t(p.hintKey)}
                    </span>
                  </span>
                </DropdownPanelItem>
              ))}
            </DropdownPanel>
          ) : null}
        </FloatingToolbar>
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(UpscaleSessionHost);
