import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

test("Canvas send-to-chat is a native selection-toolbar action, not a host overlay", () => {
  const harness = read("../web/src/features/canvas/host/NativeRecombynCanvasHarness.tsx");
  const action = read("../web/src/features/canvas/upstream/apps/web/src/components/rcb/selection/chrome/SendToChatToolbarAction.tsx");
  const single = read("../web/src/features/canvas/upstream/apps/web/src/components/rcb/selection/chrome/SelectionContextToolbar.tsx");
  const multi = read("../web/src/features/canvas/upstream/apps/web/src/components/rcb/selection/chrome/MultiSelectionToolbar.tsx");
  const frame = read("../web/src/features/canvas/upstream/apps/web/src/components/editor/nodes/FrameNode/FrameContextToolbar.tsx");
  const adapter = read("../web/src/features/canvas/adapters/recombynSelectionToChat.ts");
  assert.doesNotMatch(harness, /CanvasSendToChatHostAction/);
  assert.doesNotMatch(action, /CanvasSendToChatHostAction/);
  assert.doesNotMatch(adapter, /@recombyn-native\/components\/editor\/panels\/agent\/flyToChat/);
  assert.doesNotMatch(action, /@recombyn-native\/components\/editor\/panels\/agent\/flyToChat/);
  assert.doesNotMatch(adapter, /playCanvasFlyToChat/);
  assert.doesNotMatch(action, /noteCanvasFlyOrigin/);
  assert.match(action, /data-canvas-send-to-chat/);
  assert.match(action, /requestCanvasSelectionToChat/);
  assert.match(action, /chat\.canvasSendToChat/);
  assert.match(action, /canvasId/);
  assert.match(single, /SendToChatToolbarAction/);
  assert.match(single, /<SendToChatToolbarAction target=\{nodeId\} \/>/);
  assert.match(multi, /SendToChatToolbarAction/);
  assert.match(multi, /canvasToolbarChatTargets\(opNodeIds, frameIds\)/);
  assert.match(frame, /SendToChatToolbarAction/);
  assert.match(frame, /target=\{`frame:\$\{frame\.id\}`\}/);
  assert.match(harness, /setActiveTool\("select"\)/);
  assert.match(harness, /setMixedSelection/);
});

test("Composer appends pending Canvas selections per surface and submits them in order", () => {
  const composer = read("../web/src/views/Composer.tsx");
  const composerCanvasList = read("../web/src/views/composer/ComposerCanvasContextList.tsx");
  const hook = read("../web/src/views/composer/useComposerCanvasContext.ts");
  const payload = read("../web/src/views/composer/composerCanvasContext.ts");
  const preview = read("../web/src/features/canvas/host/canvasSelectionPreview.ts");
  const chip = read("../web/src/views/chat-message/CanvasContextChip.tsx");
  const en = read("../web/src/locales/en.json");
  const zh = read("../web/src/locales/zh.json");
  assert.match(composer, /useComposerCanvasContext/);
  assert.match(composer, /canvas\.buildSendPayload\(\)/);
  assert.match(composer, /ComposerCanvasContextList/);
  assert.match(composerCanvasList, /data-canvas-context-list/);
  assert.match(composerCanvasList, /composer-canvas-context-scroll/);
  assert.match(composerCanvasList, /scrollStripHorizontally/);
  assert.match(chip, /CanvasSelectionThumbnail/);
  assert.match(preview, /renderComposerChipThumb/);
  assert.match(chip, /selectedIds=\{selectionTokens\}/);
  assert.match(composerCanvasList, /aria-label=\{t\("chat\.canvasPendingSelections"/);
  assert.match(composer, /composer-attachments/);
  assert.doesNotMatch(composer, /previousChannelIdRef/);
  assert.doesNotMatch(composer, /setPendingCanvasChatContext\(null, previous\)/);
  assert.doesNotMatch(composer, /@recombyn-native/);
  assert.match(hook, /pushCanvasChatSurface\(channelId\)/);
  assert.match(hook, /getPendingCanvasChatContexts\(channelId\)/);
  assert.match(hook, /removePendingCanvasChatContext\(pendingId, channelId\)/);
  assert.doesNotMatch(hook, /previousChannelIdRef/);
  assert.match(payload, /canvasSelections: input\.canvasContexts\.map/);
  assert.match(chip, /aria-label=\{previewLabel\}/);
  assert.match(chip, /title=\{previewLabel\}/);
  assert.match(chip, /<PopoverTrigger/);
  assert.doesNotMatch(chip, /<Eye /);
  assert.doesNotMatch(chip, /<ScanSearch /);
  assert.match(chip, /attachment-card is-file is-canvas-context/);
  assert.match(chip, /canvas-context-chip__thumb-btn/);
  assert.match(chip, /attachment-card__remove/);
  assert.match(chip, /requestCanvasSelectionFocus/);
  assert.match(chip, /workspaceLocationForModule/);
  assert.doesNotMatch(chip, />\{t\("chat\.canvasViewSelection"\)\}</);
  assert.doesNotMatch(chip, />\{t\("chat\.canvasShowPreview"\)\}</);
  assert.doesNotMatch(chip, /未命名画布|在画布中打开|画布不可用/);
  for (const key of [
    "canvasUntitled",
    "canvasSummaryWhole",
    "canvasViewSelection",
    "canvasUnavailable",
    "canvasExecutorUnavailable",
    "canvasRemoveContext",
    "canvasSendToChat",
    "canvasShowPreview",
    "canvasHidePreview",
    "canvasRevision",
    "canvasPendingSelections",
    "canvasSourceConversation",
  ]) {
    assert.match(en, new RegExp(`"${key}"`));
    assert.match(zh, new RegExp(`"${key}"`));
  }
});

test("sent Canvas context and Turn Inspector render structured cards, not raw JSON only", () => {
  const chat = read("../web/src/views/Chat.tsx");
  const chip = read("../web/src/views/chat-message/CanvasContextChip.tsx");
  const inspector = read("../web/src/views/chat-message/TurnDetailsButton.tsx");
  const turnCard = read("../web/src/views/chat-message/CanvasTurnSourceCard.tsx");
  assert.match(chat, /messageCanvasContexts\(m\)/);
  assert.match(chip, /requestCanvasSelectionFocus/);
  assert.match(chip, /workspaceLocationForModule/);
  assert.match(inspector, /CanvasTurnSourceCard/);
  assert.match(turnCard, /data-canvas-turn-source/);
  assert.match(turnCard, /chat\.canvasSnapshotId/);
  assert.match(turnCard, /chat\.canvasViewSelection/);
  assert.match(turnCard, /chat\.canvasSourceConversation/);
  assert.match(turnCard, /data-canvas-source-surface/);
  assert.match(turnCard, /liveReadWrite/);
  assert.match(chip, /previewDocumentFromCanvasSelection/);
  assert.match(turnCard, /previewDocumentFromCanvasSelection/);
  assert.doesNotMatch(inspector, /source\.sourceKind === "canvas_selection_snapshot" \? t\("chat\.canvasContextSource"\)/);
});
