/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/cropExpand/CropExpandSessionHost.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useState, type ReactNode, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  HiOutlineArrowsPointingOut,
  HiOutlineChevronDown,
  HiOutlineScissors,
} from 'react-icons/hi2';
import { BiExit } from 'react-icons/bi';
import { nanoid } from 'nanoid';
import { message, DropdownPanel, DropdownPanelItem } from '@recombyn-native/components/base';
import Tooltip from '@recombyn-native/components/base/tooltip';
import { PanelConfirmCost, IMAGE_TOOL_TOKEN_COST } from '@recombyn-native/components/editor/nodes/ImageNode/toolPanels/ImageToolPanelShell';
import {
  RcbOverlayPortal,
  rcbScreenPxToScene,
  useRcbCamera,
  useRcbScreenToolbarStyle,
} from '@recombyn-native/components/rcb';
import { FloatingToolbar } from '@recombyn-native/components/editor/chrome/FloatingToolbar';
import {
  closeImageToolPanel,
  setDocument,
  setSelectedNodeId,
  setSelectedNodeIds,
  startImageProcess,
  type ImageToolPanelKind,
} from '@recombyn-native/store/modules/editor';
import {
  addNodeToDocument,
  cloneSceneValue,
} from '@recombyn-native/components/rcb/scene/document/sceneDocument';
import {
  isVideoGeneratorNode
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import { imageSrcToFile } from '@recombyn-native/utils/uploadImage';
import { cn } from '@recombyn-native/utils/classnames';
import { AspectPresetGlyph } from '@recombyn-native/components/rcb/selection/chrome/AspectRatioPresetMenu';
import { imageToolBtn, ImageToolSep } from '../imageToolbarShared';
import CropExpandOverlay, {
  cropRectForRatio,
  expandFrameForRatio,
  initialCropRect,
  initialExpandFrame,
  type CropRect,
  type ExpandFrame,
} from './CropExpandOverlay';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

/**
 * Decode src for canvas crop. Must go through authenticated fetch for local
 * `/api/v1/uploads/…` and COS public URLs (browser CORS blocks direct COS fetch).
 */
async function loadImageForCrop(
  src: string,
  uploadKey?: string | null
): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  const file = await imageSrcToFile(src, 'crop.png', { uploadKey });
  const blobUrl = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error('image load failed'));
    };
    el.src = blobUrl;
  });
  return { img, revoke: () => URL.revokeObjectURL(blobUrl) };
}

/** Crop display-space rect → natural pixels (object-fit: fill / stretch to node). */
async function cropImageToDataUrl(
  src: string,
  nodeW: number,
  nodeH: number,
  rect: CropRect,
  uploadKey?: string | null
): Promise<string> {
  const { img, revoke } = await loadImageForCrop(src, uploadKey);
  try {
    const nw = Math.max(1, img.naturalWidth || img.width || 1);
    const nh = Math.max(1, img.naturalHeight || img.height || 1);
    const sx = (rect.x / Math.max(1, nodeW)) * nw;
    const sy = (rect.y / Math.max(1, nodeH)) * nh;
    const sw = Math.max(1, (rect.w / Math.max(1, nodeW)) * nw);
    const sh = Math.max(1, (rect.h / Math.max(1, nodeH)) * nh);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unsupported');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    revoke();
  }
}

/** Build outpaint meta from the on-canvas expand frame (image-local coords). */
function expandMetaFromFrame(cw: number, ch: number, frame: ExpandFrame) {
  const padLeft = Math.max(0, Math.round(-frame.ox));
  const padTop = Math.max(0, Math.round(-frame.oy));
  const padRight = Math.max(0, Math.round(frame.ox + frame.w - cw));
  const padBottom = Math.max(0, Math.round(frame.oy + frame.h - ch));
  const dirs: string[] = [];
  if (padLeft) dirs.push('left');
  if (padRight) dirs.push('right');
  if (padTop) dirs.push('top');
  if (padBottom) dirs.push('bottom');
  const scale = Math.max(frame.w / Math.max(1, cw), frame.h / Math.max(1, ch));
  return {
    direction: dirs.length ? dirs.join(',') : 'all',
    scale: `${scale.toFixed(2)}x`,
    padLeft,
    padTop,
    padRight,
    padBottom,
    targetWidth: Math.max(1, Math.round(frame.w)),
    targetHeight: Math.max(1, Math.round(frame.h)),
  };
}

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

function isCroppableNode(node: SceneNodeInput) {
  if (!node) return false;
  if (node.key === 'image') return true;
  if (node.key === 'video' && !isVideoGeneratorNode(node)) return true;
  return false;
}

/** Read normalized video crop fractions from attrs (full frame when unset). */
function readVideoCropFractions(attrs: Record<string, unknown> | undefined) {
  const fx = Number(attrs?.cropX);
  const fy = Number(attrs?.cropY);
  const fw = Number(attrs?.cropW);
  const fh = Number(attrs?.cropH);
  if (
    Number.isFinite(fx) &&
    Number.isFinite(fy) &&
    Number.isFinite(fw) &&
    Number.isFinite(fh) &&
    fw > 0 &&
    fh > 0
  ) {
    return { x: fx, y: fy, w: fw, h: fh };
  }
  return { x: 0, y: 0, w: 1, h: 1 };
}

/** Compose on-canvas crop rect with any existing source-space crop fractions. */
function composeVideoCropFractions(
  attrs: Record<string, unknown> | undefined,
  boxW: number,
  boxH: number,
  rect: CropRect
) {
  const base = readVideoCropFractions(attrs);
  const rx = rect.x / Math.max(1, boxW);
  const ry = rect.y / Math.max(1, boxH);
  const rw = rect.w / Math.max(1, boxW);
  const rh = rect.h / Math.max(1, boxH);
  return {
    cropX: Number((base.x + rx * base.w).toFixed(5)),
    cropY: Number((base.y + ry * base.h).toFixed(5)),
    cropW: Number((rw * base.w).toFixed(5)),
    cropH: Number((rh * base.h).toFixed(5)),
  };
}

export const CROP_EXPAND_RATIOS: { id: string; label: string; w: number; h: number }[] = [
  { id: 'original', label: '原始', w: 0, h: 0 },
  { id: '1:1', label: '1:1', w: 1, h: 1 },
  { id: '4:3', label: '4:3', w: 4, h: 3 },
  { id: '3:4', label: '3:4', w: 3, h: 4 },
  { id: '16:9', label: '16:9', w: 16, h: 9 },
  { id: '9:16', label: '9:16', w: 9, h: 16 },
];

/**
 * On-canvas crop / expand: control frame + compact bar under the frame.
 */
function CropExpandSessionHost({ document }: { document: SceneDocument }): ReactNode {
  const dispatch = useDispatch();
  const camera = useRcbCamera();
  const panel = useSelector((s: any) => s.editor.imageToolPanel as null | {
    nodeId: string;
    kind: ImageToolPanelKind;
  });
  const selectedNodeId = useSelector((s: any) => s.editor.selectedNodeId as string | null);

  const mode = panel?.kind === 'crop' || panel?.kind === 'expand' ? panel.kind : null;
  const nodeId = mode ? panel!.nodeId : null;
  const node = nodeId ? document?.deltaSetLike?.[nodeId] : null;
  const box = useMemo(() => nodeBox(document, node), [document, node]);

  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [expandFrame, setExpandFrame] = useState<ExpandFrame | null>(null);
  const [ratio, setRatio] = useState('original');
  const [ratioMenuOpen, setRatioMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!mode || !box) {
      setCropRect(null);
      setExpandFrame(null);
      return;
    }
    // Video siblings already show the prior crop; re-enter with a full-plate frame.
    setCropRect(initialCropRect(box.width, box.height));
    setExpandFrame(initialExpandFrame(box.width, box.height));
    setRatio('original');
    setRatioMenuOpen(false);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, nodeId, box?.width, box?.height]);

  useEffect(() => {
    if (!mode || !nodeId) return;
    if (!selectedNodeId || selectedNodeId !== nodeId) {
      dispatch(closeImageToolPanel());
    }
  }, [selectedNodeId, mode, nodeId, dispatch]);

  useEffect(() => {
    if (!mode || !nodeId) return;
    if (!isCroppableNode(node)) {
      dispatch(closeImageToolPanel());
      return;
    }
    // Expand is image-only (outpaint).
    if (mode === 'expand' && node.key !== 'image') {
      dispatch(closeImageToolPanel());
    }
  }, [document, mode, nodeId, node, dispatch]);

  // Hooks must run unconditionally — never after the early return below.
  const frameWorld = useMemo(() => {
    if (!mode || !box || !cropRect || !expandFrame) return null;
    if (mode === 'expand') {
      return {
        left: box.left + expandFrame.ox,
        top: box.top + expandFrame.oy,
        width: expandFrame.w,
        height: expandFrame.h,
      };
    }
    return {
      left: box.left + cropRect.x,
      top: box.top + cropRect.y,
      width: cropRect.w,
      height: cropRect.h,
    };
  }, [mode, box, cropRect, expandFrame]);

  const z = Math.max(0.05, camera.zoom || 1);
  const toolbarGap = rcbScreenPxToScene(10, z);
  const toolbarStyle = useRcbScreenToolbarStyle({
    left: frameWorld ? frameWorld.left + frameWorld.width / 2 : 0,
    top: frameWorld ? frameWorld.top + frameWorld.height + toolbarGap : 0,
    anchor: 'top',
  });


  if (!mode || !nodeId || !box || !cropRect || !expandFrame || !frameWorld) return null;

  const close = () => dispatch(closeImageToolPanel());

  const applyRatio = (id: string) => {
    setRatio(id);
    setRatioMenuOpen(false);
    const preset = CROP_EXPAND_RATIOS.find((r) => r.id === id);
    if (!preset || id === 'original') {
      if (mode === 'crop') setCropRect(initialCropRect(box.width, box.height));
      else setExpandFrame(initialExpandFrame(box.width, box.height));
      return;
    }
    if (mode === 'crop') {
      setCropRect(cropRectForRatio(box.width, box.height, preset.w, preset.h));
    } else {
      setExpandFrame(expandFrameForRatio(box.width, box.height, preset.w, preset.h));
    }
  };

  const label = String(
    node?.attrs?.name || node?.attrs?.title || (node?.key === 'video' ? 'Video' : 'Image')
  );
  const ratioLabel =
    CROP_EXPAND_RATIOS.find((r) => r.id === ratio)?.label || '原始';

  const clearProcessAttrs = (attrs: Record<string, unknown>) => {
    delete attrs.processStatus;
    delete attrs.processKind;
    delete attrs.processLabel;
    delete attrs.processSourceId;
    delete attrs.processTargetWidth;
    delete attrs.processTargetHeight;
  };

  const spawnSiblingAtCrop = (attrPatch: Record<string, unknown>, outW: number, outH: number) => {
    const gap = 16;
    const id = nanoid(10);
    const clone = cloneSceneValue(node);
    clone.id = id;
    clone.x = Math.round(box.left + box.width + gap);
    clone.y = Math.round(box.top);
    clone.width = Math.max(1, outW);
    clone.height = Math.max(1, outH);
    clone.attrs = { ...(clone.attrs || {}), ...attrPatch };
    clearProcessAttrs(clone.attrs);
    return { id, document: addNodeToDocument(document, id, clone) };
  };

  const confirmExpand = () => {
    if (!expandFrame || !nodeId || !box) return;
    const outW = Math.max(1, Math.round(expandFrame.w));
    const outH = Math.max(1, Math.round(expandFrame.h));
    dispatch(
      startImageProcess({
        sourceId: nodeId,
        kind: 'expand',
        label: '扩展中',
        targetWidth: outW,
        targetHeight: outH,
        meta: expandMetaFromFrame(box.width, box.height, expandFrame),
      })
    );
    close();
  };

  const confirmVideoCrop = () => {
    if (!cropRect || !nodeId || !box || !node) return;
    const outW = Math.max(1, Math.round(cropRect.w));
    const outH = Math.max(1, Math.round(cropRect.h));
    const cropAttrs = composeVideoCropFractions(node.attrs, box.width, box.height, cropRect);
    const { id, document: next } = spawnSiblingAtCrop(cropAttrs, outW, outH);
    dispatch(setDocument(next));
    dispatch(setSelectedNodeIds([id]));
    dispatch(setSelectedNodeId(id));
    close();
  };

  const onConfirm = () => {
    if (busy || !nodeId || !box) return;
    const src = String(node?.attrs?.src || '');
    if (!src) {
      message.error(node?.key === 'video' ? '视频不可用' : '图片不可用');
      return;
    }

    if (mode === 'expand') {
      confirmExpand();
      return;
    }

    if (!cropRect) return;

    if (node.key === 'video') {
      confirmVideoCrop();
      return;
    }

    setBusy(true);
    async function applyCrop() {
      try {
        const uploadKey = String(node?.attrs?.uploadKey || node?.attrs?.key || '').trim() || null;
        const nextSrc = await cropImageToDataUrl(
          src,
          box.width,
          box.height,
          cropRect,
          uploadKey
        );
        const outW = Math.max(1, Math.round(cropRect.w));
        const outH = Math.max(1, Math.round(cropRect.h));
        const { id, document: next } = spawnSiblingAtCrop({ src: nextSrc }, outW, outH);
        dispatch(setDocument(next));
        dispatch(setSelectedNodeIds([id]));
        dispatch(setSelectedNodeId(id));
        close();
      } catch (err) {
        console.warn('[crop]', err);
        const detail = err instanceof Error && err.message ? err.message : '';
        message.error(detail ? `裁剪失败：${detail}` : '裁剪失败');
        setBusy(false);
      }
    }
    void applyCrop();
  };

  return (
    <>
      <CropExpandOverlay
        mode={mode}
        imageBox={box}
        cropRect={cropRect}
        expandFrame={expandFrame}
        label={label}
        onCropChange={(next) => {
          setCropRect(next);
          setRatio('original');
        }}
        onExpandChange={(next) => {
          setExpandFrame(next);
          setRatio('original');
        }}
      />

      {/* Title left · ratio · confirm · exit right (same pattern as FlipRotate). */}
      <RcbOverlayPortal>
        <div
          data-crop-expand-toolbar
          data-sel-toolbar
          className="pointer-events-auto absolute z-[37]"
          style={toolbarStyle}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <FloatingToolbar className="relative">
            <span className="inline-flex h-8 items-center gap-1.5 px-1.5 text-[12px] font-medium text-[var(--ink)]">
              {mode === 'expand' ? (
                <HiOutlineArrowsPointingOut className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <HiOutlineScissors className="h-4 w-4 shrink-0" aria-hidden />
              )}
              <span>{mode === 'expand' ? '扩展' : '裁剪'}</span>
            </span>

            <ImageToolSep />

            <button
              type="button"
              className={cn(
                imageToolBtn,
                'gap-1.5 font-medium',
                ratioMenuOpen && 'bg-[var(--accent-soft)]'
              )}
              onClick={() => setRatioMenuOpen((v) => !v)}
            >
              <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[var(--muted)]">
                <AspectPresetGlyph
                  preset={
                    CROP_EXPAND_RATIOS.find((r) => r.id === ratio) || CROP_EXPAND_RATIOS[0]
                  }
                  box={12}
                />
              </span>
              {ratioLabel}
              <HiOutlineChevronDown className="h-3 w-3 text-[var(--muted)]" />
            </button>

            <ImageToolSep />

            <button
              type="button"
              disabled={busy}
              className="mx-[10px] inline-flex h-7 min-w-[52px] items-center justify-center gap-1 rounded-xl px-2.5 text-[12px] font-medium bg-[var(--ink)] text-[var(--on-brand)] transition hover:opacity-90 disabled:bg-[var(--line)] disabled:text-[var(--muted)] disabled:opacity-80"
              onClick={onConfirm}
            >
              {busy ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <>
                  <span>确认</span>
                  {mode === 'expand' ? (
                    <PanelConfirmCost amount={IMAGE_TOOL_TOKEN_COST.expand} />
                  ) : null}
                </>
              )}
            </button>

            <Tooltip tip={'退出'} placement="top">
              <button
                type="button"
                aria-label={'退出'}
                disabled={busy}
                className={imageToolBtn}
                onClick={close}
              >
                <BiExit className="h-[18px] w-[18px]" />
              </button>
            </Tooltip>

            {ratioMenuOpen ? (
              <DropdownPanel className="absolute bottom-[calc(100%+6px)] left-1/2 z-50 min-w-[168px] -translate-x-1/2">
                {CROP_EXPAND_RATIOS.map((r) => (
                  <DropdownPanelItem
                    key={r.id}
                    selected={ratio === r.id}
                    onClick={() => applyRatio(r.id)}
                  >
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-[var(--muted)]">
                      <AspectPresetGlyph preset={r} box={12} />
                    </span>
                    {r.label}
                  </DropdownPanelItem>
                ))}
              </DropdownPanel>
            ) : null}
          </FloatingToolbar>
        </div>
      </RcbOverlayPortal>
    </>
  );
}

export default memo(CropExpandSessionHost);
