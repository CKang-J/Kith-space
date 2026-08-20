import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const mapping = JSON.parse(readFileSync(path.join(import.meta.dirname, "../upstream/source-mapping.json"), "utf8")) as {
  upstreamCommit: string;
  files: Array<{ source: string; sourceSha256: string; target?: string; targetSha256?: string; changes: string[] }>;
};

test("native Recombyn source mapping is exhaustive and pinned", () => {
  assert.equal(mapping.upstreamCommit, "abd81983716b41c7fc6e2f591c23e6d9bb9c4643");
  assert.equal(mapping.files.length, 320);
  assert.equal(mapping.files.filter((file) => file.target).length, 318);
  assert.deepEqual(
    mapping.files.filter((file) => !file.target).map((file) => file.source),
    [
      "apps/web/src/assets/model/dreamina.png",
      "apps/web/src/assets/model/sync_lipsync.png",
    ],
  );
  const audit = JSON.parse(
    readFileSync(path.join(repoRoot, "docs/research/recombyn-stage1-upstream-closure-audit.json"), "utf8"),
  ) as { upstreamCommit: string; combinedFiles: Array<{ path: string; sha256: string }> };
  assert.equal(audit.upstreamCommit, mapping.upstreamCommit);
  assert.deepEqual(
    mapping.files.map((file) => [file.source, file.sourceSha256]),
    audit.combinedFiles.map((file) => [file.path, file.sha256]),
  );
  for (const file of [mapping.files[0]!, mapping.files.at(-1)!]) {
    const bytes: Uint8Array = execFileSync(
      "git",
      ["-C", path.join(repoRoot, "reference/recombyn"), "show", `${mapping.upstreamCommit}:${file.source}`],
      { encoding: null },
    );
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sourceSha256, file.source);
  }
  for (const file of mapping.files) {
    assert.ok(Array.isArray(file.changes), file.source);
    if (file.target) {
      const targetBytes = readFileSync(path.join(repoRoot, file.target));
      assert.equal(createHash("sha256").update(targetBytes).digest("hex"), file.targetSha256, file.target);
    }
  }
});

test("stage-one runtime seams stay hard-disabled and production-gated", () => {
  assert.equal(
    mapping.files.some((file) => file.source.endsWith("/components/editor/panels/AgentDock.tsx")),
    false,
  );
  const editorPage = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/pages/EditorPage.tsx"), "utf8");
  const topChrome = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/editor/page/EditorTopChrome.tsx"), "utf8");
  const toolStrip = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/editor/chrome/EditorToolStrip.tsx"), "utf8");
  const imageGenerator = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/editor/nodes/ImageGeneratorNode/ImageGeneratorCard.tsx"), "utf8");
  const videoGenerator = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/editor/nodes/VideoGeneratorNode/VideoGeneratorCard.tsx"), "utf8");
  const imageQuickEdit = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/editor/nodes/ImageNode/ImageQuickEditComposer.tsx"), "utf8");
  const videoQuickEdit = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/editor/nodes/VideoNode/VideoQuickEditComposer.tsx"), "utf8");
  const audioGenerator = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/editor/nodes/AudioGeneratorNode/AudioGeneratorCard.tsx"), "utf8");
  const audioQuickEdit = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/editor/nodes/AudioNode/AudioQuickEditComposer.tsx"), "utf8");
  const markHost = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/editor/nodes/ImageNode/mark/MarkSessionHost.tsx"), "utf8");
  const markOverlay = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/editor/nodes/ImageNode/mark/MarkRegionOverlay.tsx"), "utf8");
  const sceneDocument = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/rcb/scene/document/sceneDocument.ts"), "utf8");
  const imageToolPanelHost = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/editor/nodes/ImageNode/toolPanels/ImageToolPanelHost.tsx"), "utf8");
  const multiAnglePanel = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/editor/nodes/ImageNode/toolPanels/MultiAngleToolPanel.tsx"), "utf8");
  const canvasContextMenu = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/rcb/selection/chrome/CanvasContextMenu.tsx"), "utf8");
  const canvasContextMenuHook = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/editor/canvas/contextMenu/useCanvasContextMenu.ts"), "utf8");
  const removeBgMenu = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/editor/nodes/ImageNode/ImageRemoveBgMenu.tsx"), "utf8");
  const localUploadBoundary = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/utils/uploadImage.ts"), "utf8");
  const sharedChatService = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/service/chat.ts"), "utf8");
  const composer = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/editor/panels/AgentComposerInput.tsx"), "utf8");
  const materializer = readFileSync(path.join(repoRoot, "scripts/materialize-recombyn-stage1-native.mjs"), "utf8");
  const closureAudit = readFileSync(path.join(repoRoot, "scripts/audit-recombyn-stage1-closure.mjs"), "utf8");
  assert.doesNotMatch(editorPage, /AgentDock|agentOpen|onOpenAgent/);
  assert.doesNotMatch(topChrome, /onOpenAgent|editor\.chat|TbMessage2Filled/);
  assert.match(editorPage, /onAddToChat=\{\(target\) => requestCanvasSelectionToChat\(target, currentId \? \{ canvasId: currentId \} : undefined\)\}/);
  assert.match(toolStrip, /onClick=\{spawnImageGeneratorAtView\}/);
  assert.match(toolStrip, /onClick=\{spawnVideoGeneratorAtView\}/);
  assert.match(toolStrip, /imageGenerator} \(A\)/);
  assert.match(toolStrip, /videoGenerator} \(Shift\+A\)/);
  assert.match(imageGenerator, /runCanvasMediaGeneration/);
  assert.match(videoGenerator, /runCanvasMediaGeneration/);
  assert.match(imageGenerator, /kithImageModels/);
  assert.match(videoGenerator, /kithVideoModels/);
  assert.match(audioGenerator, /runCanvasMediaGeneration/);
  assert.match(audioQuickEdit, /runCanvasMediaGeneration/);
  assert.match(audioGenerator, /kithAudioModels/);
  assert.match(audioQuickEdit, /kithAudioModels/);
  assert.doesNotMatch(audioGenerator, /generateAudio/);
  assert.doesNotMatch(audioQuickEdit, /generateAudio/);
  assert.doesNotMatch(composer, /runDesignAgent|utils\/uploadImage|\/api\/v1\/uploads/);
  assert.match(composer, /recombynComposerSceneContext|recombynLocalMedia/);
  assert.match(markHost, /sendMarkedImageRegionToChat/);
  assert.doesNotMatch(markHost, /enqueueAgentContexts/);
  assert.match(markHost, /kithChatFlyLandId/);
  assert.doesNotMatch(markHost, /payload: buildMarkChipPayload/);
  assert.doesNotMatch(markHost, /function buildMarkChipPayload/);
  assert.doesNotMatch(markHost, /Marked image region/);
  assert.match(markHost, /nodeWidth: box\.width/);
  assert.match(markOverlay, /markLocalFromClientRect/);
  assert.doesNotMatch(markOverlay, /clientX - origin\.x/);
  assert.doesNotMatch(markOverlay, /按住拖拽框选区域/);
  assert.match(markOverlay, /data-mark-cursor-hint/);
  assert.match(markHost, /message\.warning\('请按住拖选要标记的区域'\)/);
  assert.match(sceneDocument, /isDraft\(value\) \? current\(value\)/);
  assert.match(materializer, /clone Immer reducer drafts without structuredClone/);
  assert.match(imageToolPanelHost, /const spawnProcess = \(payload:/);
  assert.match(imageToolPanelHost, /无法创建处理节点，请刷新后重试/);
  assert.match(multiAnglePanel, /zoom: scale,/);
  assert.doesNotMatch(multiAnglePanel, /scaleValueToIndex\(scale\) \* 50/);
  assert.doesNotMatch(multiAnglePanel, /setBusy\(true\)/);
  assert.match(canvasContextMenu, /className="pointer-events-auto absolute inset-0 z-\[60\]"/);
  assert.match(canvasContextMenu, /className="pointer-events-auto absolute z-\[70\] min-w-\[200px\]/);
  assert.match(canvasContextMenu, /className="pointer-events-auto absolute z-\[80\] min-w-\[11rem\]/);
  assert.match(canvasContextMenu, /className="pointer-events-auto absolute z-\[80\] min-w-\[8rem\]/);
  assert.match(canvasContextMenu, /viewportToPortalPoint/);
  assert.match(canvasContextMenu, /placeMenuInPortal\(/);
  assert.match(canvasContextMenuHook, /lastOpenX = clientX/);
  assert.match(materializer, /re-enable pointer events on body-portaled context menu surfaces/);
  assert.match(materializer, /position the context menu in island portal coordinates/);
  assert.match(materializer, /route audio generator TTS through the Kith Canvas generation job host seam/);
  assert.match(materializer, /route audio quick-edit TTS through the Kith Canvas generation job host seam/);
  assert.doesNotMatch(markHost, /message\.info/);
  assert.match(removeBgMenu, /Stay inside the selection toolbar chrome/);
  assert.doesNotMatch(removeBgMenu, /FloatingPortal|useFloating/);
  for (const source of [imageGenerator, videoGenerator, imageQuickEdit, videoQuickEdit]) {
    assert.doesNotMatch(
      source,
      /generateImage|generateVideo|uploadComposerAttachment|service\/chat|utils\/uploadImage|\/api\/v1\/(?:chat\/)?(?:image|video|uploads)/,
    );
    assert.match(source, /runCanvasMediaGeneration/);
    assert.doesNotMatch(source, /stageOneGenerationUnavailable|Kith Media Job 尚未实现/);
  }
  assert.doesNotMatch(localUploadBoundary, /service\/upload|utils\/apiBase|utils\/token|\/api\/v1\/uploads|uploadFiles|deleteUploadedFileApi/);
  assert.match(localUploadBoundary, /Stage 1 accepts local media references only/);
  assert.equal(mapping.files.some((file) => file.source.endsWith("/service/upload.ts")), false);
  assert.equal(mapping.files.some((file) => file.source.endsWith("/utils/request.ts")), false);
  assert.doesNotMatch(sharedChatService, /\/api\/v1\/chat\/(?:image|video|audio)\/jobs|waitForMediaJob/);
  assert.doesNotMatch(sharedChatService, /@recombyn-native\/utils\/request/);
  assert.match(sharedChatService, /Stage 1 暂不支持图片生成/);
  assert.match(sharedChatService, /Stage 1 暂不支持视频生成/);
  assert.match(sharedChatService, /Stage 1 暂不支持音频生成/);
  for (const forbidden of [
    "/components/editor/panels/agent/runDesignAgent.ts",
    "/components/editor/panels/agent/designTools.ts",
    "/components/editor/panels/agent/agentMemory.ts",
    "/service/design.ts",
  ]) {
    assert.equal(mapping.files.some((file) => file.source.endsWith(forbidden)), false, forbidden);
  }
  assert.doesNotMatch(materializer, /retaining native AgentDock shell/);
  assert.match(materializer, /readPinnedSource/);
  assert.doesNotMatch(materializer, /rev-parse", "HEAD"|status", "--porcelain"/);
  assert.match(closureAudit, /"@\/components\/editor\/panels\/AgentDock"/);

  const wallet = readFileSync(path.join(repoRoot, "web/src/features/canvas/adapters/recombynStageOneWallet.ts"), "utf8");
  const collaboration = readFileSync(path.join(repoRoot, "web/src/features/canvas/adapters/recombynStageOneCollaboration.tsx"), "utf8");
  assert.doesNotMatch(wallet, /\bfetch\s*\(/);
  assert.doesNotMatch(collaboration, /from ['"]yjs|new WebSocket|indexedDB\./);

  const main = readFileSync(path.join(repoRoot, "web/src/main.tsx"), "utf8");
  assert.match(main, /import\.meta\.env\.DEV \|\| import\.meta\.env\.MODE === "canvas-stage1"/);
  const webPackage = readFileSync(path.join(repoRoot, "web/package.json"), "utf8");
  assert.doesNotMatch(webPackage, /@tauri-apps|y-indexeddb|y-websocket|"yjs"/);
  assert.match(webPackage, /"@lobehub\/icons-static-svg"/);
  const modelPicker = readFileSync(path.join(repoRoot, "web/src/features/canvas/upstream/apps/web/src/components/editor/panels/agent/ModelPickerPanel.tsx"), "utf8");
  assert.match(modelPicker, /@lobehub\/icons-static-svg\/icons\/doubao-color\.svg\?url/);
  assert.match(modelPicker, /@lobehub\/icons-static-svg\/icons\/openrouter-color\.svg\?url/);
  assert.match(modelPicker, /const dreamina = jimeng/);
  assert.doesNotMatch(modelPicker, /const doubao = syncLipsync/);
});
