/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/canvas/canvasSession.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Canvas write / hit / geometry session — imperative API used by SvgCanvas.
 */
import type { Dispatch } from '@reduxjs/toolkit';
import {
  addNodeToDocument,
  patchDeltaSetLike,
} from '@recombyn-native/components/rcb/scene/document/sceneDocument';
import {
  createImageNode,
  createShapeNode,
  createTextNode,
  fitImageSize,
  measureImageNaturalSize,
} from '@recombyn-native/components/rcb/scene/document/nodeFactories';
import {
  isAudioNode,
  isLottieNode,
  isVideoNode,
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import {
  STROKE_HIT,
  sceneHitSlop,
  strokeNodeFromEndpoints,
} from '@recombyn-native/components/rcb/scene/document/sceneShapes';
import {
  deflateSelectionBox,
  inflateSelectionBox,
} from '@recombyn-native/components/rcb/scene/document/sceneEffects';
import { hitTestSceneAtPoint } from '@recombyn-native/components/rcb/scene/document/sceneHitBridge';
import {
  parseNodeText,
  parseNodeTextStyle,
} from '@recombyn-native/components/rcb/scene/document/sceneText';
import {
  clearSceneDragPreview,
  dedupeSceneNode,
  nodeLeftTop,
  previewSvgNodeAngle,
  previewSvgNodeGeometry,
  purgeOrphanSceneNodes,
} from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import { patchNodesGeometry, sceneToDocumentCoords } from '@recombyn-native/components/rcb/scene/paint/svgToScene';
import type { SceneSpatialRuntime } from '@recombyn-native/components/rcb/core/spatialIndex';
import { getShapeHost, replaceShapePaint, type SvgBoardHandle } from '@recombyn-native/components/rcb';
import {
  rcbCenterOnPoint,
  rcbDefaultPlaceFontSize,
  rcbFitImageIntoViewport,
  rcbLayoutGeneratorPlate,
  GENERATOR_EMPTY_STROKE_OUTSET,
  getDocumentGridSize,
  snapCoordToGrid,
} from '@recombyn-native/components/rcb';
import { parseFrameSelId } from '@recombyn-native/components/rcb/selection/frameSelectionIds';
import type { VideoGeomOverride } from '@recombyn-native/components/editor/nodes/VideoNode/VideoNodeOverlay';
import type { createDragWriteCoalescer } from './dragWriteCoalescer';
import {
  patchDocumentNode,
  pushEditorHistory,
  setActiveTool,
  setDocument,
  setDocumentFromCanvas,
  setPendingImageSrc,
  setSelectedNodeId,
  setSelectedNodeIds,
} from '@recombyn-native/store/modules/editor';
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';

type DragWriteCoalescer = ReturnType<typeof createDragWriteCoalescer>;

export type SceneBox = { left: number; top: number; width: number; height: number };

export type GeomPatch = {
  nodeId: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Fit generator plate to viewport, center on scene click (or fallback), snap to grid. */
export function layoutGeneratorPlateAtScene(opts: {
  document: SceneDocument | null | undefined;
  camera: { zoom?: number };
  stageEl: HTMLElement | null;
  natural: { width: number; height: number };
  center: { x: number; y: number } | null;
  fit?: { minRatio?: number; maxRatio?: number };
}): { x: number; y: number; width: number; height: number } {
  const doc = opts.document;
  const fallback = { x: 40, y: 40, width: 360, height: 360 };
  if (!doc) return fallback;
  const view = opts.stageEl?.getBoundingClientRect();
  const zoom = Math.max(0.05, Number(opts.camera?.zoom) || 1);
  const center =
    opts.center && Number.isFinite(opts.center.x) && Number.isFinite(opts.center.y)
      ? opts.center
      : { x: 40 + fallback.width / 2, y: 40 + fallback.height / 2 };
  if (!view || view.width <= 0 || view.height <= 0) {
    const origin = sceneToDocumentCoords(
      doc,
      center.x - fallback.width / 2,
      center.y - fallback.height / 2
    );
    return { ...fallback, x: origin.x, y: origin.y };
  }
  const laid = rcbLayoutGeneratorPlate({
    natural: opts.natural,
    viewport: { width: view.width, height: view.height },
    zoom,
    center,
    gridSize: getDocumentGridSize(doc),
    visualOutset: GENERATOR_EMPTY_STROKE_OUTSET,
    fit: opts.fit,
  });
  const origin = sceneToDocumentCoords(doc, laid.left, laid.top);
  return { x: origin.x, y: origin.y, width: laid.width, height: laid.height };
}

export function listNodeIdsFromDoc(doc: SceneDocument | null | undefined): readonly string[] {
  const page = doc?.pages?.find((p) => p.id === doc?.activePageId) || doc?.pages?.[0];
  const fromPage = page?.children;
  // Return live children — never copy O(N) on every hit/guides call.
  if (Array.isArray(fromPage) && fromPage.length) return fromPage;
  const rootKids = doc?.deltaSetLike?.ROOT?.children;
  return Array.isArray(rootKids) ? rootKids : [];
}

export function getNodeBoxFromDoc(doc: SceneDocument | null | undefined, nodeId: string): SceneBox | null {
  const node = doc?.deltaSetLike?.[nodeId];
  if (!node) return null;
  const { left, top } = nodeLeftTop(doc, node);
  const geom: SceneBox = {
    left,
    top,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
  // Control box = path + stroke visual outer (resize / rotate follow ink).
  return inflateSelectionBox(geom, node);
}

/** Persist chrome box → stored path geometry. */
export function toGeometryPatches(doc: SceneDocument | null | undefined, patches: GeomPatch[]): GeomPatch[] {
  return patches.map((p) => {
    const node = doc?.deltaSetLike?.[p.nodeId];
    const deflated = deflateSelectionBox(p, node);
    return {
      ...p,
      left: deflated.left,
      top: deflated.top,
      width: deflated.width,
      height: deflated.height,
    };
  });
}

/** Line/arrow keep a fixed hit height — length changes via width only. */
export function normalizeGeomPatches(doc: SceneDocument | null | undefined, patches: GeomPatch[]): GeomPatch[] {
  return patches.map((p) => {
    const t = String(doc?.deltaSetLike?.[p.nodeId]?.attrs?.shapeType || '');
    if (t !== 'line' && t !== 'arrow') return p;
    const midY = p.top + p.height / 2;
    return {
      ...p,
      height: STROKE_HIT,
      top: midY - STROKE_HIT / 2,
      width: Math.max(1, p.width),
    };
  });
}

export function hitTestFrameInDoc(doc: SceneDocument | null | undefined, x: number, y: number): string | null {
  const frames = Array.isArray(doc?.frames) ? doc.frames : [];
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i];
    if (!frame || frame.locked || frame.hidden) continue;
    const fx = Number(frame.x) || 0;
    const fy = Number(frame.y) || 0;
    const fw = Math.max(1, Number(frame.width) || 1);
    const fh = Math.max(1, Number(frame.height) || 1);
    if (x >= fx && x <= fx + fw && y >= fy && y <= fy + fh) {
      return String(frame.id);
    }
  }
  return null;
}

export type CanvasSessionDeps = {
  getDocument: () => SceneDocument | null;
  setDocumentLocal: (doc: SceneDocument) => void;
  getBoard: () => SvgBoardHandle | null;
  getZoom: () => number;
  isReadOnly: () => boolean;
  dispatch: Dispatch<any>;
  spatial: SceneSpatialRuntime;
  setEditingTextId: (id: string | null) => void;
  measureViewport: () => DOMRect | null;
  getDragWriteCoalescer: () => DragWriteCoalescer;
  getFrameGeomHistoryPushed: () => boolean;
  setFrameGeomHistoryPushed: (next: boolean) => void;
  publishVideoLiveGeom: (next: Record<string, VideoGeomOverride> | null) => void;
  clearVideoLiveGeom: () => void;
};

export type ShapeCreateBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
};

export type CanvasSession = {
  listNodeIds: () => readonly string[];
  getNodeBox: (nodeId: string) => SceneBox | null;
  hitTest: (
    x: number,
    y: number,
    screen?: { clientX: number; clientY: number }
  ) => string | null;
  hitTestFrame: (x: number, y: number) => string | null;
  queryNodeIdsInRect: (box: SceneBox) => string[];
  finishToSelect: () => void;
  onCreateShape: (kind: string, box: ShapeCreateBox) => void;
  onPlaceText: (point: { x: number; y: number; width?: number; autoSize?: boolean }) => void;
  imageSizeForViewport: (natural: { width: number; height: number }) => {
    width: number;
    height: number;
  };
  placeImageAt: (src: string, x: number, y: number) => Promise<void>;
  onGeometryCommit: (
    patches: GeomPatch[],
    options?: { textResizeMode?: 'scale' | 'wrap'; skipHistory?: boolean }
  ) => void;
  onGeometryPreview: (
    patches: GeomPatch[],
    options?: { textResizeMode?: 'scale' | 'wrap' }
  ) => void;
  onAngleCommit: (nodeId: string, angleDeg: number, options?: { skipHistory?: boolean }) => void;
  onAnglePreview: (nodeId: string, angleDeg: number) => void;
};

export function createCanvasSession(deps: CanvasSessionDeps): CanvasSession {
  const listNodeIds = () => listNodeIdsFromDoc(deps.getDocument());

  const getNodeBox = (nodeId: string) => getNodeBoxFromDoc(deps.getDocument(), nodeId);

  const hitTest = (
    x: number,
    y: number,
    screen?: { clientX: number; clientY: number }
  ) => {
    const doc = deps.getDocument();
    const board = deps.getBoard();
    const zoom = Math.max(0.05, deps.getZoom() || 1);
    const pad = sceneHitSlop(zoom);
    const allIds = listNodeIds();
    const order = deps.spatial.hitCandidateIds({
      x,
      y,
      pad: pad + 64 / zoom,
      allIds,
    });
    return hitTestSceneAtPoint({
      document: doc,
      order,
      x,
      y,
      zoom,
      screen,
      getNodeBox,
      nodeEls: board?.nodeEls ?? null,
    });
  };

  const hitTestFrame = (x: number, y: number) => hitTestFrameInDoc(deps.getDocument(), x, y);

  const queryNodeIdsInRect = (box: SceneBox) =>
    deps.spatial.queryIdsInRect(box, { ascending: true });

  const finishToSelect = () => {
    deps.dispatch(setActiveTool('select'));
  };

  const onCreateShape = (kind: string, box: ShapeCreateBox) => {
    const doc = deps.getDocument();
    if (!doc || deps.isReadOnly()) return;
    const isStroke = kind === 'line' || kind === 'arrow';

    if (isStroke && box.x0 != null && box.y0 != null && box.x1 != null && box.y1 != null) {
      const a = sceneToDocumentCoords(doc, box.x0, box.y0);
      const b = sceneToDocumentCoords(doc, box.x1, box.y1);
      const placed = strokeNodeFromEndpoints({
        x0: a.x,
        y0: a.y,
        x1: b.x,
        y1: b.y,
      });
      const { id, node } = createShapeNode({
        x: placed.x,
        y: placed.y,
        width: placed.width,
        height: placed.height,
        shapeType: kind,
        fill: 'transparent',
        angle: placed.angle,
      });
      const next = addNodeToDocument(doc, id, node);
      deps.setDocumentLocal(next);
      // History without sceneReloadToken — remounting every host caused a one-frame jump.
      deps.dispatch(pushEditorHistory());
      deps.dispatch(setDocumentFromCanvas(next));
      deps.dispatch(setSelectedNodeIds([id]));
      deps.dispatch(setSelectedNodeId(id));
      finishToSelect();
      return;
    }

    // Circles / regular polygons / stars are already squared in ShapeDrawFeature
    // (visual→geom). Do NOT Math.max(3, size) here — that inflated geom 2→3 and
    // made committed ink jump from visual 3×3 to 4×4 after center stroke.
    const origin = sceneToDocumentCoords(doc, box.left, box.top);
    const { id, node } = createShapeNode({
      x: origin.x,
      y: origin.y,
      width: box.width,
      height: box.height,
      shapeType: kind,
      fill: '#FFFFFF',
    });
    const next = addNodeToDocument(doc, id, node);
    deps.setDocumentLocal(next);
    deps.dispatch(pushEditorHistory());
    deps.dispatch(setDocumentFromCanvas(next));
    deps.dispatch(setSelectedNodeIds([id]));
    deps.dispatch(setSelectedNodeId(id));
    finishToSelect();
  };

  const onPlaceText = (point: { x: number; y: number; width?: number; autoSize?: boolean }) => {
    const doc = deps.getDocument();
    if (!doc || deps.isReadOnly()) return;
    const autoSize = point.autoSize !== false;
    const gridSize = getDocumentGridSize(doc);
    const zoom = Math.max(0.05, deps.getZoom() || 1);
    // Screen-constant ~14px so 3000% zoom does not spawn document-14 glyphs.
    const fontSize = rcbDefaultPlaceFontSize(zoom, 14);
    const origin = sceneToDocumentCoords(
      doc,
      snapCoordToGrid(point.x, gridSize),
      snapCoordToGrid(point.y, gridSize)
    );
    const fixedW = autoSize
      ? 2
      : Math.max(gridSize, snapCoordToGrid(Math.max(gridSize, point.width || 160), gridSize));
    const { id, node } = createTextNode({
      x: origin.x,
      y: origin.y,
      text: '',
      width: fixedW,
      // Height comes from measured font metrics — do not hardcode 20.
      autoSize,
      fontSize,
    });
    const next = addNodeToDocument(doc, id, node);
    deps.setDocumentLocal(next);
    deps.dispatch(setDocument(next));
    deps.dispatch(setSelectedNodeIds([id]));
    deps.dispatch(setSelectedNodeId(id));
    deps.setEditingTextId(id);
    finishToSelect();
  };

  const imageSizeForViewport = (natural: { width: number; height: number }) => {
    const view = deps.measureViewport();
    if (!view || view.width < 1 || view.height < 1) {
      return fitImageSize(natural.width, natural.height, 2400);
    }
    return rcbFitImageIntoViewport(natural, view, deps.getZoom());
  };

  const placeImageAt = async (src: string, x: number, y: number) => {
    if (deps.isReadOnly()) return;
    try {
      const natural = await measureImageNaturalSize(src);
      const { width, height } = imageSizeForViewport(natural);
      const latest = deps.getDocument();
      if (!latest) return;
      const placed = rcbCenterOnPoint({ x, y }, { width, height });
      const origin = sceneToDocumentCoords(latest, placed.left, placed.top);
      const { id, node } = createImageNode({
        x: origin.x,
        y: origin.y,
        width: placed.width,
        height: placed.height,
        src,
      });
      deps.dispatch(setDocument(addNodeToDocument(latest, id, node)));
      deps.dispatch(setSelectedNodeId(id));
      deps.dispatch(setPendingImageSrc(null));
      finishToSelect();
    } catch {
      deps.dispatch(setPendingImageSrc(null));
      finishToSelect();
    }
  };

  const applyFrameGeometryPatches = (
    patches: GeomPatch[],
    opts?: { preview?: boolean }
  ) => {
    const nodePatches: GeomPatch[] = [];
    const frames: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
    for (const p of patches) {
      const fid = parseFrameSelId(p.nodeId);
      if (fid) {
        frames.push({
          id: fid,
          x: p.left,
          y: p.top,
          width: Math.max(1, p.width),
          height: Math.max(1, p.height),
        });
      } else {
        nodePatches.push(p);
      }
    }
    if (!frames.length) return { nodePatches, frames };
    // Live preview only — commit merges frames into the document object below.
    if (opts?.preview) {
      // Push pre-gesture doc before the first Redux frame write (same as title-bar
      // onFrameMoveStart). Nodes are still pre-gesture in Redux during preview.
      if (!deps.getFrameGeomHistoryPushed()) {
        deps.dispatch(pushEditorHistory());
        deps.setFrameGeomHistoryPushed(true);
      }
      deps.getDragWriteCoalescer().queueFrames(frames);
    }
    return { nodePatches, frames };
  };

  const onGeometryCommit = (
    patches: GeomPatch[],
    options?: { textResizeMode?: 'scale' | 'wrap'; skipHistory?: boolean }
  ) => {
    // Drop coalesced frame previews — commit writes the final document once.
    deps.getDragWriteCoalescer().cancel();
    const doc = deps.getDocument();
    const board = deps.getBoard();
    if (!doc || deps.isReadOnly() || !patches.length) return;
    const { nodePatches, frames } = applyFrameGeometryPatches(patches);
    let next = doc;
    if (nodePatches.length) {
      const normalized = normalizeGeomPatches(doc, toGeometryPatches(doc, nodePatches));
      next = patchNodesGeometry(doc, normalized, {
        fitTextBox: true,
        textResizeMode: options?.textResizeMode,
      });
      // Sync SVG for node patches (below). Keep normalized in scope via rebuild from next.
      deps.setDocumentLocal(next);
      if (board) {
        normalized.forEach((p) => {
          const el = board.nodeEls.get(p.nodeId) as any;
          const shapeType = String(
            el?.sceneShapeType ||
              el?.attr?.('data-scene-shape-type') ||
              next?.deltaSetLike?.[p.nodeId]?.attrs?.shapeType ||
              ''
          );
          const isStrokeShape = shapeType === 'line' || shapeType === 'arrow';
          const isText = next?.deltaSetLike?.[p.nodeId]?.key === 'text';
          const didResize = Boolean(el?.__sceneDidResize);
          clearSceneDragPreview(board.nodeEls, p.nodeId);
          // Images/svg use scale preview while dragging — remount to bake
          // width/height (and refresh the infinite SVG viewport) on commit.
          if (didResize || isStrokeShape || isText) {
            void replaceShapePaint(next, board.nodeEls, p.nodeId, board.root ? board : null);
            return;
          }
          const synced = previewSvgNodeGeometry(board.nodeEls, p.nodeId, p);
          if (!synced) {
            void replaceShapePaint(next, board.nodeEls, p.nodeId, board.root ? board : null);
            return;
          }
          const host = getShapeHost(p.nodeId);
          if (host?.layer) {
            dedupeSceneNode(host.layer, p.nodeId, board.nodeEls.get(p.nodeId) ?? null);
          } else if (board.layer) {
            dedupeSceneNode(board.layer, p.nodeId, board.nodeEls.get(p.nodeId) ?? null);
          }
        });
        const validIds = next?.deltaSetLike?.ROOT?.children || [];
        if (board.layer) {
          purgeOrphanSceneNodes(board.layer, board.nodeEls, validIds);
        } else {
          [...board.nodeEls.keys()].forEach((id) => {
            if (!validIds.includes(id)) board.nodeEls.delete(id);
          });
        }
      }
    }
    // Merge frame boxes into the same document write so nodes don't clobber frames.
    if (frames.length) {
      const byId = new Map(frames.map((f) => [f.id, f]));
      next = {
        ...next,
        frames: (Array.isArray(next.frames) ? next.frames : []).map((f: any) => {
          const hit = byId.get(String(f?.id));
          if (!hit) return f;
          return { ...f, x: hit.x, y: hit.y, width: hit.width, height: hit.height };
        }),
      };
    }
    deps.setDocumentLocal(next);
    // Node-only preview leaves Redux pristine; frame preview already pushed history.
    if (!options?.skipHistory && !deps.getFrameGeomHistoryPushed()) {
      deps.dispatch(pushEditorHistory());
    }
    deps.setFrameGeomHistoryPushed(false);
    deps.dispatch(setDocumentFromCanvas(next));
    // Same React turn as Redux doc — HTML plates must not fall back to stale
    // coords between commit and onTransformingChange(false).
    deps.clearVideoLiveGeom();
  };

  const onGeometryPreview = (
    patches: GeomPatch[],
    options?: { textResizeMode?: 'scale' | 'wrap' }
  ) => {
    const doc = deps.getDocument();
    const board = deps.getBoard();
    if (!doc || deps.isReadOnly() || !patches.length) return;
    const { nodePatches } = applyFrameGeometryPatches(patches, { preview: true });
    if (!nodePatches.length || !board) return;
    const normalized = normalizeGeomPatches(doc, toGeometryPatches(doc, nodePatches));
    const next = patchNodesGeometry(doc, normalized, {
      textResizeMode: options?.textResizeMode,
    });
    deps.setDocumentLocal(next);
    const videoOverrides: Record<string, VideoGeomOverride> = {};
    let hasVideo = false;
    const coalescer = deps.getDragWriteCoalescer();
    normalized.forEach((p) => {
      const node = next?.deltaSetLike?.[p.nodeId];
      const isText = node?.key === 'text';
      const box =
        isText && options?.textResizeMode === 'wrap'
          ? {
              left: p.left,
              top: p.top,
              width: Math.max(1, Number(node.width) || p.width),
              height: Math.max(1, Number(node.height) || p.height),
            }
          : p;
      if (node?.key === 'video' || node?.key === 'lottie' || node?.key === 'audio') {
        hasVideo = true;
        const pending = coalescer.getPendingVideoGeom()?.[p.nodeId];
        videoOverrides[p.nodeId] = {
          left: box.left,
          top: box.top,
          width: Math.max(1, box.width),
          height: Math.max(1, box.height),
          angle: Number.isFinite(pending?.angle)
            ? Number(pending!.angle)
            : Number(node.attrs?.angle) || 0,
        };
      }
      // Per-shape hosts may register before shared nodeEls is wired — recover.
      if (!board.nodeEls.get(p.nodeId)) {
        const hostEl = getShapeHost(p.nodeId)?.el;
        if (hostEl) board.nodeEls.set(p.nodeId, hostEl);
      }
      previewSvgNodeGeometry(board.nodeEls, p.nodeId, box, {
        textResizeMode: options?.textResizeMode,
        plainText: isText ? parseNodeText(node.attrs || {}) : undefined,
        textStyle: isText ? parseNodeTextStyle(node.attrs || {}) : undefined,
      });
    });
    // Keep HTML <video> plates glued to chrome (Redux doc is still pre-gesture).
    if (hasVideo) {
      deps.publishVideoLiveGeom({
        ...(coalescer.getPendingVideoGeom() || {}),
        ...videoOverrides,
      });
    }
  };

  const onAngleCommit = (
    nodeId: string,
    angleDeg: number,
    options?: { skipHistory?: boolean }
  ) => {
    if (deps.isReadOnly() || !nodeId) return;
    const nextAngle = Number(angleDeg.toFixed(2));
    const doc = deps.getDocument();
    if (doc?.deltaSetLike?.[nodeId]) {
      const node = doc.deltaSetLike[nodeId];
      deps.setDocumentLocal({
        ...doc,
        deltaSetLike: patchDeltaSetLike(doc.deltaSetLike, {
          [nodeId]: {
            ...node,
            attrs: { ...node.attrs, angle: nextAngle },
          },
        }),
      });
    }
    deps.dispatch(
      patchDocumentNode({
        nodeId,
        patch: { attrs: { angle: nextAngle } },
        skipHistory: Boolean(options?.skipHistory),
      })
    );
  };

  const onAnglePreview = (nodeId: string, angleDeg: number) => {
    const doc = deps.getDocument();
    const board = deps.getBoard();
    if (!doc || !board || deps.isReadOnly() || !nodeId) return;
    const node = doc.deltaSetLike?.[nodeId];
    if (!node) return;
    const nextAngle = Number(angleDeg.toFixed(2));
    deps.setDocumentLocal({
      ...doc,
      deltaSetLike: patchDeltaSetLike(doc.deltaSetLike, {
        [nodeId]: {
          ...node,
          attrs: { ...node.attrs, angle: nextAngle },
        },
      }),
    });
    const synced = previewSvgNodeAngle(
      board.nodeEls,
      nodeId,
      nextAngle,
      deps.getDocument()
    );
    if (!synced) {
      void replaceShapePaint(
        deps.getDocument(),
        board.nodeEls,
        nodeId,
        board.root ? board : null
      );
    }
    // HTML video / lottie plates read Redux doc — push live angle so rotate tracks chrome.
    if (isVideoNode(node) || isLottieNode(node) || isAudioNode(node)) {
      const live = deps.getDocument()?.deltaSetLike?.[nodeId] || node;
      const { left, top } = nodeLeftTop(deps.getDocument(), live);
      const coalescer = deps.getDragWriteCoalescer();
      const pending = coalescer.getPendingVideoGeom()?.[nodeId];
      deps.publishVideoLiveGeom({
        ...(coalescer.getPendingVideoGeom() || {}),
        [nodeId]: {
          left: pending?.left ?? left,
          top: pending?.top ?? top,
          width: Math.max(1, pending?.width != null ? pending.width : Number(live.width) || 1),
          height: Math.max(
            1,
            pending?.height != null ? pending.height : Number(live.height) || 1
          ),
          angle: nextAngle,
        },
      });
    }
  };

  return {
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
  };
}
