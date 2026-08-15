/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/toolPanels/ImageToolPanelHost.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, memo } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { message } from '@recombyn-native/components/base';
import {
  closeImageToolPanel,
  failImageProcess,
  finishImageProcess,
  patchDocumentNode,
  pushEditorHistory,
  startImageProcess,
  type ImageToolPanelKind,
} from '@recombyn-native/store/modules/editor';
import { buildNodeAdjustFilterCss } from '@recombyn-native/components/rcb/scene/document/sceneFill';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import {
  RcbOverlayPortal,
  useRcbCamera,
  useRcbDevicePixelRatio,
  rcbSceneToScreen,
} from '@recombyn-native/components/rcb';
import { uploadImageFromSrc } from '@recombyn-native/utils/uploadImage';
import {
  layerOpacityToPct,
  parseLayerOpacity,
} from '@recombyn-native/components/rcb/selection/chrome/BlendModeControl';
import EraserMaskOverlay, { type EraserMaskOverlayHandle } from './EraserMaskOverlay';
import EraserToolPanel from './EraserToolPanel';
import OpacityToolPanel from './OpacityToolPanel';
import MultiAngleToolPanel from './MultiAngleToolPanel';
import AdjustToolPanel, {
  parseAdjustValues,
  type AdjustValues,
} from './AdjustToolPanel';
import ReplaceTextToolPanel from './ReplaceTextToolPanel';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

/** Local erase → right-side cutout node (source image untouched), same pattern as 抠图. */
async function confirmEraserAsNewNode(opts: {
  applyErase: (src: string, o?: { uploadKey?: string | null }) => Promise<string>;
  src: string;
  uploadKey: string | null;
  sourceId: string;
  label: string;
  dispatch: (action: unknown) => void;
  getPendingProcessId: () => string | null;
  /** Called after the loading clone is spawned (close eraser UI). */
  onSpawned?: () => void;
}): Promise<void> {
  const erased = await opts.applyErase(opts.src, { uploadKey: opts.uploadKey });
  if (!erased || erased === opts.src) {
    throw new Error('请先在图片上涂抹');
  }
  opts.dispatch(
    startImageProcess({
      sourceId: opts.sourceId,
      kind: 'eraser',
      label: opts.label,
    })
  );
  const processId = opts.getPendingProcessId();
  if (!processId) throw new Error('橡皮失败');
  opts.onSpawned?.();
  try {
    const uploaded = await uploadImageFromSrc(erased, 'eraser.png');
    const url = String(uploaded?.url || erased).trim() || erased;
    opts.dispatch(
      finishImageProcess({
        nodeId: processId,
        src: url,
        attrs: {
          cutout: 'true',
          name: '擦除',
          ...(uploaded?.key ? { uploadKey: String(uploaded.key) } : {}),
        },
      })
    );
  } catch (err) {
    opts.dispatch(failImageProcess({ nodeId: processId }));
    throw err;
  }
}

/** Dock Eraser / Replace text / … to the image's top-right (not the selection toolbar). */
function panelStyleRight(
  camera: { x: number; y: number; zoom: number },
  box: { left: number; top: number; width: number; height: number },
  dpr?: number
): CSSProperties {
  const gap = 16 / Math.max(0.05, camera.zoom);
  // Top edge of the image, just outside the right edge — same as Eraser card.
  const { x, y } = rcbSceneToScreen(
    camera,
    box.left + box.width + gap,
    box.top,
    dpr
  );
  return {
    position: 'absolute',
    left: x,
    top: y,
    zIndex: 40,
  };
}

function nodeBox(
  document: SceneDocument,
  node: SceneNodeInput
): { left: number; top: number; width: number; height: number } | null {
  if (!node) return null;
  const { left, top } = nodeLeftTop(document, node);
  return {
    left,
    top,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
}

/** Host for image tool panels positioned relative to the source image. */
function ImageToolPanelHost({ document }: { document: SceneDocument }): ReactNode {
  const dispatch = useDispatch();
  const store = useStore();
  const { t } = useTranslation();
  const camera = useRcbCamera();
  const dpr = useRcbDevicePixelRatio();
  const panel = useSelector((s: any) => s.editor.imageToolPanel as null | {
    nodeId: string;
    kind: ImageToolPanelKind;
  });
  const selectedNodeId = useSelector((s: any) => s.editor.selectedNodeId as string | null);

  const [brushSize, setBrushSize] = useState(96);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [eraseBusy, setEraseBusy] = useState(false);
  const [opacityPct, setOpacityPct] = useState(100);
  const maskRef = useRef<EraserMaskOverlayHandle>(null);
  const adjustHistoryPushedRef = useRef(false);
  const adjustBaselineRef = useRef<{ cssFilter: string; adjustValues: unknown } | null>(null);
  const opacityBaselineRef = useRef(1);

  useEffect(() => {
    if (!panel) return;
    if (!selectedNodeId || selectedNodeId !== panel.nodeId) {
      dispatch(closeImageToolPanel());
    }
  }, [selectedNodeId, panel, dispatch]);

  useEffect(() => {
    if (!panel) return;
    // Crop / expand / flipRotate / media quick-edit are owned outside this host
    // (selection chrome). Do not force `node.key === 'image'` for those.
    if (
      panel.kind === 'crop' ||
      panel.kind === 'expand' ||
      panel.kind === 'upscale' ||
      panel.kind === 'flipRotate' ||
      panel.kind === 'quickEdit' ||
      panel.kind === 'lottieEdit' ||
      panel.kind === 'mark'
    ) {
      return;
    }
    const node = document?.deltaSetLike?.[panel.nodeId];
    if (!node || node.key !== 'image') dispatch(closeImageToolPanel());
  }, [document, panel, dispatch]);

  useEffect(() => {
    if (panel?.kind !== 'eraser' || !panel.nodeId) return;
    const node = document?.deltaSetLike?.[panel.nodeId];
    const boxNow = nodeBox(document, node);
    const shortSide = Math.min(boxNow?.width || 0, boxNow?.height || 0);
    // ~12% of the short side — readable on large plates without maxing the slider.
    const initial = Math.round(Math.min(280, Math.max(64, shortSide * 0.12 || 96)));
    setBrushSize(initial);
    setHasStrokes(false);
    setEraseBusy(false);
    maskRef.current?.clear();
    // Only when opening / switching the eraser target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel?.kind, panel?.nodeId]);

  useEffect(() => {
    if (panel?.kind !== 'opacity' || !panel.nodeId) return;
    const node = document?.deltaSetLike?.[panel.nodeId];
    const base = parseLayerOpacity(node?.attrs?.opacity, 1);
    opacityBaselineRef.current = base;
    setOpacityPct(layerOpacityToPct(base));
    // Only when opening / switching the opacity target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel?.kind, panel?.nodeId]);

  // Snapshot adjust attrs once when the panel opens (for cancel restore).
  useEffect(() => {
    if (panel?.kind !== 'adjust' || !panel.nodeId) {
      adjustHistoryPushedRef.current = false;
      adjustBaselineRef.current = null;
      return;
    }
    const node = document?.deltaSetLike?.[panel.nodeId];
    adjustHistoryPushedRef.current = false;
    adjustBaselineRef.current = {
      cssFilter: String(node?.attrs?.cssFilter || '').trim(),
      adjustValues: node?.attrs?.adjustValues ?? null,
    };
    // Only re-snapshot when opening / switching image — not on every doc patch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel?.kind, panel?.nodeId]);

  const box = useMemo(() => {
    if (!panel) return null;
    return nodeBox(document, document?.deltaSetLike?.[panel.nodeId]);
  }, [document, panel]);

  if (!panel || !box) return null;
  // Flip/rotate + Chat quick-edit use the selection floating toolbar; crop/expand use on-canvas frame.
  if (
    panel.kind === 'flipRotate' ||
    panel.kind === 'quickEdit' ||
    panel.kind === 'lottieEdit' ||
    panel.kind === 'crop' ||
    panel.kind === 'expand' ||
    panel.kind === 'upscale' ||
    panel.kind === 'mark'
  ) {
    return null;
  }

  const close = () => dispatch(closeImageToolPanel());

  const runProcess = (kind: ImageToolPanelKind, label: string, size?: {
    targetWidth?: number;
    targetHeight?: number;
  }) => {
    dispatch(
      startImageProcess({
        sourceId: panel.nodeId,
        kind,
        label,
        targetWidth: size?.targetWidth,
        targetHeight: size?.targetHeight,
      })
    );
    close();
  };

  const style = panelStyleRight(camera, box, dpr);

  const writeAdjustAttrs = (opts: AdjustValues, mode: 'preview' | 'commit') => {
    const node = document?.deltaSetLike?.[panel.nodeId];
    const filter = buildNodeAdjustFilterCss(opts);
    const cssFilter = filter === 'none' ? '' : filter;
    const adjustValues = JSON.stringify(opts);
    if (mode === 'preview') {
      if (!adjustHistoryPushedRef.current) {
        adjustHistoryPushedRef.current = true;
        dispatch(pushEditorHistory());
      }
      dispatch(
        patchDocumentNode({
          nodeId: panel.nodeId,
          skipHistory: true,
          patch: {
            attrs: {
              ...(node?.attrs || {}),
              cssFilter,
              adjustValues,
            },
          },
        })
      );
      return;
    }
    dispatch(
      patchDocumentNode({
        nodeId: panel.nodeId,
        // History already snapped on first preview; avoid a duplicate empty undo step.
        skipHistory: adjustHistoryPushedRef.current,
        patch: {
          attrs: {
            ...(node?.attrs || {}),
            cssFilter,
            adjustValues,
          },
        },
      })
    );
  };

  const writeOpacity = (pct: number, mode: 'preview' | 'commit') => {
    const node = document?.deltaSetLike?.[panel!.nodeId];
    const next01 = Math.min(1, Math.max(0, Math.round(pct) / 100));
    dispatch(
      patchDocumentNode({
        nodeId: panel!.nodeId,
        skipHistory: mode === 'preview',
        patch: {
          attrs: {
            ...(node?.attrs || {}),
            opacity: next01,
          },
        },
      })
    );
  };

  let body: ReactNode = null;
  switch (panel.kind) {
    case 'opacity':
      body = (
        <OpacityToolPanel
          opacityPct={opacityPct}
          onOpacityPctChange={(v) => {
            setOpacityPct(v);
            writeOpacity(v, 'preview');
          }}
          onReset={() => {
            setOpacityPct(100);
            writeOpacity(100, 'preview');
          }}
          onCancel={() => {
            const node = document?.deltaSetLike?.[panel.nodeId];
            dispatch(
              patchDocumentNode({
                nodeId: panel.nodeId,
                skipHistory: true,
                patch: {
                  attrs: {
                    ...(node?.attrs || {}),
                    opacity: opacityBaselineRef.current,
                  },
                },
              })
            );
            close();
          }}
          onConfirm={() => {
            writeOpacity(opacityPct, 'commit');
            close();
          }}
        />
      );
      break;
    case 'eraser':
      body = (
        <EraserToolPanel
          brushSize={brushSize}
          onBrushSizeChange={setBrushSize}
          hasStrokes={hasStrokes}
          confirmBusy={eraseBusy}
          onReset={() => {
            const shortSide = Math.min(box.width, box.height);
            setBrushSize(Math.round(Math.min(280, Math.max(64, shortSide * 0.12 || 96))));
            maskRef.current?.clear();
            setHasStrokes(false);
          }}
          onCancel={close}
          onConfirm={async () => {
            if (!hasStrokes || eraseBusy) return;
            const sourceId = panel.nodeId;
            const node = document?.deltaSetLike?.[sourceId];
            const src = String(node?.attrs?.src || '');
            if (!src) {
              message.error('未找到图片');
              return;
            }
            const applyErase = maskRef.current?.applyErase;
            if (!applyErase) return;
            setEraseBusy(true);
            try {
              await confirmEraserAsNewNode({
                applyErase,
                src,
                uploadKey: String(node?.attrs?.uploadKey || node?.attrs?.key || '') || null,
                sourceId,
                label: t('editor.imageToolbar.processingEraser'),
                dispatch,
                getPendingProcessId: () =>
                  (store.getState() as any).editor?.pendingImageProcessId || null,
                onSpawned: close,
              });
              message.success('擦除完成（透明 PNG）');
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : '';
              message.error(msg && msg !== '橡皮失败' ? msg : '橡皮失败');
            } finally {
              setEraseBusy(false);
            }
          }}
        />
      );
      break;
    case 'multiAngle': {
      const node = document?.deltaSetLike?.[panel.nodeId];
      body = (
        <MultiAngleToolPanel
          imageSrc={String(node?.attrs?.src || '') || undefined}
          onCancel={close}
          onConfirm={(opts) => {
            dispatch(
              startImageProcess({
                sourceId: panel.nodeId,
                kind: 'multiAngle',
                label: '多角度生成中',
                meta: {
                  rotate: opts.rotate,
                  tilt: opts.tilt,
                  zoom: opts.zoom,
                  mode: opts.mode,
                },
              })
            );
            close();
          }}
        />
      );
      break;
    }
    case 'adjust': {
      const node = document?.deltaSetLike?.[panel.nodeId];
      const saved = parseAdjustValues(
        adjustBaselineRef.current?.adjustValues ?? node?.attrs?.adjustValues
      );
      body = (
        <AdjustToolPanel
          key={`${panel.nodeId}-adjust`}
          initialValues={saved}
          onChange={(opts) => writeAdjustAttrs(opts, 'preview')}
          onCancel={() => {
            const baseline = adjustBaselineRef.current;
            const n = document?.deltaSetLike?.[panel.nodeId];
            dispatch(
              patchDocumentNode({
                nodeId: panel.nodeId,
                skipHistory: true,
                patch: {
                  attrs: {
                    ...(n?.attrs || {}),
                    cssFilter: baseline?.cssFilter ?? '',
                    adjustValues: baseline?.adjustValues ?? null,
                  },
                },
              })
            );
            close();
          }}
          onConfirm={(opts) => {
            writeAdjustAttrs(opts, 'commit');
            close();
          }}
        />
      );
      break;
    }
    case 'replaceText': {
      const node = document?.deltaSetLike?.[panel.nodeId];
      const initialOriginal = String(
        node?.attrs?.letteringText || node?.attrs?.replaceTextOriginal || ''
      ).trim();
      body = (
        <ReplaceTextToolPanel
          key={`${panel.nodeId}-replaceText`}
          initialOriginal={initialOriginal}
          onCancel={close}
          onConfirm={(opts) => {
            dispatch(
              startImageProcess({
                sourceId: panel.nodeId,
                kind: 'replaceText',
                label: t('editor.imageToolbar.processingReplaceText'),
                meta: {
                  originalText: opts.originalText,
                  newText: opts.newText,
                },
              })
            );
            close();
          }}
        />
      );
      break;
    }
    default:
      break;
  }

  return (
    <>
      {panel.kind === 'eraser' ? (
        <EraserMaskOverlay
          ref={maskRef}
          imageBox={box}
          brushSize={brushSize}
          onDirtyChange={setHasStrokes}
        />
      ) : null}
      <RcbOverlayPortal>
        <div
          className="pointer-events-auto"
          style={style}
          data-image-tool-panel
          onPointerDown={(e) => {
            // Stop bubble so canvas selection/pan does not run; do not use capture —
            // capture stopPropagation blocks panel internals (e.g. angle-editor drag).
            e.stopPropagation();
          }}
        >
          {body}
        </div>
      </RcbOverlayPortal>
    </>
  );
}

export default memo(ImageToolPanelHost);
