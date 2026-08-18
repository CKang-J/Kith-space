import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

test("Canvas send-to-chat is a visible host action over native selection, not a hidden event-only path", () => {
  const harness = read("../web/src/features/canvas/host/NativeRecombynCanvasHarness.tsx");
  const action = read("../web/src/features/canvas/host/CanvasSendToChatHostAction.tsx");
  const adapter = read("../web/src/features/canvas/adapters/recombynSelectionToChat.ts");
  assert.match(harness, /CanvasSendToChatHostAction/);
  assert.match(harness, /sendToChatTitle=\{embedded \? projectName : undefined\}/);
  assert.match(action, /data-canvas-send-to-chat/);
  assert.match(action, /requestCanvasSelectionToChat/);
  assert.match(action, /data-sel-toolbar/);
  assert.match(action, /chat\.canvasSendToChat/);
  assert.match(adapter, /playFlyChipToChat/);
  assert.match(action, /chat\.canvasFlyLabel/);
  assert.doesNotMatch(action, /web\/src\/features\/canvas\/upstream/);
  assert.doesNotMatch(action, /editor\.contextMenu\.addToChat/);
});

test("Composer binds pending Canvas selection to the current Chat surface and eligible executors", () => {
  const composer = read("../web/src/views/Composer.tsx");
  const chip = read("../web/src/views/chat-message/CanvasContextChip.tsx");
  const en = read("../web/src/locales/en.json");
  const zh = read("../web/src/locales/zh.json");
  assert.match(composer, /pushCanvasChatSurface\(channelId\)/);
  assert.match(composer, /noteActiveCanvasFlyLand/);
  assert.doesNotMatch(composer, /@recombyn-native/);
  assert.match(composer, /data-fly-land=\{`kith-chat:\$\{channelId\}`\}/);
  assert.match(composer, /\/api\/channels\/\$\{encodeURIComponent\(channelId\)\}\/canvas-executors/);
  assert.match(composer, /data-canvas-executor-select/);
  assert.match(composer, /chat\.canvasExecutorUnavailable/);
  assert.match(composer, /setPendingCanvasChatContext\(null, previous\)/);
  assert.match(chip, /t\("chat\.canvasViewSelection"\)/);
  assert.match(chip, /t\("chat\.canvasUnavailable"\)/);
  assert.match(chip, /t\("chat\.canvasRemoveContext"/);
  assert.doesNotMatch(chip, /未命名画布|在画布中打开|画布不可用/);
  for (const key of [
    "canvasUntitled",
    "canvasSummaryWhole",
    "canvasViewSelection",
    "canvasUnavailable",
    "canvasExecutorUnavailable",
    "canvasRemoveContext",
    "canvasSendToChat",
    "canvasFlyLabel",
    "canvasLoading",
    "canvasLiveMode",
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
  assert.match(chat, /m\.canvasContext \? <div className="mt-2"><CanvasContextChip context=\{m\.canvasContext\}/);
  assert.match(chip, /requestCanvasSelectionFocus/);
  assert.match(chip, /workspaceLocationForModule/);
  assert.match(inspector, /CanvasTurnSourceCard/);
  assert.match(turnCard, /data-canvas-turn-source/);
  assert.match(turnCard, /chat\.canvasSnapshotId/);
  assert.match(turnCard, /chat\.canvasViewSelection/);
  assert.match(turnCard, /liveReadWrite/);
  assert.doesNotMatch(inspector, /source\.sourceKind === "canvas_selection_snapshot" \? t\("chat\.canvasContextSource"\)/);
});
