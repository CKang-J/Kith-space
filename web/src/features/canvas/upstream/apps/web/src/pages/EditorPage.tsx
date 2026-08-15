/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/pages/EditorPage.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { requestCanvasSelectionToChat } from '@/features/canvas/adapters/recombynSelectionToChat';
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { message } from '@recombyn-native/components/base';
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';
import { store } from '@recombyn-native/store';
import { useProjectCloudSync, ProjectRevisionConflictDialog } from '@recombyn-native/components/editor/useProjectCloudSync';
import { CollabRoomProvider } from '@recombyn-native/components/editor/collab/CollabRoomProvider';
import { isCollabActive } from '@recombyn-native/components/editor/collab/collabRuntime';
import DevPropertiesPanel from '@recombyn-native/components/editor/panels/DevPropertiesPanel';
import ShareDialog from '@recombyn-native/components/editor/panels/ShareDialog';
import { apiClient } from '@recombyn-native/service/client';
import type { ShareDto } from '@recombyn-native/models/shares';
import EditorBootOverlay from '@recombyn-native/components/editor/chrome/EditorBootOverlay';
import {
  RCB_DEFAULT_CAMERA as DEFAULT_CAMERA,
  RCB_MAX_ZOOM,
  RCB_MIN_ZOOM,
  rcbFitCamera,
  zoomAtPoint,
  PENCIL_CURSOR,
  ERASER_CURSOR,
  PEN_CURSOR,
  BUCKET_CURSOR,
  type RcbCamera as CanvasCamera,
} from '@recombyn-native/components/rcb';
import LayerPanel from '@recombyn-native/components/editor/panels/LayerPanel';
import AssetPanel from '@recombyn-native/components/editor/panels/AssetPanel';
import EditorToolStrip from '@recombyn-native/components/editor/chrome/EditorToolStrip';
import type { PathEditSubtool } from '@recombyn-native/components/editor/chrome/PathEditToolbar';
import { getDocumentGridSize } from '@recombyn-native/components/rcb/selection/alignGuides';
import { cn } from '@recombyn-native/utils/classnames';
import { fetchProject } from '@recombyn-native/service/projects';
import {
  createEmptyDocument,
  listSceneNodes
} from '@recombyn-native/components/rcb/scene/document/sceneDocument';
import {
  getProjectDraft,
  getProjectSession,
  putProjectDraft,
  putProjectSession,
} from '@recombyn-native/components/editor/projectDraftStore';
import {
  createTemplate,
  importDocument,
  openTemplate,
  renameTemplate,
  setActiveFrameId,
  setMixedSelection,
  setGridMode,
  setSelectedNodeId,
  setTemplateThumbnail,
  setWorkspaceMode,
  bakeDocumentOrigin,
  EMPTY_ID_LIST,
} from '@recombyn-native/store/modules/editor';
import { normalizeProjectThumbnailUrls, collageOrSingleThumb } from '@recombyn-native/utils/projectThumb';
import type { ArtboardFrame } from '@recombyn-native/components/rcb/frames/types';
import type { FillPanelValue } from '@recombyn-native/components/editor/panels/FillPanel';
import { cssSolidWithOpacity } from '@recombyn-native/components/base/colorPanel';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import {
  cssPreviewForGradient,
  DEFAULT_FILL_IMAGE_ADJUST,
  parseFillGradient,
  parseFillImageFit,
  parseFillType,
  type FillType,
} from '@recombyn-native/components/rcb/scene/document/sceneFill';
import EditorOnboardingTour, {
  hasCompletedEditorTour,
} from '@recombyn-native/components/editor/chrome/EditorOnboardingTour';
import EditorTopChrome, { flushAndGoHome } from '@recombyn-native/components/editor/page/EditorTopChrome';
import EditorToolDocks from '@recombyn-native/components/editor/page/EditorToolDocks';
import EditorBottomHud, { isThemeFollowCanvasBg } from '@recombyn-native/components/editor/page/EditorBottomHud';
import { loadFontCatalog } from '@recombyn-native/components/rcb/scene/document/fontCatalog';
import EditorStageWorld from '@recombyn-native/components/editor/page/EditorStageWorld';

const BOOT_MIN_MS = 520;
const BOOT_EXIT_MS = 280;

/** Jump diagnostics (`window.__rcbJumpDump`). */
function rcbJumpLog(event: string, data: Record<string, unknown> = {}) {
  const row = { event, t: Math.round(performance.now()), ...data };
  const w = window as Window & {
    __rcbJumpLog?: unknown[];
    __rcbJumpDump?: () => string;
  };
  if (!Array.isArray(w.__rcbJumpLog)) w.__rcbJumpLog = [];
  w.__rcbJumpLog.push(row);
  w.__rcbJumpDump = () => JSON.stringify(w.__rcbJumpLog, null, 2);
}

function documentToCanvasFill(document: SceneDocument, themeFallback: string): FillPanelValue {
  const raw = String(document?.backgroundColor || '').trim();
  const fillType = parseFillType(document?.backgroundFillType);
  const panelType = (
    fillType === 'linear' ||
    fillType === 'radial' ||
    fillType === 'angular' ||
    fillType === 'diffuse' ||
    fillType === 'image'
      ? fillType
      : 'solid'
  ) as FillType;

  return {
    fillType: panelType,
    fillColor: raw || themeFallback,
    fillOpacity: Number(document?.backgroundOpacity ?? 100),
    fillGradient: document?.backgroundGradient as FillPanelValue['fillGradient'],
    fillImageSrc: document?.backgroundImageSrc != null ? String(document.backgroundImageSrc) : undefined,
    fillImageFit: parseFillImageFit(document?.backgroundImageFit),
    fillImageRotate: Number(document?.backgroundImageRotate || 0) as FillPanelValue['fillImageRotate'],
    fillImageAdjust:
      (document?.backgroundImageAdjust as FillPanelValue['fillImageAdjust']) ||
      DEFAULT_FILL_IMAGE_ADJUST,
  };
}

function computeWorldSurface(doc: SceneDocument, frames: ArtboardFrame[]) {
  let maxX = 3600;
  let maxY = 2400;
  for (const f of frames) {
    maxX = Math.max(maxX, f.x + f.width + 400);
    maxY = Math.max(maxY, f.y + f.height + 400);
  }
  const children: string[] = doc?.deltaSetLike?.ROOT?.children || [];
  for (const id of children) {
    const node = doc?.deltaSetLike?.[id];
    if (!node) continue;
    const x = Number(node.x) || 0;
    const y = Number(node.y) || 0;
    const w = Math.max(1, Number(node.width) || 0);
    const h = Math.max(1, Number(node.height) || 0);
    maxX = Math.max(maxX, x + w + 400);
    maxY = Math.max(maxY, y + h + 400);
  }
  return { x: 0, y: 0, width: Math.ceil(maxX), height: Math.ceil(maxY) };
}

function useThemeCanvasColor() {
  const [color, setColor] = useState('#f5f5f5');
  useEffect(() => {
    const read = () => {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue('--canvas')
        .trim();
      if (v) setColor(v);
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    return () => obs.disconnect();
  }, []);
  return color;
}

function useViewportMatch(query: string) {
  const read = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

type SceneBox = { x: number; y: number; width: number; height: number };

function unionSceneBox(a: SceneBox | null, b: SceneBox): SceneBox {
  if (!a) return { ...b };
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/** Union of artboards + scene nodes for zoom-to-fit. */
function editorContentBounds(doc: SceneDocument, frames: ArtboardFrame[]): SceneBox {
  let box: SceneBox | null = null;
  for (const f of frames) {
    box = unionSceneBox(box, {
      x: f.x,
      y: f.y,
      width: Math.max(1, f.width),
      height: Math.max(1, f.height),
    });
  }
  for (const { node } of listSceneNodes(doc)) {
    if (!node) continue;
    const { left, top } = nodeLeftTop(doc, node);
    const w = Math.max(1, Number(node.width) || 0);
    const h = Math.max(1, Number(node.height) || 0);
    if (w < 2 && h < 2) continue;
    box = unionSceneBox(box, { x: left, y: top, width: w, height: h });
  }
  if (!box) return { x: 0, y: 0, width: 1200, height: 800 };
  return box;
}

/** True when the scene has real artboards/nodes 鈥?not the empty-doc fallback box. */
function editorHasFitContent(doc: SceneDocument, frames: ArtboardFrame[]): boolean {
  for (const f of frames) {
    if ((Number(f.width) || 0) >= 2 && (Number(f.height) || 0) >= 2) return true;
  }
  for (const { node } of listSceneNodes(doc)) {
    if (!node) continue;
    const w = Math.max(0, Number(node.width) || 0);
    const h = Math.max(0, Number(node.height) || 0);
    if (w >= 2 && h >= 2) return true;
  }
  return false;
}

function computeStageBackground(
  document: SceneDocument,
  followThemeCanvas: boolean,
  themeCanvas: string
): string | undefined {
  const type = parseFillType(document?.backgroundFillType);
  const opacity = Number(document?.backgroundOpacity ?? 100);
  const baseColor = followThemeCanvas
    ? themeCanvas
    : String(document?.backgroundColor || '').trim() || themeCanvas;

  if (followThemeCanvas && type === 'solid' && opacity >= 100) return undefined;

  if (type === 'solid' || !document?.backgroundFillType) {
    return cssSolidWithOpacity(baseColor, opacity);
  }
  if (type === 'image') {
    const src = String(document?.backgroundImageSrc || '');
    if (!src) return cssSolidWithOpacity(baseColor, opacity);
    return `url(${src}) center / cover no-repeat`;
  }
  const gradient = parseFillGradient(document?.backgroundGradient, type, baseColor);
  return cssPreviewForGradient({ ...gradient, type }, opacity);
}

function resolveEditorCanvasCursor(
  frameMode: boolean,
  activeTool: string,
  pencilEraseMode: boolean,
  pickMode: { active: boolean; blocked: boolean }
): string | undefined {
  if (pickMode.active) return pickMode.blocked ? 'not-allowed' : 'copy';
  if (frameMode) return 'crosshair';
  if (activeTool === 'pencil') return pencilEraseMode ? ERASER_CURSOR : PENCIL_CURSOR;
  if (activeTool === 'pen') return PEN_CURSOR;
  if (activeTool === 'bucket') return BUCKET_CURSOR;
  return undefined;
}

type EditorProjectDraft = Awaited<ReturnType<typeof getProjectDraft>>;

function shouldPreferLocalDraft(
  draft: EditorProjectDraft,
  proj: { document?: unknown; updatedAt?: number } | null | undefined
): boolean {
  if (!draft?.document) return false;
  const cloudUpdated = Number(proj?.updatedAt) || 0;
  const draftUpdated = Number(draft.updatedAt) || 0;
  return (
    !proj?.document ||
    draftUpdated > cloudUpdated ||
    (draftUpdated === cloudUpdated && !draft.syncedAt)
  );
}

function persistUnsyncedDraft(
  targetId: string,
  draft: NonNullable<EditorProjectDraft>,
  name: string
) {
  void putProjectDraft({
    projectId: targetId,
    name,
    document: draft.document,
    updatedAt: draft.updatedAt || Date.now(),
    syncedAt: null,
    cloudRevision: null,
    baseDocument: null,
  });
}

/** Keep /editor/:id when cloud has no row yet 鈥?never mint a second nanoid. */
function seedLocalProjectForUrl(
  targetId: string,
  dispatch: ReturnType<typeof useDispatch>,
  name: string,
  document: unknown
) {
  dispatch(
    importDocument({
      id: targetId,
      name,
      document,
      source: 'user',
      dirty: true,
    })
  );
  void putProjectDraft({
    projectId: targetId,
    name,
    document,
    updatedAt: Date.now(),
    syncedAt: null,
    cloudRevision: null,
    baseDocument: null,
  });
}

async function hydrateShareTarget(
  targetId: string,
  dispatch: ReturnType<typeof useDispatch>,
  navigate: ReturnType<typeof useNavigate>,
  t: (key: string, opts?: Record<string, unknown>) => string,
  isCancelled: () => boolean
) {
  try {
    const res = (await apiClient.sharesSharesGet({
      params: { share_id: targetId },
    })) as { share: ShareDto };
    if (isCancelled()) return;
    const s = res.share;
    if (!s?.document || !s.viewerCanEdit) {
      message.warning(t('editor.shareNoEditAccess'));
      navigate(`/s/${encodeURIComponent(targetId)}`, { replace: true });
      return;
    }
    dispatch(
      importDocument({
        id: s.id,
        name: s.name || t('home.untitled'),
        document: s.document,
        source: 'scratch',
      })
    );
    dispatch(setWorkspaceMode('design'));
  } catch {
    if (isCancelled()) return;
    message.error(t('editor.shareOpenFailed'));
    navigate(`/s/${encodeURIComponent(targetId)}`, { replace: true });
  }
}

async function hydrateCloudProject(
  targetId: string,
  dispatch: ReturnType<typeof useDispatch>,
  t: (key: string, opts?: Record<string, unknown>) => string,
  isCancelled: () => boolean
) {
  let draft: Awaited<ReturnType<typeof getProjectDraft>> | null = null;
  try {
    draft = await getProjectDraft(targetId);
  } catch {
    draft = null;
  }
  // Local-only id (nanoid before first successful PUT): GET would always 404.
  if (draft?.document && !draft.syncedAt) {
    if (isCancelled()) return;
    const name = draft.name || t('home.untitled');
    dispatch(
      importDocument({
        id: targetId,
        name,
        document: draft.document,
        source: 'user',
        dirty: true,
      })
    );
    persistUnsyncedDraft(targetId, draft, name);
    return;
  }
  try {
    const res = await fetchProject(targetId);
    if (isCancelled()) return;
    const proj = res.project;
    const cloudUpdated = Number(proj?.updatedAt) || 0;
    const cloudRev = Number(proj?.revision);
    const revision = Number.isFinite(cloudRev) && cloudRev >= 1 ? cloudRev : null;

    if (shouldPreferLocalDraft(draft, proj) && draft?.document) {
      const needsUpload = !draft.syncedAt;
      const name = draft.name || proj?.name || t('home.untitled');
      dispatch(
        importDocument({
          id: targetId,
          name,
          document: draft.document,
          source: 'user',
          dirty: needsUpload,
        })
      );
      if (needsUpload) persistUnsyncedDraft(targetId, draft, name);
      return;
    }

    if (!proj?.document) {
      if (draft?.document) {
        const name = draft.name || t('home.untitled');
        dispatch(
          importDocument({
            id: targetId,
            name,
            document: draft.document,
            source: 'user',
            dirty: !draft.syncedAt,
          })
        );
        if (!draft.syncedAt) persistUnsyncedDraft(targetId, draft, name);
        return;
      }
      seedLocalProjectForUrl(
        targetId,
        dispatch,
        t('home.untitled'),
        createEmptyDocument({ emptyWorld: true })
      );
      return;
    }

    dispatch(
      importDocument({
        id: proj.id,
        name: proj.name || t('home.untitled'),
        document: proj.document,
        source: 'user',
      })
    );
    {
      const thumbs = normalizeProjectThumbnailUrls(proj.thumbnailUrl, proj.updatedAt);
      dispatch(
        setTemplateThumbnail({
          id: proj.id,
          thumbnail: collageOrSingleThumb(thumbs),
          custom: Boolean(proj.thumbnailCustom),
        })
      );
    }
    void putProjectDraft({
      projectId: proj.id,
      name: proj.name || t('home.untitled'),
      document: proj.document,
      updatedAt: cloudUpdated || Date.now(),
      syncedAt: Date.now(),
      cloudRevision: revision,
      baseDocument: proj.document,
    });
  } catch {
    if (isCancelled()) return;
    if (draft?.document) {
      const name = draft.name || t('home.untitled');
      dispatch(
        importDocument({
          id: targetId,
          name,
          document: draft.document,
          source: 'user',
          dirty: true,
        })
      );
      persistUnsyncedDraft(targetId, draft, name);
      return;
    }
    seedLocalProjectForUrl(
      targetId,
      dispatch,
      t('home.untitled'),
      createEmptyDocument({ emptyWorld: true })
    );
  }
}

function EditorPage() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  // Defer font catalog off home cold path (was eager in main.tsx).
  useEffect(() => {
    void loadFontCatalog();
  }, []);
  const [camera, setCamera] = useState<CanvasCamera>(DEFAULT_CAMERA);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Layers / assets docks stay closed by default (open only via HUD toggle).
  const [layersOpen, setLayersOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [canvasBgOpen, setCanvasBgOpen] = useState(false);
  /** Enter page / fit-to-canvas 鈥?menu highlights銆岄€傚簲鐢诲竷銆島ntil user picks another zoom. */
  const [zoomFitActive, setZoomFitActive] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [pathEditOpen, setPathEditOpen] = useState(false);
  const [pathEditSubtool, setPathEditSubtool] = useState<PathEditSubtool>('select');
  const [canvasMeshSelectedIndex, setCanvasMeshSelectedIndex] = useState(0);
  const [canvasMeshShowGuides, setCanvasMeshShowGuides] = useState(true);
  const themeCanvas = useThemeCanvasColor();
  const isMobileViewport = useViewportMatch('(max-width: 767px)');
  const isTabletViewport = useViewportMatch('(max-width: 1279px)');
  const useCompactTooling = isTabletViewport;
  const [bootOpen, setBootOpen] = useState(true);
  const [bootExiting, setBootExiting] = useState(false);
  const [bootProgress, setBootProgress] = useState(8);
  const bootStartedAt = useRef(Date.now());
  const bootOpenRef = useRef(true);
  const bootFinishingRef = useRef(false);
  const bootExitTimer = useRef<number | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  /** Local session: selection + grid. Camera fits once after stage layout (below). */
  const sessionReadyForIdRef = useRef<string | null>(null);
  const didInitialFitRef = useRef(false);
  /** User pan/zoom 鈥?do not overwrite with auto-fit. */
  const cameraUserTouchedRef = useRef(false);
  const gridUserTouchedRef = useRef(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageEl, setStageEl] = useState<HTMLElement | null>(null);
  const document = useSelector((state: any) => state.editor.document);
  useProjectCloudSync();
  const sceneReloadToken = useSelector((state: any) => state.editor.sceneReloadToken);
  const documentPatchToken = useSelector((state: any) => state.editor.documentPatchToken);
  const lastPatchedNodeIds = useSelector(
    (state: any) => (state.editor.lastPatchedNodeIds as string[]) ?? EMPTY_ID_LIST
  );
  const selectedNodeId = useSelector((state: any) => state.editor.selectedNodeId);
  const selectedNodeIds = useSelector(
    (state: any) => (state.editor.selectedNodeIds as string[]) ?? EMPTY_ID_LIST
  );
  const selectedFrameIds = useSelector(
    (state: any) => (state.editor.selectedFrameIds as string[]) ?? EMPTY_ID_LIST
  );
  const currentId = useSelector((state: any) => state.editor.currentId as string | null);
  const templates = useSelector((state: any) => state.editor.templates as any[]);
  const currentTemplate = useSelector((state: any) =>
    state.editor.templates.find((item: any) => item.id === state.editor.currentId)
  );

  // Persist share-edit sessions back to the shares API (not projects).
  // When a Yjs room is active, CollabRoomProvider owns the debounced write.
  const shareSaveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!currentId?.startsWith('share_') || !document) return undefined;
    if (isCollabActive()) return undefined;
    if (shareSaveTimer.current) window.clearTimeout(shareSaveTimer.current);
    const id = currentId;
    shareSaveTimer.current = window.setTimeout(() => {
      async function persistShareDocument() {
        try {
          await apiClient.sharesSharesUpdateDocument({
            params: { share_id: id },
            body: { document: document as Record<string, unknown> },
          });
        } catch {
          /* ignore */
        }
      }
      void persistShareDocument();
    }, 700);
    return () => {
      if (shareSaveTimer.current) window.clearTimeout(shareSaveTimer.current);
    };
  }, [currentId, document]);

  const activeTool = useSelector((state: any) => state.editor.activeTool);
  const pencilEraseMode = useSelector((state: any) => Boolean(state.editor.pencilEraseMode));
  const canvasAttachPick = useSelector(
    (state: any) => state.editor.canvasAttachPick as null | { target: string }
  );
  const canvasAttachPickBlocked = useSelector((state: any) =>
    Boolean(state.editor.canvasAttachPickBlocked)
  );
  const isGridMode = useSelector((state: any) => Boolean(state.editor.isGridMode));
  const gridSize = getDocumentGridSize(document);
  const workspaceMode = useSelector(
    (state: any) => state.editor.workspaceMode || 'design'
  ) as 'design' | 'dev';

  useEffect(() => {
    const onPathEdit = (e: Event) => {
      const active = Boolean((e as CustomEvent).detail?.active);
      setPathEditOpen(active);
      // Keep toolbar in sync with canvas: Select is the default when entering path edit.
      if (active) setPathEditSubtool('select');
    };
    const onSubtool = (e: Event) => {
      const s = (e as CustomEvent).detail?.subtool;
      setPathEditSubtool(s === 'pen' ? 'pen' : 'select');
    };
    window.addEventListener('resume:path-edit', onPathEdit);
    window.addEventListener('resume:path-edit-subtool', onSubtool);
    return () => {
      window.removeEventListener('resume:path-edit', onPathEdit);
      window.removeEventListener('resume:path-edit-subtool', onSubtool);
    };
  }, []);

  const followThemeCanvas = isThemeFollowCanvasBg(String(document?.backgroundColor || ''));
  const canvasFillValue = useMemo(
    () => documentToCanvasFill(document, themeCanvas),
    [document, themeCanvas]
  );
  const stageBackground = useMemo(
    () => computeStageBackground(document, followThemeCanvas, themeCanvas),
    [document, followThemeCanvas, themeCanvas]
  );

  /** Editor UI is design-only; hide legacy Design/Dev toggle. */
  useEffect(() => {
    dispatch(setWorkspaceMode('design'));
  }, [dispatch]);

  const isDevMode = workspaceMode === 'dev';
  const panMode = activeTool === 'pan';
  const frameMode = !isDevMode && activeTool === 'frame';
  const canvasCursor = resolveEditorCanvasCursor(frameMode, activeTool, pencilEraseMode, {
    active: Boolean(canvasAttachPick),
    blocked: canvasAttachPickBlocked,
  });

  const frames: ArtboardFrame[] = Array.isArray(document?.frames) ? document.frames : [];
  const activeFrameId = document?.activeFrameId ?? null;
  const activeFrame = frames.find((f) => f.id === activeFrameId) ?? null;
  const selectedFrames = frames.filter(
    (f) => !f.hidden && selectedFrameIds.includes(f.id)
  );
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = stageEl;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const apply = () => {
      const next = {
        width: Math.max(1, el.clientWidth),
        height: Math.max(1, el.clientHeight),
      };
      setStageSize((prev) => {
        if (prev.width === next.width && prev.height === next.height) return prev;
        rcbJumpLog('stageSize', {
          prev,
          next,
          bootOpen: bootOpenRef.current,
          didFit: didInitialFitRef.current,
        });
        return next;
      });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stageEl]);

  /**
   * Catch late auto-fit / collab camera writes AFTER boot.
   * Skip when the user already owns the camera 鈥?otherwise every wheel zoom
   * spam-logs as `afterReveal` and looks like a reveal fight (it is not).
   */
  useEffect(() => {
    if (bootOpen) return;
    if (cameraUserTouchedRef.current) return;
    rcbJumpLog('camera.afterReveal', {
      x: Number(camera.x.toFixed(2)),
      y: Number(camera.y.toFixed(2)),
      zoom: Number(camera.zoom.toFixed(4)),
      userTouched: false,
      stageW: stageSize.width,
      stageH: stageSize.height,
      stack: (new Error().stack || '')
        .split('\n')
        .slice(2, 10)
        .map((s) => s.trim()),
    });
  }, [bootOpen, camera.x, camera.y, camera.zoom, stageSize.width, stageSize.height]);

  // Scene paper follows content bounds only. Camera pan/zoom is CSS on RcbCanvas 鈥?
  // never resize/slide SVG viewBox to chase the frustum.
  const worldSurface = document
    ? computeWorldSurface(document, frames)
    : { x: 0, y: 0, width: 3600, height: 2400 };
  // RcbCanvas autofit disabled here 鈥?we only center once on first load (below).
  const worldBounds = { x: 0, y: 0, width: 0, height: 0 };

  /** Stable embedded scene doc 鈥?avoid `document={{...}}` identity churn each render.
   * Paper fill is transparent here so SVG hosts don't paint over the stage CSS fill.
   * Reducers preserve real stage `backgroundColor` when this view doc is committed. */
  const canvasDocument = useMemo(() => {
    if (!document) return null;
    return {
      ...document,
      x: 0,
      y: 0,
      // Content bounds only 鈥?viewport coverage is handled by viewRect, not doc size.
      width: worldSurface.width,
      height: worldSurface.height,
      backgroundColor: 'transparent',
      backgroundFillType: 'solid' as const,
    };
  }, [document, worldSurface.width, worldSurface.height]);

  // Home "New project" / URL projectId / post-login ?from= intent (URL query).
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(location.search);
    const createNew = params.get('createNew') === '1';
    const fromHomeAgent = params.get('fromHomeAgent') === '1';
    const targetId = decodeURIComponent((routeProjectId || '').trim());

    if (createNew) {
      dispatch(createTemplate({ emptyWorld: true }));
      const ed = (store.getState() as any).editor as {
        currentId?: string | null;
        document?: unknown;
        templates?: { id: string; name?: string }[];
      };
      const id = String(ed?.currentId || '');
      // Persist before first edit so refresh / hydrate won't GET a missing cloud row.
      if (id && ed.document) {
        const name =
          ed.templates?.find((x) => x.id === id)?.name || t('home.untitled');
        void putProjectDraft({
          projectId: id,
          name,
          document: ed.document,
          updatedAt: Date.now(),
          syncedAt: null,
          cloudRevision: null,
          baseDocument: null,
        });
      }
      // Jump straight to /editor/:id so we never rely on a second remounting route.
      if (id) {
        navigate(
          fromHomeAgent
            ? `/editor/${encodeURIComponent(id)}?fromHomeAgent=1`
            : `/editor/${encodeURIComponent(id)}`,
          { replace: true }
        );
      } else {
        navigate(fromHomeAgent ? '/editor?fromHomeAgent=1' : '/editor', { replace: true });
      }
      return () => {
        cancelled = true;
      };
    }

    if (targetId) {
      if (currentId === targetId && document) {
        return () => {
          cancelled = true;
        };
      }
      const local = templates.find((x) => x.id === targetId);
      if (local?.document) {
        dispatch(openTemplate(targetId));
        return () => {
          cancelled = true;
        };
      }

      // Shared document edit 鈥?same EditorPage chrome; persist via shares API.
      if (targetId.startsWith('share_')) {
        void hydrateShareTarget(targetId, dispatch, navigate, t, () => cancelled);
        return () => {
          cancelled = true;
        };
      }

      void hydrateCloudProject(targetId, dispatch, t, () => cancelled);
      return () => {
        cancelled = true;
      };
    }

    if (!document) dispatch(createTemplate({ emptyWorld: true }));
    return () => {
      cancelled = true;
    };
    // Only re-run when route / nav intent changes 鈥?not on every doc edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, routeProjectId, location.search, navigate, t]);

  /** Local session: selection + grid. Camera fits once after stage layout (below). */
  useEffect(() => {
    sessionReadyForIdRef.current = null;
    didInitialFitRef.current = false;
    cameraUserTouchedRef.current = false;
    gridUserTouchedRef.current = false;
    setZoomFitActive(true);
    // Keep previous camera until fit 鈥?snapping to DEFAULT here causes a visible jump.
    dispatch(setGridMode(false));
  }, [currentId, dispatch]);

  useEffect(() => {
    if (!currentId || !document) return;
    if (sessionReadyForIdRef.current === currentId) return;
    let cancelled = false;
    async function restoreSession() {
      let session: Awaited<ReturnType<typeof getProjectSession>> | null = null;
      try {
        session = await getProjectSession(currentId);
      } catch {
        session = null;
      }
      if (cancelled) return;
      // Do not restore session.camera 鈥?enter page always fits content once after load.
      if (!gridUserTouchedRef.current) {
        dispatch(setGridMode(Boolean(session?.isGridMode)));
      }
      const delta = document?.deltaSetLike || {};
      const nodeIds = (session?.selectedNodeIds || []).filter(
        (id) => id && id !== 'ROOT' && delta[id]
      );
      const frameValid = new Set(
        (Array.isArray(document?.frames) ? document.frames : [])
          .map((f: any) => String(f?.id || ''))
          .filter(Boolean)
      );
      const frameIds = (session?.selectedFrameIds || []).filter((id) =>
        frameValid.has(id)
      );
      if (nodeIds.length || frameIds.length) {
        dispatch(setMixedSelection({ nodeIds, frameIds }));
      }
      sessionReadyForIdRef.current = currentId;
    }
    restoreSession();
    return () => {
      cancelled = true;
    };
  }, [currentId, document, dispatch]);

  useEffect(() => {
    if (!currentId) return;
    if (sessionReadyForIdRef.current !== currentId) return;
    const timer = window.setTimeout(() => {
      void putProjectSession({
        projectId: currentId,
        camera,
        selectedNodeIds,
        selectedFrameIds,
        isGridMode,
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [currentId, camera, selectedNodeIds, selectedFrameIds, isGridMode]);

  // Keep /editor/:projectId in sync so refresh can reload the same project.
  useEffect(() => {
    if (!currentId) return;
    const pathId = decodeURIComponent((routeProjectId || '').trim());
    if (pathId === currentId) return;
    const params = new URLSearchParams(location.search);
    const q = new URLSearchParams();
    if (params.get('fromHomeAgent') === '1') q.set('fromHomeAgent', '1');
    const search = q.toString();
    navigate(
      {
        pathname: `/editor/${encodeURIComponent(currentId)}`,
        search: search ? `?${search}` : '',
      },
      { replace: true }
    );
  }, [currentId, routeProjectId, navigate, location.search]);

  const goHomeFromEditor = useCallback(() => {
    void flushAndGoHome(navigate);
  }, [navigate]);

  const renameProjectFromChrome = useCallback(
    (name: string) => {
      dispatch(renameTemplate(name));
    },
    [dispatch]
  );

  const openShareDialog = useCallback(() => {
    setShareOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') {
        setInspectOpen(false);
        setLayersOpen(false);
        setAssetsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Entering mobile: collapse left docks (they become sheets on demand).
  useEffect(() => {
    if (!isMobileViewport) return;
    setLayersOpen(false);
    setAssetsOpen(false);
  }, [isMobileViewport]);

  const toggleLayersOpen = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setLayersOpen((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      if (next) setAssetsOpen(false);
      return next;
    });
  }, []);

  const toggleAssetsOpen = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setAssetsOpen((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      if (next) setLayersOpen(false);
      return next;
    });
  }, []);

  const finishBoot = useCallback(() => {
    if (!bootOpenRef.current || bootFinishingRef.current) return;
    bootFinishingRef.current = true;
    const el = stageRef.current;
    const cam = cameraRef.current;
    rcbJumpLog('finishBoot.start', {
      waitMs: Math.max(0, BOOT_MIN_MS - (Date.now() - bootStartedAt.current)),
      stageW: el?.clientWidth || 0,
      stageH: el?.clientHeight || 0,
      camera: { x: cam.x, y: cam.y, zoom: cam.zoom },
    });
    const wait = Math.max(0, BOOT_MIN_MS - (Date.now() - bootStartedAt.current));
    window.setTimeout(() => {
      setBootProgress(100);
      setBootExiting(true);
      rcbJumpLog('finishBoot.exiting', {
        stageW: stageRef.current?.clientWidth || 0,
        stageH: stageRef.current?.clientHeight || 0,
      });
      bootExitTimer.current = window.setTimeout(() => {
        bootOpenRef.current = false;
        setBootOpen(false);
        setBootExiting(false);
        bootExitTimer.current = null;
        rcbJumpLog('finishBoot.revealed', {
          stageW: stageRef.current?.clientWidth || 0,
          stageH: stageRef.current?.clientHeight || 0,
        });
      }, BOOT_EXIT_MS);
    }, wait);
  }, []);

  // Empty / content fit + boot reveal are handled by the stage-layout initial-fit effect.

  useEffect(() => {
    if (!bootOpen || bootExiting) return undefined;
    const id = window.setInterval(() => {
      setBootProgress((p) => {
        if (p >= 90) return p;
        const step = 4 + Math.random() * 10;
        return Math.min(90, p + step);
      });
    }, 380);
    return () => window.clearInterval(id);
  }, [bootOpen, bootExiting]);

  useEffect(() => {
    if (!bootOpen) return undefined;
    const failSafe = window.setTimeout(() => finishBoot(), 12000);
    return () => window.clearTimeout(failSafe);
  }, [bootOpen, finishBoot]);

  useEffect(
    () => () => {
      if (bootExitTimer.current) window.clearTimeout(bootExitTimer.current);
    },
    []
  );

  const zoomAtStageCenter = useCallback((nextZoom: number) => {
    const el = stageRef.current;
    if (!el) return;
    cameraUserTouchedRef.current = true;
    setZoomFitActive(false);
    // Layout px (clientWidth) 鈥?same space as camera.x/y. getBoundingClientRect is visual
    // and drifts under browser zoom / CSS scale, which makes content jump off-screen.
    setCamera((c) =>
      zoomAtPoint(c, nextZoom, el.clientWidth / 2, el.clientHeight / 2)
    );
  }, []);

  const onZoomIn = useCallback(() => {
    cameraUserTouchedRef.current = true;
    setZoomFitActive(false);
    setCamera((c) => {
      const el = stageRef.current;
      if (!el) return c;
      const next = Math.min(RCB_MAX_ZOOM, Number((c.zoom * 1.1).toFixed(4)));
      return zoomAtPoint(c, next, el.clientWidth / 2, el.clientHeight / 2);
    });
  }, []);

  const onZoomOut = useCallback(() => {
    cameraUserTouchedRef.current = true;
    setZoomFitActive(false);
    setCamera((c) => {
      const el = stageRef.current;
      if (!el) return c;
      const next = Math.max(RCB_MIN_ZOOM, Number((c.zoom / 1.1).toFixed(4)));
      return zoomAtPoint(c, next, el.clientWidth / 2, el.clientHeight / 2);
    });
  }, []);

  const onFitView = useCallback((): boolean => {
    const el = stageRef.current;
    const vw = el?.clientWidth || 0;
    const vh = el?.clientHeight || 0;
    // Match RcbCanvas autofit gate 鈥?tiny/unlaid-out stages must not count as fitted.
    if (vw < 40 || vh < 40) {
      rcbJumpLog('fitView.skipTiny', { vw, vh });
      return false;
    }
    const doc = (store.getState() as any).editor?.document;
    const fr: ArtboardFrame[] = Array.isArray(doc?.frames) ? doc.frames : [];
    // Empty scene 鈫?100%. With content 鈫?fit all artboards/nodes with 120px margins.
    if (!editorHasFitContent(doc, fr)) {
      const next = { ...DEFAULT_CAMERA, zoom: 1 };
      rcbJumpLog('fitView.empty100', { vw, vh, next });
      setCamera(next);
      setZoomFitActive(true);
      return true;
    }
    const bounds = editorContentBounds(doc, fr);
    const next = rcbFitCamera({ width: vw, height: vh }, bounds, 120, 1);
    rcbJumpLog('fitView', {
      vw,
      vh,
      bounds,
      docOrigin: { x: Number(doc?.x) || 0, y: Number(doc?.y) || 0 },
      next: {
        x: Number(next.x.toFixed(2)),
        y: Number(next.y.toFixed(2)),
        zoom: Number(next.zoom.toFixed(4)),
      },
      bootOpen: bootOpenRef.current,
      userTouched: cameraUserTouchedRef.current,
    });
    // Camera pan/zoom only 鈥?never move node/frame scene coordinates.
    setCamera(next);
    setZoomFitActive(true);
    return true;
  }, []);

  /** Manual fit (toolbar / shortcut) 鈥?stop auto re-fit after this. */
  const onFitViewManual = useCallback((): boolean => {
    cameraUserTouchedRef.current = true;
    return onFitView();
  }, [onFitView]);

  /** Pan/zoom from the canvas 鈥?marks camera as user-owned. */
  const onCanvasCameraChange = useCallback((next: CanvasCamera) => {
    cameraUserTouchedRef.current = true;
    setZoomFitActive(false);
    rcbJumpLog('camera.user', {
      x: Number(next.x.toFixed(2)),
      y: Number(next.y.toFixed(2)),
      zoom: Number(next.zoom.toFixed(4)),
    });
    setCamera(next);
  }, []);

  /**
   * Fit camera **before** boot overlay dismisses 鈥?once content is visible, never
   * auto-adjust again after the native canvas stage settles.
   */
  useEffect(() => {
    if (!document || !currentId) return;
    if (didInitialFitRef.current) return;

    // Bake store origin before first fit 鈥?canvasDocument paints at 0,0; a late
    // align remount would jump every host after the overlay lifts.
    const ox = Number(document.x) || 0;
    const oy = Number(document.y) || 0;
    if (ox !== 0 || oy !== 0) {
      rcbJumpLog('bakeDocumentOrigin', { ox, oy, currentId });
      dispatch(bakeDocumentOrigin());
      return;
    }

    const hasContent = editorHasFitContent(document, frames);
    if (!hasContent) {
      // Empty project: enter at 100% zoom (no content fit).
      const el = stageRef.current;
      if (el && el.clientWidth >= 40 && el.clientHeight >= 40) {
        setCamera({ ...DEFAULT_CAMERA, zoom: 1 });
        didInitialFitRef.current = true;
        finishBoot();
      }
      return;
    }

    // Boot already gone (e.g. empty 鈫?agent added nodes): skip auto-fit to avoid jump.
    if (!bootOpenRef.current) {
      didInitialFitRef.current = true;
      return;
    }

    let cancelled = false;
    let tries = 0;
    let lastW = 0;
    let lastH = 0;
    let stableFrames = 0;

    const finishOnce = (fitted: boolean) => {
      if (cancelled) return;
      didInitialFitRef.current = true;
      rcbJumpLog('initialFit.done', {
        fitted,
        stageW: stageRef.current?.clientWidth || 0,
        stageH: stageRef.current?.clientHeight || 0,
        tries,
        stableFrames,
      });
      finishBoot();
    };

    const tick = () => {
      if (cancelled || didInitialFitRef.current) return;
      const el = stageRef.current;
      if (!el || el.clientWidth < 40 || el.clientHeight < 40) {
        if (tries++ < 90) {
          requestAnimationFrame(tick);
          return;
        }
        finishOnce(false);
        return;
      }

      const w = el.clientWidth;
      const h = el.clientHeight;
      // Wait until the native stage size stops changing while boot still covers.
      if (Math.abs(w - lastW) <= 1 && Math.abs(h - lastH) <= 1) {
        stableFrames += 1;
      } else {
        if (lastW || lastH) {
          rcbJumpLog('initialFit.stageUnstable', {
            from: { w: lastW, h: lastH },
            to: { w, h },
            tries,
          });
        }
        stableFrames = 0;
        lastW = w;
        lastH = h;
      }
      if (stableFrames < 4) {
        if (tries++ < 90) {
          requestAnimationFrame(tick);
          return;
        }
      }

      if (!onFitView()) {
        if (tries++ < 90) {
          requestAnimationFrame(tick);
          return;
        }
        finishOnce(false);
        return;
      }
      // One more frame so the camera transform paints under the overlay, then reveal.
      requestAnimationFrame(() => {
        if (cancelled) return;
        finishOnce(true);
      });
    };

    tick();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fit once per project/stage; finishBoot is stable
  }, [document, currentId, frames.length, stageEl, stageSize.width, stageSize.height, onFitView, finishBoot]);

  /** SvgCanvas ready is no longer the fit trigger (see initial-fit effect above). */
  const onCanvasReady = useCallback(() => {
    if (didInitialFitRef.current) finishBoot();
  }, [finishBoot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t?.isContentEditable
      ) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        onZoomIn();
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        onZoomOut();
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        zoomAtStageCenter(1);
        return;
      }
      if (e.shiftKey && !mod && !e.altKey && (e.key === '1' || e.code === 'Digit1')) {
        e.preventDefault();
        onFitViewManual();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onFitViewManual, onZoomIn, onZoomOut, zoomAtStageCenter]);

  /** Select a layer and pan so its center sits in the current viewport (keep zoom). */
  const focusLayerNode = useCallback(
    (nodeId: string) => {
      dispatch(setSelectedNodeId(nodeId));
      const node = document?.deltaSetLike?.[nodeId];
      if (!node || !document) return;
      const { left, top } = nodeLeftTop(document, node);
      const w = Math.max(1, Number(node.width) || 1);
      const h = Math.max(1, Number(node.height) || 1);
      const cx = left + w / 2;
      const cy = top + h / 2;
      const el = stageRef.current;
      const vw = el?.clientWidth || el?.getBoundingClientRect().width || 0;
      const vh = el?.clientHeight || el?.getBoundingClientRect().height || 0;
      if (vw < 1 || vh < 1) return;
      setCamera((c) => {
        const z = Math.max(0.05, c.zoom || 1);
        return {
          zoom: c.zoom,
          x: vw / 2 - cx * z,
          y: vh / 2 - cy * z,
        };
      });
    },
    [dispatch, document]
  );

  const focusLayerFrame = useCallback(
    (frameId: string) => {
      dispatch(setActiveFrameId(frameId));
      const frame = (document?.frames || []).find((f: any) => f?.id === frameId);
      if (!frame) return;
      const cx = Number(frame.x) + Math.max(1, Number(frame.width) || 1) / 2;
      const cy = Number(frame.y) + Math.max(1, Number(frame.height) || 1) / 2;
      const el = stageRef.current;
      const vw = el?.clientWidth || el?.getBoundingClientRect().width || 0;
      const vh = el?.clientHeight || el?.getBoundingClientRect().height || 0;
      if (vw < 1 || vh < 1) return;
      setCamera((c) => {
        const z = Math.max(0.05, c.zoom || 1);
        return {
          zoom: c.zoom,
          x: vw / 2 - cx * z,
          y: vh / 2 - cy * z,
        };
      });
    },
    [dispatch, document]
  );

  const zoomPercent = Math.round(camera.zoom * 100);
  const projectName = currentTemplate?.name || t('home.untitled');
  return (
    <CollabRoomProvider stageEl={stageEl} camera={camera} onCameraChange={setCamera}>
      <ProjectRevisionConflictDialog />
      <div
        className={cn(
          'relative flex h-full flex-col overflow-hidden',
          followThemeCanvas && 'bg-[var(--canvas)]'
        )}
        style={stageBackground ? { background: stageBackground } : undefined}
      >
        <div className="relative flex min-h-0 flex-1">
          {layersOpen && !isMobileViewport ? (
            <div className="relative z-30 h-full shrink-0">
              <LayerPanel
                onClose={() => setLayersOpen(false)}
                onSelectNode={focusLayerNode}
                onSelectFrame={focusLayerFrame}
              />
            </div>
          ) : null}

          {assetsOpen && !isMobileViewport ? (
            <div className="relative z-30 h-full shrink-0">
              <AssetPanel onClose={() => setAssetsOpen(false)} />
            </div>
          ) : null}

          <main
            className={cn(
              'relative flex min-w-0 flex-1 flex-col overflow-hidden',
              followThemeCanvas && 'bg-[var(--canvas)]'
            )}
            style={stageBackground ? { background: stageBackground } : undefined}
          >
            <EditorTopChrome
              projectName={projectName}
              workspaceMode={workspaceMode}
              inspectOpen={inspectOpen}
              onGoHome={goHomeFromEditor}
              onRename={renameProjectFromChrome}
              onShare={openShareDialog}
            />

            <EditorToolDocks
              isDevMode={isDevMode}
              pathEditOpen={pathEditOpen}
              pathEditSubtool={pathEditSubtool}
              onPathEditSubtool={setPathEditSubtool}
              onPathEditExit={() => setPathEditOpen(false)}
              activeTool={activeTool}
            />

            <EditorStageWorld
              document={document}
              worldBounds={worldBounds}
              worldSurface={worldSurface}
              camera={camera}
              onCameraChange={onCanvasCameraChange}
              panMode={panMode}
              frameMode={frameMode}
              stageBackground={stageBackground}
              stageRef={stageRef}
              onViewportEl={setStageEl}
              stageEl={stageEl}
              canvasCursor={canvasCursor}
              gridSize={gridSize}
              isDevMode={isDevMode}
              isMobileViewport={isMobileViewport}
              activeTool={activeTool}
              canvasDocument={canvasDocument}
              sceneReloadToken={sceneReloadToken}
              documentPatchToken={documentPatchToken}
              lastPatchedNodeIds={lastPatchedNodeIds}
              selectedNodeId={selectedNodeId}
              selectedNodeIds={selectedNodeIds}
              selectedFrameIds={selectedFrameIds}
              frames={frames}
              selectedFrames={selectedFrames}
              activeFrame={activeFrame}
              canvasFillValue={canvasFillValue}
              canvasBgOpen={canvasBgOpen}
              canvasMeshSelectedIndex={canvasMeshSelectedIndex}
              setCanvasMeshSelectedIndex={setCanvasMeshSelectedIndex}
              canvasMeshShowGuides={canvasMeshShowGuides}
              onZoomIn={onZoomIn}
              onZoomOut={onZoomOut}
              onCanvasReady={onCanvasReady}
              onAddToChat={requestCanvasSelectionToChat}
            />

            <div
              data-tour="editor-tools"
              className={cn(
                'pointer-events-none absolute left-1/2 z-20 -translate-x-1/2',
                'bottom-4'
              )}
            >
              <div className="pointer-events-auto">
                <EditorToolStrip
                  camera={camera}
                  stageEl={stageEl}
                  compact={false}
                  selectOnly={isDevMode}
                />
              </div>
            </div>

            <EditorBottomHud
              document={document}
              frames={frames}
              camera={camera}
              stageEl={stageEl}
              stageBackground={stageBackground}
              activeFrameId={activeFrameId}
              selectedFrameIds={selectedFrameIds}
              selectedNodeIds={selectedNodeIds}
              onCameraChange={onCanvasCameraChange}
              isDevMode={isDevMode}
              useCompactTooling={useCompactTooling}
              layersOpen={layersOpen}
              setLayersOpen={toggleLayersOpen}
              assetsOpen={assetsOpen}
              setAssetsOpen={toggleAssetsOpen}
              minimapOpen={minimapOpen}
              setMinimapOpen={setMinimapOpen}
              shortcutsOpen={shortcutsOpen}
              setShortcutsOpen={setShortcutsOpen}
              toolsExpanded={toolsExpanded}
              setToolsExpanded={setToolsExpanded}
              canvasFillValue={canvasFillValue}
              canvasBgOpen={canvasBgOpen}
              setCanvasBgOpen={setCanvasBgOpen}
              canvasMeshSelectedIndex={canvasMeshSelectedIndex}
              setCanvasMeshSelectedIndex={setCanvasMeshSelectedIndex}
              canvasMeshShowGuides={canvasMeshShowGuides}
              setCanvasMeshShowGuides={setCanvasMeshShowGuides}
              zoomPercent={zoomPercent}
              zoomFitActive={zoomFitActive}
              onZoomIn={onZoomIn}
              onZoomOut={onZoomOut}
              onFitView={onFitViewManual}
              zoomAtStageCenter={zoomAtStageCenter}
            />
          </main>

          {workspaceMode === 'dev' && inspectOpen ? (
            <DevPropertiesPanel onClose={() => setInspectOpen(false)} />
          ) : null}
        </div>

        {isMobileViewport && layersOpen ? (
          <>
            <button
              type="button"
              aria-label={t('editor.closePanel')}
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
              onClick={() => setLayersOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 z-50">
              <LayerPanel
                mobile
                onClose={() => setLayersOpen(false)}
                onSelectNode={(nodeId) => {
                  focusLayerNode(nodeId);
                  setLayersOpen(false);
                }}
                onSelectFrame={(frameId) => {
                  focusLayerFrame(frameId);
                  setLayersOpen(false);
                }}
              />
            </div>
          </>
        ) : null}

        {isMobileViewport && assetsOpen ? (
          <>
            <button
              type="button"
              aria-label={t('editor.closePanel')}
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
              onClick={() => setAssetsOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 z-50">
              <AssetPanel
                mobile
                onClose={() => setAssetsOpen(false)}
              />
            </div>
          </>
        ) : null}

        {bootOpen ? <EditorBootOverlay progress={bootProgress} exiting={bootExiting} /> : null}
        {shareOpen ? (
          <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} />
        ) : null}
        {/* Mobile chrome differs (floating agent / no tool strip targets) — tour breaks layout. */}
        {!isMobileViewport && (
          <EditorOnboardingTour
            ready={!bootOpen}
          />
        )}
      </div>
    </CollabRoomProvider>
  );

}

export default memo(EditorPage);
