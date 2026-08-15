/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/canvas/SvgCanvas.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  addNodeToDocument,
  removeNodesFromDocument,
  reorderNodesInDocument,
  listSceneNodes,
  updateNodeInDocument,
} from '@recombyn-native/components/rcb/scene/document/sceneDocument';
import {
  createImageNode,
  createShapeNode,
  measureImageNaturalSize,
  parseLottieAnimationData,
  prepareVideoUploadPreview,
} from '@recombyn-native/components/rcb/scene/document/nodeFactories';
import {
  expandSelectionWithGroups,
  selectionSharedGroupId,
} from '@recombyn-native/components/rcb/scene/document/sceneGroups';
import {
  isNodeHidden,
  isNodeLocked,
  isVideoNode,
  isExportableSceneNode,
  isGeneratorNode,
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import {
  resolveSelectionNodeIds,
  nodeIdsInsideFrames,
  type SceneClipboardPayload,
} from '@recombyn-native/components/rcb/scene/document/sceneClipboard';
import {
  loadSceneOntoSvg,
  nodeLeftTop,
  stampStrokeBakeZoomBucket,
} from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import { sceneToDocumentCoords } from '@recombyn-native/components/rcb/scene/paint/svgToScene';
import { strokeCenterlineToFilledOutline } from '@recombyn-native/components/rcb/scene/paint/outlineToPath';
import { computeShapeBoolean, type ShapeBox } from '@recombyn-native/components/rcb/selection/shapeBoolean';
import { createDragWriteCoalescer } from './dragWriteCoalescer';
import {
  createCanvasSession,
  layoutGeneratorPlateAtScene,
} from './canvasSession';
import { runCanvasCtxAction } from './runCanvasCtxAction';
import {
  setSceneHitTestBridge,
} from '@recombyn-native/components/rcb/scene/document/sceneHitBridge';
import { SceneSpatialRuntime } from '@recombyn-native/components/rcb/core/spatialIndex';
import { useSvgBoard } from '@recombyn-native/components/rcb/canvas/useSvgBoard';
import {
  RcbShapesLayer,
  replaceShapePaint,
  setSharedNodeEls,
  listShapeHosts,
  rcbScreenToScene,
  type SvgBoardHandle,
} from '@recombyn-native/components/rcb';
import {
  abortNodeUpload,
  beginNodeUpload,
  finishNodeUpload,
  isUploadAbortError,
  uploadImageFile,
  readFileAsDataUrl,
  waitForImageReady,
} from '@recombyn-native/utils/uploadImage';
import { getHttpErrorMessage } from '@recombyn-native/service/client';
import store, { type RootState } from '@recombyn-native/store';
import { message } from '@recombyn-native/components/base';
import { useTranslation } from 'react-i18next';
import {
  cssPreviewForGradient,
  parseFillGradient,
  parseFillType,
} from '@recombyn-native/components/rcb/scene/document/sceneFill';
import { cssSolidWithOpacity } from '@recombyn-native/components/base/colorPanel';
import {
  patchDocumentNode,
  setActiveFrameId,
  setSelectedFrameIds,
  setMixedSelection,
  updateArtboardFrames,
  setActiveTool,
  setDocument,
  setDocumentFromCanvas,
  removeDocumentNodes,
  pushEditorHistory,
  setPendingImageSrc,
  setSelectedNodeId,
  setSelectedNodeIds,
  startImageUploadPlaceholder,
  startVideoUploadPlaceholder,
  finishImageProcess,
  failImageProcess,
  spawnLottie,
  spawnAudio,
  undo,
  redo,
  clearCanvasAttachPick,
  setCanvasAttachPickBlocked,
  setPendingCanvasAttach,
  EMPTY_ID_LIST,
} from '@recombyn-native/store/modules/editor';
import { requestProjectFlush } from '@recombyn-native/components/editor/useProjectCloudSync';
import {
  canCollabRedo,
  canCollabUndo,
  collabRedo,
  collabUndo,
  getCollabUndoEpoch,
  getCollabViewEpoch,
  isCollabActive,
  isCollabViewOnly,
  subscribeCollabUndo,
  subscribeCollabView,
} from '@recombyn-native/components/editor/collab/collabRuntime';
import SvgPaper from './SvgPaper';
import { pointerToWorld, type ArtboardRect } from './pointerToWorld';
import {
  attachPickFilterOpts,
  ctxMenuSeedFrameIds,
  ctxMenuSeedNodeIds,
  filterChatAttachNodeIds,
  frameForFullBleedPlate,
  resolveAttachPickPayload,
} from './attachPick';
import {
  noteCanvasFlyOrigin,
  resolveAttachPayloadFlyOrigin,
} from '@recombyn-native/components/editor/panels/agent/flyToChat';
import {
  useCanvasClipboard,
  type CanvasClipboardApi,
} from './clipboard/useCanvasClipboard';
import { useCanvasContextMenu } from './contextMenu/useCanvasContextMenu';
import { useChatImageDrop } from './drop/useChatImageDrop';
import { useCanvasHotkeys } from './keyboard/useCanvasHotkeys';
import {
  SelectionFeature,
  ShapeDrawFeature,
  TextPlaceFeature,
  ImagePlaceFeature,
  PencilDrawFeature,
  PenDrawFeature,
  PenPathEditFeature,
  BucketFillFeature,
  DEFAULT_PENCIL_BRUSH_ID,
  STAMP_TINT_READY_EVENT,
  rcbCenterOnPoint,
  getDocumentGridSize,
} from '@recombyn-native/components/rcb';
import ImageProcessOverlay from '@recombyn-native/components/editor/nodes/ImageNode/ImageProcessOverlay';
import ImageGeneratorOverlay from '@recombyn-native/components/editor/nodes/ImageGeneratorNode/ImageGeneratorOverlay';
import VideoGeneratorOverlay from '@recombyn-native/components/editor/nodes/VideoGeneratorNode/VideoGeneratorOverlay';
import LottieGeneratorOverlay from '@recombyn-native/components/editor/nodes/LottieGeneratorNode/LottieGeneratorOverlay';
import AudioGeneratorOverlay from '@recombyn-native/components/editor/nodes/AudioGeneratorNode/AudioGeneratorOverlay';
import AudioNodeOverlay, {
  type AudioGeomOverride,
} from '@recombyn-native/components/editor/nodes/AudioNode/AudioNodeOverlay';
import VideoNodeOverlay, {
  type VideoGeomOverride,
} from '@recombyn-native/components/editor/nodes/VideoNode/VideoNodeOverlay';
import LottieNodeOverlay, {
  type LottieGeomOverride,
} from '@recombyn-native/components/editor/nodes/LottieNode/LottieNodeOverlay';
import type { PencilEraseStroke } from '@recombyn-native/components/rcb';
import { erasePencilNode } from '@recombyn-native/components/rcb';
import type { SceneDocument, ScenePage } from '@recombyn-native/components/rcb/sceneNode';
import TextInlineEditor from '@recombyn-native/components/editor/nodes/TextNode/TextInlineEditor';
import CanvasContextMenu, {
  type ContextMenuState,
  type CtxAction,
} from '@recombyn-native/components/rcb/selection/chrome/CanvasContextMenu';
import {
  useRcbCamera,
  useRcbOverlayRoot,
  useRcbViewportEl,
} from '@recombyn-native/components/rcb';

const EMPTY_NODE_IDS: string[] = [];

type SvgCanvasProps = {
  document: SceneDocument;
  readOnly?: boolean;
  /**
   * Skip image/video-generator plates and process-shimmer (share preview / export-like view).
   */
  omitNonExportable?: boolean;
  reloadToken?: number;
  selectedNodeId?: string | null;
  selectedNodeIds?: string[];
  documentPatchToken?: number;
  /** Nodes patched via Redux — refresh SVG even when selection is empty (e.g. agent busy). */
  lastPatchedNodeIds?: string[];
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onLoadStart?: () => void;
  onReady?: () => void;
  /** Open the editor AI agent dock (selection contextual bar). */
  onOpenAgent?: (opts?: { prompt?: string }) => void;
  /** Right-click 銆屾坊鍔犲埌 Chat銆嶁€?one node id, `frame:id`, or multiple selected ids as one group. */
  onAddToChat?: (target: string | string[]) => void;
  /** When true, paper has no outer shadow (hosted inside HtmlArtboardFrame). */
  embedded?: boolean;
  /** Full viewport stage — pencil/pen hit-test beyond the finite SVG paper. */
  stageEl?: HTMLElement | null;
  /**
   * Drawable paper in world units. Prefer origin at (0,0) and grow width/height
   * to cover the camera frustum — do not slide the origin with pan/zoom.
   */
  viewRect?: { x: number; y: number; width: number; height: number } | null;
};

/** True when a full-bleed plate still has the legacy agent default #333 stroke. */
function isLegacyDefaultPlateStroke(attrs: Record<string, unknown> | undefined | null): boolean {
  if (!attrs) return false;
  const border = String(attrs['border-color'] || '')
    .replace(/\s/g, '')
    .toLowerCase();
  const bw = Number(attrs['border-width'] ?? 1);
  const strokeOn = String(attrs['stroke-enabled'] ?? 'true') !== 'false';
  if (!strokeOn || !(bw > 0)) return false;
  return border === '#333333' || border === '#333' || border === 'rgb(51,51,51)';
}

function legacyPlateStrokeHealAttrs(): Record<string, unknown> {
  return {
    'stroke-enabled': 'false',
    'stroke-visible': 'false',
    'border-width': 0,
  };
}

function ctxMenuCanReplace(opts: {
  readOnly: boolean;
  document: SceneDocument | null | undefined;
  ids: string[];
  ctxNodeId?: string | null;
}): boolean {
  if (opts.readOnly) return false;
  const targetId = opts.ctxNodeId || (opts.ids.length === 1 ? opts.ids[0] : null);
  if (!targetId) return false;
  const node = opts.document?.deltaSetLike?.[targetId];
  if (!node || isGeneratorNode(node)) return false;
  if (String(node?.attrs?.processStatus || '') === 'running') return false;
  return node.key === 'image' || isVideoNode(node);
}

function ctxMenuCanExport(opts: {
  document: SceneDocument | null | undefined;
  ids: string[];
  selectedFrameIds: string[];
  ctxNodeId?: string | null;
  ctxFrameId?: string | null;
  activeFrameId?: string | null;
}): boolean {
  const seedNodes = ctxMenuSeedNodeIds(opts.ids, opts.ctxNodeId);
  const seedFrames = ctxMenuSeedFrameIds(opts.selectedFrameIds, opts.ctxFrameId);
  const targetIds = resolveSelectionNodeIds(opts.document, seedNodes, seedFrames);
  if (targetIds.length) {
    return targetIds.some((id) => isExportableSceneNode(opts.document?.deltaSetLike?.[id]));
  }
  return Boolean(seedFrames.length || opts.ctxFrameId || opts.activeFrameId);
}

/**
 * SVG.js editor shell — mounts the board and composes feature components.
 */
function SvgCanvas({
  document,
  readOnly = false,
  omitNonExportable = false,
  reloadToken = 0,
  selectedNodeId = null,
  selectedNodeIds = [],
  documentPatchToken = 0,
  lastPatchedNodeIds = [],
  onZoomIn,
  onZoomOut,
  onReady,
  onOpenAgent,
  onAddToChat,
  embedded = false,
  stageEl = null,
  viewRect = null,
}: SvgCanvasProps) {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const camera = useRcbCamera();
  const viewportEl = useRcbViewportEl();
  useSyncExternalStore(subscribeCollabView, getCollabViewEpoch, getCollabViewEpoch);
  const collabViewOnly = isCollabViewOnly();
  // Collab share viewers: block mutations while still allowing pan/zoom/select chrome.
  readOnly = Boolean(readOnly || collabViewOnly);
  const activeTool = useSelector((s: RootState) => s.editor.activeTool);
  const shapeKind = useSelector((s: RootState) => s.editor.shapeKind);
  const pendingImageSrc = useSelector((s: RootState) => s.editor.pendingImageSrc);
  const penStrokeColor = useSelector((s: RootState) => String(s.editor.penStrokeColor || '#333333'));
  const penStrokeWidth = useSelector((s: RootState) => {
    const n = Number(s.editor.penStrokeWidth);
    return Number.isFinite(n) && n > 0 ? n : 1;
  });
  const pencilBrushId = useSelector((s: RootState) =>
    String(s.editor.pencilBrushId || DEFAULT_PENCIL_BRUSH_ID)
  );
  const pencilEraseMode = useSelector((s: RootState) => Boolean(s.editor.pencilEraseMode));
  const pencilPressureEnabled = useSelector((s: RootState) =>
    s.editor.pencilPressureEnabled !== false
  );
  const pencilHardness = useSelector((s: RootState) => {
    const n = Number(s.editor.pencilHardness);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 80;
  });
  const penStrokeOpacity = useSelector((s: RootState) => {
    const n = Number(s.editor.penStrokeOpacity);
    return Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 100;
  });
  const bucketFill = useSelector((s: RootState) => s.editor.bucketFill);
  const bucketFillRef = useRef(bucketFill);
  bucketFillRef.current = bucketFill;
  const workspaceMode = useSelector(
    (s: RootState) => (s.editor.workspaceMode || 'design') as 'design' | 'dev'
  );
  const canvasAttachPick = useSelector(
    (s: RootState) =>
      s.editor.canvasAttachPick as null | { target: string; accept?: 'image' | 'media' }
  );
  const canvasAttachPickRef = useRef(canvasAttachPick);
  canvasAttachPickRef.current = canvasAttachPick;
  const onAddToChatRef = useRef(onAddToChat);
  onAddToChatRef.current = onAddToChat;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const lastPointerClientRef = useRef({ x: 0, y: 0 });
  const hitTestRef = useRef<(x: number, y: number, screen?: { clientX: number; clientY: number }) => string | null>(
    () => null
  );
  const [stampTintEpoch, setStampTintEpoch] = useState(0);
  const reduxCanUndo = useSelector((s: RootState) => (s.editor.historyPast?.length || 0) > 0);
  const reduxCanRedo = useSelector((s: RootState) => (s.editor.historyFuture?.length || 0) > 0);
  useSyncExternalStore(subscribeCollabUndo, getCollabUndoEpoch, getCollabUndoEpoch);
  // Collab prefers Yjs undo; if that stack is empty (pre-seed / sync lag), fall
  // back to Redux so the menu and Ctrl+Z stay usable. View-only never undoes.
  const canUndo = isCollabViewOnly()
    ? false
    : isCollabActive()
      ? canCollabUndo() || reduxCanUndo
      : reduxCanUndo;
  const canRedo = isCollabViewOnly()
    ? false
    : isCollabActive()
      ? canCollabRedo() || reduxCanRedo
      : reduxCanRedo;
  const imageToolPanelKind = useSelector((s: RootState) => s.editor.imageToolPanel?.kind as string | undefined);
  const shapeStylePanel = useSelector((s: RootState) => s.editor.shapeStylePanel as null | { kind: string });
  const shapeStylePanelOpen = Boolean(shapeStylePanel);
  const cropExpandOpen =
    imageToolPanelKind === 'crop' ||
    imageToolPanelKind === 'expand' ||
    imageToolPanelKind === 'upscale';
  // Side panels (Eraser / Replace text / …) — hide selection toolbar like Eraser.
  const imageToolSidePanelOpen =
    imageToolPanelKind === 'eraser' ||
    imageToolPanelKind === 'replaceText' ||
    imageToolPanelKind === 'multiAngle' ||
    imageToolPanelKind === 'adjust' ||
    imageToolPanelKind === 'mark';
  const videoToolPanelKind = useSelector(
    (s: RootState) => s.editor.videoToolPanel?.kind as string | undefined
  );
  const videoToolOpen = videoToolPanelKind === 'trim';
  const audioToolPanelKind = useSelector(
    (s: RootState) => s.editor.audioToolPanel?.kind as string | undefined
  );
  const audioToolOpen =
    audioToolPanelKind === 'trim' || audioToolPanelKind === 'speed';
  const activeFrameId = useSelector(
    (s: RootState) => (s.editor.document?.activeFrameId as string | null) ?? null
  );
  const selectedFrameIds = useSelector(
    (s: RootState) => (s.editor.selectedFrameIds as string[]) ?? EMPTY_ID_LIST
  );

  const paperRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Scene / selection refs (declared once — do not duplicate in this component).
  const documentRef = useRef(document);
  const selectedIdsRef = useRef<string[]>([]);
  const activeFrameIdRef = useRef<string | null>(null);
  const selectedFrameIdsRef = useRef<string[]>([]);
  const loadSeqRef = useRef(0);
  const lastLoadKeyRef = useRef<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const imagePlaceAtRef = useRef<{ x: number; y: number } | null>(null);
  const [paperEl, setPaperEl] = useState<HTMLElement | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const clipboardRef = useRef<SceneClipboardPayload | null>(null);
  /** When the in-app node clipboard was last written (Ctrl+C / cut / context copy). */
  const internalClipboardAtRef = useRef(0);
  /** Last seen OS clipboard fingerprint + when it changed (for paste priority). */
  const osClipboardMetaRef = useRef<{ fingerprint: string; at: number }>({
    fingerprint: '',
    at: 0,
  });
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  /** Double-click pen path → anchor / handle edit. */
  const [editingPenId, setEditingPenId] = useState<string | null>(null);
  const [pathEditSubtool, setPathEditSubtool] = useState<'select' | 'pen' | 'curve'>('select');
  /** After inline text commit, blank-canvas pointerup must not clear selection. */
  const keepSelectAfterTextEditRef = useRef<string | null>(null);
  /**
   * Mixed selection drag live-updates Redux frames (skipHistory) so artboard HTML
   * moves with the chrome. Snapshot history once before the first frame write so
   * commit does not push a half-new doc (new frames + old nodes).
   */
  const frameGeomHistoryPushedRef = useRef(false);
  const [geometryTransforming, setGeometryTransforming] = useState(false);
  /** Live video plate boxes while dragging — Redux only commits on gesture end. */
  const [videoLiveGeom, setVideoLiveGeom] = useState<Record<string, VideoGeomOverride> | null>(
    null
  );
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const setVideoLiveGeomRef = useRef(setVideoLiveGeom);
  setVideoLiveGeomRef.current = setVideoLiveGeom;
  const dragWriteCoalesceRef = useRef(
    createDragWriteCoalescer(({ frames, videoGeom }) => {
      if (frames.length) {
        dispatchRef.current(
          updateArtboardFrames({
            skipHistory: true,
            patches: frames.map((fp) => ({
              id: fp.id,
              patch: { x: fp.x, y: fp.y, width: fp.width, height: fp.height },
            })),
          })
        );
      }
      if (videoGeom !== undefined) setVideoLiveGeomRef.current(videoGeom);
    })
  );
  useEffect(
    () => () => {
      dragWriteCoalesceRef.current.cancel();
    },
    []
  );
  const overlayRoot = useRcbOverlayRoot();

  const onGeometryTransformingChange = useCallback((next: boolean) => {
    setGeometryTransforming(next);
    if (!next) {
      dragWriteCoalesceRef.current.cancel();
      // Clear live geom with the Redux document write in onGeometryCommit when
      // possible. Soft-click / cancelled transforms still need a clear here.
      setVideoLiveGeom(null);
    }
  }, []);
  documentRef.current = document;
  selectedIdsRef.current = ctxMenuSeedNodeIds(selectedNodeIds || [], selectedNodeId);
  activeFrameIdRef.current = activeFrameId;
  selectedFrameIdsRef.current = selectedFrameIds;

  // Content bounds (export / guides). Infinite embedded mode has no DOM paper size —
  // camera CSS on RcbCanvas world layer owns pan/zoom.
  const paperW = viewRect?.width || document?.width || 794;
  const paperH = viewRect?.height || document?.height || 1123;
  const infinite = Boolean(embedded);
  const artboard = useMemo(
    () => ({ x: 0, y: 0, width: paperW, height: paperH }),
    [paperW, paperH]
  );
  const modLabel = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '?' : 'Ctrl';
  // Embedded infinite canvas: per-shape hosts (RcbShapesLayer). Finite paper keeps mono board.
  const { boardRef: monoBoardRef, boardEpoch } = useSvgBoard(hostRef, paperW, paperH, {
    infinite,
    enabled: !infinite,
  });
  const nodeElsRef = useRef(new Map<string, SVGElement>());
  const perShapeBoardRef = useRef<SvgBoardHandle>({
    root: null as unknown as SVGSVGElement,
    layer: null as unknown as SVGGElement,
    nodeEls: nodeElsRef.current,
    getSvgElement: () => null,
    toSvgString: () => '',
  });
  const boardRef = infinite ? perShapeBoardRef : monoBoardRef;

  useEffect(() => {
    if (!infinite) return undefined;
    setSharedNodeEls(nodeElsRef.current);
    perShapeBoardRef.current.nodeEls = nodeElsRef.current;
    // Hosts that painted before shared map was set wrote into a throwaway Map.
    listShapeHosts().forEach((h) => {
      if (h.el) nodeElsRef.current.set(h.nodeId, h.el);
    });
    return () => setSharedNodeEls(null);
  }, [infinite]);

  useEffect(() => {
    setPaperEl(paperRef.current);
  }, [boardEpoch, infinite]);

  // Non-infinite only: keep a finite SVG paper. Embedded infinite must NOT re-apply viewBox.
  useEffect(() => {
    if (infinite) return;
    const board = boardRef.current;
    if (!board) return;
    const w = Math.max(1, Math.round(paperW));
    const h = Math.max(1, Math.round(paperH));
    try {
      board.root.setAttribute('width', String(w));
      board.root.setAttribute('height', String(h));
      board.root.setAttribute('viewBox', `0 0 ${w} ${h}`);
      board.root.setAttribute('preserveAspectRatio', 'none');
    } catch {
      /* ignore */
    }
  }, [infinite, paperW, paperH, boardEpoch, boardRef]);

  useEffect(() => {
    if (infinite) {
      // Per-shape hosts mount via RcbShapesLayer; signal ready once children are known.
      onReadyRef.current?.();
      return;
    }
    const board = boardRef.current;
    if (!board || !document) return;
    // Width/height omitted: world surface padding changes on every edge move.
    const key = `${reloadToken}:${boardEpoch}:${String(document.backgroundColor || '')}`;
    if (lastLoadKeyRef.current === key) return;
    lastLoadKeyRef.current = key;

    const seq = ++loadSeqRef.current;
    board.loadSeq = seq;
    // Drop stale wrappers immediately so in-place preview cannot re-attach detached ghosts.
    board.nodeEls = new Map();
    async function loadScene() {
      const map = await loadSceneOntoSvg(board.root, board.layer, document, seq, board, {
        infinite,
        omitNonExportable,
      });
      if (loadSeqRef.current !== seq) return;
      board.nodeEls = map || new Map();
      onReadyRef.current?.();
    }
    void loadScene();
  }, [document, reloadToken, boardEpoch, infinite, omitNonExportable, boardRef]);

  useEffect(() => {
    if (!documentPatchToken || geometryTransforming) return;
    const board = boardRef.current;
    const doc = documentRef.current;
    if (!board || !doc) return;
    // Only nodes touched by the latest document patch — never repaint on selection
    // alone (re-setting a video poster flashes the first frame under the live <video>).
    lastPatchedNodeIds.forEach((id) => {
      if (!id) return;
      void replaceShapePaint(doc, board.nodeEls, id, board.root ? board : null);
    });
  }, [documentPatchToken, lastPatchedNodeIds, geometryTransforming, boardRef]);

  // Stamp tip tint may resolve after first paint ? refresh pencil stamp strokes.
  useEffect(() => {
    const onReady = () => setStampTintEpoch((n) => n + 1);
    window.addEventListener(STAMP_TINT_READY_EVENT, onReady);
    return () => window.removeEventListener(STAMP_TINT_READY_EVENT, onReady);
  }, []);

  useEffect(() => {
    if (!stampTintEpoch) return;
    const board = boardRef.current;
    const doc = documentRef.current;
    if (!board || !doc) return;
    listSceneNodes(doc).forEach(({ id, node }) => {
      if (node?.key !== 'shape') return;
      if (String(node.attrs?.shapeType || '') !== 'pencil') return;
      const stamp = node.attrs?.brushStampSrc;
      if (!stamp) return;
      void replaceShapePaint(doc, board.nodeEls, id, board.root ? board : null);
    });
  }, [stampTintEpoch, boardRef]);

  // Tip strokes are raster baked — rebake at higher zoom so they don't go soft.
  const stampBakeZoomRef = useRef(0);
  useEffect(() => {
    const bucket = stampStrokeBakeZoomBucket(camera.zoom);
    if (stampBakeZoomRef.current === 0) {
      stampBakeZoomRef.current = bucket;
      return;
    }
    if (bucket <= stampBakeZoomRef.current) return;
    stampBakeZoomRef.current = bucket;
    const t = window.setTimeout(() => {
      const board = boardRef.current;
      const doc = documentRef.current;
      if (!board || !doc) return;
      listSceneNodes(doc).forEach(({ id, node }) => {
        if (node?.key !== 'shape') return;
        if (String(node.attrs?.shapeType || '') !== 'pencil') return;
        const stamp = node.attrs?.brushStampSrc;
        if (!stamp) return;
        void replaceShapePaint(doc, board.nodeEls, id, board.root ? board : null);
      });
    }, 140);
    return () => window.clearTimeout(t);
  }, [camera.zoom, boardRef]);

  const cameraZoomRef = useRef(camera.zoom);
  cameraZoomRef.current = camera.zoom;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const overlayRootRef = useRef(overlayRoot);
  overlayRootRef.current = overlayRoot;
  const paperElRef = useRef(paperEl);
  paperElRef.current = paperEl;
  // boardRef identity flips with infinite mode — hold the live ref object.
  const boardRefHolder = useRef(boardRef);
  boardRefHolder.current = boardRef;

  /**
   * Spatial index — owned by SceneSpatialRuntime (reload / membership / patch).
   * Never rebuild every AABB because size drifted by 1.
   */
  const spatialRuntimeRef = useRef(new SceneSpatialRuntime(256));
  const session = useMemo(
    () =>
      createCanvasSession({
        getDocument: () => documentRef.current,
        setDocumentLocal: (doc) => {
          documentRef.current = doc;
        },
        getBoard: () => boardRefHolder.current.current,
        getZoom: () => cameraZoomRef.current,
        isReadOnly: () => readOnlyRef.current,
        dispatch,
        spatial: spatialRuntimeRef.current,
        setEditingTextId,
        measureViewport: () =>
          overlayRootRef.current?.getBoundingClientRect() ||
          paperElRef.current?.parentElement?.getBoundingClientRect() ||
          null,
        getDragWriteCoalescer: () => dragWriteCoalesceRef.current,
        getFrameGeomHistoryPushed: () => frameGeomHistoryPushedRef.current,
        setFrameGeomHistoryPushed: (next) => {
          frameGeomHistoryPushedRef.current = next;
        },
        publishVideoLiveGeom: (next) => {
          dragWriteCoalesceRef.current.queueVideoGeom(next);
        },
        clearVideoLiveGeom: () => {
          setVideoLiveGeomRef.current(null);
        },
      }),
    [dispatch]
  );
  const {
    listNodeIds,
    getNodeBox,
    hitTest,
    hitTestFrame,
    queryNodeIdsInRect,
    finishToSelect,
    onCreateShape,
    onPlaceText,
    imageSizeForViewport,
    placeImageAt,
    onGeometryCommit,
    onGeometryPreview,
    onAngleCommit,
    onAnglePreview,
  } = session;

  const nodeSpatialIndex = useMemo(() => {
    const runtime = spatialRuntimeRef.current;
    const doc = document;
    if (!doc) {
      runtime.clear();
      return runtime.index;
    }
    const page: ScenePage | undefined =
      doc?.pages?.find((p) => p.id === doc?.activePageId) || doc?.pages?.[0];
    const fromPage = page?.children;
    const childrenSrc: string[] =
      Array.isArray(fromPage) && fromPage.length
        ? fromPage
        : Array.isArray(doc?.deltaSetLike?.ROOT?.children)
          ? doc.deltaSetLike.ROOT.children
          : [];
    return runtime.sync({
      document: doc,
      childrenIds: childrenSrc,
      reloadToken,
      patchedNodeIds: lastPatchedNodeIds,
      aabbPad: 32,
    });
  }, [document, reloadToken, lastPatchedNodeIds]);

  useEffect(() => {
    setSceneHitTestBridge(hitTest);
    return () => setSceneHitTestBridge(null);
  }, [hitTest]);

  hitTestRef.current = hitTest;

  /** Apply one canvas pick into composer, then exit pick mode (one pick per activation). */
  const noteFlyOriginForPayload = useCallback(
    (payload: string | string[], fromPointer: boolean) => {
      if (fromPointer) {
        const p = lastPointerClientRef.current;
        if (p.x || p.y) {
          noteCanvasFlyOrigin(p.x, p.y);
          return;
        }
      }
      const doc = documentRef.current;
      if (!doc) return;
      const origin = resolveAttachPayloadFlyOrigin({
        document: doc,
        payload,
        camera,
      });
      if (origin) noteCanvasFlyOrigin(origin.x, origin.y);
    },
    [camera]
  );

  const completeCanvasAttachPick = useCallback(
    (pickTarget: string, payload: string | string[]) => {
      noteFlyOriginForPayload(payload, true);
      if (pickTarget === 'agent') {
        onAddToChatRef.current?.(payload);
      } else {
        // Pending attach keeps the node composer open via the payload — do not
        // steal selection onto the host plate (that feels like exiting pick).
        dispatch(setPendingCanvasAttach({ target: pickTarget, payload }));
      }
      dispatch(clearCanvasAttachPick());
    },
    [dispatch, noteFlyOriginForPayload]
  );

  const emitAddToChat = useCallback(
    (payload: string | string[]) => {
      noteFlyOriginForPayload(payload, false);
      onAddToChatRef.current?.(payload);
    },
    [noteFlyOriginForPayload]
  );

  // Track pointer for pick-mode fly origin (click → composer).
  useEffect(() => {
    if (!stageEl) return undefined;
    const onPointer = (e: PointerEvent) => {
      lastPointerClientRef.current = { x: e.clientX, y: e.clientY };
    };
    stageEl.addEventListener('pointerdown', onPointer, true);
    stageEl.addEventListener('pointermove', onPointer, true);
    return () => {
      stageEl.removeEventListener('pointerdown', onPointer, true);
      stageEl.removeEventListener('pointermove', onPointer, true);
    };
  }, [stageEl]);

  // Plus / not-allowed cursor while picking for Chat.
  useEffect(() => {
    if (!canvasAttachPick || !stageEl) {
      dispatch(setCanvasAttachPickBlocked(false));
      return undefined;
    }
    const onMove = (e: PointerEvent) => {
      const pt = rcbScreenToScene(camera, stageEl, e.clientX, e.clientY);
      const id = hitTestRef.current(pt.x, pt.y, {
        clientX: e.clientX,
        clientY: e.clientY,
      });
      if (!id) {
        dispatch(setCanvasAttachPickBlocked(false));
        return;
      }
      const doc = documentRef.current;
      const seed = expandSelectionWithGroups(doc, [id]);
      const attachable = filterChatAttachNodeIds(
        doc,
        seed,
        attachPickFilterOpts(canvasAttachPickRef.current)
      );
      dispatch(setCanvasAttachPickBlocked(seed.length > 0 && attachable.length === 0));
    };
    stageEl.addEventListener('pointermove', onMove);
    return () => {
      stageEl.removeEventListener('pointermove', onMove);
      dispatch(setCanvasAttachPickBlocked(false));
    };
  }, [canvasAttachPick, stageEl, dispatch, camera]);

  const onSelectFrame = useCallback(
    (frameId: string | null) => {
      const pick = canvasAttachPickRef.current;
      if (pick?.target) {
        if (!frameId) {
          dispatch(clearCanvasAttachPick());
          return;
        }
        completeCanvasAttachPick(pick.target, `frame:${frameId}`);
        return;
      }
      if (!frameId) {
        dispatch(setActiveFrameId(null));
        return;
      }
      dispatch(setSelectedNodeIds([]));
      dispatch(setSelectedNodeId(null));
      dispatch(setActiveFrameId(frameId));
    },
    [dispatch, completeCanvasAttachPick]
  );

  const onSelectFrames = useCallback(
    (frameIds: string[]) => {
      const pick = canvasAttachPickRef.current;
      const ids = Array.isArray(frameIds) ? frameIds.filter(Boolean) : [];
      if (pick?.target) {
        if (!ids.length) {
          dispatch(clearCanvasAttachPick());
          return;
        }
        completeCanvasAttachPick(pick.target, `frame:${ids[0]}`);
        return;
      }
      if (!ids.length) {
        dispatch(setActiveFrameId(null));
        return;
      }
      dispatch(setSelectedNodeIds([]));
      dispatch(setSelectedFrameIds(ids));
    },
    [dispatch, completeCanvasAttachPick]
  );

  const onSelectMixed = useCallback(
    (nodeIds: string[], frameIds: string[], opts?: { additive?: boolean }) => {
      const pick = canvasAttachPickRef.current;
      if (pick?.target && !opts?.additive) {
        const resolved = resolveAttachPickPayload(
          documentRef.current,
          nodeIds || [],
          (frameIds || [])[0],
          attachPickFilterOpts(pick)
        );
        if (!resolved) {
          dispatch(clearCanvasAttachPick());
          return;
        }
        if (resolved.blockedOnly) return; // stay in pick mode
        completeCanvasAttachPick(pick.target, resolved.payload);
        return;
      }
      keepSelectAfterTextEditRef.current = null;
      let nextNodes = expandSelectionWithGroups(documentRef.current, nodeIds || []);
      let nextFrames = [...new Set((frameIds || []).filter(Boolean))];
      if (opts?.additive) {
        const curNodes = new Set(selectedIdsRef.current);
        nextNodes.forEach((id) => {
          if (curNodes.has(id)) curNodes.delete(id);
          else curNodes.add(id);
        });
        nextNodes = [...curNodes];
        const curFrames = new Set(selectedFrameIdsRef.current);
        nextFrames.forEach((id) => {
          if (curFrames.has(id)) curFrames.delete(id);
          else curFrames.add(id);
        });
        nextFrames = [...curFrames];
      }
      dispatch(setMixedSelection({ nodeIds: nextNodes, frameIds: nextFrames }));
    },
    [dispatch, completeCanvasAttachPick]
  );

  const onSelect = useCallback(
    (ids: string[], opts?: { additive?: boolean }) => {
      // Allow selection in read-only Dev/preview so inspect annotations work.
      // Do not re-select after text blur: blank click must clear focus/selection.
      keepSelectAfterTextEditRef.current = null;
      const doc = documentRef.current;
      const pick = canvasAttachPickRef.current;

      // Composer pick mode — attach hit (group-expanded); blocked nodes keep pick active.
      if (pick?.target && !opts?.additive) {
        if (!ids.length) {
          dispatch(clearCanvasAttachPick());
          return;
        }
        if (ids.length === 1) {
          const plateFrame = frameForFullBleedPlate(doc, ids[0]);
          if (plateFrame) {
            completeCanvasAttachPick(pick.target, `frame:${plateFrame.id}`);
            return;
          }
        }
        const resolved = resolveAttachPickPayload(
          doc,
          ids,
          undefined,
          attachPickFilterOpts(pick)
        );
        if (!resolved) {
          dispatch(clearCanvasAttachPick());
          return;
        }
        if (resolved.blockedOnly) return;
        completeCanvasAttachPick(pick.target, resolved.payload);
        return;
      }

      // Soft-click a near-full-bleed background plate → select the artboard instead
      // (avoids a white+stroke rect looking like a UI overlay on the poster).
      if (!opts?.additive && ids.length === 1) {
        const plateFrame = frameForFullBleedPlate(doc, ids[0]);
        if (plateFrame) {
          const plate = doc?.deltaSetLike?.[ids[0]];
          // Heal legacy agent plates that used the old default #333 stroke.
          if (isLegacyDefaultPlateStroke(plate?.attrs)) {
            dispatch(
              patchDocumentNode({
                nodeId: ids[0],
                skipHistory: true,
                patch: { attrs: legacyPlateStrokeHealAttrs() },
              })
            );
          }
          dispatch(setSelectedNodeIds([]));
          dispatch(setActiveFrameId(plateFrame.id));
          return;
        }
      }
      // Clicking any grouped member selects the whole group.
      let seed = expandSelectionWithGroups(doc, ids);
      let next = seed;
      if (opts?.additive) {
        const cur = new Set(selectedIdsRef.current);
        seed.forEach((id) => {
          if (cur.has(id)) cur.delete(id);
          else cur.add(id);
        });
        next = [...cur];
        // Keep frames when shift-adding nodes.
        dispatch(setSelectedNodeIds(next));
        return;
      }
      // Prefer setSelectedNodeIds only — setSelectedNodeId clears multi-select to [id].
      dispatch(setMixedSelection({ nodeIds: next, frameIds: [] }));
    },
    [dispatch, completeCanvasAttachPick]
  );

  const onTextEditCommit = useCallback(
    (next: {
      attrs: Record<string, unknown>;
      width: number;
      height: number;
      left?: number;
    }) => {
      if (!editingTextId) return;
      const id = editingTextId;
      const doc = documentRef.current;
      keepSelectAfterTextEditRef.current = null;
      const patch: Record<string, unknown> = {
        attrs: next.attrs,
        width: next.width,
        height: next.height,
      };
      if (next.left != null && doc) {
        const coords = sceneToDocumentCoords(doc, next.left, 0);
        patch.x = coords.x;
      }
      dispatch(
        patchDocumentNode({
          nodeId: id,
          patch,
        })
      );
      setEditingTextId(null);
    },
    [dispatch, editingTextId]
  );

  const onTextLiveSize = useCallback(
    (next: { width: number; height: number; left?: number; autoSize?: boolean }) => {
      if (!editingTextId) return;
      const doc = documentRef.current;
      const patch: Record<string, unknown> = {
        width: next.width,
        height: next.height,
      };
      if (next.autoSize != null) {
        patch.attrs = { autoSize: next.autoSize ? 'true' : 'false' };
      }
      if (next.left != null && doc) {
        const coords = sceneToDocumentCoords(doc, next.left, 0);
        patch.x = coords.x;
      }
      dispatch(
        patchDocumentNode({
          nodeId: editingTextId,
          patch,
          skipHistory: true,
        })
      );
    },
    [dispatch, editingTextId]
  );

  const onTextEditCancel = useCallback(() => {
    const id = editingTextId;
    keepSelectAfterTextEditRef.current = null;
    setEditingTextId(null);
    if (!id || !documentRef.current) return;
    const node = documentRef.current.deltaSetLike?.[id];
    const md = String(node?.attrs?.markdown ?? '').trim();
    // Delete empty / freshly placed text that was cancelled.
    if (!md) {
      const next = removeNodesFromDocument(documentRef.current, [id]);
      documentRef.current = next;
      dispatch(setDocument(next));
      dispatch(setSelectedNodeIds([]));
      dispatch(setSelectedNodeId(null));
    } else {
      // Discard edits but keep the node selected (same as blur-to-select).
      dispatch(setSelectedNodeIds([id]));
      dispatch(setSelectedNodeId(id));
    }
  }, [dispatch, editingTextId]);

  // Hide SVG text glyph while the caret editor is open (avoid double text).
  // Native SVGElement has no SVG.js `.opacity()` — use style/attribute.
  useEffect(() => {
    if (!editingTextId) return undefined;
    const applyHidden = (hidden: boolean) => {
      const el = boardRef.current?.nodeEls.get(editingTextId) as SVGElement | undefined;
      if (!el) return false;
      const v = hidden ? '0' : '1';
      el.style.opacity = v;
      el.setAttribute('opacity', v);
      const wrap = el as SVGElement & { opacity?: (n: number) => void };
      if (typeof wrap.opacity === 'function') wrap.opacity(hidden ? 0 : 1);
      return true;
    };
    applyHidden(true);
    // Host remounts on width/height paintToken — keep forcing hide while editing.
    const timer = window.setInterval(() => applyHidden(true), 48);
    return () => {
      window.clearInterval(timer);
      applyHidden(false);
    };
  }, [editingTextId, reloadToken, boardEpoch, boardRef]);

  /**
   * Size an incoming image against what is actually on screen, so the same file
   * lands at a usable size whether the user is zoomed way in or way out.
   */
  // Upload: place immediately at the visible viewport center (not world paper center).
  const autoPlaceSrcRef = useRef<string | null>(null);
  useEffect(() => {
    if (readOnly || !pendingImageSrc) {
      autoPlaceSrcRef.current = null;
      return;
    }
    if (autoPlaceSrcRef.current === pendingImageSrc) return;
    autoPlaceSrcRef.current = pendingImageSrc;

    const view =
      overlayRoot?.getBoundingClientRect() ||
      paperEl?.parentElement?.getBoundingClientRect() ||
      null;
    const center = view && (stageEl || paperEl)
      ? pointerToWorld(
          camera,
          { viewportEl, stageEl, paperEl, artboard },
          view.left + view.width / 2,
          view.top + view.height / 2
        )
      : { x: paperW / 2, y: paperH / 2 };
    placeImageAt(pendingImageSrc, center.x, center.y);
  }, [
    pendingImageSrc,
    paperW,
    paperH,
    paperEl,
    stageEl,
    viewportEl,
    camera,
    overlayRoot,
    artboard,
    placeImageAt,
    readOnly,
  ]);

  const onPencilCommit = useCallback(
    (
      pathD: string,
      box: { left: number; top: number; width: number; height: number },
      meta?: { pathPressure?: string; brushHardness?: number; brushStampSrc?: string }
    ) => {
      const doc = documentRef.current;
      if (!doc || readOnly) return;
      const origin = sceneToDocumentCoords(doc, box.left, box.top);
      const { id, node } = createShapeNode({
        x: origin.x,
        y: origin.y,
        width: box.width,
        height: box.height,
        shapeType: 'pencil',
        fill: 'transparent',
        stroke: penStrokeColor,
        borderWidth: penStrokeWidth,
        path: pathD,
        closed: false,
        brushStyle: pencilBrushId || DEFAULT_PENCIL_BRUSH_ID,
        opacity: penStrokeOpacity / 100,
      });
      if (meta?.pathPressure) {
        (node.attrs as Record<string, unknown>).pathPressure = meta.pathPressure;
      }
      if (meta?.brushHardness != null && Number.isFinite(meta.brushHardness)) {
        (node.attrs as Record<string, unknown>).brushHardness = meta.brushHardness;
      }
      (node.attrs as Record<string, unknown>).pressureEnabled = pencilPressureEnabled;
      const next = addNodeToDocument(doc, id, node);
      documentRef.current = next;
      dispatch(pushEditorHistory());
      dispatch(setDocumentFromCanvas(next));
      // Stay in pencil mode for continuous strokes; do not auto-select.
      dispatch(setSelectedNodeIds([]));
      dispatch(setSelectedNodeId(null));
    },
    [dispatch, readOnly, penStrokeColor, penStrokeWidth, pencilBrushId, penStrokeOpacity, pencilPressureEnabled]
  );

  const onBucketFill = useCallback(
    (nodeId: string) => {
      if (readOnly || !nodeId) return;
      const fill = bucketFillRef.current;
      const fillType = String(fill.fillType || 'solid');
      const attrs: Record<string, unknown> = {
        'fill-color': String(fill.fillColor || '#333333'),
        'fill-type': fillType,
        'fill-opacity': Math.max(0, Math.min(100, Number(fill.fillOpacity) || 100)),
        'fill-enabled': 'true',
        'fill-visible': 'true',
      };
      if (fillType !== 'solid' && fillType !== 'image' && fill.fillGradient) {
        attrs['fill-gradient'] = String(fill.fillGradient);
      } else {
        attrs['fill-gradient'] = undefined;
      }
      if (fillType === 'image') {
        attrs['fill-image-src'] = fill.fillImageSrc || '';
        attrs['fill-image-fit'] = fill.fillImageFit ?? 'fill';
        attrs['fill-image-rotate'] = fill.fillImageRotate ?? 0;
        if (fill.fillImageAdjust) attrs['fill-image-adjust'] = fill.fillImageAdjust;
      }
      dispatch(
        patchDocumentNode({
          nodeId,
          patch: { attrs },
        })
      );
    },
    [dispatch, readOnly]
  );

  const pencilEraseTargets = useMemo(() => {
    const doc = document;
    if (!doc) return [];
    return listSceneNodes(doc)
      .filter(({ node }) => {
        if (node?.key !== 'shape') return false;
        return String(node.attrs?.shapeType || '') === 'pencil';
      })
      .map(({ id, node }) => {
        const { left, top } = nodeLeftTop(doc, node);
        return {
          id,
          left,
          top,
          width: Math.max(1, Number(node.width) || 1),
          height: Math.max(1, Number(node.height) || 1),
        };
      });
  }, [document]);

  const onPencilErase = useCallback(
    (stroke: PencilEraseStroke) => {
      const doc = documentRef.current;
      if (!doc || readOnly || !stroke.points.length) return;

      const pencils = listSceneNodes(doc).filter(({ node }) => {
        if (node?.key !== 'shape') return false;
        return String(node.attrs?.shapeType || '') === 'pencil';
      });
      if (!pencils.length) return;

      let next = doc;
      let changed = false;
      for (const { id, node } of pencils) {
        const { left, top } = nodeLeftTop(next, node);
        const strokeWidth =
          Number(node.attrs?.['border-width'] ?? node.attrs?.strokeWidth ?? 10) || 10;
        const brushId = String(node.attrs?.brushStyle || 'solid');
        const srcPressure =
          node.attrs?.pathPressure != null ? String(node.attrs.pathPressure) : undefined;
        const fragments = erasePencilNode({
          pathD: String(node.attrs?.path || ''),
          left,
          top,
          strokeWidth,
          brushId,
          pathPressure: srcPressure,
          eraseScene: stroke.points,
          eraseRadius: stroke.radius,
        });
        if (fragments == null) continue;

        changed = true;
        next = removeNodesFromDocument(next, [id]);
        for (const frag of fragments) {
          const origin = sceneToDocumentCoords(next, frag.left, frag.top);
          const { id: nid, node: nnode } = createShapeNode({
            x: origin.x,
            y: origin.y,
            width: frag.width,
            height: frag.height,
            shapeType: 'pencil',
            fill: 'transparent',
            stroke: String(node.attrs?.['border-color'] || node.attrs?.stroke || '#333333'),
            borderWidth: strokeWidth,
            path: frag.pathD,
            closed: false,
            brushStyle: brushId,
            brushStampSrc:
              node.attrs?.brushStampSrc != null ? String(node.attrs.brushStampSrc) : undefined,
          });
          nnode.z = Number(node.z) || 0;
          // Keep stroke visibility / opacity attrs from the source stroke.
          const src = node.attrs || {};
          for (const key of [
            'stroke-enabled',
            'stroke-visible',
            'stroke-opacity',
            'opacity',
            'blendMode',
            'strokeLinecap',
            'stroke-linecap',
            'strokeLinejoin',
            'stroke-linejoin',
          ]) {
            if (src[key] != null) nnode.attrs[key] = src[key];
          }
          if (frag.pathPressure) {
            (nnode.attrs as Record<string, unknown>).pathPressure = frag.pathPressure;
          }
          next = addNodeToDocument(next, nid, nnode);
        }
      }

      if (!changed) return;
      documentRef.current = next;
      dispatch(setDocument(next));
      dispatch(setSelectedNodeIds([]));
      dispatch(setSelectedNodeId(null));
    },
    [dispatch, readOnly]
  );

  const onPenCommit = useCallback(
    (
      pathD: string,
      box: { left: number; top: number; width: number; height: number },
      closed: boolean,
      opts?: { replaceNodeId?: string }
    ) => {
      const doc = documentRef.current;
      if (!doc || readOnly) return;
      const origin = sceneToDocumentCoords(doc, box.left, box.top);
      const replaceId = opts?.replaceNodeId;
      if (replaceId && doc.deltaSetLike?.[replaceId]) {
        const prev = doc.deltaSetLike[replaceId];
        const prevType = String(prev?.attrs?.shapeType || 'pen');
        const shapeType = prevType === 'path' ? 'path' : 'pen';
        dispatch(pushEditorHistory());
        dispatch(
          patchDocumentNode({
            nodeId: replaceId,
            patch: {
              x: origin.x,
              y: origin.y,
              width: Math.max(1, box.width),
              height: Math.max(1, box.height),
              attrs: {
                shapeType,
                path: pathD,
                closed: closed ? 'true' : 'false',
                'border-color': penStrokeColor,
                'border-width': penStrokeWidth,
              },
            },
          })
        );
        dispatch(setSelectedNodeIds([replaceId]));
        return;
      }
      const { id, node } = createShapeNode({
        x: origin.x,
        y: origin.y,
        width: box.width,
        height: box.height,
        shapeType: 'pen',
        fill: 'transparent',
        stroke: penStrokeColor,
        borderWidth: penStrokeWidth,
        path: pathD,
        closed,
      });
      const next = addNodeToDocument(doc, id, node);
      documentRef.current = next;
      dispatch(pushEditorHistory());
      dispatch(setDocumentFromCanvas(next));
      // Close / Enter finish — keep pen tool so the next click starts a new path.
      dispatch(setSelectedNodeIds([id]));
    },
    [dispatch, readOnly, penStrokeColor, penStrokeWidth]
  );

  const onPenPathEditCommit = useCallback(
    (payload: {
      nodeId: string;
      pathD: string;
      box: { left: number; top: number; width: number; height: number };
      closed: boolean;
    }) => {
      const doc = documentRef.current;
      if (!doc || readOnly) return;
      const origin = sceneToDocumentCoords(doc, payload.box.left, payload.box.top);
      const prev = doc.deltaSetLike?.[payload.nodeId];
      const prevType = String(prev?.attrs?.shapeType || 'path');
      const shapeType = prevType === 'pen' ? 'pen' : 'path';
      dispatch(pushEditorHistory());
      dispatch(
        patchDocumentNode({
          nodeId: payload.nodeId,
          patch: {
            x: origin.x,
            y: origin.y,
            width: Math.max(1, payload.box.width),
            height: Math.max(1, payload.box.height),
            attrs: {
              shapeType,
              path: payload.pathD,
              closed: payload.closed ? 'true' : 'false',
            },
          },
        })
      );
    },
    [dispatch, readOnly]
  );

  const onPathEditUnionNewShape = useCallback(
    (
      editingId: string,
      addition: {
        pathD: string;
        box: { left: number; top: number; width: number; height: number };
        closed: boolean;
      },
      strokeWidth: number
    ) => {
      const doc = documentRef.current;
      if (!doc || readOnly || !editingId) return;
      const baseNode = doc.deltaSetLike?.[editingId];
      if (!baseNode) return;

      const ink = String(
        baseNode.attrs?.['border-color'] ||
          baseNode.attrs?.stroke ||
          penStrokeColor ||
          '#333333'
      );
      const sw = Math.max(1, Number(strokeWidth) || penStrokeWidth || 2);
      const baseType = String(baseNode.attrs?.shapeType || 'path');
      const basePath = String(baseNode.attrs?.path || baseNode.attrs?.d || '').trim();
      const baseClosed =
        baseNode.attrs?.closed === true ||
        baseNode.attrs?.closed === 'true' ||
        /\sZ\s*$/i.test(basePath);
      // Open stroke pens must stay stroked siblings — boolean-union turns them into
      // fill-only silhouettes (stroke-enabled=false) and they disappear if fill is clear.
      const baseIsOpenStroke =
        baseType === 'pen' || baseType === 'pencil' || !baseClosed;

      if (!addition.closed || baseIsOpenStroke) {
        const origin = sceneToDocumentCoords(doc, addition.box.left, addition.box.top);
        const { id, node } = createShapeNode({
          x: origin.x,
          y: origin.y,
          width: Math.max(1, addition.box.width),
          height: Math.max(1, addition.box.height),
          shapeType: 'pen',
          fill: 'transparent',
          stroke: ink,
          borderWidth: sw,
          path: addition.pathD,
          closed: addition.closed,
        });
        const next = addNodeToDocument(doc, id, node);
        documentRef.current = next;
        dispatch(pushEditorHistory());
        dispatch(setDocument(next));
        dispatch(setSelectedNodeIds([id]));
        dispatch(setSelectedNodeId(id));
        return;
      }

      const { left: bx, top: by } = nodeLeftTop(doc, baseNode);
      if (!basePath) return;

      const baseBox: ShapeBox = {
        left: bx,
        top: by,
        width: Math.max(1, Number(baseNode.width) || 1),
        height: Math.max(1, Number(baseNode.height) || 1),
        shapeType: 'path',
        path: basePath,
        angle: Number(baseNode.attrs?.angle) || 0,
      };

      const addBox: ShapeBox = {
        left: addition.box.left,
        top: addition.box.top,
        width: addition.box.width,
        height: addition.box.height,
        shapeType: 'path',
        path: addition.pathD,
        angle: 0,
      };

      const { result } = computeShapeBoolean([baseBox, addBox], 'union');
      if (!result?.path) return;

      const fillKeep = String(
        baseNode.attrs?.['fill-color'] || baseNode.attrs?.fill || ink
      );
      const origin = sceneToDocumentCoords(doc, result.x, result.y);
      dispatch(pushEditorHistory());
      dispatch(
        patchDocumentNode({
          nodeId: editingId,
          patch: {
            x: origin.x,
            y: origin.y,
            width: Math.max(1, result.width),
            height: Math.max(1, result.height),
            attrs: {
              shapeType: 'path',
              path: result.path,
              closed: 'true',
              'fill-rule': result.fillRule,
              'fill-enabled': 'true',
              'fill-visible': 'true',
              'fill-color': fillKeep === 'transparent' ? ink : fillKeep,
              'fill-type': 'solid',
              'stroke-enabled': 'false',
              'border-width': 0,
            },
          },
        })
      );
      dispatch(setSelectedNodeIds([editingId]));
      dispatch(setSelectedNodeId(editingId));
    },
    [dispatch, readOnly, penStrokeColor, penStrokeWidth]
  );

  const reorderLayer = useCallback(
    (action: 'front' | 'back' | 'forward' | 'backward', ids: string[]) => {
      const doc = documentRef.current;
      if (!doc || !ids.length) return;
      const next = reorderNodesInDocument(doc, ids, action);
      // Reorder only changes z-order — do not bump sceneReloadToken (full remount).
      // Hosts keep their SVG; CSS z-index + DOM order update instead.
      documentRef.current = next;
      dispatch(pushEditorHistory());
      dispatch(setDocumentFromCanvas(next));
    },
    [dispatch]
  );

  const deleteSelected = useCallback(
    (ids: string[]) => {
      if (!ids.length || !documentRef.current) return;
      // Abort in-flight placeholder uploads so finishImageProcess cannot resurrect them.
      ids.forEach((id) => abortNodeUpload(id));
      dispatch(removeDocumentNodes({ nodeIds: ids }));
      // Persist ASAP — refresh must not restore deleted nodes from a stale cloud doc.
      requestProjectFlush();
    },
    [dispatch]
  );

  /**
   * Delete selected nodes and/or artboards in one history step so Undo restores
   * frame + content together (Ctrl+A → Delete must not split into two undos).
   * Upload placeholders are scrubbed from history (not restorable via Undo).
   */
  const deleteCanvasSelection = useCallback(
    (opts?: { nodeIds?: string[]; frameIds?: string[] }) => {
      const doc0 = documentRef.current;
      if (!doc0) return false;
      const nodeIds = opts?.nodeIds ? [...opts.nodeIds] : [...selectedIdsRef.current];
      let frameIds = opts?.frameIds ? [...opts.frameIds] : [...selectedFrameIdsRef.current];
      if (!frameIds.length && !nodeIds.length && activeFrameIdRef.current) {
        frameIds = [activeFrameIdRef.current];
      }
      if (!nodeIds.length && !frameIds.length) return false;

      const inside = frameIds.length ? nodeIdsInsideFrames(doc0, frameIds) : [];
      const allNodes = [...new Set([...nodeIds, ...inside])];
      allNodes.forEach((id) => abortNodeUpload(id));

      dispatch(removeDocumentNodes({ nodeIds: allNodes, frameIds }));
      requestProjectFlush();
      return true;
    },
    [dispatch]
  );


  useCanvasContextMenu({
    readOnly,
    camera,
    artboard,
    viewportEl,
    stageEl,
    paperEl,
    documentRef,
    selectedIdsRef,
    selectedFrameIdsRef,
    activeFrameIdRef,
    hitTest,
    setCtxMenu,
  });

  useChatImageDrop({
    readOnly,
    camera,
    artboard,
    viewportEl,
    stageEl,
    paperEl,
    documentRef,
    imageSizeForViewport,
    finishToSelect,
  });

  const clipboardApiRef = useRef<CanvasClipboardApi | null>(null);

  const runCtxAction = (action: CtxAction) => {
    runCanvasCtxAction(action, {
      getCtxMenu: () => ctxMenu,
      clearCtxMenu: () => setCtxMenu(null),
      selectedIdsRef,
      selectedFrameIdsRef,
      activeFrameIdRef,
      documentRef,
      imagePlaceAtRef,
      imageInputRef,
      clipboardApiRef,
      readOnly: Boolean(readOnly),
      dispatch,
      camera,
      stageEl: stageEl ?? null,
      t,
      onAddToChat: emitAddToChat,
      collabUndo,
      collabRedo,
      deleteCanvasSelection,
      reorderLayer,
    });
  };

  const runCtxActionRef = useRef(runCtxAction);
  runCtxActionRef.current = runCtxAction;

  /** Document x/y so a box of given size is centered on anchor or viewport. */
  const placeOriginForSize = useCallback(
    (
      size: { width: number; height: number },
      anchor?: { x: number; y: number } | null
    ): { x: number; y: number } | null => {
      const doc = documentRef.current;
      if (!doc) return null;
      if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
        const placed = rcbCenterOnPoint({ x: anchor.x, y: anchor.y }, size);
        return sceneToDocumentCoords(doc, placed.left, placed.top);
      }
      const view =
        overlayRoot?.getBoundingClientRect() ||
        paperEl?.parentElement?.getBoundingClientRect() ||
        null;
      if (view && (stageEl || paperEl)) {
        const center = pointerToWorld(
          camera,
          { viewportEl, stageEl, paperEl, artboard },
          view.left + view.width / 2,
          view.top + view.height / 2
        );
        const placed = rcbCenterOnPoint(center, size);
        return sceneToDocumentCoords(doc, placed.left, placed.top);
      }
      return { x: 40, y: 40 };
    },
    [artboard, camera, overlayRoot, paperEl, stageEl, viewportEl]
  );

  const onImageFile = async (file: File | null) => {
    if (!file) return;
    const at = imagePlaceAtRef.current;
    imagePlaceAtRef.current = null;
    try {
      const preview = await readFileAsDataUrl(file);
      const natural = await measureImageNaturalSize(preview);
      const { width, height } = imageSizeForViewport(natural);
      const origin = placeOriginForSize({ width, height }, at);
      dispatch(
        startImageUploadPlaceholder({
          src: preview,
          width,
          height,
          x: origin?.x,
          y: origin?.y,
          label: '上传中',
          name: file.name?.replace(/\.[^.]+$/, '') || 'Image',
        })
      );
      finishToSelect();
      const spawnedId = String(store.getState().editor?.pendingImageProcessId || '');
      const signal = spawnedId ? beginNodeUpload(spawnedId) : undefined;
      try {
        const uploaded = await uploadImageFile(file, { signal });
        if (signal?.aborted) return;
        const remoteReady = await waitForImageReady(uploaded.url, { signal });
        if (signal?.aborted) return;
        dispatch(
          finishImageProcess({
            nodeId: spawnedId || undefined,
            // Keep local preview until the remote URL is fully decoded.
            ...(remoteReady ? { src: uploaded.url } : {}),
            attrs: uploaded.key ? { uploadKey: uploaded.key } : undefined,
          })
        );
      } finally {
        finishNodeUpload(spawnedId);
      }
    } catch (err: unknown) {
      if (isUploadAbortError(err)) return;
      dispatch(failImageProcess({}));
      message.error(getHttpErrorMessage(err, '图片上传失败'));
    }
  };

  const onVideoFile = async (file: File | null) => {
    if (!file) return;
    const at = imagePlaceAtRef.current;
    imagePlaceAtRef.current = null;
    try {
      const prepared = await prepareVideoUploadPreview(file);
      const { width, height } = imageSizeForViewport({
        width: prepared.width,
        height: prepared.height,
      });
      const origin = placeOriginForSize({ width, height }, at);
      dispatch(
        startVideoUploadPlaceholder({
          src: prepared.preview,
          poster: prepared.poster,
          width,
          height,
          x: origin?.x,
          y: origin?.y,
          label: '上传中',
          name: prepared.name,
          duration: prepared.duration,
        })
      );
      finishToSelect();
      const uploaded = await uploadImageFile(file);
      dispatch(
        finishImageProcess({
          src: uploaded.url,
          attrs: {
            ...(uploaded.key ? { uploadKey: uploaded.key } : {}),
            ...(prepared.poster ? { poster: prepared.poster } : {}),
            ...(Number.isFinite(prepared.duration) && prepared.duration > 0
              ? { duration: prepared.duration }
              : {}),
            assetKind: 'video',
          },
        })
      );
    } catch (err: unknown) {
      dispatch(failImageProcess({}));
      message.error(getHttpErrorMessage(err, '视频上传失败'));
    }
  };

  const probeAudioDuration = (src: string): Promise<number | null> =>
    new Promise((resolve) => {
      // Scene `document` prop shadows the DOM global — use window.document.
      const audio = window.document.createElement('audio');
      audio.preload = 'metadata';
      const done = (value: number | null) => {
        audio.removeAttribute('src');
        audio.load();
        resolve(value);
      };
      audio.onloadedmetadata = () => {
        const d = Number(audio.duration);
        done(Number.isFinite(d) && d > 0 ? d : null);
      };
      audio.onerror = () => done(null);
      audio.src = src;
      window.setTimeout(() => done(null), 4000);
    });

  const onAudioFile = async (file: File | null) => {
    if (!file) return;
    const at = imagePlaceAtRef.current;
    imagePlaceAtRef.current = null;
    try {
      const preview = await readFileAsDataUrl(file);
      const duration = (await probeAudioDuration(preview)) || undefined;
      const laid = layoutGeneratorPlateAtScene({
        document: documentRef.current,
        camera,
        stageEl,
        natural: { width: 720, height: 400 },
        center: at,
        fit: { minRatio: 0.22, maxRatio: 0.4 },
      });
      // Place immediately with local preview; swap to remote URL after upload.
      dispatch(
        spawnAudio({
          src: preview,
          width: laid.width,
          height: laid.height,
          x: laid.x,
          y: laid.y,
          name: file.name?.replace(/\.[^.]+$/, '') || t('editor.tools.audio', { defaultValue: 'Audio' }),
          duration,
        })
      );
      finishToSelect();
      const spawnedId = String(store.getState().editor?.selectedNodeId || '');
      const signal = spawnedId ? beginNodeUpload(spawnedId) : undefined;
      try {
        const uploaded = await uploadImageFile(file, { signal });
        if (signal?.aborted) return;
        const url = String(uploaded.url || '').trim();
        if (!url || !spawnedId) return;
        dispatch(
          patchDocumentNode({
            nodeId: spawnedId,
            patch: {
              attrs: {
                src: url,
                ...(uploaded.key ? { uploadKey: uploaded.key } : {}),
                ...(duration ? { duration: duration } : {}),
              },
            },
          })
        );
      } finally {
        finishNodeUpload(spawnedId);
      }
    } catch (err: unknown) {
      if (isUploadAbortError(err)) return;
      message.error(getHttpErrorMessage(err, '音频上传失败'));
    }
  };

  const onLottiePaste = async (payload: {
    animationData: Record<string, unknown>;
    name?: string;
    anchor?: { x: number; y: number } | null;
  }) => {
    const data = parseLottieAnimationData(payload.animationData);
    if (!data) {
      message.error(t('editor.tools.lottieGenInvalidJson'));
      return;
    }
    const natW = Math.max(1, Math.round(Number(data.w) || 200));
    const natH = Math.max(1, Math.round(Number(data.h) || 200));
    const { width, height } = imageSizeForViewport({ width: natW, height: natH });
    const origin = placeOriginForSize({ width, height }, payload.anchor ?? null);
    dispatch(
      spawnLottie({
        animationData: data,
        width,
        height,
        x: origin?.x,
        y: origin?.y,
        name: payload.name || t('editor.tools.lottie'),
      })
    );
    finishToSelect();
  };

  const onLottieFile = async (file: File | null) => {
    if (!file) return;
    const at = imagePlaceAtRef.current;
    imagePlaceAtRef.current = null;
    try {
      const text = await file.text();
      const animationData = parseLottieAnimationData(text);
      if (!animationData) throw new Error('invalid lottie');
      await onLottiePaste({
        animationData,
        name: file.name?.replace(/\.json$/i, '') || undefined,
        anchor: at,
      });
    } catch {
      message.error(t('editor.tools.lottieGenInvalidJson'));
    }
  };

  const onMediaFile = (file: File | null) => {
    if (!file) return;
    const mime = (file.type || '').toLowerCase();
    const name = file.name || '';
    if (mime.startsWith('video/')) {
      onVideoFile(file);
      return;
    }
    if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) {
      void onAudioFile(file);
      return;
    }
    if (mime === 'application/json' || mime === 'text/json' || /\.json$/i.test(name)) {
      void onLottieFile(file);
      return;
    }
    onImageFile(file);
  };


  const clipboardApi = useCanvasClipboard({
    readOnly,
    artboardWidth: artboard?.width,
    documentRef,
    selectedIdsRef,
    selectedFrameIdsRef,
    activeFrameIdRef,
    clipboardRef,
    internalClipboardAtRef,
    osClipboardMetaRef,
    imagePlaceAtRef,
    deleteCanvasSelection,
    placeOriginForSize,
    finishToSelect,
    onImageFile,
    onVideoFile,
    onAudioFile,
    onLottiePaste,
  });
  clipboardApiRef.current = clipboardApi;

  useCanvasHotkeys({
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
    copySelected: clipboardApi.copySelected,
    cutSelected: clipboardApi.cutSelected,
    duplicateSelected: clipboardApi.duplicateSelected,
    onAddToChat: emitAddToChat,
  });

  const bgType = parseFillType(document?.backgroundFillType);
  const bgOpacity = Number(document?.backgroundOpacity ?? 100);
  const bgColor = String(document?.backgroundColor || '#ffffff');
  let paperBackground = cssSolidWithOpacity(bgColor, bgOpacity);
  if (bgType === 'image') {
    const src = String(document?.backgroundImageSrc || '');
    if (src) paperBackground = `url(${src}) center / cover no-repeat`;
  } else if (bgType !== 'solid') {
    paperBackground = cssPreviewForGradient(
      {
        ...parseFillGradient(
          document?.backgroundGradient,
          bgType,
          String(document?.backgroundColor || '#3B82F6')
        ),
        type: bgType,
      },
      bgOpacity
    );
  }

  const ids = useMemo(() => {
    if (selectedNodeIds?.length > 0) return selectedNodeIds;
    if (selectedNodeId) return [selectedNodeId];
    return EMPTY_NODE_IDS;
  }, [selectedNodeIds, selectedNodeId]);

  const keepVisibleIds = useMemo(() => {
    const out = [...ids];
    if (editingTextId) out.push(editingTextId);
    if (editingPenId) out.push(editingPenId);
    return out;
  }, [ids, editingTextId, editingPenId]);

  /** Editors need full SVG; selection alone must stay LOD while zoomed out. */
  const forceFullIds = useMemo(() => {
    const out: string[] = [];
    if (editingTextId) out.push(editingTextId);
    if (editingPenId) out.push(editingPenId);
    return out;
  }, [editingTextId, editingPenId]);

  // Path-edit stays open on empty selection (blank click must not dismiss).
  // Only leave when the user selects a *different* node.
  useEffect(() => {
    if (!editingPenId) return;
    if (!ids.length) return;
    if (!ids.includes(editingPenId)) setEditingPenId(null);
  }, [editingPenId, ids]);

  // Outline / toolbar: enter path-edit chrome for a node.
  useEffect(() => {
    const onEnter = (e: Event) => {
      const nodeId = String((e as CustomEvent).detail?.nodeId || '');
      if (!nodeId || readOnly) return;
      setEditingTextId(null);
      setEditingPenId(nodeId);
      dispatch(setSelectedNodeIds([nodeId]));
      dispatch(setActiveTool('select'));
      // Outline / enter path-edit: default to Select (edit anchors), not Pen (draw).
      setPathEditSubtool('select');
      window.dispatchEvent(
        new CustomEvent('resume:path-edit-subtool', { detail: { subtool: 'select' } })
      );
    };
    window.addEventListener('resume:enter-path-edit', onEnter);
    return () => window.removeEventListener('resume:enter-path-edit', onEnter);
  }, [dispatch, readOnly]);

  useEffect(() => {
    const onSub = (e: Event) => {
      const s = (e as CustomEvent).detail?.subtool;
      if (s === 'pen') setPathEditSubtool('pen');
      else if (s === 'curve') setPathEditSubtool('curve');
      else setPathEditSubtool('select');
    };
    window.addEventListener('resume:path-edit-subtool', onSub);
    return () => window.removeEventListener('resume:path-edit-subtool', onSub);
  }, []);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('resume:path-edit', { detail: { active: Boolean(editingPenId) } })
    );
    return () => {
      if (editingPenId) {
        window.dispatchEvent(new CustomEvent('resume:path-edit', { detail: { active: false } }));
      }
    };
  }, [editingPenId]);

  // Path-edit ink is painted on the overlay canvas; host is forceHidden via
  // RcbShapesLayer (same gate as inline text edit) so the committed SVG does
  // not ghost under the live path.

  // Select / inspect: share preview is readOnly — always allow hit-test + chrome
  // (workspaceMode may briefly lag behind 'dev'). Path-edit owns the pointer
  // (anchors / draft pen) — do not let SelectionFeature clear selection on empty
  // click (that unmounts path-edit and looks like “auto exit”).
  const selectToolActive = activeTool === 'select' || activeTool === 'scale';
  const selectMode = selectToolActive && !editingPenId;
  const shapeMode = !readOnly && activeTool === 'shape';
  const textMode = !readOnly && activeTool === 'text';
  const imageMode = !readOnly && activeTool === 'image';
  const pencilMode = !readOnly && activeTool === 'pencil';
  const penMode = !readOnly && activeTool === 'pen';

  return (
    <div className={embedded ? 'contents' : 'relative rcb-canvas-stage'}>
      <SvgPaper
        paperRef={paperRef}
        hostRef={hostRef}
        width={paperW}
        height={paperH}
        infinite={infinite}
        background={embedded ? 'transparent' : paperBackground}
        className={
          embedded
            ? 'rcb-shapes relative overflow-visible'
            : 'rcb-canvas-paper relative shadow-[0_8px_40px_rgba(15,23,42,0.12)] ring-1 ring-black/5'
        }
      >
        {infinite ? (
          <RcbShapesLayer
            document={document}
            reloadToken={reloadToken}
            documentPatchToken={documentPatchToken}
            lastPatchedNodeIds={lastPatchedNodeIds}
            hiddenNodeId={editingTextId || editingPenId}
            keepVisibleIds={keepVisibleIds}
            forceFullIds={forceFullIds}
            spatialIndex={nodeSpatialIndex}
          />
        ) : null}
        {/* HTML <video>/Lottie live in SVG foreignObject — keep visible during
            transform (same as audio). FO rides previewSvgNodeGeometry with the
            node; hiding globally made unrelated image drags blank every video. */}
        {infinite ? (
          <VideoNodeOverlay
            document={document}
            geometryOverrides={videoLiveGeom}
          />
        ) : null}
        {infinite ? (
          <LottieNodeOverlay
            document={document}
            geometryOverrides={videoLiveGeom as Record<string, LottieGeomOverride> | null}
          />
        ) : null}
        {infinite ? (
          <AudioNodeOverlay
            document={document}
            // Keep HTML waveform during drag — SVG underlay is plate-only (no poster).
            geometryOverrides={videoLiveGeom as Record<string, AudioGeomOverride> | null}
          />
        ) : null}
        {/* Scene-space HTML overlays (selection / draw previews). Origin matches SVG. */}
        {/* Above frame/node stackOrder so preview select/hover strokes aren't covered. */}
        {/* Above HostPathChrome (z=1e6) so poly/star/radius knobs receive hits
            over resize hotzones; wrapper is 0脳0 + overflow visible, empty areas
            still pass through to chrome / shapes. */}
        <div className="absolute left-0 top-0 z-[1000001] h-0 w-0 overflow-visible">
          <SelectionFeature
            enabled={selectMode}
            readOnly={readOnly}
            attachPickActive={Boolean(canvasAttachPick)}
            document={document}
            selectedNodeIds={ids}
            selectedFrameIds={selectedFrameIds}
            paperEl={paperEl}
            stageEl={stageEl}
            artboard={artboard}
            onSelect={onSelect}
            onGeometryCommit={onGeometryCommit}
            onGeometryPreview={onGeometryPreview}
            onAngleCommit={onAngleCommit}
            onAnglePreview={onAnglePreview}
            hitTest={hitTest}
            hitTestFrame={hitTestFrame}
            onSelectFrame={onSelectFrame}
            onSelectFrames={onSelectFrames}
            onSelectMixed={onSelectMixed}
            getNodeBox={getNodeBox}
            listNodeIds={listNodeIds}
            queryNodeIdsInRect={queryNodeIdsInRect}
            onOpenAgent={onOpenAgent}
            onEditText={(id) => {
              setEditingPenId(null);
              setEditingTextId(id);
            }}
            onEditPenPath={(id) => {
              setEditingTextId(null);
              setEditingPenId(id);
              setPathEditSubtool('select');
              window.dispatchEvent(
                new CustomEvent('resume:path-edit-subtool', { detail: { subtool: 'select' } })
              );
            }}
            suppressChrome={
              Boolean(editingTextId) ||
              Boolean(editingPenId) ||
              cropExpandOpen ||
              imageToolSidePanelOpen ||
              videoToolOpen ||
              audioToolOpen ||
              // Keep chrome while editing radius so the outline can follow rounded corners.
              (shapeStylePanelOpen && shapeStylePanel?.kind !== 'radius')
            }
            onTransformingChange={onGeometryTransformingChange}
          />
          <ImageProcessOverlay document={document} hidden={geometryTransforming} />
          {!omitNonExportable ? (
            <>
              <ImageGeneratorOverlay
                document={document}
                hidden={geometryTransforming}
                readOnly={readOnly}
              />
              <VideoGeneratorOverlay
                document={document}
                hidden={geometryTransforming}
                readOnly={readOnly}
              />
              <LottieGeneratorOverlay
                document={document}
                hidden={geometryTransforming}
                readOnly={readOnly}
                geometryOverrides={
                  videoLiveGeom as Record<
                    string,
                    { left: number; top: number; width: number; height: number }
                  > | null
                }
              />
              <AudioGeneratorOverlay
                document={document}
                hidden={geometryTransforming}
                readOnly={readOnly}
              />
            </>
          ) : null}
          <ShapeDrawFeature
            enabled={shapeMode}
            shapeKind={shapeKind || 'rect'}
            artboard={artboard}
            paperEl={paperEl}
            stageEl={stageEl}
            onCreate={onCreateShape}
            // Draw always snaps to the document grid; overlay visibility is separate.
            gridSnap
            gridSize={getDocumentGridSize(document)}
          />
          <TextPlaceFeature
            enabled={textMode}
            artboard={artboard}
            paperEl={paperEl}
            stageEl={stageEl}
            onPlace={onPlaceText}
          />
          <ImagePlaceFeature
            enabled={imageMode}
            artboard={artboard}
            paperEl={paperEl}
            stageEl={stageEl}
            pendingSrc={pendingImageSrc}
            onPlace={placeImageAt}
          />
          <PencilDrawFeature
            enabled={pencilMode}
            artboard={artboard}
            paperEl={paperEl}
            stageEl={stageEl}
            strokeColor={penStrokeColor}
            strokeWidth={penStrokeWidth}
            strokeOpacity={penStrokeOpacity / 100}
            brushId={pencilBrushId}
            pressureEnabled={pencilPressureEnabled}
            hardness={pencilHardness}
            eraseMode={pencilEraseMode}
            eraseTargets={pencilEraseTargets}
            onCommit={onPencilCommit}
            onErase={onPencilErase}
          />
          <BucketFillFeature
            enabled={!readOnly && activeTool === 'bucket'}
            artboard={artboard}
            paperEl={paperEl}
            stageEl={stageEl}
            fillColor={String(bucketFill.fillColor || '#333333')}
            hitTest={hitTest}
            onFill={onBucketFill}
          />
          <PenDrawFeature
            enabled={penMode && !editingPenId}
            artboard={artboard}
            paperEl={paperEl}
            stageEl={stageEl}
            strokeColor={penStrokeColor}
            strokeWidth={penStrokeWidth}
            gridSnap
            gridSize={getDocumentGridSize(document)}
            onCommit={onPenCommit}
            onCancel={finishToSelect}
            hitTest={hitTest}
            document={document}
            onEditExistingPath={(id) => {
              setEditingTextId(null);
              setEditingPenId(id);
              setPathEditSubtool('select');
              window.dispatchEvent(
                new CustomEvent('resume:path-edit-subtool', { detail: { subtool: 'select' } })
              );
              dispatch(setActiveTool('select'));
            }}
          />
          {editingPenId ? (
            <PenPathEditFeature
              enabled={!readOnly}
              nodeId={editingPenId}
              document={document}
              paperEl={paperEl}
              stageEl={stageEl}
              drawNewShapeMode={pathEditSubtool === 'pen'}
              convertPointMode={pathEditSubtool === 'curve'}
              newStrokeColor={penStrokeColor}
              newStrokeWidth={penStrokeWidth}
              gridSnap
              gridSize={getDocumentGridSize(document)}
              onCommitNewShape={({ pathD, box, closed }) => {
                if (!editingPenId) return;
                onPathEditUnionNewShape(editingPenId, { pathD, box, closed }, penStrokeWidth);
              }}
              onCommit={onPenPathEditCommit}
              onExit={() => setEditingPenId(null)}
            />
          ) : null}
        </div>
      </SvgPaper>

      {editingTextId ? (
        <TextInlineEditor
          document={document}
          nodeId={editingTextId}
          onCommit={onTextEditCommit}
          onLiveSize={onTextLiveSize}
          onCancel={onTextEditCancel}
        />
      ) : null}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*,video/*,audio/*,.json,application/json"
        className="hidden"
        onChange={(e) => {
          onMediaFile(e.target.files?.[0] || null);
          e.target.value = '';
        }}
      />

      <CanvasContextMenu
        menu={ctxMenu}
        hasNode={Boolean(
          ids.length ||
            ctxMenu?.nodeId ||
            selectedFrameIds.length ||
            ctxMenu?.frameId ||
            activeFrameId
        )}
        canReplace={ctxMenuCanReplace({
          readOnly,
          document,
          ids,
          ctxNodeId: ctxMenu?.nodeId,
        })}
        canAddToChat={(() => {
          const targetIds = resolveSelectionNodeIds(
            document,
            ctxMenuSeedNodeIds(ids, ctxMenu?.nodeId),
            ctxMenuSeedFrameIds(selectedFrameIds, ctxMenu?.frameId)
          );
          if (targetIds.length) {
            return filterChatAttachNodeIds(document, targetIds).length > 0;
          }
          return Boolean(ctxMenu?.frameId || activeFrameId);
        })()}
        canDelete={Boolean(
          ids.length ||
            ctxMenu?.nodeId ||
            ctxMenu?.frameId ||
            selectedFrameIds.length ||
            activeFrameId
        )}
        canLayerActions={Boolean(
          ids.length || ctxMenu?.nodeId || ctxMenu?.frameId || selectedFrameIds.length || activeFrameId
        )}
        canExport={ctxMenuCanExport({
          document,
          ids,
          selectedFrameIds,
          ctxNodeId: ctxMenu?.nodeId,
          ctxFrameId: ctxMenu?.frameId,
          activeFrameId,
        })}
        canToggleHidden={(() => {
          const targetIds = ctxMenuSeedNodeIds(ids, ctxMenu?.nodeId);
          if (!targetIds.length) return false;
          // Generators have no hide — same as export.
          return targetIds.some((id) => !isGeneratorNode(document?.deltaSetLike?.[id]));
        })()}
        canToggleLocked={(() => {
          const targetIds = ctxMenuSeedNodeIds(ids, ctxMenu?.nodeId);
          if (targetIds.length) {
            return targetIds.some((id) => !isGeneratorNode(document?.deltaSetLike?.[id]));
          }
          return Boolean(
            ctxMenu?.frameId || selectedFrameIds.length || activeFrameId
          );
        })()}
        canGroup={(() => {
          const targetIds = resolveSelectionNodeIds(
            document,
            ctxMenuSeedNodeIds(ids, ctxMenu?.nodeId),
            ctxMenuSeedFrameIds(selectedFrameIds, ctxMenu?.frameId)
          );
          if (targetIds.length < 2) return false;
          return !selectionSharedGroupId(document, targetIds);
        })()}
        canUngroup={(() => {
          const targetIds = resolveSelectionNodeIds(
            document,
            ctxMenuSeedNodeIds(ids, ctxMenu?.nodeId),
            ctxMenuSeedFrameIds(selectedFrameIds, ctxMenu?.frameId)
          );
          if (targetIds.length < 2) return false;
          return Boolean(selectionSharedGroupId(document, targetIds));
        })()}
        targetHidden={(() => {
          const targetIds = ctxMenuSeedNodeIds(ids, ctxMenu?.nodeId);
          if (!targetIds.length) return false;
          return targetIds.every((id) => isNodeHidden(document?.deltaSetLike?.[id]));
        })()}
        targetLocked={(() => {
          const targetIds = ctxMenuSeedNodeIds(ids, ctxMenu?.nodeId);
          if (targetIds.length) {
            return targetIds.every((id) => isNodeLocked(document?.deltaSetLike?.[id]));
          }
          const fid = ctxMenu?.frameId || activeFrameId;
          if (!fid) return false;
          const frame = (Array.isArray(document?.frames) ? document.frames : []).find(
            (f) => f?.id === fid
          );
          return Boolean(frame?.locked);
        })()}
        exportKind={(() => {
          const targetIds = resolveSelectionNodeIds(
            document,
            ctxMenuSeedNodeIds(ids, ctxMenu?.nodeId),
            ctxMenuSeedFrameIds(selectedFrameIds, ctxMenu?.frameId)
          );
          if (!targetIds.length) return 'image';
          const allVideo = targetIds.every((id) => {
            const node = document?.deltaSetLike?.[id];
            return isVideoNode(node) && Boolean(String(node?.attrs?.src || '').trim());
          });
          return allVideo ? 'video' : 'image';
        })()}
        canUndo={canUndo}
        canRedo={canRedo}
        canPaste
        modLabel={modLabel}
        onAction={runCtxAction}
        onClose={() => setCtxMenu(null)}
      />
    </div>
  );
}

export default memo(SvgCanvas);
