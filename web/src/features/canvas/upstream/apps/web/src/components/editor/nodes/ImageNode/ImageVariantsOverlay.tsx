/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/ImageVariantsOverlay.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import {
  RcbOverlayPortal,
  useRcbCamera,
  rcbSceneToScreen,
} from '@recombyn-native/components/rcb';
import {
  isImageGeneratorNode
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import {
  listImageVariantUrls
} from '@recombyn-native/components/rcb/scene/document/mediaLifecycle';
import { detachImageVariant, patchDocumentNode } from '@recombyn-native/store/modules/editor';
import { cn } from '@recombyn-native/utils/classnames';
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';
const EDGE_PAD = 10;
const EXPAND_GAP = 12;
const CORNER_BTN = 20;

type SceneBox = { left: number; top: number; width: number; height: number };

/**
 * Full-size alt tiles — prefer left of main, then above, then right
 * (so results stay on-canvas instead of clipping off the right edge).
 */
function expandedAltLayout(
  main: { left: number; top: number; width: number; height: number },
  count: number
) {
  if (count <= 0) return [];
  const w = main.width;
  const h = main.height;
  const gap = EXPAND_GAP;
  const need = count * w + (count - 1) * gap;
  const preferLeft = main.left >= need + gap + 16;
  const preferAbove = !preferLeft && main.top >= h + gap + 40;

  return Array.from({ length: count }, (_, i) => {
    if (preferLeft) {
      return {
        left: main.left - (i + 1) * (w + gap),
        top: main.top,
        width: w,
        height: h,
      };
    }
    if (preferAbove) {
      return {
        left: main.left + main.width - (i + 1) * w - i * gap,
        top: main.top - h - gap,
        width: w,
        height: h,
      };
    }
    return {
      left: main.left + w + gap + i * (w + gap),
      top: main.top,
      width: w,
      height: h,
    };
  });
}

/**
 * Multi-gen stack: top-right “N张图” count + expand tiles.
 * Positioned from the same scene box as selection chrome so controls never overlap.
 */
function ImageVariantsOverlay({
  document,
  nodeId,
  box,
  angle = 0,
  imageHovered = false,
  hidden,
  readOnly,
}: {
  document: SceneDocument;
  nodeId: string;
  /** Scene-space image box (same as SelectionFeature chrome). */
  box: SceneBox;
  angle?: number;
  imageHovered?: boolean;
  hidden?: boolean;
  readOnly?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const camera = useRcbCamera();
  const [expanded, setExpanded] = useState(false);
  const [barHovered, setBarHovered] = useState(false);

  const node = nodeId ? document?.deltaSetLike?.[nodeId] : null;
  const urls = useMemo(() => (node ? listImageVariantUrls(node) : []), [node]);
  const mainSrc = String(node?.attrs?.src || '').trim();
  const alts = useMemo(() => urls.filter((u) => u !== mainSrc), [urls, mainSrc]);
  const canShow =
    !hidden &&
    !readOnly &&
    Boolean(node) &&
    Boolean(nodeId) &&
    node?.key === 'image' &&
    !isImageGeneratorNode(node) &&
    urls.length > 1 &&
    String(node?.attrs?.processStatus || '') !== 'running';

  useEffect(() => {
    setExpanded(false);
  }, [nodeId]);

  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    let removePointer: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      const onPointer = (e: PointerEvent) => {
        const el = e.target as HTMLElement | null;
        if (el?.closest?.('[data-image-variants]')) return;
        setExpanded(false);
      };
      window.addEventListener('pointerdown', onPointer, true);
      removePointer = () => window.removeEventListener('pointerdown', onPointer, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      removePointer?.();
    };
  }, [expanded]);

  if (!canShow || !node || !nodeId) return null;

  const tl = rcbSceneToScreen(camera, box.left, box.top);
  const br = rcbSceneToScreen(camera, box.left + box.width, box.top + box.height);
  const stageBox = {
    left: Math.min(tl.x, br.x),
    top: Math.min(tl.y, br.y),
    width: Math.abs(br.x - tl.x),
    height: Math.abs(br.y - tl.y),
  };
  const count = urls.length;
  const altLayout = expandedAltLayout(stageBox, alts.length);
  const visible = imageHovered || barHovered || expanded;

  const frameStyle: CSSProperties = {
    position: 'absolute',
    left: stageBox.left,
    top: stageBox.top,
    width: stageBox.width,
    height: stageBox.height,
    transform: Math.abs(angle) > 0.001 ? `rotate(${angle}deg)` : undefined,
    transformOrigin: 'center center',
  };

  const setMain = (url: string) => {
    if (!nodeId || url === mainSrc) return;
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: { attrs: { src: url } },
      })
    );
  };

  const detach = (url: string) => {
    if (!nodeId) return;
    dispatch(
      detachImageVariant({
        nodeId,
        url,
        name: t('editor.tools.imageDetachedName'),
      })
    );
    setExpanded(false);
  };

  return (
    <RcbOverlayPortal>
      <div
        data-image-variants
        data-sel-toolbar
        data-scene-node-id={nodeId}
        className="pointer-events-none"
      >
        {/* Corner count — hover-visible; replace lives in the context menu */}
        <div className="pointer-events-none absolute z-[36]" style={frameStyle}>
          <div
            data-image-variants-bar
            data-image-node-id={nodeId}
            className={cn(
              'absolute flex items-center gap-1 transition-opacity duration-150',
              visible
                ? 'pointer-events-auto opacity-100'
                : 'pointer-events-none opacity-0'
            )}
            style={{ right: EDGE_PAD, top: EDGE_PAD }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerEnter={() => setBarHovered(true)}
            onPointerLeave={() => setBarHovered(false)}
          >
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={
                expanded
                  ? t('editor.tools.imageStackCollapse')
                  : t('editor.tools.imageStackExpand', { count })
              }
              onClick={() => setExpanded((v) => !v)}
              className={cn(
                'inline-flex h-5 min-w-[20px] items-center justify-center whitespace-nowrap rounded-[3px] px-1.5 text-[11px] font-semibold leading-none text-white shadow-[0_2px_8px_rgba(15,23,42,0.2)] transition',
                expanded ? 'bg-[var(--ink)]' : 'bg-[#1a1a1a] hover:bg-[#2a2a2a]'
              )}
              style={{ minHeight: CORNER_BTN }}
            >
              {t('editor.tools.imageStackCount', { count })}
            </button>
          </div>
        </div>

        {expanded
          ? alts.map((url, i) => {
              const pos = altLayout[i] || {
                left: stageBox.left - stageBox.width - EXPAND_GAP,
                top: stageBox.top,
                width: stageBox.width,
                height: stageBox.height,
              };
              const cardStyle: CSSProperties = {
                position: 'absolute',
                left: pos.left,
                top: pos.top,
                width: pos.width,
                height: pos.height,
                transform: Math.abs(angle) > 0.001 ? `rotate(${angle}deg)` : undefined,
                transformOrigin: 'center center',
              };
              return (
                <div
                  key={`${nodeId}-alt-${i}-${url.slice(-24)}`}
                  className="pointer-events-auto absolute z-[36] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-[0_8px_28px_rgba(15,23,42,0.18)]"
                  style={cardStyle}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
                  <div className="absolute right-2 top-2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setMain(url)}
                      className="inline-flex h-7 items-center whitespace-nowrap rounded-md bg-black/65 px-2 text-[11px] font-medium text-white transition hover:bg-black/80"
                    >
                      {t('editor.tools.imageStackSetMain')}
                    </button>
                    <button
                      type="button"
                      onClick={() => detach(url)}
                      className="inline-flex h-7 items-center whitespace-nowrap rounded-md bg-black/65 px-2 text-[11px] font-medium text-white transition hover:bg-black/80"
                    >
                      {t('editor.tools.imageStackDetach')}
                    </button>
                  </div>
                </div>
              );
            })
          : null}
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(ImageVariantsOverlay);
