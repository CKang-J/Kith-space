/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/canvas/runCanvasCtxAction.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { Dispatch } from '@reduxjs/toolkit';
import { message } from '@recombyn-native/components/base';
import {
  groupNodesInDocument,
  ungroupNodesInDocument,
  unlockedGroupableIds,
} from '@recombyn-native/components/rcb/scene/document/sceneGroups';
import {
  isNodeHidden,
  isNodeLocked,
  isVideoNode,
  isGeneratorNode,
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import { resolveSelectionNodeIds } from '@recombyn-native/components/rcb/scene/document/sceneClipboard';
import { updateNodeInDocument } from '@recombyn-native/components/rcb/scene/document/sceneDocument';
import { exportFabricImage, exportCropSlots, type ExportImageFormat } from '@recombyn-native/components/rcb/scene/paint/exportImage';
import { downloadVideoNodeAsset } from '@recombyn-native/components/editor/nodes/VideoNode/VideoDownloadButton';
import { replaceImageNodeFromFile } from '@recombyn-native/components/editor/nodes/ImageNode/ImageReplaceUploadControl';
import { replaceVideoNodeFromFile } from '@recombyn-native/components/editor/nodes/VideoNode/VideoReplaceCornerButton';
import type { ContextMenuState, CtxAction } from '@recombyn-native/components/rcb/selection/chrome/CanvasContextMenu';
import {
  setActiveFrameId,
  setSelectedFrameIds,
  setMixedSelection,
  updateArtboardFrame,
  updateArtboardFrames,
  setDocument,
  setDocumentFromCanvas,
  pushEditorHistory,
  setSelectedNodeId,
  setSelectedNodeIds,
  spawnImageGenerator,
  spawnVideoGenerator,
  spawnLottieGenerator,
  spawnAudioGenerator,
  undo,
  redo,
} from '@recombyn-native/store/modules/editor';
import { layoutGeneratorPlateAtScene } from './canvasSession';
import { ctxMenuSeedNodeIds, filterChatAttachNodeIds } from './attachPick';
import type { CanvasClipboardApi } from './clipboard/useCanvasClipboard';
import type { SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

export type RunCanvasCtxActionDeps = {
  getCtxMenu: () => ContextMenuState | null;
  clearCtxMenu: () => void;
  selectedIdsRef: { current: string[] };
  selectedFrameIdsRef: { current: string[] };
  activeFrameIdRef: { current: string | null };
  documentRef: { current: any };
  imagePlaceAtRef: { current: { x: number; y: number } | null };
  imageInputRef: { current: HTMLInputElement | null };
  clipboardApiRef: { current: CanvasClipboardApi | null };
  readOnly: boolean;
  dispatch: Dispatch<any>;
  camera: any;
  stageEl: HTMLElement | null;
  t: (key: string, opts?: any) => string;
  onAddToChat?: (id: string | string[]) => void;
  collabUndo: () => boolean;
  collabRedo: () => boolean;
  deleteCanvasSelection: (opts?: { nodeIds?: string[]; frameIds?: string[] }) => boolean;
  reorderLayer: (dir: 'front' | 'forward' | 'backward' | 'back', ids: string[]) => void;
};

export function runCanvasCtxAction(action: CtxAction, deps: RunCanvasCtxActionDeps) {
  const {
    getCtxMenu,
    clearCtxMenu,
    selectedIdsRef,
    selectedFrameIdsRef,
    activeFrameIdRef,
    documentRef,
    imagePlaceAtRef,
    imageInputRef,
    clipboardApiRef,
    readOnly,
    dispatch,
    camera,
    stageEl,
    t,
    onAddToChat,
    collabUndo,
    collabRedo,
    deleteCanvasSelection,
    reorderLayer,
  } = deps;
  const ctxMenu = getCtxMenu();

  let ids = selectedIdsRef.current;
  if (!ids.length && ctxMenu?.nodeId) ids = [ctxMenu.nodeId];

  let placeAt: { x: number; y: number } | null = null;
  if (ctxMenu && Number.isFinite(ctxMenu.sceneX) && Number.isFinite(ctxMenu.sceneY)) {
    placeAt = { x: ctxMenu.sceneX, y: ctxMenu.sceneY };
  }

  const hitNodeId = ctxMenu?.nodeId ?? null;
  const menuFrameId = ctxMenu?.frameId || activeFrameIdRef.current;
  // Only expand via artboards that are actually in the selection (or the
  // frame under the context-menu cursor). Do not use activeFrameId alone —
  // that would pull unrelated board content into group / lock / export.
  let frameIdsForAction = selectedFrameIdsRef.current;
  if (!frameIdsForAction.length && ctxMenu?.frameId) {
    frameIdsForAction = [String(ctxMenu.frameId)];
  }
  clearCtxMenu();

  if (action === 'upload') {
    // Empty canvas only — disabled when right-clicking a node.
    if (hitNodeId) return;
    imagePlaceAtRef.current = placeAt;
    imageInputRef.current?.click();
    return;
  }
  if (action === 'replace') {
    if (readOnly) return;
    const targetId = hitNodeId || (ids.length === 1 ? ids[0] : null);
    if (!targetId) return;
    const node = documentRef.current?.deltaSetLike?.[targetId];
    if (!node || isGeneratorNode(node)) return;
    if (String(node?.attrs?.processStatus || '') === 'running') return;
    const isImage = node.key === 'image';
    const isVideo = isVideoNode(node);
    if (!isImage && !isVideo) return;
    const keepWidth = Math.max(1, Number(node.width) || 1);
    const input = window.document.createElement('input');
    input.type = 'file';
    input.accept = isVideo ? 'video/*' : 'image/*';
    input.style.display = 'none';
    window.document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      if (!file) return;
      const opts = {
        dispatch,
        nodeId: targetId,
        keepWidth,
        file,
      };
      if (isVideo) void replaceVideoNodeFromFile(opts);
      else void replaceImageNodeFromFile(opts);
    };
    input.oncancel = () => input.remove();
    input.click();
    return;
  }
  if (
    action === 'spawnImageGenerator' ||
    action === 'spawnVideoGenerator' ||
    action === 'spawnLottieGenerator' ||
    action === 'spawnAudioGenerator'
  ) {
    const doc = documentRef.current;
    if (!doc) return;
    const specs = {
      spawnImageGenerator: {
        natural: { width: 1024, height: 1024 },
        fit: { minRatio: 0.28, maxRatio: 0.42 },
        nameKey: 'editor.tools.imageGenerator' as const,
        dispatch: spawnImageGenerator,
      },
      spawnVideoGenerator: {
        natural: { width: 1280, height: 720 },
        fit: { minRatio: 0.28, maxRatio: 0.48 },
        nameKey: 'editor.tools.videoGenerator' as const,
        dispatch: spawnVideoGenerator,
      },
      spawnLottieGenerator: {
        natural: { width: 200, height: 200 },
        fit: { minRatio: 0.18, maxRatio: 0.32 },
        nameKey: 'editor.tools.lottieGenerator' as const,
        dispatch: spawnLottieGenerator,
      },
      spawnAudioGenerator: {
        natural: { width: 720, height: 400 },
        fit: { minRatio: 0.22, maxRatio: 0.4 },
        nameKey: 'editor.tools.audioGenerator' as const,
        dispatch: spawnAudioGenerator,
      },
    }[action];
    const laid = layoutGeneratorPlateAtScene({
      document: doc,
      camera,
      stageEl,
      natural: specs.natural,
      center: placeAt,
      fit: specs.fit,
    });
    dispatch(
      specs.dispatch({
        x: laid.x,
        y: laid.y,
        width: laid.width,
        height: laid.height,
        name: t(specs.nameKey),
      })
    );
    return;
  }
  if (action === 'addToChat') {
    const clearAfter = () => {
      dispatch(setSelectedNodeIds([]));
      dispatch(setSelectedNodeId(null));
      dispatch(setSelectedFrameIds([]));
      dispatch(setActiveFrameId(null));
    };
    const seedNodes = ctxMenuSeedNodeIds(ids, hitNodeId);
    const expanded = resolveSelectionNodeIds(
      documentRef.current,
      seedNodes,
      frameIdsForAction
    );
    // Box / multi-select → one group chip (unless right-click landed on an unselected node).
    if (
      seedNodes.length &&
      expanded.length > 1 &&
      (!hitNodeId || expanded.includes(hitNodeId) || ids.includes(hitNodeId))
    ) {
      const attachable = filterChatAttachNodeIds(documentRef.current, expanded);
      if (!attachable.length) return;
      onAddToChat?.(attachable.length === 1 ? attachable[0]! : attachable);
      clearAfter();
      return;
    }
    const id = hitNodeId || ids[0];
    if (id) {
      const attachable = filterChatAttachNodeIds(documentRef.current, [id]);
      if (!attachable.length) return;
      onAddToChat?.(attachable[0]!);
      clearAfter();
      return;
    }
    const frameChip = frameIdsForAction[0] || menuFrameId;
    if (frameChip) {
      // Artboard selected (no node under cursor) — pin the frame into Chat.
      onAddToChat?.(`frame:${frameChip}`);
      clearAfter();
    }
    return;
  }
  if (action === 'group') {
    const targetIds = resolveSelectionNodeIds(documentRef.current, ids, frameIdsForAction);
    const grouped = unlockedGroupableIds(documentRef.current, targetIds);
    if (grouped.length < 2) return;
    const next = groupNodesInDocument(documentRef.current, grouped);
    dispatch(setDocument(next));
    dispatch(setMixedSelection({ nodeIds: grouped, frameIds: frameIdsForAction }));
    return;
  }
  if (action === 'ungroup') {
    const targetIds = resolveSelectionNodeIds(documentRef.current, ids, frameIdsForAction);
    const unlocked = unlockedGroupableIds(documentRef.current, targetIds);
    if (!unlocked.length) return;
    const next = ungroupNodesInDocument(documentRef.current, unlocked);
    dispatch(setDocument(next));
    dispatch(setMixedSelection({ nodeIds: unlocked, frameIds: frameIdsForAction }));
    return;
  }
  if (action === 'undo') {
    if (!collabUndo()) dispatch(undo());
    return;
  }
  if (action === 'redo') {
    if (!collabRedo()) dispatch(redo());
    return;
  }
  if (action === 'copy') {
    clipboardApiRef.current?.copySelected(ids, frameIdsForAction);
    return;
  }
  if (action === 'cut') {
    clipboardApiRef.current?.cutSelected(ids, frameIdsForAction);
    return;
  }
  if (action === 'paste') {
    void clipboardApiRef.current?.pasteFromOsOrInternal(
      placeAt ? { anchor: placeAt } : undefined
    );
    return;
  }
  if (action === 'duplicate') {
    clipboardApiRef.current?.duplicateSelected(ids, frameIdsForAction);
    return;
  }
  if (action === 'delete') {
    let frameIds = selectedFrameIdsRef.current;
    if (!frameIds.length && !ids.length) {
      const fid = menuFrameId || activeFrameIdRef.current;
      if (fid) frameIds = [String(fid)];
    }
    deleteCanvasSelection({ nodeIds: ids, frameIds });
    return;
  }
  if (action === 'front' || action === 'forward' || action === 'backward' || action === 'back') {
    const targetIds = resolveSelectionNodeIds(documentRef.current, ids, frameIdsForAction);
    reorderLayer(action, targetIds.length ? targetIds : ids);
    return;
  }
  if (action === 'toggleHidden') {
    const seedNodes = ctxMenuSeedNodeIds(ids, hitNodeId);
    // Frame-only selection has no hide target (artboards are not scene nodes).
    if (!seedNodes.length) return;
    const targetIds = resolveSelectionNodeIds(
      documentRef.current,
      seedNodes,
      frameIdsForAction
    ).filter((id) => !isGeneratorNode(documentRef.current?.deltaSetLike?.[id]));
    if (!targetIds.length) return;
    const doc = documentRef.current;
    if (!doc) return;
    // Hide if any target is visible; show only when all are hidden.
    const anyVisible = targetIds.some((id) => !isNodeHidden(doc?.deltaSetLike?.[id]));
    dispatch(pushEditorHistory());
    let next = doc;
    for (const id of targetIds) {
      next = updateNodeInDocument(next, id, {
        attrs: { hidden: anyVisible ? 'true' : 'false' },
      });
    }
    dispatch(setDocumentFromCanvas(next));
    // Drop selection on hide so the canvas cannot keep interacting with it.
    // Unhide via layers eye, or re-select the layer then Show.
    if (anyVisible) {
      dispatch(setSelectedNodeIds([]));
      dispatch(setSelectedNodeId(null));
    }
    return;
  }
  if (action === 'toggleLocked') {
    const seedNodes = ctxMenuSeedNodeIds(ids, hitNodeId);
    const targetIds = seedNodes.length
      ? resolveSelectionNodeIds(documentRef.current, seedNodes, frameIdsForAction).filter(
          (id) => !isGeneratorNode(documentRef.current?.deltaSetLike?.[id])
        )
      : [];
    const doc = documentRef.current;
    if (targetIds.length && doc) {
      const anyUnlocked = targetIds.some((id) => !isNodeLocked(doc?.deltaSetLike?.[id]));
      dispatch(pushEditorHistory());
      let next = doc;
      for (const id of targetIds) {
        next = updateNodeInDocument(next, id, {
          attrs: { locked: anyUnlocked ? 'true' : 'false' },
        });
      }
      dispatch(setDocumentFromCanvas(next));
    }
    // Also toggle co-selected artboards (same gesture as node lock).
    if (frameIdsForAction.length) {
      const frames = Array.isArray(documentRef.current?.frames)
        ? documentRef.current.frames
        : [];
      const anyFrameUnlocked = frameIdsForAction.some((fid) => {
        const frame = frames.find((f: any) => f?.id === fid);
        return frame && !frame.locked;
      });
      dispatch(
        updateArtboardFrames({
          patches: frameIdsForAction.map((fid) => ({
            id: fid,
            patch: { locked: anyFrameUnlocked },
          })),
        })
      );
      return;
    }
    if (!targetIds.length && menuFrameId) {
      const frames = Array.isArray(documentRef.current?.frames)
        ? documentRef.current.frames
        : [];
      const frame = frames.find((f: any) => f?.id === menuFrameId);
      dispatch(
        updateArtboardFrame({
          id: menuFrameId,
          patch: { locked: !frame?.locked },
        })
      );
    }
    return;
  }
  if (action === 'exportMp4' || action === 'exportMp3') {
    const doc = documentRef.current;
    const seedNodes = ctxMenuSeedNodeIds(ids, hitNodeId);
    const targetIds = resolveSelectionNodeIds(
      doc,
      seedNodes,
      frameIdsForAction
    );
    const videoNodes = targetIds
      .map((id) => doc?.deltaSetLike?.[id])
      .filter((node: SceneNodeInput) => isVideoNode(node) && String(node?.attrs?.src || '').trim());
    if (!videoNodes.length) {
      message.warning(t('editor.noSelectionExport'));
      return;
    }
    const mode = action === 'exportMp3' ? 'audio' : 'video';
    const hideLoading = message.loading(
      t(
        mode === 'audio'
          ? 'editor.videoToolbar.exportingAudio'
          : 'editor.videoToolbar.exporting',
        {
          defaultValue: mode === 'audio' ? '正在导出音频…' : '正在导出视频…',
        }
      ),
      0
    );
    const exportSelectedVideos = async () => {
      try {
        for (const node of videoNodes) {
          const attrs = node?.attrs || {};
          await downloadVideoNodeAsset({
            src: String(attrs.src || ''),
            name: String(node?.name || attrs.name || 'video'),
            uploadKey: attrs.uploadKey != null ? String(attrs.uploadKey) : null,
            cropX: attrs.cropX,
            cropY: attrs.cropY,
            cropW: attrs.cropW,
            cropH: attrs.cropH,
            trimStart: attrs.trimStart,
            trimEnd: attrs.trimEnd,
            flipX: attrs.flipX === true || attrs.flipX === 'true',
            flipY: attrs.flipY === true || attrs.flipY === 'true',
            mode,
          });
        }
        hideLoading();
        message.success(
          t(mode === 'audio' ? 'editor.exportedAudio' : 'editor.exportedVideo', {
            defaultValue: mode === 'audio' ? '已导出音频' : '已导出视频',
          })
        );
      } catch (err) {
        hideLoading();
        console.warn('[ctx-video-export]', err);
        message.error(
          t(
            mode === 'audio'
              ? 'editor.videoToolbar.exportAudioFail'
              : 'editor.videoToolbar.downloadFail',
            {
              defaultValue: mode === 'audio' ? '音频导出失败（可能无音轨）' : '下载失败',
            }
          )
        );
      }
    };
    exportSelectedVideos();
    return;
  }
  if (action === 'exportPng' || action === 'exportJpg' || action === 'exportSvg') {
    let format: ExportImageFormat = 'png';
    if (action === 'exportJpg') format = 'jpeg';
    else if (action === 'exportSvg') format = 'svg';
    const doc = documentRef.current;
    const seedNodes = ctxMenuSeedNodeIds(ids, hitNodeId);
    // Mixed / node selection: export expanded nodes. Frame-only keeps crop export
    // so artboard background is preserved.
    if (seedNodes.length) {
      const targetIds = resolveSelectionNodeIds(
        documentRef.current,
        seedNodes,
        frameIdsForAction
      );
      if (targetIds.length) {
        const ok = exportFabricImage({
          selectionOnly: true,
          nodeIds: targetIds,
          document: doc,
          format,
          filename: t('editor.layerExportName'),
        });
        if (ok) {
          message.success(t(format === 'svg' ? 'editor.exportedSvg' : 'editor.exportedImage'));
        } else {
          message.error(t('editor.exportFailed'));
        }
        return;
      }
    }
    const exportFrameId = frameIdsForAction[0] || menuFrameId;
    if (exportFrameId) {
      const frames = Array.isArray(doc?.frames) ? doc.frames : [];
      const frame = frames.find((f: any) => f?.id === exportFrameId);
      if (frame && frame.width > 0 && frame.height > 0) {
        async function exportFrame() {
          const tally = await exportCropSlots({
            crop: {
              x: Number(frame.x) || 0,
              y: Number(frame.y) || 0,
              width: Number(frame.width) || 1,
              height: Number(frame.height) || 1,
            },
            backgroundColor: frame.backgroundColor,
            baseName: String(frame.name || t('editor.pageExportName')),
            compress: false,
            document: doc,
            slots: [
              {
                id: 'ctx',
                scale: 1,
                affixMode: 'suffix',
                affix: '',
                format,
              },
            ],
          });
          if (tally.saved > 0) {
            message.success(
              t(format === 'svg' ? 'editor.exportedSvg' : 'editor.exportedImage')
            );
          } else if (!(tally.cancelled > 0 && tally.failed === 0)) {
            message.error(t('editor.exportFailed'));
          }
        }
        void exportFrame();
      }
    }
  }
}
