/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/canvas/keyboard/useCanvasHotkeys.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, type RefObject } from 'react';
import { useDispatch } from 'react-redux';
import {
  isGeneratorNode
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import {
  resolveSelectionNodeIds
} from '@recombyn-native/components/rcb/scene/document/sceneClipboard';
import {
  clearCanvasAttachPick,
  redo,
  setActiveFrameId,
  setSelectedFrameIds,
  setSelectedNodeId,
  setSelectedNodeIds,
  undo,
} from '@recombyn-native/store/modules/editor';
import { collabRedo, collabUndo } from '@recombyn-native/components/editor/collab/collabRuntime';
import type { CtxAction } from '@recombyn-native/components/rcb/selection/chrome/CanvasContextMenu';
import { filterChatAttachNodeIds } from '../attachPick';

type UseCanvasHotkeysArgs = {
  readOnly: boolean;
  activeTool: string;
  documentRef: RefObject<any>;
  selectedIdsRef: RefObject<string[]>;
  selectedFrameIdsRef: RefObject<string[]>;
  activeFrameIdRef: RefObject<string | null>;
  canvasAttachPickRef: RefObject<unknown>;
  imagePlaceAtRef: RefObject<{ x: number; y: number } | null>;
  imageInputRef: RefObject<HTMLInputElement | null>;
  runCtxActionRef: RefObject<(action: CtxAction) => void>;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onSelectMixed: (nodeIds: string[], frameIds: string[]) => void;
  listNodeIds: () => readonly string[];
  deleteCanvasSelection: () => boolean;
  reorderLayer: (dir: 'front' | 'forward' | 'backward' | 'back', ids: string[]) => void;
  copySelected: (nodeIds?: string[], frameIds?: string[]) => boolean;
  cutSelected: (nodeIds?: string[], frameIds?: string[]) => void;
  duplicateSelected: (nodeIds?: string[], frameIds?: string[]) => void;
  onAddToChat?: (target: string | string[]) => void;
};

export function useCanvasHotkeys(args: UseCanvasHotkeysArgs) {
  const {
    readOnly,
    activeTool,
    documentRef,
    selectedIdsRef,
    selectedFrameIdsRef,
    activeFrameIdRef,
    canvasAttachPickRef,
    imagePlaceAtRef,
    imageInputRef,
    runCtxActionRef,
    onZoomIn,
    onZoomOut,
    onSelectMixed,
    listNodeIds,
    deleteCanvasSelection,
    reorderLayer,
    copySelected,
    cutSelected,
    duplicateSelected,
    onAddToChat,
  } = args;
  const dispatch = useDispatch();

  useEffect(() => {
    const isTypingTarget = (t: HTMLElement | null) =>
      Boolean(
        t &&
          (t.tagName === 'INPUT' ||
            t.tagName === 'TEXTAREA' ||
            t.isContentEditable ||
            t.closest?.(
              '[data-fill-panel], [data-color-panel], [data-select-dropdown], [data-frame-label], [data-text-inline-editor]'
            ))
      );

    const isComposerTarget = (t: HTMLElement | null) =>
      Boolean(
        t?.closest?.(
          '[data-agent-composer], [data-image-generator], [data-video-generator], [data-image-quick-edit]'
        )
      );

    const composerPromptText = (t: HTMLElement | null) => {
      const el =
        (t?.closest?.('[data-agent-composer]') as HTMLElement | null) ||
        (t
          ?.closest?.('[data-image-generator], [data-video-generator], [data-image-quick-edit]')
          ?.querySelector?.('[data-agent-composer]') as HTMLElement | null);
      return (el?.innerText || '').replace(/\u200b/g, '').trim();
    };

    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const typing = isTypingTarget(target);
      const inComposer = isComposerTarget(target);

      if (e.key === 'Escape' && canvasAttachPickRef.current) {
        e.preventDefault();
        dispatch(clearCanvasAttachPick());
        return;
      }

      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        onZoomIn?.();
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        onZoomOut?.();
      }
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (!collabUndo()) dispatch(undo());
      }
      if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (!collabRedo()) dispatch(redo());
      }
      if (mod && e.key.toLowerCase() === 'a' && activeTool === 'select' && !typing) {
        e.preventDefault();
        const doc = documentRef.current;
        const nodeIds = listNodeIds();
        const frameIds = (Array.isArray(doc?.frames) ? doc.frames : [])
          .filter((f: any) => f?.id && !f.locked)
          .map((f: any) => String(f.id));
        onSelectMixed([...nodeIds], frameIds);
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        imagePlaceAtRef.current = null;
        imageInputRef.current?.click();
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'h' && !typing && !readOnly) {
        const ids = selectedIdsRef.current;
        const frameIds = selectedFrameIdsRef.current;
        const targetIds = resolveSelectionNodeIds(documentRef.current, ids, frameIds).filter(
          (id) => !isGeneratorNode(documentRef.current?.deltaSetLike?.[id])
        );
        if (!targetIds.length) return;
        e.preventDefault();
        runCtxActionRef.current('toggleHidden');
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'k' && !typing && !readOnly) {
        const ids = selectedIdsRef.current;
        const frameIds = selectedFrameIdsRef.current;
        const lockableNodes = ids.filter(
          (id) => !isGeneratorNode(documentRef.current?.deltaSetLike?.[id])
        );
        if (!lockableNodes.length && !frameIds.length && !activeFrameIdRef.current) return;
        if (ids.length && !lockableNodes.length && !frameIds.length) return;
        e.preventDefault();
        runCtxActionRef.current('toggleLocked');
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'l' && !typing) {
        const clearAfterAddToChat = () => {
          dispatch(setSelectedNodeIds([]));
          dispatch(setSelectedNodeId(null));
          dispatch(setSelectedFrameIds([]));
          dispatch(setActiveFrameId(null));
        };
        const attachable = filterChatAttachNodeIds(
          documentRef.current,
          resolveSelectionNodeIds(
            documentRef.current,
            selectedIdsRef.current,
            selectedFrameIdsRef.current
          )
        );
        if (attachable.length > 1) {
          e.preventDefault();
          onAddToChat?.(attachable);
          clearAfterAddToChat();
          return;
        }
        const id = attachable[0];
        if (id) {
          e.preventDefault();
          onAddToChat?.(id);
          clearAfterAddToChat();
          return;
        }
        if (selectedIdsRef.current.length || selectedFrameIdsRef.current.length) return;
        if (activeFrameIdRef.current) {
          e.preventDefault();
          onAddToChat?.(`frame:${activeFrameIdRef.current}`);
          clearAfterAddToChat();
        }
      }
      if (mod && !typing && !readOnly) {
        const k = e.key.toLowerCase();
        if (k === 'c') {
          const ids = selectedIdsRef.current;
          const frameIds = selectedFrameIdsRef.current;
          if (!ids.length && !frameIds.length && !activeFrameIdRef.current) return;
          e.preventDefault();
          copySelected(ids, frameIds);
          return;
        }
        if (k === 'x') {
          const ids = selectedIdsRef.current;
          const frameIds = selectedFrameIdsRef.current;
          if (!ids.length && !frameIds.length && !activeFrameIdRef.current) return;
          e.preventDefault();
          cutSelected(ids, frameIds);
          return;
        }
        if (k === 'v') {
          return;
        }
        if (k === 'd') {
          const ids = selectedIdsRef.current;
          const frameIds = selectedFrameIdsRef.current;
          if (!ids.length && !frameIds.length && !activeFrameIdRef.current) return;
          e.preventDefault();
          duplicateSelected(ids, frameIds);
          return;
        }
        if (k === 'g') {
          const ids = selectedIdsRef.current;
          const frameIds = selectedFrameIdsRef.current;
          const targetIds = resolveSelectionNodeIds(documentRef.current, ids, frameIds);
          if (targetIds.length < 2) return;
          e.preventDefault();
          if (e.shiftKey) {
            runCtxActionRef.current('ungroup');
          } else {
            runCtxActionRef.current('group');
          }
          return;
        }
      }
      if (e.key === 'Delete' && !readOnly) {
        if (target?.closest?.('[data-fill-panel], [data-color-panel]')) return;
        if (inComposer && composerPromptText(target)) return;
        if (typing && !inComposer) return;
        const ids = selectedIdsRef.current;
        const frameIds = selectedFrameIdsRef.current;
        if (ids.length || frameIds.length || activeFrameIdRef.current) {
          e.preventDefault();
          deleteCanvasSelection();
        }
      }
      if (e.key === ']' || e.key === '[') {
        const ids = resolveSelectionNodeIds(
          documentRef.current,
          selectedIdsRef.current,
          selectedFrameIdsRef.current
        );
        if (!ids.length) return;
        e.preventDefault();
        if (e.key === ']' && mod) reorderLayer('forward', ids);
        else if (e.key === ']') reorderLayer('front', ids);
        else if (e.key === '[' && mod) reorderLayer('backward', ids);
        else reorderLayer('back', ids);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [
    activeFrameIdRef,
    activeTool,
    canvasAttachPickRef,
    copySelected,
    cutSelected,
    deleteCanvasSelection,
    dispatch,
    documentRef,
    duplicateSelected,
    imageInputRef,
    imagePlaceAtRef,
    listNodeIds,
    onAddToChat,
    onSelectMixed,
    onZoomIn,
    onZoomOut,
    readOnly,
    reorderLayer,
    runCtxActionRef,
    selectedFrameIdsRef,
    selectedIdsRef,
  ]);
}
