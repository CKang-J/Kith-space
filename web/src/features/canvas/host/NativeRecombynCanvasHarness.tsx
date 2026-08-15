import { useEffect, useRef } from "react";
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
import nativeI18n from "@recombyn-native/i18n";
import "@/features/canvas/upstream/recombyn-native.css";
import EditorPage from "@recombyn-native/pages/EditorPage";
import { MessageContainer } from "@recombyn-native/components/base";
import { store } from "@recombyn-native/store";
import { importDocument } from "@recombyn-native/store/modules/editor";

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
  "zh-CN": ["导出全部 Frame", "导出选中内容", "导出 Canvas JSON"],
  "zh-TW": ["匯出全部 Frame", "匯出選取內容", "匯出 Canvas JSON"],
  en: ["Export all frames", "Export selection", "Export Canvas JSON"],
  ja: ["すべての Frame を書き出す", "選択範囲を書き出す", "Canvas JSON を書き出す"],
})) {
  nativeI18n.addResource(language, "common", "app.name", "Kith-space");
  nativeI18n.addResource(language, "common", "editor.exportAllPages", labels[0]);
  nativeI18n.addResource(language, "common", "editor.exportSelected", labels[1]);
  nativeI18n.addResource(language, "common", "editor.exportJson", labels[2]);
}

export function NativeRecombynCanvasHarness() {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!rootRef.current) return undefined;
    store.dispatch(importDocument({
      id: PROJECT_ID,
      name: "Recombyn UI Island Fixture",
      document: nativeStageOneDocumentAdapter.read(),
      source: "scratch",
      dirty: false,
    }));
    const disconnectProjection = nativeStageOneDocumentAdapter.connectProjection(store);
    localStorage.setItem("recombyn-editor-tour-v3", "1");
    const detachPortalRoot = attachRecombynPortalRoot(rootRef.current);
    document.documentElement.dataset.recombynStageOne = "native";
    return () => {
      disconnectProjection();
      detachPortalRoot();
      delete document.documentElement.dataset.recombynStageOne;
    };
  }, []);
  useEffect(() => rootRef.current ? installNativePerformanceProbe(rootRef.current) : undefined, []);

  return (
    <div ref={rootRef} className="h-dvh overflow-hidden text-base" data-kith-canvas-root data-recombyn-native-editor data-theme={STAGE_ONE_THEME}>
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[`/editor/${PROJECT_ID}`]}>
            <Routes><Route path="/editor/:projectId" element={<EditorPage />} /></Routes>
          </MemoryRouter>
          <MessageContainer />
        </QueryClientProvider>
      </Provider>
    </div>
  );
}
