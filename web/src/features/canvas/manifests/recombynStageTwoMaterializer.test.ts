import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { materializeRecombynStageTwoHostSeams } from "./recombynStageTwoMaterializer.ts";

test("Stage2 materializer enables the native media picker without touching other disabled controls", () => {
  const path = new URL("../upstream/apps/web/src/components/editor/chrome/EditorToolStrip.tsx", import.meta.url);
  const source = readFileSync(path, "utf8");
  const result = materializeRecombynStageTwoHostSeams(source, path.pathname);
  assert.match(result, /active=\{imageActive\}\n        disabled=\{toolsLocked\}/);
  assert.equal(
    result.match(/disabled=\{toolsLocked\}/g)?.length,
    (source.match(/disabled=\{toolsLocked\}/g)?.length ?? 0) + 1,
  );
});

test("Stage2 materializer routes native context-menu history through the host Core seam", () => {
  const source = `if (action === 'undo') {
    if (!collabUndo()) dispatch(undo());
    return;
  }
  if (action === 'redo') {
    if (!collabRedo()) dispatch(redo());
    return;
  }`;
  const result = materializeRecombynStageTwoHostSeams(
    source,
    "/features/canvas/upstream/apps/web/src/components/editor/canvas/runCanvasCtxAction.ts",
  );
  assert.match(result, /kith:canvas-history/);
  assert.match(result, /detail: \{ kind: action \}/);
  assert.match(result, /cancelable: true/);
  assert.match(result, /if \(!event\.defaultPrevented\)/);
  assert.match(result, /dispatch\((?:undo|redo)\(\)\)/);
});

test("Stage2 materializer uploads native media before any scene document dispatch", () => {
  const path = new URL("../upstream/apps/web/src/components/editor/canvas/SvgCanvas.tsx", import.meta.url);
  const result = materializeRecombynStageTwoHostSeams(readFileSync(path, "utf8"), path.pathname);
  assert.doesNotMatch(result, /startImageUploadPlaceholder\(\{\s*src: preview/);
  assert.doesNotMatch(result, /startVideoUploadPlaceholder\(\{\s*src: prepared\.preview/);
  assert.doesNotMatch(result, /spawnAudio\(\{\s*src: preview/);
  for (const marker of ["const onImageFile", "const onVideoFile", "const onAudioFile"]) {
    const section = result.slice(result.indexOf(marker), result.indexOf(marker) + 2_500);
    assert.ok(section.indexOf("await uploadImageFile(file") < section.indexOf("dispatch("));
  }
  assert.match(result, /Mac\/i\.test\(navigator\.platform\) \? '\u2318' : 'Ctrl'/);
  assert.doesNotMatch(result, /Mac\/i\.test\(navigator\.platform\) \? '\?' : 'Ctrl'/);
});

test("Stage2 materializer makes the bottom Upload tool durable before its placeholder dispatch", () => {
  const path = new URL("../upstream/apps/web/src/components/editor/chrome/EditorToolStrip.tsx", import.meta.url);
  const result = materializeRecombynStageTwoHostSeams(readFileSync(path, "utf8"), path.pathname);
  assert.doesNotMatch(result, /startImageUploadPlaceholder\(\{\s*src: preview/);
  assert.doesNotMatch(result, /startVideoUploadPlaceholder\(\{\s*src: prepared\.preview/);
  for (const marker of ["const onPickImage", "const onPickVideo"]) {
    const section = result.slice(result.indexOf(marker), result.indexOf(marker) + 3_500);
    assert.ok(section.indexOf("await uploadImageFile(file") < section.indexOf("dispatch("));
  }
});

test("the embedded Canvas host reuses Kith i18n without upstream URL redirects", () => {
  const host = readFileSync(new URL("../host/NativeRecombynCanvasHarness.tsx", import.meta.url), "utf8");
  const adapter = readFileSync(new URL("../adapters/recombynEmbeddedI18n.ts", import.meta.url), "utf8");
  const vite = readFileSync(new URL("../../../../vite.config.ts", import.meta.url), "utf8");
  assert.doesNotMatch(host, /from ["']@recombyn-native\/i18n["']/);
  assert.match(host, /recombynEmbeddedI18n/);
  assert.match(adapter, /from ["']@\/i18n["']/);
  assert.doesNotMatch(adapter, /redirectToPreferred|location\.(?:replace|assign|reload)/);
  assert.match(vite, /find: \/\^@recombyn-native\\\/i18n\$\//);
});

test("the embedded Canvas fills its workspace instead of the browser viewport", () => {
  const host = readFileSync(new URL("../host/NativeRecombynCanvasHarness.tsx", import.meta.url), "utf8");
  assert.match(host, /embedded \? "[^"]*!h-full[^"]*"/);
});

test("durable draft hydration runs in layout lifecycle rather than NativeRecombynCanvas render", () => {
  const host = readFileSync(new URL("../host/NativeRecombynCanvasHarness.tsx", import.meta.url), "utf8");
  const hydration = host.slice(host.indexOf("useLayoutEffect(() => {"), host.indexOf("useEffect(() => {", host.indexOf("useLayoutEffect(() => {")));
  assert.match(hydration, /putProjectDraft/);
  assert.match(hydration, /projectId,/);
  assert.match(hydration, /document: initialDocument/);
  assert.match(hydration, /\[initialDocument, projectId, projectName\]/);
  const productRender = host.slice(host.indexOf("export function NativeRecombynCanvas("));
  assert.doesNotMatch(productRender, /void putProjectDraft/);
});

test("Canvas realtime lifecycle forwards a remote delete to the Workspace tab owner", () => {
  const resource = readFileSync(new URL("../host/useCanvasCoreResource.ts", import.meta.url), "utf8");
  assert.match(resource, /socket\.on\("canvas:deleted"/);
  assert.match(resource, /event\.canvasId === canvasId/);
  assert.match(resource, /CustomEvent\("kith:canvas-deleted"/);
});

test("Stage2 materializer removes product-shell home, share, and account controls from Canvas chrome", () => {
  const path = new URL("../upstream/apps/web/src/components/editor/page/EditorTopChrome.tsx", import.meta.url);
  const result = materializeRecombynStageTwoHostSeams(readFileSync(path, "utf8"), path.pathname);
  assert.doesNotMatch(result, /aria-label=\{t\('editor\.home'/);
  assert.doesNotMatch(result, /WalletAccountChip/);
  assert.match(result, /aria-label=\{t\('home\.untitled'\)\}/);
  assert.match(result, /<EditorTopExportButton \/>/);
  assert.doesNotMatch(result, /aria-label=\{t\('editor\.share'\)\}/);
  assert.doesNotMatch(result, /HiOutlineShare/);
  assert.doesNotMatch(result, /onShare/);
});

test("Stage2 materializer removes the native share dialog lifecycle from the product Canvas", () => {
  const path = new URL("../upstream/apps/web/src/pages/EditorPage.tsx", import.meta.url);
  const result = materializeRecombynStageTwoHostSeams(readFileSync(path, "utf8"), path.pathname);
  assert.doesNotMatch(result, /import ShareDialog/);
  assert.doesNotMatch(result, /const \[shareOpen|setShareOpen\(|openShareDialog\b/);
  assert.doesNotMatch(result, /onShare=/);
  assert.doesNotMatch(result, /<ShareDialog/);
});

test("Stage2 materializer centers the bottom toolbar in the embedded Canvas page", () => {
  const path = new URL("../upstream/apps/web/src/pages/EditorPage.tsx", import.meta.url);
  const result = materializeRecombynStageTwoHostSeams(readFileSync(path, "utf8"), path.pathname);
  assert.match(result, /style=\{\{ left: 'var\(--kith-canvas-toolbar-center-x\)' \}\}/);
  assert.match(result, /pointer-events-none absolute z-20'/);
  assert.doesNotMatch(result, /pointer-events-none fixed/);
  assert.doesNotMatch(result, /absolute left-1\/2 z-20/);
});

test("Stage2 materializer centers pen and pencil docks on the visible Canvas stage", () => {
  const path = new URL("../upstream/apps/web/src/components/editor/page/EditorToolDocks.tsx", import.meta.url);
  const result = materializeRecombynStageTwoHostSeams(readFileSync(path, "utf8"), path.pathname);
  assert.equal(result.match(/--kith-canvas-tool-dock-center-x/g)?.length, 3);
  assert.equal(result.match(/transform: 'translateX\(-50%\)'/g)?.length, 3);
  assert.doesNotMatch(result, /absolute left-1\/2 top-3/);
  assert.doesNotMatch(result, /-translate-x-1\/2/);
});

test("the native host keeps the floating-ui portal outside React's editor mount", () => {
  const host = readFileSync(new URL("../host/NativeRecombynCanvasHarness.tsx", import.meta.url), "utf8");
  assert.match(host, /const editorMountRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(host, /createRoot\(editorMountRef\.current\)/);
  assert.match(host, /<div ref=\{editorMountRef\} className="size-full" \/>/);
  assert.doesNotMatch(host, /createRoot\(rootRef\.current\)/);
});

test("Core snapshot projection uses the native remote reducer so Frame selection survives", () => {
  const host = readFileSync(new URL("../host/useRecombynCanvasProjection.ts", import.meta.url), "utf8");
  const project = host.slice(host.indexOf("project: (latest)"), host.indexOf("reportError:"));
  assert.match(project, /dispatch\(applyCollabDocument\(latest\.document\)\)/);
  assert.doesNotMatch(project, /dispatch\(importDocument/);
});

test("Stage2 materializer routes title commits and JSON export through host ports", () => {
  const topPath = new URL("../upstream/apps/web/src/components/editor/page/EditorTopChrome.tsx", import.meta.url);
  const top = materializeRecombynStageTwoHostSeams(readFileSync(topPath, "utf8"), topPath.pathname);
  assert.match(top, /kith:canvas-title/);
  assert.match(top, /phase: 'commit'/);
  assert.match(top, /placeholder=\{t\('home\.untitled'\)\}/);
  const editorPath = new URL("../upstream/apps/web/src/pages/EditorPage.tsx", import.meta.url);
  const editor = materializeRecombynStageTwoHostSeams(readFileSync(editorPath, "utf8"), editorPath.pathname);
  assert.match(editor, /currentTemplate\?\.name \?\? t\('home\.untitled'\)/);
  assert.doesNotMatch(editor, /currentTemplate\?\.name \|\| t\('home\.untitled'\)/);
  const exportPath = new URL("../upstream/apps/web/src/components/editor/panels/ExportSelectionPanel.tsx", import.meta.url);
  const exported = materializeRecombynStageTwoHostSeams(readFileSync(exportPath, "utf8"), exportPath.pathname);
  assert.match(exported, /kith:canvas-export/);
  assert.match(exported, /event\.defaultPrevented/);
  assert.match(exported, /detail\.complete/);
  assert.doesNotMatch(exported, /event\.defaultPrevented\s*\?\s*'saved'/);
  assert.doesNotMatch(exported.slice(exported.indexOf("onClick={runExportJson}") - 80, exported.indexOf("onClick={runExportJson}") + 40), /disabled/);
});

test("Stage2 materializer gives the zoom menu one click owner", () => {
  const path = new URL("../upstream/apps/web/src/components/editor/page/EditorBottomHud.tsx", import.meta.url);
  const result = materializeRecombynStageTwoHostSeams(readFileSync(path, "utf8"), path.pathname);
  const zoom = result.slice(result.indexOf("<Dropdown\n          trigger=\"click\""), result.indexOf("</Dropdown>", result.indexOf("<Dropdown\n          trigger=\"click\"")));
  assert.match(zoom, /referenceToggle=\{false\}/);
  assert.match(zoom, /onClick=\{\(\) => setZoomMenuOpen\(\(open\) => !open\)\}/);
});

test("the embedded toolbar observes the visible stage when side panels resize it", () => {
  const host = readFileSync(new URL("../host/NativeRecombynCanvasHarness.tsx", import.meta.url), "utf8");
  assert.match(host, /querySelector<HTMLElement>\('\[data-canvas-stage="1"\]'\)/);
  assert.match(host, /observer\.observe\(stage\)/);
  assert.match(host, /stageBounds\.left - rootBounds\.left \+ \(stageBounds\.width - toolbarWidth\) \/ 2/);
  assert.match(host, /stageBounds\.left - rootBounds\.left \+ stageBounds\.width \/ 2/);
});
