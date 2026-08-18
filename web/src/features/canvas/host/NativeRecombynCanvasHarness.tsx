import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import upstreamScene from "@/features/canvas/fixtures/recombyn-upstream-scene.json";
import { queryClient } from "@/features/canvas/adapters/recombynStageOneServices";
import { createRecombynNativeDocumentAdapter } from "@/features/canvas/adapters/recombynNativeDocument";
import {
  loadStageOneDocument,
  persistStageOneDocument,
} from "@/features/canvas/adapters/recombynStageOneDocumentPersistence";
import { putProjectDraft } from "@/features/canvas/adapters/recombynProjectMemory";
import { attachRecombynPortalRoot } from "@/features/canvas/adapters/recombynFloatingUi";
import { installNativePerformanceProbe } from "@/features/canvas/state/nativePerformanceProbe";
import nativeI18n from "@/features/canvas/adapters/recombynEmbeddedI18n";
import "@/features/canvas/upstream/recombyn-native.css";
import EditorPage from "@recombyn-native/pages/EditorPage";
import { MessageContainer } from "@recombyn-native/components/base";
import { store } from "@recombyn-native/store";
import { importDocument, setMixedSelection } from "@recombyn-native/store/modules/editor";
import type { CanvasCoreClient, CanvasLibraryItem, KithApi } from "@/features/canvas/adapters/canvasCoreApi";
import type { RecombynCoreProjectionConnection } from "@/features/canvas/adapters/recombynCoreProjection";
import { resolveKithCanvasTheme } from "@/features/canvas/adapters/recombynThemeBridge";
import { useCanvasCoreResource } from "./useCanvasCoreResource";
import { useCanvasAssetBridges } from "./useCanvasAssetBridges";
import { useRecombynCanvasProjection } from "./useRecombynCanvasProjection";
import { RecombynEditorIconSprite } from "./RecombynEditorIconSprite";
import i18n from "@/i18n";
import { bindCanvasSelectionToChat } from "./canvasChatBridge";
import { CanvasSendToChatHostAction } from "./CanvasSendToChatHostAction";
import { applyCanvasSelectionFocus } from "./canvasSelectionFocus";

const PROJECT_ID = "kith-stage-one-native";
const STAGE_ONE_THEME = new URLSearchParams(window.location.search).get("__canvas_theme") === "dark" ? "dark" : "light";
export const nativeStageOneDocumentAdapter = createRecombynNativeDocumentAdapter(
  loadStageOneDocument(window.localStorage, upstreamScene),
  {
    onDocumentChange: (document) => persistStageOneDocument(window.localStorage, document),
  },
);
void putProjectDraft({
  projectId: PROJECT_ID,
  name: "Recombyn UI Island Fixture",
  document: nativeStageOneDocumentAdapter.read(),
  cloudRevision: null,
  baseDocument: null,
});
for (const [language, labels] of Object.entries({
  zh: ["导出全部 Frame", "导出选中内容", "导出 Canvas JSON"],
  en: ["Export all frames", "Export selection", "Export Canvas JSON"],
})) {
  nativeI18n.addResource(language, "translation", "app.name", "Kith-space");
  nativeI18n.addResource(language, "translation", "editor.exportAllPages", labels[0]);
  nativeI18n.addResource(language, "translation", "editor.exportSelected", labels[1]);
  nativeI18n.addResource(language, "translation", "editor.exportJson", labels[2]);
}

interface NativeEditorSurfaceProps {
  projectId: string;
  projectName?: string;
  document: unknown;
  embedded?: boolean;
  connect(): () => void;
  onHistory?(kind: "undo" | "redo"): void;
}

function NativeEditorApp({ projectId, sendToChatTitle }: { projectId: string; sendToChatTitle?: string }) {
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <div className="relative size-full min-h-0 min-w-0">
          <MemoryRouter initialEntries={[`/editor/${projectId}`]}>
            <Routes><Route path="/editor/:projectId" element={<EditorPage />} /></Routes>
          </MemoryRouter>
          {sendToChatTitle ? <CanvasSendToChatHostAction canvasId={projectId} canvasTitle={sendToChatTitle} /> : null}
          <MessageContainer />
        </div>
      </QueryClientProvider>
    </Provider>
  );
}

function NativeEditorSurface({ projectId, projectName = "Kith Canvas", document: initialDocument, embedded = false, connect, onHistory }: NativeEditorSurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const editorMountRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Hydrate before the passive effect mounts EditorPage. This remains safe in
    // Strict Mode and cannot write an old resource after a Canvas switch.
    void putProjectDraft({
      projectId,
      name: projectName,
      document: initialDocument,
      syncedAt: null,
      cloudRevision: null,
      baseDocument: null,
    });
  }, [initialDocument, projectId, projectName]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let toolbar: HTMLElement | null = null;
    let stage: HTMLElement | null = null;
    let contentObserver: MutationObserver | null = null;
    const positionToolbar = () => {
      stage = root.querySelector<HTMLElement>('[data-canvas-stage="1"]');
      toolbar = root.querySelector<HTMLElement>('[data-tour="editor-tools"]');
      if (!stage) return;
      observer.observe(stage);
      const stageBounds = stage.getBoundingClientRect();
      const rootBounds = root.getBoundingClientRect();
      const toolbarWidth = toolbar?.getBoundingClientRect().width ?? 0;
      root.style.setProperty("--kith-canvas-toolbar-center-x", `${stageBounds.left - rootBounds.left + (stageBounds.width - toolbarWidth) / 2}px`);
      root.style.setProperty("--kith-canvas-tool-dock-center-x", `${stageBounds.left - rootBounds.left + stageBounds.width / 2}px`);
      if (toolbar && stage) contentObserver?.disconnect();
    };
    const observer = new ResizeObserver(positionToolbar);
    observer.observe(root);
    contentObserver = new MutationObserver(positionToolbar);
    contentObserver.observe(root, { childList: true, subtree: true });
    positionToolbar();
    window.addEventListener("resize", positionToolbar);
    return () => {
      observer.disconnect();
      contentObserver?.disconnect();
      window.removeEventListener("resize", positionToolbar);
    };
  }, []);
  useEffect(() => {
    if (!embedded || !rootRef.current) return undefined;
    const root = rootRef.current;
    const syncTheme = () => { root.dataset.theme = resolveKithCanvasTheme(document.documentElement.classList); };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [embedded]);
  useEffect(() => {
    if (!rootRef.current || !editorMountRef.current) return undefined;
    store.dispatch(importDocument({
      id: projectId,
      name: projectName,
      document: initialDocument,
      source: "scratch",
      dirty: false,
    }));
    const disconnectProjection = connect();
    localStorage.setItem("recombyn-editor-tour-v3", "1");
    const detachPortalRoot = attachRecombynPortalRoot(rootRef.current);
    const editorRoot = createRoot(editorMountRef.current);
    editorRoot.render(<NativeEditorApp projectId={projectId} sendToChatTitle={embedded ? projectName : undefined} />);
    document.documentElement.dataset.recombynStageOne = "native";
    const releaseFocus = embedded
      ? applyCanvasSelectionFocus(projectId, (request) => {
        store.dispatch(setMixedSelection({ nodeIds: request.nodeIds, frameIds: request.frameIds }));
      })
      : undefined;
    return () => {
      disconnectProjection();
      releaseFocus?.();
      editorRoot.unmount();
      detachPortalRoot();
      delete document.documentElement.dataset.recombynStageOne;
    };
  }, [connect, embedded, initialDocument, projectId, projectName]);
  useEffect(() => rootRef.current ? installNativePerformanceProbe(rootRef.current) : undefined, []);
  useEffect(() => {
    if (!onHistory) return undefined;
    const handleHistory = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      const accelerator = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const kind = accelerator && key === "z" ? (event.shiftKey ? "redo" : "undo") : accelerator && key === "y" ? "redo" : null;
      if (!kind) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onHistory(kind);
    };
    document.addEventListener("keydown", handleHistory, true);
    const handleNativeHistory = (event: Event) => {
      const kind = (event as CustomEvent<{ kind?: unknown }>).detail?.kind;
      if (kind === "undo" || kind === "redo") {
        event.preventDefault();
        onHistory(kind);
      }
    };
    window.addEventListener("kith:canvas-history", handleNativeHistory);
    return () => {
      document.removeEventListener("keydown", handleHistory, true);
      window.removeEventListener("kith:canvas-history", handleNativeHistory);
    };
  }, [onHistory]);

  return (
    <div ref={rootRef} className={embedded ? "size-full !h-full min-h-0 min-w-0 overflow-hidden text-base" : "h-dvh w-full overflow-hidden text-base"} data-kith-canvas-root data-recombyn-native-editor data-theme={embedded ? resolveKithCanvasTheme(document.documentElement.classList) : STAGE_ONE_THEME}>
      <RecombynEditorIconSprite />
      <div ref={editorMountRef} className="size-full" />
    </div>
  );
}

export function NativeRecombynCanvasHarness() {
  return (
    <NativeEditorSurface
      projectId={PROJECT_ID}
      document={nativeStageOneDocumentAdapter.read()}
      connect={() => nativeStageOneDocumentAdapter.connectProjection(store)}
    />
  );
}

export function NativeRecombynCanvas({ canvasId, api, spaceId }: { canvasId: string; api: KithApi; spaceId: string }) {
  const { client, resourceKey, loaded, loadError, connectionRef } = useCanvasCoreResource(canvasId, spaceId, api);
  useCanvasAssetBridges(client, canvasId, spaceId, resourceKey);

  if (loadError) return <div role="alert" className="grid h-full place-items-center p-6 text-sm text-destructive">{loadError}</div>;
  if (!loaded || loaded.resourceKey !== resourceKey) return <div className="grid h-full place-items-center text-sm text-muted-foreground">{i18n.t("chat.canvasLoading")}</div>;
  return <DurableCanvasEditor canvasId={canvasId} resourceKey={resourceKey} snapshot={loaded.snapshot} client={client} connectionRef={connectionRef} />;
}

function DurableCanvasEditor({ canvasId, resourceKey, snapshot, client, connectionRef }: {
  canvasId: string;
  resourceKey: string;
  snapshot: CanvasLibraryItem;
  client: CanvasCoreClient;
  connectionRef: MutableRefObject<RecombynCoreProjectionConnection | null>;
}) {
  const { connect, handleHistory } = useRecombynCanvasProjection({ canvasId, resourceKey, snapshot, client, connectionRef });
  useEffect(() => bindCanvasSelectionToChat({
    canvasId,
    canvasTitle: snapshot.title,
    previewDocument: snapshot.document,
    documentRevision: snapshot.revisions.document,
  }), [canvasId, snapshot.document, snapshot.revisions.document, snapshot.title]);
  return <NativeEditorSurface
    projectId={canvasId}
    projectName={snapshot.title}
    document={snapshot.document}
    embedded
    connect={connect}
    onHistory={handleHistory}
  />;
}
