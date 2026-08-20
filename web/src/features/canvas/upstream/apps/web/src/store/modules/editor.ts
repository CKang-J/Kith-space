/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/store/modules/editor.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';
import {
  createEmptyDocument,
  normalizeDocument,
  reconcileStackOrder,
  setDocumentCanvasMeta,
  setDocumentSize,
  updateNodeInDocument,
  mergeNodePatch,
  alignImportedDocumentOrigin,
  mergeImportedIntoDocument,
  ensureDocumentContentOnCanvas,
  addNodeToDocument,
  removeNodesFromDocument
} from '@recombyn-native/components/rcb/scene/document/sceneDocument';
import {
  clearImageProcessAttrs,
  spawnImageProcessNode,
  spawnImportPlaceholderNode,
  spawnImageUploadPlaceholderNode,
  spawnVideoUploadPlaceholderNode,
  promoteImageGeneratorToImage,
  promoteVideoGeneratorToVideo,
  promoteLottieGeneratorToLottie,
  promoteAudioGeneratorToAudio,
  applyImageDecomposeLayers,
  detachImageVariantToNode
} from '@recombyn-native/components/rcb/scene/document/mediaLifecycle';
import {
  createImageGeneratorNode,
  createVideoGeneratorNode,
  createLottieNode,
  createLottieGeneratorNode,
  createAudioNode,
  createAudioGeneratorNode,
  createImageNode,
  createVideoNode
} from '@recombyn-native/components/rcb/scene/document/nodeFactories';
import {
  isEphemeralUploadNode
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import {
  loadTemplates,
  saveTemplates,
  isSessionTemplate,
  type EditorLibraryItem,
  type TemplateSource,
} from '@recombyn-native/utils/templatesStorage';
import {
  purgeLegacyCustomThumbCache,
} from '@recombyn-native/utils/projectThumb';
import type { ArtboardFrame } from '@recombyn-native/components/rcb/frames/types';
import type { SceneDocument, SceneNode } from '@recombyn-native/components/rcb/sceneNode';
import { coerceSceneDocumentInput } from '@recombyn-native/components/rcb/sceneNode';
import {
  asHistoryEntry,
  cloneDocument,
  cloneNodeForHistory,
  pushHistory as snapshotEditorHistory,
  pushNodePatchHistory as snapshotNodePatchHistory,
  restoreNodesIntoDocument,
  scrubNodeIdsFromHistory,
  type HistoryEntry,
} from './editorHistory';

export type { ArtboardFrame } from '@recombyn-native/components/rcb/frames/types';
export type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';

/** Import / hydrate: Zod at boundary, then align/normalize for legacy. */
function documentFromExternalPayload(raw: unknown): SceneDocument {
  return alignImportedDocumentOrigin(coerceSceneDocumentInput(raw));
}

/** Side panel / toolbar kinds for image tools. */
export type ImageToolPanelKind =
  | 'eraser'
  | 'opacity'
  | 'multiAngle'
  | 'expand'
  | 'crop'
  | 'adjust'
  | 'flipRotate'
  | 'quickEdit'
  | 'replaceText'
  | 'lottieEdit'
  | 'mark'
  | 'upscale';

/** On-canvas video tool sessions (trim timeline). Spatial crop reuses image crop panel. */
export type VideoToolPanelKind = 'trim';

/** On-canvas audio tool sessions — 截取 / 变速 only. */
export type AudioToolPanelKind = 'trim' | 'speed';

function createFrame(partial?: Partial<ArtboardFrame>): ArtboardFrame {
  const hasW = partial?.width != null && Number.isFinite(Number(partial.width));
  const hasH = partial?.height != null && Number.isFinite(Number(partial.height));
  const width = Math.max(1, Math.round(hasW ? Number(partial!.width) : 794));
  const height = Math.max(1, Math.round(hasH ? Number(partial!.height) : 1123));
  return {
    id: partial?.id || nanoid(8),
    name: partial?.name || 'Frame',
    x: Math.round(partial?.x ?? 0),
    y: Math.round(partial?.y ?? 0),
    width,
    height,
    backgroundColor: partial?.backgroundColor ?? '#FFFFFF',
    clipContent: partial?.clipContent ?? false,
  };
}

/**
 * Claim session (`case`/`scratch`) as owned on first real edit.
 * Full document snapshots (local + cloud) are debounced in `useProjectCloudSync`.
 */
function syncLibraryOnEdit(state: typeof initialState, claim = true) {
  if (!state.currentId || !state.document) return;
  const item = state.templates.find((t) => t.id === state.currentId);
  if (!item) return;
  // Share-edit sessions stay off the Projects library.
  if (String(state.currentId).startsWith('share_')) return;
  if (!(claim && isSessionTemplate(item))) return;
  item.source = 'user' as TemplateSource;
  item.document = cloneDocument(state.document) ?? state.document;
  item.updatedAt = Date.now();
  saveTemplates(state.templates);
}

function touchOpened(item: EditorLibraryItem | null | undefined) {
  if (!item) return;
  item.openedAt = Date.now();
}

const templates = loadTemplates();

/** Stable empty id list for useSelector fallbacks (avoid `|| []` new refs). */
export const EMPTY_ID_LIST: string[] = [];

/**
 * Ephemeral AI overlay (PR9). Highlight / outline / operation label / AI cursor.
 * Must never enter SceneDocument, frames, or Yjs.
 */
export type AiOperationState = {
  active: boolean;
  transactionId?: string;
  frameId?: string | null;
  nodeId?: string | null;
  action?: string;
  label?: string;
};

const initialState = {
  templates,
  currentId: null as string | null,
  document: null as SceneDocument | null,
  selectedNodeId: null as string | null,
  selectedNodeIds: [] as string[],
  /** Multi artboard selection (UI); document.activeFrameId is the primary. */
  selectedFrameIds: [] as string[],
  dirty: false,
  /**
   * Monotonic local scene version. Human edits bump it; AI transactions hold
   * `aiMutationLock` so per-op setDocument snapshots do not look like user edits.
   */
  sceneRevision: 0,
  /** >0 while an AI DesignTransaction is applying (PR7 Scene Mutation). */
  aiMutationLock: 0,
  sceneReloadToken: 0,
  documentPatchToken: 0,
  /** Node ids last touched by `patchDocumentNode` — SvgCanvas refreshes these even with no selection. */
  lastPatchedNodeIds: [] as string[],
  historyPast: [] as HistoryEntry[],
  historyFuture: [] as HistoryEntry[],
  activeTool: 'select' as string,
  /** Local grid snap + overlay (session-persisted; not in cloud document). */
  isGridMode: false,
  shapeKind: 'rect' as string,
  pendingImageSrc: null as string | null,
  pendingImageProcessId: null as string | null,
  /** Blank loading node while image import runs. */
  pendingImportPlaceholderId: null as string | null,
  /** Interactive image tool panel docked to the right of the source image (figs 2-5). */
  imageToolPanel: null as null | { nodeId: string; kind: ImageToolPanelKind },
  videoToolPanel: null as null | {
    nodeId: string;
    kind: VideoToolPanelKind;
    /** Canvas playhead at open — trim preview must not jump to 0. */
    keepTime?: number;
  },
  audioToolPanel: null as null | {
    nodeId: string;
    kind: AudioToolPanelKind;
    /** Canvas playhead at open — trim preview must not jump to 0. */
    keepTime?: number;
  },
  /** Fill / stroke panel docked to the right of the selection (hides top chrome while open). */
  shapeStylePanel: null as null | { kind: 'fill' | 'stroke' | 'radius'; nodeIds: string[] },
  /** Shared stroke settings for pen / pencil tools. */
  penStrokeColor: '#333333' as string,
  penStrokeWidth: 1 as number,
  /** Brush / stroke opacity while painting (0–100). */
  penStrokeOpacity: 100 as number,
  /** Paint-bucket fill (same schema as FillPanel). */
  bucketFill: {
    fillType: 'solid' as const,
    fillColor: '#333333',
    fillOpacity: 100,
    fillGradient: undefined as string | undefined,
    fillImageSrc: undefined as string | undefined,
    fillImageFit: undefined as 'fill' | 'fit' | 'crop' | 'tile' | undefined,
    fillImageRotate: undefined as number | undefined,
    fillImageAdjust: undefined as Record<string, number> | undefined,
  },
  /** Pencil brush wheel selection (default = first: 矢量墨线). */
  pencilBrushId: 'vector-ink' as string,
  /** When true, pencil tool erases existing pencil strokes instead of drawing. */
  pencilEraseMode: false,
  /** When true, pencil uses stylus/touch pressure (+ brush speed sim). */
  pencilPressureEnabled: true,
  /** Tip hardness 0–100. Soft = feathered edge + denser dabs. */
  pencilHardness: 80,
  /** Design = edit; Dev = inspect spacing / margins. */
  workspaceMode: 'design' as 'design' | 'dev',
  /** Dev-mode node under pointer (inspect panel + spacing overlay). */
  devHoverNodeId: null as string | null,
  /** True while the design agent is mutating the canvas (hides selection chrome). */
  agentBusy: false,
  /** Local AI generating chrome — not persisted, not collab-synced. */
  aiOperationState: null as AiOperationState | null,
  /**
   * Composer canvas pick — next click attaches (group-expanded) to the target.
   * `target`: `'agent'` | `` `node:${nodeId}` ``
   * `accept`: `'image'` = stills only (image generator / quick-edit); omit/`'media'` allows video.
   */
  canvasAttachPick: null as null | { target: string; accept?: 'image' | 'media' },
  /** Hover is over a node that cannot be added (generator / shimmer). */
  canvasAttachPickBlocked: false,
  /** Delivered once after a successful pick; composers consume and clear. */
  pendingCanvasAttach: null as null | { target: string; payload: string | string[] },
  /**
   * Mark / programmatic chips for the right AgentDock (@ mentions).
   * EditorPage opens the panel when `agentOpenNonce` bumps; dock inserts then clears.
   */
  pendingAgentContexts: [] as Array<{
    key: string;
    label: string;
    kind: string;
    payload: string;
    dataUrl?: string;
    thumbUrl?: string;
  }>,
  agentOpenNonce: 0,
};

/** Stage fill lives on Redux; SvgCanvas view docs force transparent paper for hosts. */
const STAGE_CANVAS_META_KEYS = [
  'backgroundColor',
  'backgroundFillType',
  'backgroundGradient',
  'backgroundOpacity',
  'backgroundImageSrc',
  'backgroundImageFit',
  'backgroundImageRotate',
  'backgroundImageAdjust',
] as const;

/**
 * Embedded canvas passes a view document with `backgroundColor: 'transparent'`.
 * Geometry commits must not write that back over the real stage fill.
 */
function preserveStageCanvasMeta(
  prev: SceneDocument | null | undefined,
  incoming: SceneDocument
): SceneDocument {
  if (!prev || !incoming || typeof incoming !== 'object') return incoming;
  if (String(incoming.backgroundColor) !== 'transparent') return incoming;
  if (String(prev.backgroundColor ?? '') === 'transparent') return incoming;
  const next = { ...incoming } as Record<string, unknown>;
  const src = prev as Record<string, unknown>;
  for (const key of STAGE_CANVAS_META_KEYS) {
    if (key in prev) next[key] = src[key];
  }
  return next as SceneDocument;
}

function clearSelection(state: typeof initialState) {
  state.selectedNodeId = null;
  state.selectedNodeIds = [];
  state.selectedFrameIds = [];
  state.imageToolPanel = null;
  state.videoToolPanel = null;
  state.audioToolPanel = null;
  state.shapeStylePanel = null;
}

/** Drop pending process id when its node was deleted (upload-in-flight must not revive it). */
function clearPendingProcessIfNodeGone(state: typeof initialState) {
  const pending = state.pendingImageProcessId;
  if (!pending) return;
  if (!state.document?.deltaSetLike?.[pending]) {
    state.pendingImageProcessId = null;
  }
}

function bumpSceneRevisionIfUnlocked(state: typeof initialState) {
  if ((state.aiMutationLock || 0) > 0) return;
  state.sceneRevision = (state.sceneRevision || 0) + 1;
}

/** Remote Yjs is a user-visible scene change — AI must rebase, not silent-overwrite. */
function bumpSceneRevisionForRemoteCollab(state: typeof initialState) {
  state.sceneRevision = (state.sceneRevision || 0) + 1;
}

function pushHistory(state: typeof initialState) {
  snapshotEditorHistory(state);
  bumpSceneRevisionIfUnlocked(state);
}

function pushNodePatchHistory(state: typeof initialState, nodeIds: string[]) {
  snapshotNodePatchHistory(state, nodeIds);
  bumpSceneRevisionIfUnlocked(state);
}

const editorSlice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    createTemplate(state, action) {
      const id = nanoid();
      const now = Date.now();
      const doc = normalizeDocument(
        action.payload?.document ||
          createEmptyDocument({
            width: action.payload?.width,
            height: action.payload?.height,
            emptyWorld: action.payload?.emptyWorld,
          })
      );
      const source: TemplateSource =
        action.payload?.source === 'user' ||
        action.payload?.source === 'import' ||
        action.payload?.source === 'case' ||
        action.payload?.source === 'scratch'
          ? action.payload.source
          : 'scratch';
      const item = {
        id,
        name: action.payload?.name || '未命名作品',
        updatedAt: now,
        openedAt: now,
        source,
        document: doc,
      };
      state.templates.unshift(item);
      state.currentId = id;
      state.document = doc;
      clearSelection(state);
      state.dirty = false;
      state.historyPast = [];
      state.historyFuture = [];
      state.sceneReloadToken += 1;
      saveTemplates(state.templates);
    },
    openTemplate(state, action) {
      const item = state.templates.find((t) => t.id === action.payload);
      if (!item) return;
      state.currentId = item.id;
      const doc = ensureDocumentContentOnCanvas(item.document as SceneDocument);
      // Enter editor with nothing selected (cases often ship activeFrameId).
      doc.activeFrameId = null;
      state.document = doc;
      // Keep library copy origin-cleared so reopen doesn't re-jump.
      item.document = doc;
      clearSelection(state);
      state.dirty = false;
      state.historyPast = [];
      state.historyFuture = [];
      state.sceneReloadToken += 1;
      touchOpened(item);
      saveTemplates(state.templates);
    },
    /**
     * Bake non-zero document.x/y into node coords before first fit/paint.
     * Idempotent when origin is already 0.
     */
    bakeDocumentOrigin(state) {
      if (!state.document) return;
      const ox = Number(state.document.x) || 0;
      const oy = Number(state.document.y) || 0;
      if (ox === 0 && oy === 0) return;
      const doc = alignImportedDocumentOrigin(state.document);
      state.document = doc;
      const item = state.templates.find((t) => t.id === state.currentId);
      if (item) item.document = doc;
      state.sceneReloadToken += 1;
    },
    setDocument(state, action) {
      pushHistory(state);
      state.document = normalizeDocument(
        preserveStageCanvasMeta(state.document, action.payload)
      );
      state.dirty = true;
      state.sceneReloadToken += 1;
      // Deleted upload placeholder — drop pending id (caller aborts the HTTP request).
      if (
        state.pendingImageProcessId &&
        !state.document?.deltaSetLike?.[state.pendingImageProcessId]
      ) {
        state.pendingImageProcessId = null;
      }
      syncLibraryOnEdit(state);
    },
    /**
     * Delete nodes / artboards. In-flight process placeholders (upload / AI) are
     * permanent: scrubbed from history so Ctrl+Z cannot bring them back, and
     * pendingImageProcessId is cleared so the watcher stops applying results.
     */
    removeDocumentNodes(state, action) {
      if (!state.document) return;
      const nodeIds = (action.payload?.nodeIds || [])
        .map((id: unknown) => String(id || '').trim())
        .filter(Boolean);
      const frameIds = (action.payload?.frameIds || [])
        .map((id: unknown) => String(id || '').trim())
        .filter(Boolean);
      if (!nodeIds.length && !frameIds.length) return;

      const ephemeralIds = nodeIds.filter((id: string) =>
        isEphemeralUploadNode(state.document?.deltaSetLike?.[id])
      );
      const undoableNodeIds = nodeIds.filter((id: string) => !ephemeralIds.includes(id));
      const hasUndoableChange = undoableNodeIds.length > 0 || frameIds.length > 0;

      if (hasUndoableChange) pushHistory(state);

      let next: SceneDocument | null | undefined = state.document;
      if (nodeIds.length) next = removeNodesFromDocument(next, nodeIds);
      if (frameIds.length) {
        const idSet = new Set(frameIds);
        const frames = (Array.isArray(next.frames) ? next.frames : []).filter(
          (f) => f && !idSet.has(String(f.id))
        );
        const active =
          next.activeFrameId && idSet.has(String(next.activeFrameId))
            ? frames[0]?.id ?? null
            : next.activeFrameId ?? null;
        next = { ...next, frames, activeFrameId: active };
        if (Array.isArray(next.stackOrder)) {
          next.stackOrder = next.stackOrder.filter((key: string) => {
            const k = String(key);
            if (!k.startsWith('frame:')) return true;
            return !idSet.has(k.slice(6));
          });
        }
        state.selectedFrameIds = state.selectedFrameIds.filter((id) => !idSet.has(id));
        if (active && !state.selectedFrameIds.includes(active)) {
          state.selectedFrameIds = [active];
        }
      }

      state.document = normalizeDocument(next);
      if (ephemeralIds.length) scrubNodeIdsFromHistory(state, ephemeralIds);

      const gone = new Set(nodeIds);
      if (state.selectedNodeId && gone.has(state.selectedNodeId)) state.selectedNodeId = null;
      state.selectedNodeIds = state.selectedNodeIds.filter((id) => !gone.has(id));
      if (state.imageToolPanel && gone.has(state.imageToolPanel.nodeId)) {
        state.imageToolPanel = null;
      }
      if (state.videoToolPanel && gone.has(state.videoToolPanel.nodeId)) {
        state.videoToolPanel = null;
      }
      if (state.audioToolPanel && gone.has(state.audioToolPanel.nodeId)) {
        state.audioToolPanel = null;
      }
      if (
        state.pendingImportPlaceholderId &&
        gone.has(state.pendingImportPlaceholderId)
      ) {
        state.pendingImportPlaceholderId = null;
      }
      clearPendingProcessIfNodeGone(state);

      state.dirty = true;
      state.sceneReloadToken += 1;
      syncLibraryOnEdit(state);
    },
    setDocumentFromCanvas(state, action) {
      state.document = normalizeDocument(
        preserveStageCanvasMeta(state.document, action.payload)
      );
      state.dirty = true;
      if (
        state.pendingImageProcessId &&
        !state.document?.deltaSetLike?.[state.pendingImageProcessId]
      ) {
        state.pendingImageProcessId = null;
      }
      syncLibraryOnEdit(state);
    },
    patchDocumentNode(state, action) {
      const { nodeId, patch, skipHistory } = action.payload || {};
      if (!state.document || !nodeId) return;
      const id = String(nodeId);
      if (!state.document.deltaSetLike?.[id]) return;
      if (!skipHistory) pushNodePatchHistory(state, [id]);
      // Immer draft: single-key write — O(1) structural share, no custom Proxy.
      state.document.deltaSetLike[id] = mergeNodePatch(state.document.deltaSetLike[id], patch);
      state.dirty = true;
      state.documentPatchToken += 1;
      state.lastPatchedNodeIds = [id];
      syncLibraryOnEdit(state);
    },
    /** Apply many node patches in one Redux write (align / distribute / flip). */
    patchDocumentNodes(state, action) {
      const { patches, skipHistory } = action.payload || {};
      if (!state.document || !Array.isArray(patches) || !patches.length) return;
      const ids: string[] = [];
      for (const item of patches) {
        if (item?.nodeId && item?.patch) ids.push(String(item.nodeId));
      }
      if (!ids.length) return;
      if (!skipHistory) pushNodePatchHistory(state, ids);
      const applied: string[] = [];
      for (const item of patches) {
        const id = item?.nodeId ? String(item.nodeId) : '';
        const patch = item?.patch;
        if (!id || !patch || !state.document.deltaSetLike?.[id]) continue;
        state.document.deltaSetLike[id] = mergeNodePatch(state.document.deltaSetLike[id], patch);
        applied.push(id);
      }
      if (!applied.length) return;
      state.dirty = true;
      state.documentPatchToken += 1;
      state.lastPatchedNodeIds = applied;
      syncLibraryOnEdit(state);
    },
    setSelectedNodeId(state, action) {
      state.selectedNodeId = action.payload;
      state.selectedNodeIds = action.payload ? [action.payload] : [];
      // Selecting a node clears artboard multi-select (single-target click).
      if (action.payload) state.selectedFrameIds = [];
      if (!action.payload || state.imageToolPanel?.nodeId !== action.payload) {
        state.imageToolPanel = null;
      }
      if (!action.payload || state.videoToolPanel?.nodeId !== action.payload) {
        state.videoToolPanel = null;
      }
      if (!action.payload || state.audioToolPanel?.nodeId !== action.payload) {
        state.audioToolPanel = null;
      }
      if (
        !action.payload ||
        !state.shapeStylePanel?.nodeIds?.length ||
        state.shapeStylePanel.nodeIds.length !== 1 ||
        state.shapeStylePanel.nodeIds[0] !== action.payload
      ) {
        state.shapeStylePanel = null;
      }
    },
    setSelectedNodeIds(state, action) {
      const ids = Array.isArray(action.payload) ? action.payload.filter(Boolean) : [];
      state.selectedNodeIds = ids;
      state.selectedNodeId = ids[0] || null;
      // Do not clear selectedFrameIds here — marquee may select frames + nodes together.
      // Callers that want nodes-only should also dispatch setSelectedFrameIds([]).
      if (!ids[0] || state.imageToolPanel?.nodeId !== ids[0]) {
        state.imageToolPanel = null;
      }
      if (!ids[0] || state.videoToolPanel?.nodeId !== ids[0]) {
        state.videoToolPanel = null;
      }
      if (!ids[0] || state.audioToolPanel?.nodeId !== ids[0]) {
        state.audioToolPanel = null;
      }
      const panelIds = state.shapeStylePanel?.nodeIds || [];
      const same =
        panelIds.length === ids.length &&
        panelIds.every((id) => ids.includes(id)) &&
        ids.every((id) => panelIds.includes(id));
      if (!same) state.shapeStylePanel = null;
    },
    addArtboardFrame(state, action) {
      if (!state.document) return;
      pushHistory(state);
      const next = normalizeDocument(state.document);
      const frames = Array.isArray(next.frames) ? [...next.frames] : [];
      const payload = action.payload || {};
      const { activate, ...framePartial } = payload as {
        activate?: boolean;
      } & Partial<ArtboardFrame>;
      const frame = createFrame(framePartial);
      frames.push(frame);
      next.frames = frames;
      const key = `frame:${frame.id}`;
      const order = Array.isArray(next.stackOrder) ? next.stackOrder.map(String) : [];
      if (!order.includes(key)) {
        // Keep new plates with other frames (under existing nodes). Appending on
        // top makes a remounted white/black plate cover sibling content until sync.
        let insertAt = 0;
        for (let i = 0; i < order.length; i += 1) {
          if (order[i].startsWith('frame:')) insertAt = i + 1;
        }
        next.stackOrder = [...order.slice(0, insertAt), key, ...order.slice(insertAt)];
      }
      reconcileStackOrder(next);
      if (activate !== false) {
        next.activeFrameId = frame.id;
        state.selectedFrameIds = [frame.id];
        state.selectedNodeId = null;
        state.selectedNodeIds = [];
      }
      state.document = next;
      state.dirty = true;
      state.sceneReloadToken += 1;
      syncLibraryOnEdit(state);
    },
    setActiveFrameId(state, action) {
      if (!state.document) return;
      const next = normalizeDocument(state.document);
      const id = action.payload ? String(action.payload) : null;
      next.activeFrameId = id;
      state.document = next;
      state.selectedFrameIds = id ? [id] : [];
      // Soft-click / title click selects one artboard like a rect — clear nodes.
      if (id) {
        state.selectedNodeId = null;
        state.selectedNodeIds = [];
      }
      state.dirty = true;
    },
    setSelectedFrameIds(state, action) {
      if (!state.document) return;
      const ids = Array.isArray(action.payload)
        ? [...new Set(action.payload.filter(Boolean).map(String))]
        : [];
      const next = normalizeDocument(state.document);
      const valid = new Set(
        (Array.isArray(next.frames) ? next.frames : []).map((f) => f?.id).filter(Boolean)
      );
      const filtered = ids.filter((id) => valid.has(id));
      next.activeFrameId = filtered[0] || null;
      state.document = next;
      state.selectedFrameIds = filtered;
      // Do not clear nodes — mixed marquee selection is allowed.
      // Callers that want frames-only should also dispatch setSelectedNodeIds([]).
      state.dirty = true;
    },
    /** Set node + artboard selection together (marquee / unified control box). */
    setMixedSelection(
      state,
      action: PayloadAction<{ nodeIds?: string[]; frameIds?: string[] }>
    ) {
      if (!state.document) return;
      const nodeIds = (action.payload?.nodeIds || []).filter(Boolean).map(String);
      const frameIdsRaw = (action.payload?.frameIds || []).filter(Boolean).map(String);
      const next = normalizeDocument(state.document);
      const valid = new Set(
        (Array.isArray(next.frames) ? next.frames : [])
          .map((f) => String(f?.id || ''))
          .filter(Boolean)
      );
      const frameIds = Array.from(new Set(frameIdsRaw.filter((id) => valid.has(id))));
      next.activeFrameId = frameIds[0] || null;
      state.document = next;
      state.selectedNodeIds = nodeIds;
      state.selectedNodeId = nodeIds[0] || null;
      state.selectedFrameIds = frameIds;
      if (!nodeIds[0] || state.imageToolPanel?.nodeId !== nodeIds[0]) {
        state.imageToolPanel = null;
      }
      if (!nodeIds[0] || state.videoToolPanel?.nodeId !== nodeIds[0]) {
        state.videoToolPanel = null;
      }
      if (!nodeIds[0] || state.audioToolPanel?.nodeId !== nodeIds[0]) {
        state.audioToolPanel = null;
      }
      const panelIds = state.shapeStylePanel?.nodeIds || [];
      const same =
        panelIds.length === nodeIds.length &&
        panelIds.every((id: string) => nodeIds.includes(id)) &&
        nodeIds.every((id: string) => panelIds.includes(id));
      if (!same) state.shapeStylePanel = null;
    },
    /** Remove one or more artboard frames. Contained scene nodes are cleared by the canvas delete path. */
    removeArtboardFrames(state, action) {
      if (!state.document) return;
      const ids: string[] = Array.isArray(action.payload)
        ? action.payload.filter(Boolean)
        : action.payload
          ? [action.payload]
          : [];
      if (!ids.length) return;
      pushHistory(state);
      const next = normalizeDocument(state.document);
      const idSet = new Set(ids);
      const frames = (Array.isArray(next.frames) ? next.frames : []).filter(
        (f) => f && !idSet.has(f.id)
      );
      next.frames = frames;
      if (next.activeFrameId && idSet.has(next.activeFrameId)) {
        next.activeFrameId = frames[0]?.id ?? null;
      }
      if (Array.isArray(next.stackOrder)) {
        next.stackOrder = next.stackOrder.filter((key: string) => {
          const k = String(key);
          if (!k.startsWith('frame:')) return true;
          return !idSet.has(k.slice(6));
        });
      }
      state.selectedFrameIds = (state.selectedFrameIds || []).filter((id) => !idSet.has(id));
      if (next.activeFrameId && !state.selectedFrameIds.includes(next.activeFrameId)) {
        state.selectedFrameIds = next.activeFrameId ? [next.activeFrameId] : [];
      }
      state.document = next;
      state.dirty = true;
      state.sceneReloadToken += 1;
      syncLibraryOnEdit(state);
    },
    renameArtboardFrame(state, action) {
      if (!state.document) return;
      const { id, name } = action.payload || {};
      if (!id) return;
      pushHistory(state);
      const next = normalizeDocument(state.document);
      const frames = Array.isArray(next.frames) ? next.frames : [];
      const frame = frames.find((f) => f.id === id);
      if (frame) frame.name = String(name || frame.name || 'Frame');
      next.frames = frames;
      state.document = next;
      state.dirty = true;
      syncLibraryOnEdit(state);
    },
    updateArtboardFrame(state, action) {
      if (!state.document) return;
      const { id, patch, skipHistory } = action.payload || {};
      if (!id || !patch) return;
      if (!skipHistory) pushHistory(state);
      const next = normalizeDocument(state.document);
      const frames = Array.isArray(next.frames) ? next.frames : [];
      const frame = frames.find((f) => f.id === id);
      if (frame) Object.assign(frame, patch);
      next.frames = frames;
      state.document = next;
      state.dirty = true;
      // Position / lock / generating-chrome updates refresh HTML without SVG reload.
      // If clipContent is on, x/y moves must remount so clip rects stay aligned.
      // skipHistory previews (live drag) also skip SVG remount — commit bumps token.
      const keys = Object.keys(patch);
      const chromeKeys = new Set([
        'x',
        'y',
        'locked',
        'hidden',
        'processStatus',
        'processLabel',
        'processKind',
      ]);
      const onlyChrome =
        keys.length > 0 &&
        keys.every((k) => chromeKeys.has(k)) &&
        !(Boolean(frame?.clipContent) && (keys.includes('x') || keys.includes('y')));
      if (!onlyChrome && !skipHistory) state.sceneReloadToken += 1;
      syncLibraryOnEdit(state);
    },
    /** Batch frame patches in one document write (multi-select drag / lock). */
    updateArtboardFrames(state, action) {
      if (!state.document) return;
      const { patches, skipHistory } = action.payload || {};
      if (!Array.isArray(patches) || !patches.length) return;
      if (!skipHistory) pushHistory(state);
      const next = normalizeDocument(state.document);
      const frames = Array.isArray(next.frames) ? next.frames : [];
      const byId = new Map<string, ArtboardFrame>(frames.map((f) => [String(f?.id), f]));
      const chromeKeys = new Set([
        'x',
        'y',
        'locked',
        'hidden',
        'processStatus',
        'processLabel',
        'processKind',
      ]);
      let needsReload = false;
      for (const item of patches) {
        const id = item?.id;
        const patch = item?.patch;
        if (!id || !patch) continue;
        const frame = byId.get(String(id));
        if (!frame) continue;
        Object.assign(frame, patch);
        const keys = Object.keys(patch);
        const onlyChrome =
          keys.length > 0 &&
          keys.every((k) => chromeKeys.has(k)) &&
          !(Boolean(frame.clipContent) && (keys.includes('x') || keys.includes('y')));
        if (!onlyChrome && !skipHistory) needsReload = true;
      }
      next.frames = frames;
      state.document = next;
      state.dirty = true;
      if (needsReload) state.sceneReloadToken += 1;
      syncLibraryOnEdit(state);
    },
    /** Snapshot history without changing the document (e.g. before a live frame drag). */
    pushEditorHistory(state) {
      if (!state.document) return;
      pushHistory(state);
    },
    /** AI DesignTransaction: freeze user revision while tool_ops apply. */
    beginAiSceneMutation(state) {
      state.aiMutationLock = (state.aiMutationLock || 0) + 1;
    },
    endAiSceneMutation(state) {
      state.aiMutationLock = Math.max(0, (state.aiMutationLock || 0) - 1);
      if (state.aiMutationLock === 0) {
        state.sceneRevision = (state.sceneRevision || 0) + 1;
      }
    },
    renameTemplate(state, action) {
      const item = state.templates.find((t) => t.id === state.currentId);
      if (!item) return;
      const next = String(action.payload ?? '');
      if (item.name === next) return;
      item.name = next;
      item.updatedAt = Date.now();
      // Renaming is an explicit claim → show in Projects.
      if (isSessionTemplate(item)) item.source = 'user';
      // Name is synced via cloud flush (same path as document edits).
      state.dirty = true;
      saveTemplates(state.templates);
    },
    persistCurrent(state, action) {
      if (!state.currentId || !state.document) return;
      const item = state.templates.find((t) => t.id === state.currentId);
      if (!item) return;
      item.document = cloneDocument(state.document) ?? state.document;
      item.updatedAt = Date.now();
      if (isSessionTemplate(item)) item.source = 'user';
      // keepDirty: cloud push not ACKed yet — stay dirty so refresh-before-upload retries.
      if (!action.payload?.keepDirty) state.dirty = false;
      saveTemplates(state.templates);
    },
    clearEditorDirty(state) {
      state.dirty = false;
    },
    /**
     * Apply a remote Yjs scene snapshot. No history push, no dirty flag —
     * collab room owns live truth; persistence is handled by CollabRoomProvider.
     */
    applyCollabDocument(state, action) {
      if (!action.payload) return;
      state.document = normalizeDocument(
        preserveStageCanvasMeta(
          state.document,
          coerceSceneDocumentInput(action.payload)
        )
      );
      state.dirty = false;
      state.sceneReloadToken += 1;
      if (
        state.pendingImageProcessId &&
        !state.document?.deltaSetLike?.[state.pendingImageProcessId]
      ) {
        state.pendingImageProcessId = null;
      }
      bumpSceneRevisionForRemoteCollab(state);
      syncLibraryOnEdit(state);
    },
    /**
     * Granular remote Yjs apply: COW node/frame/meta patches without full remount
     * when possible. Payload shape matches `CollabSceneDiff` from sceneYBridge.
     */
    applyCollabScenePatch(state, action) {
      const patch = action.payload;
      if (!patch || !state.document) return;
      if (patch.mode === 'full' && patch.scene) {
        state.document = normalizeDocument(
          preserveStageCanvasMeta(
            state.document,
            coerceSceneDocumentInput(patch.scene)
          )
        );
        state.dirty = false;
        state.sceneReloadToken += 1;
        state.documentPatchToken += 1;
        state.lastPatchedNodeIds = [];
        if (
          state.pendingImageProcessId &&
          !state.document?.deltaSetLike?.[state.pendingImageProcessId]
        ) {
          state.pendingImageProcessId = null;
        }
        bumpSceneRevisionForRemoteCollab(state);
        syncLibraryOnEdit(state);
        return;
      }

      let doc: SceneDocument = state.document;
      const touched: string[] = [];

      if (patch.meta && typeof patch.meta === 'object') {
        doc = { ...doc, ...patch.meta };
      }

      const delta = { ...(doc.deltaSetLike || {}) };
      const upsertNodes =
        patch.upsertNodes && typeof patch.upsertNodes === 'object' ? patch.upsertNodes : {};
      for (const [id, node] of Object.entries(upsertNodes)) {
        if (!id || id === 'ROOT' || !node || typeof node !== 'object') continue;
        delta[id] = node as unknown as SceneNode;
        touched.push(String(id));
      }
      for (const raw of Array.isArray(patch.removeNodeIds) ? patch.removeNodeIds : []) {
        const id = String(raw || '');
        if (!id || id === 'ROOT') continue;
        if (id in delta) {
          delete delta[id];
          touched.push(id);
        }
      }

      if (Array.isArray(patch.pageChildren)) {
        const children = patch.pageChildren.map(String);
        const pageId = String(doc.activePageId || doc.pages?.[0]?.id || 'page');
        delta.ROOT = {
          id: 'ROOT',
          key: 'entry',
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          attrs: {},
          ...(delta.ROOT || {}),
          children,
        };
        const pages = Array.isArray(doc.pages) ? [...doc.pages] : [{ id: pageId, children }];
        if (pages[0]) pages[0] = { ...pages[0], id: pageId, children };
        else pages.push({ id: pageId, children });
        doc = { ...doc, pages, activePageId: pageId };
      }

      if (Array.isArray(patch.stackOrder)) {
        doc = { ...doc, stackOrder: patch.stackOrder.map(String) };
      }

      const frameById = new Map<string, any>();
      for (const frame of Array.isArray(doc.frames) ? doc.frames : []) {
        if (frame?.id) frameById.set(String(frame.id), frame);
      }
      const upsertFrames =
        patch.upsertFrames && typeof patch.upsertFrames === 'object' ? patch.upsertFrames : {};
      for (const [id, frame] of Object.entries(upsertFrames)) {
        if (!id || !frame || typeof frame !== 'object') continue;
        frameById.set(String(id), frame);
      }
      for (const raw of Array.isArray(patch.removeFrameIds) ? patch.removeFrameIds : []) {
        frameById.delete(String(raw || ''));
      }
      if (
        Object.keys(upsertFrames).length ||
        (Array.isArray(patch.removeFrameIds) && patch.removeFrameIds.length)
      ) {
        doc = { ...doc, frames: [...frameById.values()] };
      }

      doc = { ...doc, deltaSetLike: delta };
      state.document = doc;
      state.dirty = false;
      state.documentPatchToken += 1;
      state.lastPatchedNodeIds = touched;
      if (
        state.pendingImageProcessId &&
        !state.document?.deltaSetLike?.[state.pendingImageProcessId]
      ) {
        state.pendingImageProcessId = null;
      }
      bumpSceneRevisionForRemoteCollab(state);
      syncLibraryOnEdit(state);
    },
    importDocument(state, action) {
      const payload = action.payload || {};
      const source: TemplateSource =
        payload.source === 'case' ||
        payload.source === 'import' ||
        payload.source === 'user' ||
        payload.source === 'scratch'
          ? payload.source
          : 'import';
      const originCaseId = payload.originCaseId
        ? String(payload.originCaseId)
        : undefined;
      const now = Date.now();

      // Reuse an unclaimed case session instead of duplicating Projects noise.
      if (source === 'case' && originCaseId) {
        const existing = state.templates.find(
          (t) => t.originCaseId === originCaseId && t.source === 'case'
        );
        if (existing) {
          const doc = documentFromExternalPayload(payload.document);
          doc.activeFrameId = null;
          existing.document = doc;
          existing.name = payload.name || existing.name || '导入作品';
          existing.updatedAt = now;
          touchOpened(existing);
          state.currentId = existing.id;
          state.document = doc;
          clearSelection(state);
          state.dirty = false;
          state.historyPast = [];
          state.historyFuture = [];
          state.sceneReloadToken += 1;
          saveTemplates(state.templates);
          return;
        }
      }

      const id = payload.id ? String(payload.id) : nanoid();
      const doc = documentFromExternalPayload(payload.document);
      // Inspiration / import → editor: do not pre-select an artboard.
      doc.activeFrameId = null;
      const existingById = state.templates.find((t) => t.id === id);
      if (existingById) {
        existingById.document = doc;
        existingById.name = payload.name || existingById.name || '导入作品';
        existingById.updatedAt = now;
        touchOpened(existingById);
        state.currentId = id;
        state.document = doc;
        clearSelection(state);
        state.dirty = Boolean(payload.dirty);
        state.historyPast = [];
        state.historyFuture = [];
        state.sceneReloadToken += 1;
        saveTemplates(state.templates);
        return;
      }
      const item: EditorLibraryItem = {
        id,
        name: payload.name || '导入作品',
        updatedAt: now,
        openedAt: now,
        source,
        document: doc,
      };
      if (originCaseId) item.originCaseId = originCaseId;
      state.templates.unshift(item);
      state.currentId = id;
      state.document = doc;
      clearSelection(state);
      state.dirty = Boolean(payload.dirty);
      state.historyPast = [];
      state.historyFuture = [];
      state.sceneReloadToken += 1;
      saveTemplates(state.templates);
    },
    /** Spawn blank loading plate for file import (image). */
    startImportPlaceholder(state, action) {
      if (!state.document) return;
      pushHistory(state);
      const { document: next, id } = spawnImportPlaceholderNode(state.document, {
        label: action.payload?.label || '解析设计文件中',
        width: action.payload?.width,
        height: action.payload?.height,
        x: action.payload?.x,
        y: action.payload?.y,
      });
      if (!id) return;
      state.document = next;
      state.dirty = true;
      state.sceneReloadToken += 1;
      state.pendingImportPlaceholderId = id;
      // Agent design placeholder should not steal the user's current selection.
      if (action.payload?.select !== false) {
        state.selectedNodeId = id;
        state.selectedNodeIds = [id];
        state.activeTool = 'select';
      }
    },
    /** Drop placeholder and merge parsed document at its position. */
    finishImportPlaceholder(state, action) {
      const incoming = action.payload?.document;
      const id = state.pendingImportPlaceholderId;
      let offsetX = Number(action.payload?.offsetX);
      let offsetY = Number(action.payload?.offsetY);
      if (!Number.isFinite(offsetX)) offsetX = 40;
      if (!Number.isFinite(offsetY)) offsetY = 40;

      if (state.document && id) {
        const ph = state.document.deltaSetLike?.[id];
        if (ph) {
          offsetX = Number(ph.x) || offsetX;
          offsetY = Number(ph.y) || offsetY;
        }
        pushHistory(state);
        state.document = removeNodesFromDocument(state.document, [id]);
      } else if (incoming) {
        pushHistory(state);
      }

      state.pendingImportPlaceholderId = null;

      if (!incoming) {
        state.dirty = true;
        state.sceneReloadToken += 1;
        clearSelection(state);
        return;
      }

      if (!state.document) {
        state.document = alignImportedDocumentOrigin(coerceSceneDocumentInput(incoming));
      } else {
        state.document = mergeImportedIntoDocument(state.document, coerceSceneDocumentInput(incoming), {
          offsetX,
          offsetY,
        });
      }
      state.dirty = true;
      clearSelection(state);
      state.sceneReloadToken += 1;
    },
    /** Remove failed/cancelled import placeholder. */
    cancelImportPlaceholder(state) {
      const id = state.pendingImportPlaceholderId;
      if (state.document && id) {
        state.document = removeNodesFromDocument(state.document, [id]);
        state.dirty = true;
        state.sceneReloadToken += 1;
        if (state.selectedNodeId === id) clearSelection(state);
      }
      state.pendingImportPlaceholderId = null;
    },
    /** Ephemeral AI overlay. Never writes SceneDocument. */
    setAiOperationState(state, action: PayloadAction<AiOperationState | null>) {
      const next = action.payload;
      if (!next || !next.active) {
        state.aiOperationState = null;
        return;
      }
      const transactionId = String(next.transactionId || '').trim();
      const frameId = next.frameId == null ? next.frameId : String(next.frameId).trim() || null;
      const nodeId = next.nodeId == null ? next.nodeId : String(next.nodeId).trim() || null;
      const actionName = String(next.action || '').trim();
      const label = String(next.label || '').trim();
      state.aiOperationState = {
        active: true,
        ...(transactionId ? { transactionId } : {}),
        frameId: frameId ?? null,
        nodeId: nodeId ?? null,
        ...(actionName ? { action: actionName } : {}),
        ...(label ? { label } : {}),
      };
    },
    /** Clear AI overlay; also strip leftover pre-PR9 frame generating chrome. */
    clearArtboardGenerating(state) {
      state.aiOperationState = null;
      if (!state.document) return;
      const frames = Array.isArray(state.document.frames) ? state.document.frames : [];
      let cleared = false;
      for (const f of frames) {
        if (!f || String(f.processStatus || '') !== 'running') continue;
        delete f.processStatus;
        delete f.processLabel;
        delete f.processKind;
        cleared = true;
      }
      if (cleared) {
        state.document = { ...state.document, frames: [...frames] };
        state.dirty = true;
      }
    },
    /** Merge image-import parse result into the open canvas. */
    mergeImportedDocument(state, action) {
      const incoming = action.payload?.document;
      if (!incoming) return;
      pushHistory(state);
      const coerced = coerceSceneDocumentInput(incoming);
      if (!state.document) {
        state.document = alignImportedDocumentOrigin(coerced);
      } else {
        state.document = mergeImportedIntoDocument(state.document, coerced, {
          offsetX: Number(action.payload?.offsetX) || 40,
          offsetY: Number(action.payload?.offsetY) || 40,
        });
      }
      state.dirty = true;
      clearSelection(state);
      state.sceneReloadToken += 1;
    },
    deleteTemplate(state, action) {
      state.templates = state.templates.filter((t) => t.id !== action.payload);
      saveTemplates(state.templates);
      if (state.currentId === action.payload) {
        state.currentId = null;
        state.document = null;
        clearSelection(state);
        state.dirty = false;
      }
    },
    deleteTemplates(state, action) {
      const ids = new Set(Array.isArray(action.payload) ? action.payload : []);
      if (!ids.size) return;
      state.templates = state.templates.filter((t) => !ids.has(t.id));
      saveTemplates(state.templates);
      if (state.currentId && ids.has(state.currentId)) {
        state.currentId = null;
        state.document = null;
        clearSelection(state);
        state.dirty = false;
      }
    },
    renameTemplateById(state, action) {
      const { id, name } = action.payload || {};
      if (!id) return;
      const item = state.templates.find((t) => t.id === id);
      if (!item) return;
      const next = String(name || item.name || '未命名作品');
      if (item.name === next) return;
      item.name = next;
      item.updatedAt = Date.now();
      if (isSessionTemplate(item)) item.source = 'user';
      if (state.currentId === id) state.dirty = true;
      saveTemplates(state.templates);
    },
    /** Store generated/list thumbnail URL or data URL on a project card. */
    setTemplateThumbnail(state, action) {
      const { id, thumbnail, custom } = action.payload || {};
      if (!id) return;
      const item = state.templates.find((t) => t.id === id);
      if (!item) return;
      item.thumbnail = thumbnail || null;
      // Do not bump updatedAt — thumb-only writes were racing list hydrate and
      // pinning stale data: covers over newer COS URLs.
      if (custom === true) item.thumbnailCustom = true;
      else if (custom === false) item.thumbnailCustom = false;
    },
    /**
     * Drop in-memory open project + sessions (logout / guest).
     * Home / Mine lists live in Query — do not keep owned rows after sign-out.
     */
    clearProjectsLibrary(state) {
      purgeLegacyCustomThumbCache();
      state.templates = [];
      state.currentId = null;
      state.document = null;
      state.dirty = false;
      state.historyPast = [];
      state.historyFuture = [];
      state.selectedNodeId = null;
      state.selectedNodeIds = [];
      state.selectedFrameIds = [];
      state.sceneReloadToken += 1;
      state.documentPatchToken += 1;
      state.lastPatchedNodeIds = [];
      saveTemplates();
    },
    undo(state) {
      if (!state.historyPast.length || !state.document) return;
      const entry = asHistoryEntry(state.historyPast.pop());
      if (entry.kind === 'nodes') {
        const after: Record<string, SceneNode> = {};
        for (const id of Object.keys(entry.before)) {
          const cur = state.document.deltaSetLike?.[id];
          if (cur) after[id] = cloneNodeForHistory(cur);
        }
        state.historyFuture.unshift({ kind: 'nodes', before: after });
        state.document = restoreNodesIntoDocument(state.document, entry.before);
        state.documentPatchToken += 1;
        state.lastPatchedNodeIds = Object.keys(entry.before);
      } else {
        const currentSnap = cloneDocument(state.document);
        if (currentSnap) {
          state.historyFuture.unshift({
            kind: 'snap',
            doc: currentSnap,
          });
        }
        state.document = entry.doc;
        state.sceneReloadToken += 1;
        state.lastPatchedNodeIds = [];
      }
      state.dirty = true;
      // Drop selection that pointed at nodes removed by this undo (e.g. detach).
      const ds = state.document?.deltaSetLike || {};
      const ids = (state.selectedNodeIds || []).filter((id: string) => Boolean(ds[id]));
      state.selectedNodeIds = ids;
      state.selectedNodeId = ids[0] || null;
      clearPendingProcessIfNodeGone(state);
      syncLibraryOnEdit(state);
    },
    redo(state) {
      if (!state.historyFuture.length || !state.document) return;
      const entry = asHistoryEntry(state.historyFuture.shift());
      if (entry.kind === 'nodes') {
        const before: Record<string, SceneNode> = {};
        for (const id of Object.keys(entry.before)) {
          const cur = state.document.deltaSetLike?.[id];
          if (cur) before[id] = cloneNodeForHistory(cur);
        }
        state.historyPast.push({ kind: 'nodes', before });
        state.document = restoreNodesIntoDocument(state.document, entry.before);
        state.documentPatchToken += 1;
        state.lastPatchedNodeIds = Object.keys(entry.before);
      } else {
        const currentSnap = cloneDocument(state.document);
        if (currentSnap) {
          state.historyPast.push({ kind: 'snap', doc: currentSnap });
        }
        state.document = entry.doc;
        state.sceneReloadToken += 1;
        state.lastPatchedNodeIds = [];
      }
      state.dirty = true;
      const ds = state.document?.deltaSetLike || {};
      const ids = (state.selectedNodeIds || []).filter((id: string) => Boolean(ds[id]));
      state.selectedNodeIds = ids;
      state.selectedNodeId = ids[0] || null;
      clearPendingProcessIfNodeGone(state);
      syncLibraryOnEdit(state);
    },
    setActiveTool(state, action) {
      state.activeTool = action.payload;
      if (action.payload !== 'image') state.pendingImageSrc = null;
      if (action.payload !== 'pencil') state.pencilEraseMode = false;
    },
    setGridMode(state, action: PayloadAction<boolean>) {
      state.isGridMode = Boolean(action.payload);
    },
    setShapeKind(state, action) {
      state.shapeKind = action.payload;
      state.activeTool = action.payload === 'image' ? 'image' : 'shape';
    },
    setPendingImageSrc(state, action) {
      state.pendingImageSrc = action.payload;
      if (action.payload) state.activeTool = 'image';
    },
    setCanvasSize(state, action) {
      if (!state.document) return;
      const { width, height } = action.payload || {};
      pushHistory(state);
      state.document = setDocumentSize(
        state.document,
        width ?? state.document.width,
        height ?? state.document.height
      );
      state.dirty = true;
      state.sceneReloadToken += 1;
    },
    setCanvasMeta(state, action) {
      if (!state.document) return;
      pushHistory(state);
      state.document = setDocumentCanvasMeta(state.document, action.payload || {});
      state.dirty = true;
      // Background is stage CSS — do not bump sceneReloadToken (that remounts every
      // RcbShapeHost and makes in-flight canvas edits appear to "vanish").
      syncLibraryOnEdit(state);
    },
    /** Spawn canvas Image Generator plate at given document coords. */
    spawnImageGenerator(state, action) {
      if (!state.document) return;
      pushHistory(state);
      const { id, node } = createImageGeneratorNode({
        x: action.payload?.x,
        y: action.payload?.y,
        width: action.payload?.width,
        height: action.payload?.height,
        name: action.payload?.name,
      });
      state.document = addNodeToDocument(state.document, id, node);
      state.dirty = true;
      state.sceneReloadToken += 1;
      state.selectedNodeId = id;
      state.selectedNodeIds = [id];
      state.pendingImageSrc = null;
      state.activeTool = 'select';
    },
    /** Spawn canvas Video Generator plate at given document coords. */
    spawnVideoGenerator(state, action) {
      if (!state.document) return;
      pushHistory(state);
      const { id, node } = createVideoGeneratorNode({
        x: action.payload?.x,
        y: action.payload?.y,
        width: action.payload?.width,
        height: action.payload?.height,
        name: action.payload?.name,
      });
      state.document = addNodeToDocument(state.document, id, node);
      state.dirty = true;
      state.sceneReloadToken += 1;
      state.selectedNodeId = id;
      state.selectedNodeIds = [id];
      state.pendingImageSrc = null;
      state.activeTool = 'select';
    },
    /** Spawn canvas Lottie Generator plate at given document coords. */
    spawnLottieGenerator(state, action) {
      if (!state.document) return;
      pushHistory(state);
      const { id, node } = createLottieGeneratorNode({
        x: action.payload?.x,
        y: action.payload?.y,
        width: action.payload?.width,
        height: action.payload?.height,
        name: action.payload?.name,
      });
      state.document = addNodeToDocument(state.document, id, node);
      state.dirty = true;
      state.sceneReloadToken += 1;
      state.selectedNodeId = id;
      state.selectedNodeIds = [id];
      state.pendingImageSrc = null;
      state.activeTool = 'select';
    },
    /** Spawn canvas Audio Generator plate at given document coords. */
    spawnAudioGenerator(state, action) {
      if (!state.document) return;
      pushHistory(state);
      const { id, node } = createAudioGeneratorNode({
        x: action.payload?.x,
        y: action.payload?.y,
        width: action.payload?.width,
        height: action.payload?.height,
        name: action.payload?.name,
      });
      state.document = addNodeToDocument(state.document, id, node);
      state.dirty = true;
      state.sceneReloadToken += 1;
      state.selectedNodeId = id;
      state.selectedNodeIds = [id];
      state.pendingImageSrc = null;
      state.activeTool = 'select';
    },
    /** Spawn finished Lottie plate (sample or Agent JSON) at document coords. */
    spawnLottie(state, action) {
      if (!state.document) return;
      pushHistory(state);
      try {
        const { id, node } = createLottieNode({
          x: action.payload?.x,
          y: action.payload?.y,
          width: action.payload?.width,
          height: action.payload?.height,
          name: action.payload?.name,
          animationData: action.payload?.animationData,
        });
        state.document = addNodeToDocument(state.document, id, node);
        state.dirty = true;
        state.sceneReloadToken += 1;
        state.selectedNodeId = id;
        state.selectedNodeIds = [id];
        state.pendingImageSrc = null;
        state.activeTool = 'select';
      } catch {
        /* invalid animationData — no-op */
      }
    },
    /** Spawn finished audio plate (upload / paste) at document coords. */
    spawnAudio(state, action) {
      if (!state.document) return;
      const src = String(action.payload?.src || '').trim();
      if (!src) return;
      pushHistory(state);
      const { id, node } = createAudioNode({
        x: action.payload?.x,
        y: action.payload?.y,
        width: action.payload?.width,
        height: action.payload?.height,
        name: action.payload?.name,
        src,
        duration: action.payload?.duration,
        uploadKey: action.payload?.uploadKey,
      });
      state.document = addNodeToDocument(state.document, id, node);
      state.dirty = true;
      state.sceneReloadToken += 1;
      state.selectedNodeId = id;
      state.selectedNodeIds = [id];
      state.pendingImageSrc = null;
      state.activeTool = 'select';
    },
    /**
     * Insert a pre-built scene node (canvas plugins / host helpers).
     * Payload must already include a stable ``id`` matching ``node.id``.
     */
    spawnCreatedNode(state, action) {
      if (!state.document) return;
      const id = String(action.payload?.id || '').trim();
      const node = action.payload?.node;
      if (!id || !node || typeof node !== 'object') return;
      pushHistory(state);
      const next = { ...node, id };
      state.document = addNodeToDocument(state.document, id, next);
      state.dirty = true;
      state.sceneReloadToken += 1;
      state.selectedNodeId = id;
      state.selectedNodeIds = [id];
      state.pendingImageSrc = null;
      state.activeTool = 'select';
    },
    /**
     * Place a library / AI asset onto the canvas (image | video | audio | lottie).
     * Used by the Assets dock — source URL already hosted.
     */
    placeMediaAsset(state, action) {
      if (!state.document) return;
      const kind = String(action.payload?.kind || '').trim().toLowerCase();
      const src = String(action.payload?.src || '').trim();
      if (kind === 'lottie') {
        const animationData = action.payload?.animationData;
        if (!animationData && !src) return;
        pushHistory(state);
        try {
          const x = Number(action.payload?.x);
          const y = Number(action.payload?.y);
          const name = String(action.payload?.name || '').trim() || undefined;
          const prompt = String(action.payload?.prompt || '').trim();
          const { id, node } = createLottieNode({
            x: Number.isFinite(x) ? x : 40,
            y: Number.isFinite(y) ? y : 40,
            width: action.payload?.width,
            height: action.payload?.height,
            name: name || 'Lottie',
            animationData: animationData || undefined,
          });
          if (prompt) node.attrs.genPrompt = prompt;
          state.document = addNodeToDocument(state.document, id, node);
          state.dirty = true;
          state.sceneReloadToken += 1;
          state.selectedNodeId = id;
          state.selectedNodeIds = [id];
          state.pendingImageSrc = null;
          state.activeTool = 'select';
          syncLibraryOnEdit(state);
        } catch {
          /* invalid animationData — no-op */
        }
        return;
      }
      if (!src) return;
      if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return;
      pushHistory(state);
      const x = Number(action.payload?.x);
      const y = Number(action.payload?.y);
      const name = String(action.payload?.name || '').trim() || undefined;
      const uploadKey = String(action.payload?.uploadKey || '').trim() || undefined;
      const prompt = String(action.payload?.prompt || '').trim();
      let id = '';
      let node: SceneNode | null = null;
      if (kind === 'image') {
        const w = Math.max(1, Math.round(Number(action.payload?.width) || 360));
        const h = Math.max(1, Math.round(Number(action.payload?.height) || 360));
        ({ id, node } = createImageNode({
          x: Number.isFinite(x) ? x : 40,
          y: Number.isFinite(y) ? y : 40,
          width: w,
          height: h,
          src,
          name: name || 'Image',
        }));
        if (uploadKey) node.attrs.uploadKey = uploadKey;
        if (prompt) node.attrs.genPrompt = prompt;
      } else if (kind === 'video') {
        const w = Math.max(1, Math.round(Number(action.payload?.width) || 640));
        const h = Math.max(1, Math.round(Number(action.payload?.height) || 360));
        ({ id, node } = createVideoNode({
          x: Number.isFinite(x) ? x : 40,
          y: Number.isFinite(y) ? y : 40,
          width: w,
          height: h,
          src,
          name: name || 'Video',
          duration: action.payload?.duration,
        }));
        if (uploadKey) node.attrs.uploadKey = uploadKey;
        if (prompt) node.attrs.genPrompt = prompt;
      } else {
        ({ id, node } = createAudioNode({
          x: Number.isFinite(x) ? x : 40,
          y: Number.isFinite(y) ? y : 40,
          width: action.payload?.width,
          height: action.payload?.height,
          src,
          name: name || 'Audio',
          duration: action.payload?.duration,
          uploadKey,
        }));
        if (prompt) node.attrs.genPrompt = prompt;
      }
      state.document = addNodeToDocument(state.document, id, node);
      state.dirty = true;
      state.sceneReloadToken += 1;
      state.selectedNodeId = id;
      state.selectedNodeIds = [id];
      state.pendingImageSrc = null;
      state.activeTool = 'select';
      syncLibraryOnEdit(state);
    },
    /** Convert Image Generator plate → normal image node (same id). */
    /** Pull one multi-gen variant out into a sibling image node (undoable). */
    detachImageVariant(state, action) {
      const nodeId = String(action.payload?.nodeId || '');
      const url = String(action.payload?.url || '').trim();
      const name = String(action.payload?.name || '').trim() || undefined;
      if (!state.document || !nodeId || !url) return;
      pushHistory(state);
      const { document: next, id } = detachImageVariantToNode(state.document, nodeId, url, {
        name,
      });
      if (!id) {
        state.historyPast.pop();
        return;
      }
      state.document = next;
      state.dirty = true;
      state.sceneReloadToken += 1;
      state.selectedNodeId = id;
      state.selectedNodeIds = [id];
      syncLibraryOnEdit(state);
    },
    finishImageGenerator(state, action) {
      const nodeId = String(action.payload?.nodeId || '');
      const src = String(action.payload?.src || '').trim();
      if (!state.document || !nodeId || !src) return;
      pushHistory(state);
      const variants = Array.isArray(action.payload?.variants)
        ? action.payload.variants.map((u: unknown) => String(u || '').trim()).filter(Boolean)
        : undefined;
      state.document = promoteImageGeneratorToImage(state.document, nodeId, {
        src,
        width: action.payload?.width,
        height: action.payload?.height,
        x: action.payload?.x,
        y: action.payload?.y,
        name: action.payload?.name,
        variants,
        genPrompt: action.payload?.genPrompt,
      });
      state.dirty = true;
      state.sceneReloadToken += 1;
      state.selectedNodeId = nodeId;
      state.selectedNodeIds = [nodeId];
      if (state.pendingImageProcessId === nodeId) state.pendingImageProcessId = null;
      syncLibraryOnEdit(state);
    },
    /** Convert Video Generator plate → normal video node (same id). */
    finishVideoGenerator(state, action) {
      const nodeId = String(action.payload?.nodeId || '');
      const src = String(action.payload?.src || '').trim();
      if (!state.document || !nodeId || !src) return;
      pushHistory(state);
      state.document = promoteVideoGeneratorToVideo(state.document, nodeId, {
        src,
        poster: action.payload?.poster,
        width: action.payload?.width,
        height: action.payload?.height,
        x: action.payload?.x,
        y: action.payload?.y,
        name: action.payload?.name,
        genPrompt: action.payload?.genPrompt,
      });
      state.dirty = true;
      state.sceneReloadToken += 1;
      state.selectedNodeId = nodeId;
      state.selectedNodeIds = [nodeId];
      if (state.pendingImageProcessId === nodeId) state.pendingImageProcessId = null;
      syncLibraryOnEdit(state);
    },
    /** Convert Lottie Generator plate → normal Lottie node (same id). */
    finishLottieGenerator(state, action) {
      const nodeId = String(action.payload?.nodeId || '');
      const animationData = action.payload?.animationData;
      if (!state.document || !nodeId || animationData == null) return;
      pushHistory(state);
      const next = promoteLottieGeneratorToLottie(state.document, nodeId, {
        animationData,
        width: action.payload?.width,
        height: action.payload?.height,
        x: action.payload?.x,
        y: action.payload?.y,
        name: action.payload?.name,
        genPrompt: action.payload?.genPrompt,
      });
      if (next === state.document) {
        state.historyPast.pop();
        return;
      }
      state.document = next;
      state.dirty = true;
      state.sceneReloadToken += 1;
      state.selectedNodeId = nodeId;
      state.selectedNodeIds = [nodeId];
      if (state.pendingImageProcessId === nodeId) state.pendingImageProcessId = null;
      syncLibraryOnEdit(state);
    },
    /** Convert Audio Generator plate → normal audio node (same id). */
    finishAudioGenerator(state, action) {
      const nodeId = String(action.payload?.nodeId || '');
      const src = String(action.payload?.src || '').trim();
      if (!state.document || !nodeId || !src) return;
      pushHistory(state);
      state.document = promoteAudioGeneratorToAudio(state.document, nodeId, {
        src,
        width: action.payload?.width,
        height: action.payload?.height,
        x: action.payload?.x,
        y: action.payload?.y,
        name: action.payload?.name,
        genPrompt: action.payload?.genPrompt,
        duration: action.payload?.duration,
        uploadKey: action.payload?.uploadKey,
      });
      state.dirty = true;
      state.sceneReloadToken += 1;
      state.selectedNodeId = nodeId;
      state.selectedNodeIds = [nodeId];
      if (state.pendingImageProcessId === nodeId) state.pendingImageProcessId = null;
      syncLibraryOnEdit(state);
    },
    /** Spawn image node with local preview while remote upload runs. */
    startImageUploadPlaceholder(state, action) {
      if (!state.document) return;
      const src = String(action.payload?.src || '');
      if (!src) return;
      pushHistory(state);
      const { document: next, id } = spawnImageUploadPlaceholderNode(state.document, {
        src,
        width: Number(action.payload?.width) || 200,
        height: Number(action.payload?.height) || 200,
        label: action.payload?.label || '上传中',
        x: action.payload?.x,
        y: action.payload?.y,
        name: action.payload?.name,
      });
      if (!id) return;
      state.document = next;
      state.dirty = true;
      state.sceneReloadToken += 1;
      state.pendingImageProcessId = id;
      state.selectedNodeId = id;
      state.selectedNodeIds = [id];
      state.pendingImageSrc = null;
      state.activeTool = 'select';
    },
    /** Spawn video node with local preview while remote upload runs. */
    startVideoUploadPlaceholder(state, action) {
      if (!state.document) return;
      const src = String(action.payload?.src || '');
      if (!src) return;
      pushHistory(state);
      const { document: next, id } = spawnVideoUploadPlaceholderNode(state.document, {
        src,
        poster: action.payload?.poster,
        width: Number(action.payload?.width) || 640,
        height: Number(action.payload?.height) || 360,
        label: action.payload?.label || '上传中',
        x: action.payload?.x,
        y: action.payload?.y,
        name: action.payload?.name,
        duration: action.payload?.duration,
      });
      if (!id) return;
      state.document = next;
      state.dirty = true;
      state.sceneReloadToken += 1;
      state.pendingImageProcessId = id;
      state.selectedNodeId = id;
      state.selectedNodeIds = [id];
      state.pendingImageSrc = null;
      state.activeTool = 'select';
    },
    /** Spawn a right-side image processing node (original untouched). */
    startImageProcess(state, action) {
      if (!state.document) return;
      const { sourceId, kind, label, targetWidth, targetHeight, meta } = action.payload || {};
      if (!sourceId || !kind) return;
      pushHistory(state);
      const { document: next, id } = spawnImageProcessNode(state.document, sourceId, {
        kind,
        label: label || '处理中',
        targetWidth,
        targetHeight,
        meta,
      });
      if (!id) return;
      state.document = next;
      state.dirty = true;
      state.sceneReloadToken += 1;
      // Select the loading clone so it can be moved / scaled like any other object.
      state.selectedNodeId = id;
      state.selectedNodeIds = [id];
      state.pendingImageProcessId = id;
    },
    /** Finish processing overlay on a spawned node. Optional `src` replaces image pixels (e.g. upscale). */
    finishImageProcess(state, action) {
      const nodeId = action.payload?.nodeId || state.pendingImageProcessId;
      const nextSrc = action.payload?.src as string | undefined;
      const layers = action.payload?.layers as
        | import('@recombyn-native/components/rcb/scene/document/mediaLifecycle').DecomposeLayer[]
        | undefined;
      const sourceWidth = action.payload?.sourceWidth as number | undefined;
      const sourceHeight = action.payload?.sourceHeight as number | undefined;
      if (!state.document || !nodeId) return;
      // User deleted the placeholder while upload/AI was in flight — do not resurrect it.
      if (!state.document.deltaSetLike?.[nodeId]) {
        if (state.pendingImageProcessId === nodeId) state.pendingImageProcessId = null;
        return;
      }

      // editText / editElements: replace placeholder with split layers (grouped).
      if (Array.isArray(layers) && layers.length > 0) {
        const { document: next, ids } = applyImageDecomposeLayers(state.document, nodeId, layers, {
          sourceWidth,
          sourceHeight,
        });
        state.document = next;
        state.dirty = true;
        state.sceneReloadToken += 1;
        if (state.pendingImageProcessId === nodeId) state.pendingImageProcessId = null;
        if (ids.length) {
          state.selectedNodeId = ids[0];
          state.selectedNodeIds = ids;
        }
        syncLibraryOnEdit(state);
        return;
      }

      let next = clearImageProcessAttrs(state.document, nodeId);
      if (nextSrc) {
        const extra = (action.payload?.attrs || {}) as Record<string, unknown>;
        next = updateNodeInDocument(next, nodeId, {
          attrs: {
            src: nextSrc,
            // Cutouts are always transparent PNG assets.
            ...(String(extra.cutout || '') === 'true' || String(extra.cutout) === '1'
              ? { cutout: 'true', assetKind: 'image' }
              : {}),
            ...(extra.name ? { name: String(extra.name) } : {}),
            ...(extra.assetKind ? { assetKind: String(extra.assetKind) } : {}),
            ...(extra.uploadKey ? { uploadKey: String(extra.uploadKey) } : {}),
            ...(extra.genPrompt != null
              ? { genPrompt: String(extra.genPrompt || '').trim() || undefined }
              : {}),
            ...(extra.imageVariants != null
              ? { imageVariants: extra.imageVariants }
              : {}),
          },
        });
      }
      state.document = next;
      state.dirty = true;
      state.sceneReloadToken += 1;
      if (state.pendingImageProcessId === nodeId) state.pendingImageProcessId = null;
      syncLibraryOnEdit(state);
    },
    /** Drop a failed process clone and clear pending id. */
    failImageProcess(state, action) {
      const nodeId = action.payload?.nodeId || state.pendingImageProcessId;
      if (!nodeId) return;
      if (state.pendingImageProcessId === nodeId) state.pendingImageProcessId = null;
      if (!state.document?.deltaSetLike?.[nodeId]) return;
      state.document = removeNodesFromDocument(state.document, [nodeId]);
      state.dirty = true;
      state.sceneReloadToken += 1;
      if (state.selectedNodeId === nodeId) {
        state.selectedNodeId = null;
        state.selectedNodeIds = [];
      } else if (state.selectedNodeIds?.includes(nodeId)) {
        state.selectedNodeIds = state.selectedNodeIds.filter((id: string) => id !== nodeId);
        state.selectedNodeId = state.selectedNodeIds[0] || null;
      }
      syncLibraryOnEdit(state);
    },
    openImageToolPanel(state, action) {
      const { nodeId, kind } = action.payload || {};
      if (!nodeId || !kind) return;
      state.imageToolPanel = { nodeId, kind };
      state.videoToolPanel = null;
      state.audioToolPanel = null;
      state.shapeStylePanel = null;
    },
    closeImageToolPanel(state) {
      state.imageToolPanel = null;
    },
    openVideoToolPanel(state, action) {
      const { nodeId, kind, keepTime } = action.payload || {};
      if (!nodeId || kind !== 'trim') return;
      const t = Number(keepTime);
      state.videoToolPanel = {
        nodeId,
        kind,
        ...(Number.isFinite(t) && t >= 0 ? { keepTime: t } : null),
      };
      state.imageToolPanel = null;
      state.audioToolPanel = null;
      state.shapeStylePanel = null;
    },
    closeVideoToolPanel(state) {
      state.videoToolPanel = null;
    },
    openAudioToolPanel(state, action) {
      const { nodeId, kind, keepTime } = action.payload || {};
      if (!nodeId || (kind !== 'trim' && kind !== 'speed')) return;
      const t = Number(keepTime);
      state.audioToolPanel = {
        nodeId,
        kind,
        ...(kind === 'trim' && Number.isFinite(t) && t >= 0 ? { keepTime: t } : null),
      };
      state.imageToolPanel = null;
      state.videoToolPanel = null;
      state.shapeStylePanel = null;
    },
    closeAudioToolPanel(state) {
      state.audioToolPanel = null;
    },
    openShapeStylePanel(state, action) {
      const kind = action.payload?.kind;
      const nodeIds = Array.isArray(action.payload?.nodeIds)
        ? action.payload.nodeIds.filter(Boolean)
        : [];
      if ((kind !== 'fill' && kind !== 'stroke' && kind !== 'radius') || !nodeIds.length) return;
      state.shapeStylePanel = { kind, nodeIds };
      state.imageToolPanel = null;
      state.videoToolPanel = null;
      state.audioToolPanel = null;
    },
    closeShapeStylePanel(state) {
      state.shapeStylePanel = null;
    },
    setPenStrokeColor(state, action) {
      const hex = String(action.payload || '').trim();
      if (hex) state.penStrokeColor = hex;
    },
    setPenStrokeWidth(state, action) {
      const n = Number(action.payload);
      if (!Number.isFinite(n)) return;
      state.penStrokeWidth = Math.max(1, Math.min(200, Math.round(n)));
    },
    setPenStrokeOpacity(state, action) {
      const n = Number(action.payload);
      if (!Number.isFinite(n)) return;
      state.penStrokeOpacity = Math.max(1, Math.min(100, Math.round(n)));
    },
    setBucketFill(state, action) {
      const next = action.payload;
      if (!next || typeof next !== 'object') return;
      state.bucketFill = {
        ...state.bucketFill,
        ...next,
        fillType: next.fillType || state.bucketFill.fillType || 'solid',
        fillColor: String(next.fillColor || state.bucketFill.fillColor || '#333333'),
        fillOpacity: Math.max(
          0,
          Math.min(100, Math.round(Number(next.fillOpacity ?? state.bucketFill.fillOpacity) || 100))
        ),
      };
    },
    setPencilBrushId(state, action) {
      const id = String(action.payload || '').trim();
      if (id) state.pencilBrushId = id;
    },
    setPencilEraseMode(state, action) {
      state.pencilEraseMode = Boolean(action.payload);
    },
    setPencilPressureEnabled(state, action) {
      state.pencilPressureEnabled = Boolean(action.payload);
    },
    setPencilHardness(state, action) {
      const n = Number(action.payload);
      if (!Number.isFinite(n)) return;
      state.pencilHardness = Math.max(0, Math.min(100, Math.round(n)));
    },
    setWorkspaceMode(state, action) {
      const mode = action.payload;
      if (mode === 'design' || mode === 'dev') {
        state.workspaceMode = mode;
        if (mode !== 'dev') state.devHoverNodeId = null;
      }
    },
    setDevHoverNodeId(state, action) {
      state.devHoverNodeId = action.payload || null;
    },
    setAgentBusy(state, action) {
      state.agentBusy = Boolean(action.payload);
    },
    startCanvasAttachPick(
      state,
      action: PayloadAction<{ target: string; accept?: 'image' | 'media' }>
    ) {
      const target = String(action.payload?.target || '').trim();
      if (!target) {
        state.canvasAttachPick = null;
        state.canvasAttachPickBlocked = false;
        return;
      }
      const accept = action.payload?.accept === 'image' ? 'image' : 'media';
      state.canvasAttachPick = { target, accept };
      state.canvasAttachPickBlocked = false;
      state.pendingCanvasAttach = null;
    },
    clearCanvasAttachPick(state) {
      state.canvasAttachPick = null;
      state.canvasAttachPickBlocked = false;
    },
    setCanvasAttachPickBlocked(state, action: PayloadAction<boolean>) {
      state.canvasAttachPickBlocked = Boolean(action.payload);
    },
    setPendingCanvasAttach(
      state,
      action: PayloadAction<{ target: string; payload: string | string[] } | null>
    ) {
      if (!action.payload) {
        state.pendingCanvasAttach = null;
        return;
      }
      const target = String(action.payload.target || '').trim();
      if (!target) {
        state.pendingCanvasAttach = null;
        return;
      }
      state.pendingCanvasAttach = {
        target,
        payload: action.payload.payload,
      };
      // Keep canvasAttachPick until consume — cleared by SvgCanvas after one pick.
    },
    consumePendingCanvasAttach(state) {
      state.pendingCanvasAttach = null;
    },
    enqueueAgentContexts(
      state,
      action: PayloadAction<
        Array<{
          key: string;
          label: string;
          kind: string;
          payload: string;
          dataUrl?: string;
          thumbUrl?: string;
        }>
      >
    ) {
      const list = Array.isArray(action.payload) ? action.payload : [];
      if (!list.length) return;
      state.pendingAgentContexts = [...state.pendingAgentContexts, ...list];
      state.agentOpenNonce = (Number(state.agentOpenNonce) || 0) + 1;
    },
    consumePendingAgentContexts(state) {
      state.pendingAgentContexts = [];
    },
  },
});

export const {
  createTemplate,
  openTemplate,
  setDocument,
  setDocumentFromCanvas,
  bakeDocumentOrigin,
  removeDocumentNodes,
  patchDocumentNode,
  patchDocumentNodes,
  setSelectedNodeId,
  setSelectedNodeIds,
  addArtboardFrame,
  setActiveFrameId,
  setSelectedFrameIds,
  setMixedSelection,
  removeArtboardFrames,
  renameArtboardFrame,
  updateArtboardFrame,
  updateArtboardFrames,
  pushEditorHistory,
  beginAiSceneMutation,
  endAiSceneMutation,
  renameTemplate,
  persistCurrent,
  clearEditorDirty,
  applyCollabDocument,
  applyCollabScenePatch,
  importDocument,
  mergeImportedDocument,
  startImportPlaceholder,
  finishImportPlaceholder,
  cancelImportPlaceholder,
  setAiOperationState,
  clearArtboardGenerating,
  deleteTemplate,
  deleteTemplates,
  renameTemplateById,
  setTemplateThumbnail,
  clearProjectsLibrary,
  undo,
  redo,
  setActiveTool,
  setGridMode,
  setShapeKind,
  setPendingImageSrc,
  setCanvasSize,
  setCanvasMeta,
  startImageUploadPlaceholder,
  startVideoUploadPlaceholder,
  spawnImageGenerator,
  spawnVideoGenerator,
  spawnLottieGenerator,
  spawnAudioGenerator,
  spawnLottie,
  spawnAudio,
  spawnCreatedNode,
  placeMediaAsset,
  finishImageGenerator,
  finishVideoGenerator,
  finishLottieGenerator,
  finishAudioGenerator,
  detachImageVariant,
  startImageProcess,
  finishImageProcess,
  failImageProcess,
  openImageToolPanel,
  closeImageToolPanel,
  openVideoToolPanel,
  closeVideoToolPanel,
  openAudioToolPanel,
  closeAudioToolPanel,
  openShapeStylePanel,
  closeShapeStylePanel,
  setPenStrokeColor,
  setPenStrokeWidth,
  setPenStrokeOpacity,
  setBucketFill,
  setPencilBrushId,
  setPencilEraseMode,
  setPencilPressureEnabled,
  setPencilHardness,
  setWorkspaceMode,
  setDevHoverNodeId,
  setAgentBusy,
  startCanvasAttachPick,
  clearCanvasAttachPick,
  setCanvasAttachPickBlocked,
  setPendingCanvasAttach,
  consumePendingCanvasAttach,
  enqueueAgentContexts,
  consumePendingAgentContexts,
} = editorSlice.actions;

export default editorSlice.reducer;
