/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/selection/SelectionFeature.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import ImageVariantsOverlay from '@recombyn-native/components/editor/nodes/ImageNode/ImageVariantsOverlay';
import {
  useRcbCamera,
  useRcbOverlayRoot,
  useRcbScreenToScene,
  useRcbViewportEl,
} from '@recombyn-native/components/rcb/camera/context';
import {
  rcbCameraCssZoom,
  rcbResolveViewportEl,
} from '@recombyn-native/components/rcb/core/math';
import { logEdgeSamples, sampleBoxEdges } from '@recombyn-native/components/rcb/core/dprDebug';
import {
  getDocumentGridSize,
  collectPairSpacingGuides,
  SMART_GUIDE_COLOR,
  type SceneBox,
  type SmartGuideLine,
} from './alignGuides';
import SelectionChrome from './SelectionChrome';
import SelectionContextToolbar from './chrome/SelectionContextToolbar';
import MultiSelectionToolbar from './chrome/MultiSelectionToolbar';
import NodeTitleLabel from './chrome/NodeTitleLabel';
import BrushOverlay from './chrome/BrushOverlay';
import SmartGuidesOverlay from './chrome/SmartGuidesOverlay';
import CornerRadiusHandlesOverlay from './chrome/CornerRadiusHandlesOverlay';
import PolygonShapeHandlesOverlay from './chrome/PolygonShapeHandlesOverlay';
import StarShapeHandlesOverlay from './chrome/StarShapeHandlesOverlay';
import CircleShapeHandlesOverlay from './chrome/CircleShapeHandlesOverlay';
import {
  rotateBoxesAround,
  scaleBoxesToOrientedUnion,
  resolveControlChrome,
  getSelectionSharedRotation,
  pointInOrientedBox,
  type ResizeHandle,
} from './resizeGeometry';
import { rememberNodePath2D } from '@recombyn-native/components/rcb/scene/document/sceneShapes';
import { expandSelectionWithGroups } from '@recombyn-native/components/rcb/scene/document/sceneGroups';
import {
  isAudioGeneratorNode,
  isImageGeneratorNode,
  isLottieGeneratorNode,
  isVideoGeneratorNode,
  isNodeHidden,
  isNodeLocked,
  supportsCornerRadius,
  supportsShapeSides,
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import { listImageVariantUrls } from '@recombyn-native/components/rcb/scene/document/mediaLifecycle';
import { deflateSelectionBox } from '@recombyn-native/components/rcb/scene/document/sceneEffects';
import { isEditablePathNode } from '@recombyn-native/components/rcb/scene/paint/outlineToPath';
import { patchDocumentNode, setDevHoverNodeId } from '@recombyn-native/store/modules/editor';
import type { TextResizeMode } from '@recombyn-native/components/rcb/scene/paint/svgToScene';
import {
  ShapeOutlineSvg,
  nodeUsesOpenStrokeEndpoints,
  pathLocalEndpoints,
  type ShapeOutlineItem,
} from './HostPathChrome';
import { smartSnapThreshold } from './alignGuides';
import {
  CORNER_HANDLES,
  textResizeModeForHandle,
  nodeAspectLockDefault,
  mediaTitleChrome,
  readNodeAspectLocked,
  combineAspectLock,
  resolveLockAspect,
  applyTextWrapHeight,
  normalizeBox,
  boxesIntersect,
  expandSceneBox,
  marqueeHitPadScene,
  MARQUEE_MIN_HIT_SCREEN_PX,
  framesHittingMarquee,
  resolveInspectPrimaryId,
  isHostInjectedSelection,
  frameForFullBleedPlate,
  sceneBoxFromMountedNode,
  pointInBox,
  nodeHitsMarquee,
  toolbarBoxForSelection,
  patchesAsOrigins,
  multiMembersKey,
  DRAG_SCREEN_PX,
  DRAG_DISTANCE_SQUARED,
  BRUSH_SCREEN_PX,
  TOUCH_BRUSH_SCREEN_PX,
  brushScreenPx,
  makeDragSeed,
  sceneFromClientGesture,
  screenDragDistSq,
  evaluateBrushGate,
  softSelectFrameAt,
  isSelectionOriginsLocked,
  isRecentNodeDoubleTap,
  buildMoveOriginsForHit,
  filterMarqueeContentHits,
  commitMarqueeSelection,
  visualGuideBoxForNode,
  visualBoxFromChromeOrigin,
  computeMovedUnion,
  computeResizedUnion,
  collectSmartGuideTargets,
  smartGuideTargetsForDrag,
  computeRotateDelta,
  strokeEndpointBox,
  resizeOpenPathByEndpoint,
  readNodeAngle,
  readNodeShapeType,
  isStrokeShapeType,
  resolveChromeAngle,
  resolveMeasurePairNodeId,
  resolveMeasureBox,
  deflateChromeBox,
  resolveTransformHostGuideBox,
  buildShapeOutlines,
  resolveToolbarEdgePadScene,
  resolveChromeUnion,
  resolveHoverImageVariantsId,
  resolveSelectionEdgeHandles,
  type MediaTitleIcon,
  type GeometryPatch,
  type DragState,
  type MoveSnapContext,
  type ResizeSnapContext,
} from './selectionLogic';
import { frameSelId, parseFrameSelId } from './frameSelectionIds';
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';

type SelectionFeatureProps = {
  enabled: boolean;
  /** Share/preview: select + Dev annotations only — no move/resize/edit. */
  readOnly?: boolean;
  document: SceneDocument;
  selectedNodeIds: string[];
  /** Artboard frames in the same selection as nodes (union control box). */
  selectedFrameIds?: string[];
  paperEl: HTMLElement | null;
  /** Viewport element for infinite canvas (optional; camera context is preferred). */
  stageEl?: HTMLElement | null;
  artboard: { width: number; height: number };
  onSelect: (ids: string[], opts?: { additive?: boolean }) => void;
  /** Hit-test artboard frames in scene coords. */
  hitTestFrame?: (x: number, y: number) => string | null;
  onSelectFrame?: (frameId: string | null) => void;
  /** Marquee / multi artboard selection (frames only). */
  onSelectFrames?: (frameIds: string[]) => void;
  /** Marquee selecting nodes and/or frames together. */
  onSelectMixed?: (
    nodeIds: string[],
    frameIds: string[],
    opts?: { additive?: boolean }
  ) => void;
  onGeometryCommit: (
    patches: GeometryPatch[],
    options?: { textResizeMode?: TextResizeMode; skipHistory?: boolean }
  ) => void;
  /** Live DOM preview while dragging (does not write document). */
  onGeometryPreview?: (
    patches: GeometryPatch[],
    options?: { textResizeMode?: TextResizeMode }
  ) => void;
  onAngleCommit?: (
    nodeId: string,
    angleDeg: number,
    options?: { skipHistory?: boolean }
  ) => void;
  onAnglePreview?: (nodeId: string, angleDeg: number) => void;
  hitTest: (
    x: number,
    y: number,
    screen?: { clientX: number; clientY: number }
  ) => string | null;
  getNodeBox: (nodeId: string) => SceneBox | null;
  listNodeIds: () => readonly string[];
  /**
   * Optional spatial prefilter for marquee (and similar rect queries).
   * Return candidate ids that may intersect `box`; fine hit still uses nodeHitsMarquee.
   */
  queryNodeIdsInRect?: (box: SceneBox) => string[];
  onOpenAgent?: (opts?: { prompt?: string }) => void;
  /** Double-click a text node to edit inline. */
  onEditText?: (nodeId: string) => void;
  /** Double-click a pen path to edit anchors / handles. */
  onEditPenPath?: (nodeId: string) => void;
  /** Hide selection chrome / toolbars (e.g. while inline text editing). */
  suppressChrome?: boolean;
  /** Fires when move / resize / rotate starts or ends (for hiding node titles). */
  onTransformingChange?: (transforming: boolean) => void;
  /**
   * Composer "Add from canvas" pick mode ??clicks attach via onSelect and must
   * not start a move (already-selected hits would otherwise skip onSelect).
   */
  attachPickActive?: boolean;
};


function SelectionFeature({
  enabled,
  readOnly = false,
  document,
  selectedNodeIds,
  selectedFrameIds = [],
  paperEl,
  stageEl = null,
  artboard,
  onSelect,
  hitTestFrame,
  onSelectFrame,
  onSelectFrames,
  onSelectMixed,
  onGeometryCommit,
  onGeometryPreview,
  onAngleCommit,
  onAnglePreview,
  hitTest,
  getNodeBox,
  listNodeIds,
  queryNodeIdsInRect,
  onOpenAgent,
  onEditText,
  onEditPenPath,
  suppressChrome = false,
  onTransformingChange,
  attachPickActive = false,
}: SelectionFeatureProps) {
  const overlayRoot = useRcbOverlayRoot();
  const viewportEl = useRcbViewportEl();
  const toScene = useRcbScreenToScene();
  const camera = useRcbCamera();
  // Same CSS zoom the world layer / grid use (not raw camera.zoom drift).
  const zoom = Math.max(0.05, rcbCameraCssZoom(camera));
  const workspaceMode = useSelector(
    (s: any) => (s.editor.workspaceMode || 'design') as 'design' | 'dev'
  );
  const gridSize = getDocumentGridSize(document);
  /** Prefer live context viewport ??prop stageEl can go stale after resize remounts. */
  const hitEl = rcbResolveViewportEl(viewportEl, stageEl, paperEl);
  const dispatch = useDispatch();
  const shapeStylePanel = useSelector(
    (s: any) => s.editor.shapeStylePanel as null | { kind: string }
  );
  /** Radius panel keeps chrome (rounded outline) but hides floating toolbars. */
  const suppressToolbars = suppressChrome || shapeStylePanel?.kind === 'radius';
  /** Share preview / Dev: select↔hover spacing + orange pair chrome. */
  const inspectDev = workspaceMode === 'dev' || readOnly;
  const dragRef = useRef<DragState | null>(null);
  const liveUnionRef = useRef<SceneBox | null>(null);
  const liveOriginsRef = useRef<Array<{ nodeId: string; box: SceneBox }> | null>(null);
  const liveAngleRef = useRef(0);
  /** Held multi control pose until doc shared-angle catches up or members move (undo). */
  const multiChromeRef = useRef<{
    selKey: string;
    box: SceneBox;
    angle: number;
    membersKey: string;
  } | null>(null);
  const idsKeyRef = useRef('');
  const frameIdsKeyRef = useRef('');
  const holdMultiChrome = (
    box: SceneBox,
    angle: number,
    origins: Array<{ nodeId: string; box: SceneBox }>
  ) => {
    if (origins.length < 2 || Math.abs(angle) < 0.01) return;
    multiChromeRef.current = {
      selKey: `${idsKeyRef.current}#${frameIdsKeyRef.current}`,
      box: { ...box },
      angle,
      membersKey: multiMembersKey(origins),
    };
  };
  /** Soft-click double-tap on text (counted on pointerup; native dblclick is the primary path). */
  const lastTextClickRef = useRef<{ id: string; at: number } | null>(null);
  const lastNodeTapRef = useRef<{ id: string; t: number; x: number; y: number } | null>(null);
  const onTransformingChangeRef = useRef(onTransformingChange);
  onTransformingChangeRef.current = onTransformingChange;

  // Keep pointer handlers stable — document identity churn must not tear down
  // window listeners mid-marquee (setMarquee re-render used to drop pointerup → stuck brush).
  const documentRef = useRef(document);
  const getNodeBoxRef = useRef(getNodeBox);
  const listNodeIdsRef = useRef(listNodeIds);
  const queryNodeIdsInRectRef = useRef(queryNodeIdsInRect);
  const hitTestRef = useRef(hitTest);
  const hitTestFrameRef = useRef(hitTestFrame);
  const onSelectRef = useRef(onSelect);
  const onSelectFrameRef = useRef(onSelectFrame);
  const onSelectMixedRef = useRef(onSelectMixed);
  const onSelectFramesRef = useRef(onSelectFrames);
  const toSceneRef = useRef(toScene);
  const onGeometryCommitRef = useRef(onGeometryCommit);
  const onGeometryPreviewRef = useRef(onGeometryPreview);
  const onAngleCommitRef = useRef(onAngleCommit);
  const onAnglePreviewRef = useRef(onAnglePreview);
  const onEditTextRef = useRef(onEditText);
  const onEditPenPathRef = useRef(onEditPenPath);
  const zoomRef = useRef(zoom);
  const gridSizeRef = useRef(gridSize);
  const readOnlyRef = useRef(readOnly);
  const attachPickActiveRef = useRef(attachPickActive);
  documentRef.current = document;
  getNodeBoxRef.current = getNodeBox;
  listNodeIdsRef.current = listNodeIds;
  queryNodeIdsInRectRef.current = queryNodeIdsInRect;
  hitTestRef.current = hitTest;
  hitTestFrameRef.current = hitTestFrame;
  onSelectRef.current = onSelect;
  onSelectFrameRef.current = onSelectFrame;
  onSelectMixedRef.current = onSelectMixed;
  onSelectFramesRef.current = onSelectFrames;
  toSceneRef.current = toScene;
  onGeometryCommitRef.current = onGeometryCommit;
  onGeometryPreviewRef.current = onGeometryPreview;
  onAngleCommitRef.current = onAngleCommit;
  onAnglePreviewRef.current = onAnglePreview;
  onEditTextRef.current = onEditText;
  onEditPenPathRef.current = onEditPenPath;
  zoomRef.current = zoom;
  gridSizeRef.current = gridSize;
  readOnlyRef.current = readOnly;
  attachPickActiveRef.current = attachPickActive;

  const [liveUnion, setLiveUnion] = useState<SceneBox | null>(null);
  const [liveOrigins, setLiveOrigins] = useState<Array<{ nodeId: string; box: SceneBox }> | null>(
    null
  );
  const [liveAngle, setLiveAngle] = useState(0);
  const [marquee, setMarquee] = useState<SceneBox | null>(null);
  /** Live object-align guides while move / resize. */
  const [smartGuides, setSmartGuides] = useState<SmartGuideLine[]>([]);
  /** Hide chrome/toolbars while move / resize / rotate is in progress. */
  const [transforming, setTransforming] = useState(false);
  /** Dev inspect: node under pointer (annotations follow mouse). */
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const hoverNodeIdRef = useRef<string | null>(null);
  /** Preview / Dev: previous single selection ??click A then B shows A?B spacing. */
  const [inspectPairNodeId, setInspectPairNodeId] = useState<string | null>(null);
  const prevInspectSelRef = useRef<string | null>(null);

  const setTransformingNotify = (next: boolean) => {
    setTransforming(next);
    if (!next) setSmartGuides([]);
    onTransformingChangeRef.current?.(next);
  };

  liveUnionRef.current = liveUnion;
  liveOriginsRef.current = liveOrigins;
  liveAngleRef.current = liveAngle;

  const idsKey = selectedNodeIds.join('|');
  const frameIdsKey = selectedFrameIds.join('|');
  idsKeyRef.current = idsKey;
  frameIdsKeyRef.current = frameIdsKey;
  /** Bust chrome memo when stroke band attrs change (align / width). */
  const strokeChromeKey = selectedNodeIds
    .map((id) => {
      const a = document?.deltaSetLike?.[id]?.attrs || {};
      return `${a.strokeAlign ?? a['stroke-align']}:${a['border-width'] ?? a.strokeWidth}`;
    })
    .join('|');
  const selectionCount = selectedNodeIds.length + selectedFrameIds.length;
  const single = selectionCount === 1;
  const singleNode = selectedNodeIds.length === 1 && selectedFrameIds.length === 0;

  const baseOrigins = useMemo(() => {
    // Derive ids from keys so a new array reference does not recreate origins
    // every render (that caused Maximum update depth loops).
    const ids = idsKey ? idsKey.split('|').filter(Boolean) : [];
    const fids = frameIdsKey ? frameIdsKey.split('|').filter(Boolean) : [];
    const nodeOrigins = ids
      .map((id) => {
        const box = getNodeBox(id);
        if (!box) {
          const node = document?.deltaSetLike?.[id];
          if (!node) return null;
          const { left, top } = nodeLeftTop(document, node);
          return {
            nodeId: id,
            box: {
              left,
              top,
              width: Math.max(1, Number(node.width) || 1),
              height: Math.max(1, Number(node.height) || 1),
            },
          };
        }
        return { nodeId: id, box };
      })
      .filter(Boolean) as Array<{ nodeId: string; box: SceneBox }>;
    const frames = Array.isArray(document?.frames) ? document.frames : [];
    const frameOrigins = fids
      .map((fid) => {
        const f = frames.find((x: any) => x?.id === fid);
        if (!f) return null;
        return {
          nodeId: frameSelId(fid),
          box: {
            left: Number(f.x) || 0,
            top: Number(f.y) || 0,
            width: Math.max(1, Number(f.width) || 1),
            height: Math.max(1, Number(f.height) || 1),
          },
        };
      })
      .filter(Boolean) as Array<{ nodeId: string; box: SceneBox }>;
    return [...nodeOrigins, ...frameOrigins];
  }, [document, idsKey, frameIdsKey, getNodeBox, strokeChromeKey]);

  const selectionSharedRotation = useMemo(() => {
    if (selectedNodeIds.length <= 1) return 0;
    return getSelectionSharedRotation(document, selectedNodeIds);
  }, [document, selectedNodeIds]);

  const selectionUnion = useMemo(() => {
    if (!baseOrigins.length) return null;
    return resolveControlChrome(
      document,
      baseOrigins,
      null,
      baseOrigins.length > 1 ? selectionSharedRotation : undefined
    ).box;
  }, [baseOrigins, document, selectionSharedRotation]);

  useEffect(() => {
    if (dragRef.current) return;
    setLiveOrigins(baseOrigins);
    const onlyNodeId =
      !frameIdsKey && idsKey && !idsKey.includes('|') ? idsKey : null;
    if (onlyNodeId) {
      multiChromeRef.current = null;
      setLiveUnion(selectionUnion);
      setLiveAngle(readNodeAngle(document, onlyNodeId));
      return;
    }
    if (!selectionUnion || !idsKey) {
      multiChromeRef.current = null;
      setLiveUnion(selectionUnion);
      setLiveAngle(0);
      return;
    }
    const selKey = `${idsKey}#${frameIdsKey}`;
    const membersKey = multiMembersKey(baseOrigins);
    const shared = selectionSharedRotation;
    if (Math.abs(shared) > 0.01) {
      multiChromeRef.current = {
        selKey,
        box: { ...selectionUnion },
        angle: shared,
        membersKey,
      };
      setLiveUnion(selectionUnion);
      setLiveAngle(shared);
      return;
    }
    const prev = multiChromeRef.current;
    if (
      prev?.selKey === selKey &&
      Math.abs(prev.angle) > 0.01 &&
      prev.membersKey === membersKey
    ) {
      setLiveUnion(prev.box);
      setLiveAngle(prev.angle);
      return;
    }
    multiChromeRef.current = {
      selKey,
      box: { ...selectionUnion },
      angle: 0,
      membersKey,
    };
    setLiveUnion(selectionUnion);
    setLiveAngle(0);
  }, [
    baseOrigins,
    document,
    idsKey,
    frameIdsKey,
    selectionUnion,
    selectionSharedRotation,
  ]);

  // Inspect: keep prior selection as pair target when clicking another element.
  useEffect(() => {
    const next = resolveInspectPrimaryId(selectedNodeIds, selectedFrameIds);
    const prev = prevInspectSelRef.current;
    if (next && prev && prev !== next) {
      setInspectPairNodeId(prev);
    } else if (!next) {
      setInspectPairNodeId(null);
    }
    prevInspectSelRef.current = next;
  }, [selectedNodeIds, selectedFrameIds]);

  useEffect(() => {
    if (!enabled || !hitEl) return undefined;

    const applyHover = (id: string | null) => {
      if (hoverNodeIdRef.current === id) return;
      hoverNodeIdRef.current = id;
      setHoverNodeId(id);
      // Dev / share inspect panel reads hover from Redux.
      if (workspaceMode === 'dev' || readOnly) {
        dispatch(setDevHoverNodeId(id));
      }
    };

    let hoverRaf = 0;
    let pending: PointerEvent | null = null;

    const runHoverHit = (e: PointerEvent) => {
      if (dragRef.current) {
        applyHover(null);
        return;
      }
      const target = e.target as HTMLElement | null;
      const variantsHost = target?.closest?.(
        '[data-image-variants-bar]'
      ) as HTMLElement | null;
      if (variantsHost) {
        const pinned = variantsHost.getAttribute('data-image-node-id');
        if (pinned) {
          applyHover(pinned);
          return;
        }
      }
      if (
        target?.closest?.(
          '[data-ctx-menu],[data-sel-toolbar],[data-export-panel],[data-frame-toolbar],[data-image-tool-panel],[data-image-variants],[data-image-quick-edit],[data-lottie-edit-composer],[data-video-quick-edit],[data-audio-quick-edit],[data-shape-style-panel],[data-gradient-handles],[data-mesh-handles],[data-dev-props],[data-video-playback-bar],[data-video-trim-toolbar],[data-audio-playback-bar],[data-audio-trim-toolbar],[data-audio-speed-toolbar],[data-radius-handle],[data-star-handle],[data-poly-handle],[data-circle-handle]'
        )
      ) {
        applyHover(null);
        return;
      }
      // Only hit-test when the pointer is over the stage / paper / selection chrome.
      if (
        target &&
        !hitEl.contains(target) &&
        !paperEl?.contains(target) &&
        !overlayRoot?.contains(target) &&
        !target.closest?.('[data-sel-box],[data-sel-handle]')
      ) {
        applyHover(null);
        return;
      }
      const p = toScene(e.clientX, e.clientY);
      const nodeHit = hitTestRef.current(p.x, p.y, {
        clientX: e.clientX,
        clientY: e.clientY,
      });
      if (nodeHit) {
        applyHover(nodeHit);
        return;
      }
      // Empty artboard / frame chrome: still measure select↔hover spacing.
      const frameHit = hitTestFrameRef.current?.(p.x, p.y) ?? null;
      applyHover(frameHit ? frameSelId(frameHit) : null);
    };

    const onHoverMove = (e: PointerEvent) => {
      pending = e;
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        const next = pending;
        pending = null;
        if (next) runHoverHit(next);
      });
    };

    const onLeave = () => {
      pending = null;
      if (hoverRaf) {
        cancelAnimationFrame(hoverRaf);
        hoverRaf = 0;
      }
      applyHover(null);
    };

    window.addEventListener('pointermove', onHoverMove, { passive: true });
    window.addEventListener('blur', onLeave);
    return () => {
      pending = null;
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      window.removeEventListener('pointermove', onHoverMove);
      window.removeEventListener('blur', onLeave);
    };
  }, [enabled, hitEl, paperEl, overlayRoot, artboard, hitTest, dispatch, toScene, workspaceMode, readOnly]);

  useEffect(() => {
    if (!enabled || !hitEl) return undefined;

    const getPointerCtx = () => ({
      // Scene model — never shadow DOM Document (elementsFromPoint / querySelector).
      sceneDoc: documentRef.current,
      toScene: toSceneRef.current,
      zoom: zoomRef.current,
      gridSize: gridSizeRef.current,
      readOnly: readOnlyRef.current,
      attachPickActive: attachPickActiveRef.current,
      hitTest: hitTestRef.current,
      hitTestFrame: hitTestFrameRef.current,
      getNodeBox: getNodeBoxRef.current,
      listNodeIds: listNodeIdsRef.current,
      queryNodeIdsInRect: queryNodeIdsInRectRef.current,
      onSelect: onSelectRef.current,
      onSelectFrame: onSelectFrameRef.current,
      onSelectMixed: onSelectMixedRef.current,
      onSelectFrames: onSelectFramesRef.current,
      onGeometryCommit: onGeometryCommitRef.current,
      onGeometryPreview: onGeometryPreviewRef.current,
      onAngleCommit: onAngleCommitRef.current,
      onAnglePreview: onAnglePreviewRef.current,
      onEditText: onEditTextRef.current,
      onEditPenPath: onEditPenPathRef.current,
    });

    const TEXT_DBLCLICK_MS = 450;

    /**
     * Second completed soft-click (pointerup, no drag) on the same text opens edit.
     * Must not run on pointerdown ??otherwise one click (down+up) looks like a double-tap.
     */
    const tryOpenTextEdit = (id: string) => {
      const { sceneDoc, onEditText, onSelect, readOnly } = getPointerCtx();
      if (readOnly) return false;
      const node = sceneDoc?.deltaSetLike?.[id];
      if (node?.key !== 'text' || !onEditText) {
        lastTextClickRef.current = null;
        return false;
      }
      const now = performance.now();
      const prev = lastTextClickRef.current;
      if (prev && prev.id === id && now - prev.at < TEXT_DBLCLICK_MS) {
        lastTextClickRef.current = null;
        onSelect([id]);
        onEditText(id);
        return true;
      }
      lastTextClickRef.current = { id, at: now };
      return false;
    };

    const capture = (pointerId: number) => {
      hitEl.setPointerCapture?.(pointerId);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // New gesture — drop any brush left stuck after a lost pointerup.
      setMarquee(null);
      const {
        sceneDoc,
        toScene,
        readOnly,
        attachPickActive,
        hitTest,
        hitTestFrame,
        getNodeBox,
        onSelect,
        onSelectFrame,
      } = getPointerCtx();
      const target = e.target as HTMLElement;
      // Prefer sceneDoc for scene; DOM APIs use globalThis.document.
      const underPointer =
        typeof globalThis.document?.elementsFromPoint === 'function'
          ? globalThis.document.elementsFromPoint(e.clientX, e.clientY)
          : [];
      const resizeUnderPointer = () =>
        underPointer.some(
          (n) => n instanceof Element && n.getAttribute('data-sel-handle') === 'resize'
        );
      // Overlays handle their own pointers — unless a resize hit also sits under
      // the cursor (corner / control-box must prefer scale).
      const onOverlayKnob = target.closest(
        '[data-radius-handle],[data-star-handle],[data-poly-handle],[data-circle-handle],[data-sel-toolbar],[data-frame-toolbar]'
      );
      if (onOverlayKnob && !resizeUnderPointer()) return;
      if (
        target.closest(
          '[data-ctx-menu],[data-export-panel],[data-image-label],[data-frame-label],[data-crop-expand-overlay],[data-crop-expand-toolbar],[data-image-tool-panel],[data-image-variants],[data-image-quick-edit],[data-lottie-edit-composer],[data-video-quick-edit],[data-audio-quick-edit],[data-shape-style-panel],[data-gradient-handles],[data-mesh-handles],[data-color-panel],[data-text-inline-editor],[data-frame-handle],[data-image-generator],[data-video-generator],[data-video-playback-bar],[data-video-trim-toolbar],[data-audio-playback-bar],[data-audio-trim-toolbar],[data-audio-speed-toolbar]'
        )
      )
        return;

      const seed = (
        mode: DragState['mode'],
        ev: { clientX: number; clientY: number },
        pt: { x: number; y: number },
        extras?: Partial<DragState>
      ) => makeDragSeed(mode, ev, pt, extras, hitEl);

      const p = toScene(e.clientX, e.clientY);
      const liveUnionNow = liveUnionRef.current;
      const liveOriginsNow = liveOriginsRef.current;
      const liveAngleNow = liveAngleRef.current;
      const lockedSelection = isSelectionOriginsLocked(sceneDoc, liveOriginsNow);

      // Prefer resize over rotate when both are under the pointer (same corner).
      const resizeEl = underPointer.find(
        (n) => n instanceof Element && n.getAttribute('data-sel-handle') === 'resize'
      ) as HTMLElement | undefined;
      const rotateEl =
        resizeEl
          ? null
          : (underPointer.find(
              (n) => n instanceof Element && n.getAttribute('data-sel-handle') === 'rotate'
            ) as HTMLElement | undefined) ||
            (target.closest('[data-sel-handle="rotate"]') as HTMLElement | null);

      if (rotateEl && liveUnionNow && liveOriginsNow?.length) {
        if (readOnly || lockedSelection) return;
        e.preventDefault();
        e.stopPropagation();
        const { box: union, angle: angle0 } = resolveControlChrome(
          sceneDoc,
          liveOriginsNow,
          liveUnionNow,
          liveAngleNow
        );
        const center = {
          x: union.left + union.width / 2,
          y: union.top + union.height / 2,
        };
        const pointerAngle0 = (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI;
        dragRef.current = seed('rotate', e, p, {
          origins: liveOriginsNow.map((o) => ({
            nodeId: o.nodeId,
            box: { ...o.box },
            angle0: readNodeAngle(sceneDoc, o.nodeId),
          })),
          union: { ...union },
          angle0,
          center,
          pointerAngle0,
        });
        setLiveUnion(union);
        setLiveAngle(angle0);
        setTransformingNotify(true);
        capture(e.pointerId);
        return;
      }

      const resizeHandleEl =
        resizeEl ||
        (target.closest('[data-sel-handle="resize"]') as HTMLElement | null);
      if (resizeHandleEl && liveUnionNow && liveOriginsNow?.length) {
        if (readOnly || lockedSelection) return;
        e.preventDefault();
        e.stopPropagation();
        const handle = (resizeHandleEl.getAttribute('data-resize') || 'se') as ResizeHandle;
        const singleId = liveOriginsNow.length === 1 ? liveOriginsNow[0].nodeId : '';
        const singleNode = singleId ? sceneDoc?.deltaSetLike?.[singleId] : null;
        const shapeType = singleNode ? String(singleNode.attrs?.shapeType || '') : '';
        const { box: union, angle: shared } = resolveControlChrome(
          sceneDoc,
          liveOriginsNow,
          liveUnionNow,
          liveAngleNow
        );
        let pathEpLocal0: [number, number] | undefined;
        let pathEpLocal1: [number, number] | undefined;
        // Open stroke tips: record path-local ends so resize tracks the grabbed tip.
        if (
          singleId &&
          (handle === 'e' || handle === 'w') &&
          nodeUsesOpenStrokeEndpoints(singleNode) &&
          shapeType !== 'line' &&
          shapeType !== 'arrow'
        ) {
          const box = liveOriginsNow[0].box;
          const d = String(singleNode?.attrs?.path || singleNode?.attrs?.d || '');
          const [a, b] = pathLocalEndpoints(d, box.width, box.height, 'path');
          pathEpLocal0 = a;
          pathEpLocal1 = b;
        }
        dragRef.current = seed('resize', e, p, {
          origins: liveOriginsNow.map((o) => ({ nodeId: o.nodeId, box: { ...o.box } })),
          union: { ...union },
          handle,
          angle0: shared,
          aspectRatio: union.width / Math.max(1, union.height),
          pathEpLocal0,
          pathEpLocal1,
        });
        setLiveUnion(union);
        setLiveAngle(shared);
        setTransformingNotify(true);
        capture(e.pointerId);
        return;
      }

      const beginMoveSelection = () => {
        if (readOnly || !liveUnionNow || !liveOriginsNow?.length) return false;
        if (lockedSelection) return false;
        e.preventDefault();
        e.stopPropagation();
        const origins = liveOriginsNow.map((o) => ({ nodeId: o.nodeId, box: { ...o.box } }));
        dragRef.current = seed('move', e, p, {
          origins,
          union: { ...liveUnionNow },
        });
        setLiveOrigins(origins);
        setLiveUnion(liveUnionNow);
        setTransformingNotify(true);
        capture(e.pointerId);
        return true;
      };

      const pointInLiveUnion =
        liveUnionNow && pointInOrientedBox(p, liveUnionNow, liveAngleNow || 0);
      const selectionHasFrame = Boolean(
        liveOriginsNow?.some((o) => parseFrameSelId(o.nodeId))
      );

      // Drag control box (or anywhere on a frame-only / mixed selection chrome).
      const selBoxEl = target.closest('[data-sel-box]') as HTMLElement | null;
      if (selBoxEl && selectionHasFrame && !attachPickActive && beginMoveSelection()) return;

      // Hit-test scene nodes (selection chrome is non-blocking so empty clicks pass through).
      const hitId = hitTest(p.x, p.y, { clientX: e.clientX, clientY: e.clientY });
      const selectedIds = liveOriginsNow?.map((o) => o.nodeId) ?? [];
      const plateFrameId = hitId ? frameForFullBleedPlate(sceneDoc, hitId) : null;

      // Composer pick: attach node or artboard; never move / never treat frame as blank cancel.
      if (attachPickActive) {
        e.preventDefault();
        e.stopPropagation();
        const frameUnder =
          plateFrameId ||
          (!hitId ? hitTestFrame?.(p.x, p.y) : null) ||
          (selectionHasFrame && pointInLiveUnion
            ? liveOriginsNow
                ?.map((o) => parseFrameSelId(o.nodeId))
                .find((fid): fid is string => Boolean(fid))
            : null);
        if (hitId && !plateFrameId) {
          // Do NOT call onSelectFrame(null) here ??during pick that clears pick mode.
          onSelect(expandSelectionWithGroups(sceneDoc, [hitId]));
        } else if (frameUnder) {
          onSelectFrame?.(frameUnder);
        } else {
          // Truly empty canvas ??exit pick mode.
          onSelect([]);
        }
        dragRef.current = seed('blank', e, p, { skipSelectOnUp: true });
        capture(e.pointerId);
        return;
      }

      // Clicking a selected artboard (or its plate) moves the whole selection ??like a rect.
      if (
        !readOnly &&
        selectionHasFrame &&
        pointInLiveUnion &&
        (!hitId ||
          plateFrameId ||
          (hitId && selectedIds.includes(hitId)))
      ) {
        // Unselected content under the brush still gets normal select/move below.
        const plateSelected =
          plateFrameId &&
          liveOriginsNow!.some((o) => parseFrameSelId(o.nodeId) === plateFrameId);
        const emptyOrSelectedPlate = !hitId || Boolean(plateFrameId && plateSelected);
        const selectedNodeHit = Boolean(hitId && selectedIds.includes(hitId));
        if ((emptyOrSelectedPlate || selectedNodeHit) && beginMoveSelection()) return;
      }

      // Full-bleed background plate looks empty — start marquee, don't drag the plate.
      if (hitId && plateFrameId) {
        e.preventDefault();
        if (!e.shiftKey && !readOnly) {
          onSelectFrame?.(null);
          onSelect([]);
        }
        dragRef.current = seed('pointing_canvas', e, p);
        capture(e.pointerId);
        return;
      }

      // Shape under pointer ??select (if needed) then move. Never start a marquee on a shape.
      if (hitId) {
        e.preventDefault();
        e.stopPropagation();
        const additive = e.shiftKey;
        const expandedHit = expandSelectionWithGroups(sceneDoc, [hitId]);

        if (readOnly) {
          // Preview / Dev inspect: select only (no move).
          onSelectFrame?.(null);
          onSelect(expandedHit, { additive });
          dragRef.current = seed('blank', e, p);
          capture(e.pointerId);
          return;
        }

        // Expand on down so pointerdown?move uses full group origins before Redux catches up.
        if (!selectedIds.includes(hitId)) {
          // Do not open text edit on pointerdown ??a single click's up would
          // otherwise count as a second tap and enter edit immediately.
          lastTextClickRef.current = null;
          onSelectFrame?.(null);
          onSelect(expandedHit, { additive });
        }
        // Shift-add only: wait for pointer-up; don't start a translate.
        if (additive && !selectedIds.includes(hitId)) {
          dragRef.current = seed('blank', e, p);
          capture(e.pointerId);
          return;
        }

        const { origins, union } = buildMoveOriginsForHit({
          document: sceneDoc,
          hitId,
          selectedIds,
          expandedHit,
          liveOriginsNow,
          liveUnionNow,
          liveAngleNow,
          getNodeBox,
          fallbackPoint: p,
        });
        if (!origins.length) return;

        // Second click of a double-click: do not start a translate.
        if (isRecentNodeDoubleTap(lastNodeTapRef.current, hitId, e)) {
          lastNodeTapRef.current = null;
          dragRef.current = seed('blank', e, p);
          capture(e.pointerId);
          return;
        }
        lastNodeTapRef.current = { id: hitId, t: Date.now(), x: e.clientX, y: e.clientY };

        // Keep chrome rotation in sync ??transforming flips chromeAngle onto liveAngle.
        if (origins.length === 1 && !parseFrameSelId(origins[0].nodeId)) {
          setLiveAngle(readNodeAngle(sceneDoc, origins[0].nodeId));
        } else if (origins.length > 1) {
          const shared =
            liveAngleNow ||
            getSelectionSharedRotation(
              sceneDoc,
              origins.map((o) => o.nodeId)
            );
          setLiveAngle(shared);
        }
        // Locked layers stay selectable but cannot start a drag.
        if (isSelectionOriginsLocked(sceneDoc, origins)) {
          dragRef.current = seed('blank', e, p);
          capture(e.pointerId);
          return;
        }
        dragRef.current = seed('move', e, p, { origins, union });
        setLiveOrigins(origins);
        setLiveUnion(union);
        setTransformingNotify(true);
        capture(e.pointerId);
        return;
      }

      // Empty canvas / artboard interior — PointingCanvas → marquee after brush gate.
      // Soft-click on artboard selects the frame (on pointerup). Frame move is via title label
      // or by dragging inside an existing selection union (handled above).
      e.preventDefault();
      // Sparse path / star ink often misses hit-test inside a large control box.
      // Clicking empty space still inside the selection union should move, not clear.
      if (
        !readOnly &&
        pointInLiveUnion &&
        (liveOriginsNow?.length ?? 0) > 0 &&
        beginMoveSelection()
      ) {
        return;
      }
      if (!e.shiftKey) {
        onSelectFrame?.(null);
        onSelect([]);
      }
      dragRef.current = seed('pointing_canvas', e, p);
      capture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const {
        sceneDoc,
        toScene,
        zoom,
        gridSize,
        readOnly,
        getNodeBox,
        listNodeIds,
        onGeometryPreview,
        onAnglePreview,
      } = getPointerCtx();
      drag.currentClientX = e.clientX;
      drag.currentClientY = e.clientY;
      drag.currentShift = e.shiftKey;
      const screenDistSq = screenDragDistSq(drag, e.clientX, e.clientY);
      if (drag.mode === 'blank') {
        // Abandon soft click once past drag threshold.
        if (screenDistSq > DRAG_DISTANCE_SQUARED) {
          dragRef.current = null;
        }
        return;
      }
      // PointingCanvas → Brushing after dual screen-px gate.
      if (drag.mode === 'pointing_canvas') {
        if (readOnly) return;
        const { passed, box } = evaluateBrushGate(
          drag,
          zoom,
          e.clientX,
          e.clientY,
          e.pointerType || 'mouse'
        );
        if (!passed) return;
        drag.mode = 'marquee';
        setMarquee(box);
        return;
      }
      // Client-delta keeps the selection under the pointer when the stage rect
      // shifts (mobile chrome / small-viewport reflow). Rotate still needs an
      // absolute scene point for atan2 around the pivot.
      const gesture = sceneFromClientGesture(drag, zoom, e.clientX, e.clientY);
      const dx = gesture.dx;
      const dy = gesture.dy;
      const abs = toScene(e.clientX, e.clientY);
      const p =
        drag.mode === 'rotate' ? abs : { x: gesture.x, y: gesture.y };

      if (drag.mode === 'marquee') {
        setMarquee(normalizeBox(drag.sceneX0, drag.sceneY0, p.x, p.y));
        return;
      }

      if (drag.mode === 'rotate' && drag.center && drag.pointerAngle0 != null) {
        // Soft-click on rotate knob ??ignore OS pointer jitter.
        if (screenDistSq <= DRAG_DISTANCE_SQUARED) return;
        setSmartGuides([]);
        const { next, delta } = computeRotateDelta(drag, p, e.shiftKey);
        setLiveAngle(next);
        if (drag.origins.length === 1) {
          onAnglePreview?.(drag.origins[0].nodeId, next);
          return;
        }
        const moved = rotateBoxesAround(
          drag.origins.map((o) => o.box),
          drag.center,
          delta
        );
        const nextOrigins = drag.origins.map((o, i) => ({
          nodeId: o.nodeId,
          box: moved[i],
          angle0: o.angle0,
        }));
        // Keep oriented control box (do not expand to AABB of orbited members).
        setLiveOrigins(nextOrigins.map((o) => ({ nodeId: o.nodeId, box: o.box })));
        setLiveUnion(drag.union);
        onGeometryPreview?.(
          nextOrigins.map((o) => ({
            nodeId: o.nodeId,
            left: o.box.left,
            top: o.box.top,
            width: o.box.width,
            height: o.box.height,
          }))
        );
        nextOrigins.forEach((o) => {
          onAnglePreview?.(o.nodeId, Number(o.angle0 || 0) + delta);
        });
        return;
      }

      if (drag.mode === 'move') {
        // Ignore pointer jitter until the pointer actually moves (protects dblclick).
        if (screenDistSq <= DRAG_DISTANCE_SQUARED) return;
        const exclude = new Set(drag.origins.map((o) => o.nodeId));
        const threshold = smartSnapThreshold(zoom);
        const { nextUnion, sdx, sdy, guides } = computeMovedUnion({
          union: drag.union,
          origins: drag.origins,
          document: sceneDoc,
          dx,
          dy,
          disableSnap: e.ctrlKey || e.metaKey,
          gridSize,
          targets: smartGuideTargetsForDrag({
            document: sceneDoc,
            listNodeIds,
            getNodeBox,
            excludeIds: exclude,
            nearBox: {
              ...drag.union,
              left: drag.union.left + dx,
              top: drag.union.top + dy,
            },
            threshold,
            queryNodeIdsInRect,
          }),
          threshold,
        });
        const nextOrigins = drag.origins.map((o) => ({
          nodeId: o.nodeId,
          box: { ...o.box, left: o.box.left + sdx, top: o.box.top + sdy },
        }));
        setLiveUnion(nextUnion);
        setLiveOrigins(nextOrigins);
        setSmartGuides(guides);
        onGeometryPreview?.(
          nextOrigins.map((o) => ({
            nodeId: o.nodeId,
            left: o.box.left,
            top: o.box.top,
            width: o.box.width,
            height: o.box.height,
          }))
        );
        return;
      }

      if (drag.mode === 'resize' && drag.handle) {
        // Soft-click on a handle must not resize: at 3% zoom, 2px jitter ??60+
        // scene units and snap threshold is huge (8/zoom), so the box jumps.
        if (screenDistSq <= DRAG_DISTANCE_SQUARED) return;
        const stroke = strokeEndpointBox(drag, sceneDoc, p.x, p.y);
        if (stroke) {
          setLiveUnion(stroke.next);
          setLiveOrigins([{ nodeId: stroke.strokeId, box: stroke.next }]);
          setLiveAngle(stroke.angle);
          setSmartGuides([]);
          onGeometryPreview?.([
            {
              nodeId: stroke.strokeId,
              left: stroke.next.left,
              top: stroke.next.top,
              width: stroke.next.width,
              height: stroke.next.height,
            },
          ]);
          onAnglePreview?.(stroke.strokeId, stroke.angle);
          return;
        }
        const exclude = new Set(drag.origins.map((o) => o.nodeId));
        const threshold = smartSnapThreshold(zoom);
        const { next, textMode, guides } = computeResizedUnion({
          document: sceneDoc,
          drag,
          dx,
          dy,
          shiftKey: e.shiftKey,
          disableSnap: e.ctrlKey || e.metaKey,
          gridSize,
          targets: smartGuideTargetsForDrag({
            document: sceneDoc,
            listNodeIds,
            getNodeBox,
            excludeIds: exclude,
            nearBox: drag.union,
            threshold,
            queryNodeIdsInRect,
          }),
          threshold,
        });
        setSmartGuides(guides);
        if (drag.origins.length === 1) {
          setLiveUnion(next);
          setLiveOrigins([{ nodeId: drag.origins[0].nodeId, box: next }]);
          onGeometryPreview?.(
            [
              {
                nodeId: drag.origins[0].nodeId,
                left: next.left,
                top: next.top,
                width: next.width,
                height: next.height,
              },
            ],
            textMode ? { textResizeMode: textMode } : undefined
          );
          return;
        }
        const scaled = scaleBoxesToOrientedUnion(
          drag.origins.map((o) => o.box),
          drag.union,
          next,
          drag.angle0 || 0
        );
        const nextOrigins = drag.origins.map((o, i) => ({
          nodeId: o.nodeId,
          box: scaled[i],
        }));
        setLiveUnion(next);
        setLiveOrigins(nextOrigins);
        onGeometryPreview?.(
          nextOrigins.map((o) => ({
            nodeId: o.nodeId,
            left: o.box.left,
            top: o.box.top,
            width: o.box.width,
            height: o.box.height,
          }))
        );
      }
    };

    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      // Always clear the brush — even if the gesture ref was lost mid-flight
      // (effect remount used to drop pointerup and leave the box stuck).
      setMarquee(null);
      if (!drag) return;
      dragRef.current = null;
      const {
        sceneDoc,
        toScene,
        zoom,
        gridSize,
        readOnly,
        attachPickActive,
        hitTest,
        hitTestFrame,
        getNodeBox,
        listNodeIds,
        queryNodeIdsInRect,
        onSelect,
        onSelectFrame,
        onSelectMixed,
        onSelectFrames,
        onGeometryCommit,
        onAngleCommit,
      } = getPointerCtx();
      try {
        hitEl.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }

      // End events are lifecycle-only; geometry uses last down/move client point.
      const clientX = drag.currentClientX;
      const clientY = drag.currentClientY;
      const shiftKey = drag.currentShift ?? e.shiftKey;
      const gesture = sceneFromClientGesture(drag, zoom, clientX, clientY);
      const dx = gesture.dx;
      const dy = gesture.dy;
      const absEnd = toScene(clientX, clientY);
      // Move / resize / marquee: client-delta (stable if stage rect jitters).
      // Rotate: absolute scene point for atan2 around the pivot.
      let p = absEnd;
      if (drag.mode === 'move' || drag.mode === 'resize' || drag.mode === 'marquee') {
        p = { x: gesture.x, y: gesture.y };
      }
      const screenDistSq = screenDragDistSq(drag, clientX, clientY);

      const endTransform = () => setTransformingNotify(false);

      // Soft click on empty stage (never entered Brushing).
      if (drag.mode === 'pointing_canvas') {
        setMarquee(null);
        lastTextClickRef.current = null;
        const abs = toScene(clientX, clientY);
        const frameId = hitTestFrame?.(abs.x, abs.y) ?? null;
        if (frameId) {
          softSelectFrameAt(toScene, hitTestFrame, onSelectFrame, clientX, clientY);
        } else {
          // Truly empty — ensure selection stays cleared (down already cleared; re-assert).
          onSelectFrame?.(null);
          onSelect([]);
        }
        endTransform();
        return;
      }

      if (drag.mode === 'marquee') {
        setMarquee(null);
        lastTextClickRef.current = null;
        const { passed, box } = evaluateBrushGate(
          drag,
          zoom,
          clientX,
          clientY,
          e.pointerType || 'mouse'
        );
        // Still under brush gate — treat as soft click (select artboard if any).
        if (!passed) {
          const abs = toScene(clientX, clientY);
          const frameId = hitTestFrame?.(abs.x, abs.y) ?? null;
          if (frameId) {
            softSelectFrameAt(toScene, hitTestFrame, onSelectFrame, clientX, clientY);
          } else {
            onSelectFrame?.(null);
            onSelect([]);
          }
          endTransform();
          return;
        }
        // Pad spatial prefilter the same as fine hit — tiny nodes near the brush edge.
        const queryPad = marqueeHitPadScene(zoom) + MARQUEE_MIN_HIT_SCREEN_PX / Math.max(0.05, zoom);
        const queryBox = expandSceneBox(box, queryPad);
        const candidates = queryNodeIdsInRect?.(queryBox) ?? listNodeIds();
        const rawHits = candidates.filter((id) =>
          nodeHitsMarquee(sceneDoc, id, box, getNodeBox, toScene, zoom)
        );
        const frameHits = framesHittingMarquee(sceneDoc, box).map((f) => f.id);
        // Full-bleed plate: keep when artboard brushed, or other non-plate content hit.
        const contentHits = filterMarqueeContentHits(sceneDoc, rawHits, new Set(frameHits));
        commitMarqueeSelection({
          contentHits,
          frameHits,
          rawHits,
          shiftKey,
          onSelectMixed,
          onSelectFrames,
          onSelectFrame,
          onSelect,
        });
        endTransform();
        return;
      }

      if (drag.mode === 'blank') {
        // Attach-pick already applied on pointerdown ??do not onSelect on up
        // (one-shot clearPick flips attachPickActive off before up; selecting
        // here would steal focus from the host node / double-add chips).
        if (
          !drag.skipSelectOnUp &&
          !attachPickActive &&
          screenDistSq <= DRAG_DISTANCE_SQUARED
        ) {
          const id = hitTest(p.x, p.y, { clientX, clientY });
          if (id && tryOpenTextEdit(id)) {
            endTransform();
            return;
          }
          if (id) onSelect([id], { additive: shiftKey });
        }
        endTransform();
        return;
      }

      if (drag.mode === 'rotate' && drag.center && drag.pointerAngle0 != null) {
        // Soft-click: restore start pose ??do not apply angle jitter.
        if (screenDistSq <= DRAG_DISTANCE_SQUARED) {
          setLiveAngle(drag.angle0 || 0);
          setLiveUnion({ ...drag.union });
          setLiveOrigins(drag.origins.map((o) => ({ nodeId: o.nodeId, box: { ...o.box } })));
          endTransform();
          return;
        }
        const { next, delta } = computeRotateDelta(drag, p, shiftKey);
        setLiveAngle(next);
        if (drag.origins.length === 1) {
          onAngleCommit?.(drag.origins[0].nodeId, next);
          endTransform();
          return;
        }
        const moved = rotateBoxesAround(
          drag.origins.map((o) => o.box),
          drag.center,
          delta
        );
        const patches = drag.origins.map((o, i) => ({
          nodeId: o.nodeId,
          left: moved[i].left,
          top: moved[i].top,
          width: moved[i].width,
          height: moved[i].height,
        }));
        const origins = patchesAsOrigins(patches);
        setLiveUnion(drag.union);
        setLiveAngle(next);
        setLiveOrigins(origins);
        holdMultiChrome(drag.union, next, origins);
        if (Math.abs(delta) > 0.01) {
          // Angles first so geometry commit's document snapshot already carries them.
          drag.origins.forEach((o) => {
            onAngleCommit?.(o.nodeId, Number(o.angle0 || 0) + delta, { skipHistory: true });
          });
          onGeometryCommit(patches);
        }
        endTransform();
        return;
      }

      if (drag.mode === 'move') {
        // Soft-click: never leave liveUnion on a snap-only nudge while the
        // document stays put ??that desyncs chrome from the shape (worst at
        // 3%/800% where 8px snap ??huge / visible scene delta).
        if (screenDistSq <= DRAG_DISTANCE_SQUARED) {
          setLiveUnion({ ...drag.union });
          setLiveOrigins(drag.origins.map((o) => ({ nodeId: o.nodeId, box: { ...o.box } })));
          if (drag.origins.length === 1 && tryOpenTextEdit(drag.origins[0].nodeId)) {
            endTransform();
            return;
          }
          endTransform();
          return;
        }
        const exclude = new Set(drag.origins.map((o) => o.nodeId));
        const threshold = smartSnapThreshold(zoom);
        const { nextUnion, sdx, sdy } = computeMovedUnion({
          union: drag.union,
          origins: drag.origins,
          document: sceneDoc,
          dx,
          dy,
          disableSnap: e.ctrlKey || e.metaKey,
          gridSize,
          targets: smartGuideTargetsForDrag({
            document: sceneDoc,
            listNodeIds,
            getNodeBox,
            excludeIds: exclude,
            nearBox: {
              ...drag.union,
              left: drag.union.left + dx,
              top: drag.union.top + dy,
            },
            threshold,
            queryNodeIdsInRect,
          }),
          threshold,
        });
        const patches = drag.origins.map((o) => ({
          nodeId: o.nodeId,
          left: o.box.left + sdx,
          top: o.box.top + sdy,
          width: o.box.width,
          height: o.box.height,
        }));
        const origins = patchesAsOrigins(patches);
        setLiveUnion(nextUnion);
        setLiveOrigins(origins);
        holdMultiChrome(nextUnion, liveAngleRef.current, origins);
        if (Math.hypot(sdx, sdy) > 0.01) {
          lastTextClickRef.current = null;
          onGeometryCommit(patches);
        }
        endTransform();
        return;
      }

      if (drag.mode === 'resize' && drag.handle) {
        if (screenDistSq <= DRAG_DISTANCE_SQUARED) {
          setLiveUnion({ ...drag.union });
          setLiveOrigins(drag.origins.map((o) => ({ nodeId: o.nodeId, box: { ...o.box } })));
          endTransform();
          return;
        }
        const stroke = strokeEndpointBox(drag, sceneDoc, p.x, p.y);
        if (stroke) {
          setLiveUnion(stroke.next);
          setLiveOrigins([{ nodeId: stroke.strokeId, box: stroke.next }]);
          setLiveAngle(stroke.angle);
          lastTextClickRef.current = null;
          // Bake angle into documentRef first so geometry rebuild reads attrs.angle;
          // one history entry via onGeometryCommit (do not patch angle into Redux first).
          onAnglePreview?.(stroke.strokeId, stroke.angle);
          onGeometryCommit([
            {
              nodeId: stroke.strokeId,
              left: stroke.next.left,
              top: stroke.next.top,
              width: stroke.next.width,
              height: stroke.next.height,
            },
          ]);
          endTransform();
          return;
        }
        const excludeUp = new Set(drag.origins.map((o) => o.nodeId));
        const thresholdUp = smartSnapThreshold(zoom);
        const { next, textMode } = computeResizedUnion({
          document: sceneDoc,
          drag,
          dx,
          dy,
          shiftKey,
          disableSnap: e.ctrlKey || e.metaKey,
          gridSize,
          targets: smartGuideTargetsForDrag({
            document: sceneDoc,
            listNodeIds,
            getNodeBox,
            excludeIds: excludeUp,
            nearBox: drag.union,
            threshold: thresholdUp,
            queryNodeIdsInRect,
          }),
          threshold: thresholdUp,
        });
        if (drag.origins.length === 1) {
          setLiveUnion(next);
          setLiveOrigins([{ nodeId: drag.origins[0].nodeId, box: next }]);
          onGeometryCommit(
            [
              {
                nodeId: drag.origins[0].nodeId,
                left: next.left,
                top: next.top,
                width: next.width,
                height: next.height,
              },
            ],
            textMode ? { textResizeMode: textMode } : undefined
          );
          endTransform();
          return;
        }
        const scaled = scaleBoxesToOrientedUnion(
          drag.origins.map((o) => o.box),
          drag.union,
          next,
          drag.angle0 || 0
        );
        const patches = drag.origins.map((o, i) => ({
          nodeId: o.nodeId,
          left: scaled[i].left,
          top: scaled[i].top,
          width: scaled[i].width,
          height: scaled[i].height,
        }));
        const groupAngle = drag.angle0 || 0;
        const origins = patchesAsOrigins(patches);
        setLiveUnion(next);
        setLiveAngle(groupAngle);
        setLiveOrigins(origins);
        holdMultiChrome(next, groupAngle, origins);
        onGeometryCommit(patches);
      }
      endTransform();
    };

    const onDblClick = (e: MouseEvent) => {
      const {
        sceneDoc,
        toScene,
        readOnly,
        hitTest,
        onSelect,
        onEditText,
        onEditPenPath,
      } = getPointerCtx();
      if (readOnly) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-sel-toolbar],[data-frame-toolbar],[data-text-inline-editor]')) {
        return;
      }
      const p = toScene(e.clientX, e.clientY);
      let hit = hitTest(p.x, p.y, { clientX: e.clientX, clientY: e.clientY });
      // Selection chrome covers the glyph — fall back to the single selected node.
      if (!hit && target?.closest?.('[data-sel-box]')) {
        const ids = liveOriginsRef.current?.map((o) => o.nodeId) || [];
        if (ids.length === 1) hit = ids[0];
      }
      if (!hit) return;
      const node = sceneDoc?.deltaSetLike?.[hit];
      if (node?.key === 'text') {
        e.preventDefault();
        e.stopPropagation();
        lastTextClickRef.current = null;
        onSelect([hit]);
        onEditText?.(hit);
        return;
      }
      if (isEditablePathNode(node)) {
        e.preventDefault();
        e.stopPropagation();
        lastNodeTapRef.current = null;
        onSelect([hit]);
        onEditPenPath?.(hit);
      }
    };

    // Chrome lives in the unscaled overlay — also listen there for resize/rotate / dblclick.
    // Infinite paper is 0×0; stage receives empty artboard / shape clicks.
    // Deps stay element/enabled-only: document/zoom/callbacks live in refs so a
    // setMarquee / onSelect re-render cannot tear down window pointerup mid-gesture
    // (that left the blue brush stuck on a soft click).
    hitEl.addEventListener('pointerdown', onDown);
    overlayRoot?.addEventListener('pointerdown', onDown);
    hitEl.addEventListener('dblclick', onDblClick);
    overlayRoot?.addEventListener('dblclick', onDblClick);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      hitEl.removeEventListener('pointerdown', onDown);
      overlayRoot?.removeEventListener('pointerdown', onDown);
      hitEl.removeEventListener('dblclick', onDblClick);
      overlayRoot?.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      dragRef.current = null;
      setMarquee(null);
    };
  }, [enabled, hitEl, overlayRoot]);

  /** Arrow keys nudge selection 1px (Shift = 10px). Grid mode: step = gridSize (Shift = 5×). */
  useEffect(() => {
    if (!enabled || suppressChrome || readOnly) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (dragRef.current) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable ||
          t.closest?.(
            '[data-fill-panel],[data-color-panel],[data-stroke-panel],[data-shape-style-panel],[data-sel-toolbar],[data-frame-toolbar],[data-text-inline-editor]'
          ))
      ) {
        return;
      }
      const origins = liveOriginsRef.current;
      const union = liveUnionRef.current;
      if (!origins?.length || !union) return;
      if (isSelectionOriginsLocked(document, origins)) return;

      e.preventDefault();
      const step = e.shiftKey ? Math.max(10, gridSize * 10) : Math.max(1, gridSize);
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      // Same visual-outer 1px grid as drag-move (not path half-pixels).
      const { nextUnion, sdx, sdy } = computeMovedUnion({
        union,
        origins,
        document,
        dx,
        dy,
        disableSnap: false,
        gridSize,
        targets: [],
        threshold: 0,
      });
      const nextOrigins = origins.map((o) => ({
        nodeId: o.nodeId,
        box: { ...o.box, left: o.box.left + sdx, top: o.box.top + sdy },
      }));
      setLiveUnion(nextUnion);
      setLiveOrigins(nextOrigins);
      onGeometryCommit(
        nextOrigins.map((o) => ({
          nodeId: o.nodeId,
          left: o.box.left,
          top: o.box.top,
          width: o.box.width,
          height: o.box.height,
        }))
      );
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [
    enabled,
    readOnly,
    suppressChrome,
    document,
    listNodeIds,
    getNodeBox,
    onGeometryCommit,
    queryNodeIdsInRect,
    gridSize,
  ]);

  const singleId = singleNode ? selectedNodeIds[0] : null;
  const singleNodeData = singleId ? document?.deltaSetLike?.[singleId] : null;
  const selectedIsImageGen = Boolean(singleNodeData && isImageGeneratorNode(singleNodeData));
  const selectedIsVideoGen = Boolean(singleNodeData && isVideoGeneratorNode(singleNodeData));
  const selectedIsLottieGen = Boolean(singleNodeData && isLottieGeneratorNode(singleNodeData));
  const selectedIsAudioGen = Boolean(singleNodeData && isAudioGeneratorNode(singleNodeData));
  const selectedIsVideo = Boolean(singleNodeData && singleNodeData.key === 'video' && !selectedIsVideoGen);
  const selectedIsMediaGen =
    selectedIsImageGen || selectedIsVideoGen || selectedIsLottieGen || selectedIsAudioGen;
  const singleShapeType = singleNodeData
    ? String(singleNodeData?.attrs?.shapeType || '')
    : '';
  const lineChrome =
    singleNode && (singleShapeType === 'line' || singleShapeType === 'arrow');

  const chromeAngle = resolveChromeAngle({
    enabled,
    singleNode,
    multiSelected: !single,
    selectedNodeId: selectedNodeIds[0],
    document,
    transforming,
    dragMode: dragRef.current?.mode,
    hasPathEndpoints: Boolean(dragRef.current?.pathEpLocal0 && dragRef.current?.pathEpLocal1),
    liveAngle,
  });

  /** Single node or single frame — inspect size badge + hover spacing. */
  const inspectPrimaryId = resolveInspectPrimaryId(selectedNodeIds, selectedFrameIds);

  const measurePairId = resolveMeasurePairNodeId({
    inspectDev,
    transforming,
    hoverNodeId,
    inspectPairNodeId,
    inspectPrimaryId,
    selectedNodeIds,
  });

  const measurePrimaryBox = useMemo(
    () => resolveMeasureBox(inspectPrimaryId, document, getNodeBox),
    [inspectPrimaryId, document, getNodeBox]
  );
  const measurePairBox = useMemo(
    () => resolveMeasureBox(measurePairId, document, getNodeBox),
    [measurePairId, document, getNodeBox]
  );

  const idleMeasureGuides = useMemo(() => {
    if (!inspectDev || transforming || !measurePrimaryBox || !measurePairBox) {
      return [] as SmartGuideLine[];
    }
    return collectPairSpacingGuides(measurePrimaryBox, measurePairBox);
  }, [inspectDev, transforming, measurePrimaryBox, measurePairBox]);

  const displayGuides = transforming ? smartGuides : idleMeasureGuides;
  // WxH under the box: inspect/preview only — edit already has the title size label.
  const measureSizeBox =
    inspectDev && inspectPrimaryId && !suppressChrome
      ? transforming && liveUnion
        ? liveUnion
        : measurePrimaryBox
      : null;

  const shapeOutlines = buildShapeOutlines({
    enabled,
    suppressChrome,
    readOnly,
    document,
    selectedNodeIds,
    selectedFrameIds,
    hoverNodeId,
    inspectDev,
    transforming,
    inspectPrimaryId,
    inspectPairNodeId,
    singleId,
    chromeAngle,
    selectedIsImageGen,
    selectedIsVideoGen,
    selectedIsLottieGen,
    liveOrigins,
    multiUnionBox: !single ? liveUnion || selectionUnion : null,
    multiUnionAngle: !single ? chromeAngle : 0,
    getNodeBox,
  });

  const hostInjectedSelection = isHostInjectedSelection(
    singleNode,
    singleId,
    shapeOutlines,
    {
      inspectDev,
      node: singleNodeData,
      selectedFrameIds,
      selectedNodeIds,
    }
  );

  const toolbarEdgePadScene = resolveToolbarEdgePadScene(singleNodeData);
  const edgeHandles = resolveSelectionEdgeHandles({
    selectedIsImageGen,
    selectedIsVideoGen,
    selectedIsLottieGen,
    selectedIsVideo,
    lineChrome,
    nodeKey: singleNodeData?.key,
  });

  // DPR seam diagnostics ??opt-in: window.__RCB_DPR_DEBUG__ = true
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    if (window.__RCB_DPR_DEBUG__ !== true) return;
    if (!selectedNodeIds.length) return;
    const dpr = window.devicePixelRatio || 1;
    const samples = selectedNodeIds
      .map((id) => {
        const b = getNodeBox(id);
        if (!b) return null;
        return sampleBoxEdges(id, b, camera, dpr);
      })
      .filter(Boolean) as ReturnType<typeof sampleBoxEdges>[];
    logEdgeSamples(`selection(${selectedNodeIds.length})`, samples, dpr, camera);
  }, [enabled, selectedNodeIds, camera.x, camera.y, camera.zoom, getNodeBox, camera]);

  const chromeUnion = resolveChromeUnion({
    transforming,
    liveUnion,
    selectionUnion,
    selectedNodeIds,
    selectedFrameIds,
    document,
    multiGroupAngle: !single ? chromeAngle : 0,
  });

  /** Radius / ellipse knobs sit on path geom (host-local), not visual-outer chrome. */
  const chromeGeomBox =
    chromeUnion && singleNodeData
      ? deflateSelectionBox(chromeUnion, singleNodeData)
      : chromeUnion;

  const hoverImageVariantsId = resolveHoverImageVariantsId({
    inspectDev,
    transforming,
    suppressToolbars,
    hoverNodeId,
    selectedNodeIds,
    document,
  });
  const hoverImageVariantsBox = hoverImageVariantsId ? getNodeBox(hoverImageVariantsId) : null;

  // Marquee only — path multi-select uses host silhouettes + world union box.
  // Vector ink uses host path chrome; non-path uses SelectionChrome (handles / box).

  if (!enabled) return null;

  // Path chrome already covers single vector selection (and inspect path ink).
  const skipWorldSelectionChrome = hostInjectedSelection;

  return (
    <>
      <ShapeOutlineSvg outlines={shapeOutlines} />
      <BrushOverlay box={marquee} />
      <SmartGuidesOverlay
        guides={displayGuides}
        mirrorNodeId={liveOrigins?.[0]?.nodeId ?? selectedNodeIds[0] ?? null}
        sizeBox={measureSizeBox}
      />

      {/* World SelectionChrome — path single/multi use host-mirrored chrome instead.
          Multi non-path keeps chrome while rotating so the control box can tilt. */}
      {chromeUnion &&
      !suppressChrome &&
      selectionCount > 0 &&
      !skipWorldSelectionChrome &&
      (!transforming || !single) ? (
        <SelectionChrome
          box={chromeUnion}
          angle={chromeAngle}
          showHandles={!inspectDev && !readOnly && !selectedIsMediaGen && !transforming}
          cornerHandlesOnly={!single}
          variant={lineChrome ? 'line' : 'box'}
          showRotate={
            !inspectDev &&
            !readOnly &&
            !lineChrome &&
            !selectedIsMediaGen &&
            !transforming &&
            selectedNodeIds.length >= 1 &&
            selectedFrameIds.length === 0
          }
          showBoxStroke={!lineChrome}
          interactiveBox={selectedFrameIds.length > 0}
          edgeHandles={edgeHandles}
        />
      ) : null}

      {!inspectDev &&
      !readOnly &&
      !transforming &&
      chromeUnion &&
      singleNode &&
      singleId &&
      singleNodeData &&
      supportsCornerRadius(singleNodeData) &&
      !supportsShapeSides(singleNodeData) &&
      !lineChrome &&
      !suppressChrome &&
      !selectedIsImageGen ? (
        <CornerRadiusHandlesOverlay
          box={chromeGeomBox || chromeUnion}
          angle={chromeAngle}
          nodeId={singleId}
          node={singleNodeData}
          toScene={toScene}
          stageEl={hitEl}
          interactive
        />
      ) : null}

      {!inspectDev &&
      !readOnly &&
      !transforming &&
      chromeUnion &&
      singleNode &&
      singleId &&
      singleNodeData &&
      (String(singleNodeData?.attrs?.shapeType || '') === 'circle' ||
        singleNodeData?.key === 'ellipse') &&
      !lineChrome &&
      !suppressChrome &&
      !selectedIsImageGen ? (
        <CircleShapeHandlesOverlay
          box={chromeGeomBox || chromeUnion}
          angle={chromeAngle}
          nodeId={singleId}
          node={singleNodeData}
          toScene={toScene}
          stageEl={hitEl}
          interactive
        />
      ) : null}

      {!inspectDev &&
      !readOnly &&
      !transforming &&
      chromeUnion &&
      singleNode &&
      singleId &&
      singleNodeData &&
      String(singleNodeData?.attrs?.shapeType || '') === 'polygon' &&
      !lineChrome &&
      !suppressChrome &&
      !selectedIsImageGen ? (
        <PolygonShapeHandlesOverlay
          box={chromeGeomBox || chromeUnion}
          angle={chromeAngle}
          nodeId={singleId}
          node={singleNodeData}
          toScene={toScene}
          stageEl={hitEl}
          interactive
        />
      ) : null}

      {!inspectDev &&
      !readOnly &&
      !transforming &&
      chromeUnion &&
      singleNode &&
      singleId &&
      singleNodeData &&
      String(singleNodeData?.attrs?.shapeType || '') === 'star' &&
      !lineChrome &&
      !suppressChrome &&
      !selectedIsImageGen ? (
        <StarShapeHandlesOverlay
          box={chromeGeomBox || chromeUnion}
          angle={chromeAngle}
          nodeId={singleId}
          node={singleNodeData}
          toScene={toScene}
          stageEl={hitEl}
          interactive
        />
      ) : null}

      {!inspectDev && chromeUnion && singleNode && !transforming && !suppressToolbars ? (
        <SelectionContextToolbar
          document={document}
          nodeId={selectedNodeIds[0]}
          box={toolbarBoxForSelection(chromeUnion, {
            lineChrome,
            node: singleNodeData,
          })}
          edgePadScene={toolbarEdgePadScene}
          onOpenAgent={onOpenAgent}
        />
      ) : null}

      {!inspectDev &&
      chromeUnion &&
      singleNode &&
      singleId &&
      !transforming &&
      !suppressToolbars &&
      (singleNodeData?.key === 'image' ||
        singleNodeData?.key === 'video' ||
        singleNodeData?.key === 'lottie' ||
        singleNodeData?.key === 'audio') ? (
        <NodeTitleLabel
          box={chromeUnion}
          angle={chromeAngle}
          name={
            mediaTitleChrome({
              key: singleNodeData?.key,
              name: singleNodeData?.attrs?.name,
              isImageGen: selectedIsImageGen,
              isVideoGen: selectedIsVideoGen,
              isLottieGen: selectedIsLottieGen,
              isAudioGen: selectedIsAudioGen,
              isVideo: selectedIsVideo,
            }).name
          }
          sizeWidth={chromeUnion.width}
          sizeHeight={chromeUnion.height}
          dataAttr="image-label"
          icon={
            mediaTitleChrome({
              key: singleNodeData?.key,
              name: singleNodeData?.attrs?.name,
              isImageGen: selectedIsImageGen,
              isVideoGen: selectedIsVideoGen,
              isLottieGen: selectedIsLottieGen,
              isAudioGen: selectedIsAudioGen,
              isVideo: selectedIsVideo,
            }).icon
          }
          dataProps={{ 'data-scene-node-id': singleId }}
          onRename={(name) =>
            dispatch(
              patchDocumentNode({
                nodeId: singleId,
                patch: { attrs: { name } },
              })
            )
          }
          renameAriaLabel={
            mediaTitleChrome({
              key: singleNodeData?.key,
              name: singleNodeData?.attrs?.name,
              isImageGen: selectedIsImageGen,
              isVideoGen: selectedIsVideoGen,
              isLottieGen: selectedIsLottieGen,
              isAudioGen: selectedIsAudioGen,
              isVideo: selectedIsVideo,
            }).renameAriaLabel
          }
        />
      ) : null}

      {!inspectDev &&
      liveUnion &&
      singleNode &&
      singleId &&
      !transforming &&
      !suppressToolbars &&
      singleNodeData?.key === 'image' &&
      !selectedIsImageGen &&
      String(singleNodeData?.attrs?.processStatus || '') !== 'running' ? (
        <ImageVariantsOverlay
          document={document}
          nodeId={singleId}
          box={liveUnion}
          angle={chromeAngle}
          imageHovered={hoverNodeId === singleId}
          readOnly={readOnly}
        />
      ) : null}

      {!inspectDev &&
      hoverImageVariantsId &&
      hoverImageVariantsBox &&
      !transforming &&
      !suppressToolbars ? (
        <ImageVariantsOverlay
          document={document}
          nodeId={hoverImageVariantsId}
          box={hoverImageVariantsBox}
          angle={readNodeAngle(document, hoverImageVariantsId)}
          imageHovered
          readOnly={readOnly}
        />
      ) : null}

      {/* Multi-select bar: show whenever the union has 2+ items and at least one
          scene node. Do not hide just because an artboard is co-selected. */}
      {!inspectDev &&
      liveUnion &&
      !single &&
      selectedNodeIds.length >= 1 &&
      !transforming &&
      !suppressToolbars ? (
        <MultiSelectionToolbar
          document={document}
          nodeIds={selectedNodeIds}
          frameIds={selectedFrameIds}
          box={liveUnion}
        />
      ) : null}
    </>
  );
}

export default memo(SelectionFeature);
