// Unit regression for the chat message initial-load failure state.
// Run: npx tsx --test --test-force-exit test/chatInitialLoadError.unit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const chatSrc = fs.readFileSync(new URL("../web/src/views/Chat.tsx", import.meta.url), "utf8");
const messagesModelSrc = fs.readFileSync(new URL("../web/src/features/conversation/model/useConversationMessages.ts", import.meta.url), "utf8");
const threadsModelSrc = fs.readFileSync(new URL("../web/src/features/conversation/model/useConversationThreads.ts", import.meta.url), "utf8");
const en = JSON.parse(fs.readFileSync(new URL("../web/src/locales/en.json", import.meta.url), "utf8"));
const zh = JSON.parse(fs.readFileSync(new URL("../web/src/locales/zh.json", import.meta.url), "utf8"));

test("initial message load failure exits the skeleton and shows a retryable error state", () => {
  assert.match(messagesModelSrc, /const \[loadError,\s*setLoadError\] = useState/);
  assert.match(messagesModelSrc, /catch\s*\{[\s\S]*setLoadError\(true\)/);
  assert.match(messagesModelSrc, /finally\s*\{[\s\S]*setLoaded\(true\)/);
  assert.match(chatSrc, /loaded && loadError/);
  assert.match(chatSrc, /onClick=\{loadCurrentMessages\}/);
  assert.match(chatSrc, /t\("chat\.loadFailedTitle"\)/);
  assert.match(chatSrc, /t\("chat\.loadFailedBody"\)/);
  assert.match(chatSrc, /t\("chat\.retryLoad"\)/);
});

test("initial message load drops stale async results after switching channels", () => {
  assert.match(messagesModelSrc, /const requestedChannelId = channelId/);
  assert.match(messagesModelSrc, /if \(currentChannelIdRef\.current !== requestedChannelId\) return;[\s\S]*setMessages\(page\.messages\)/);
  assert.match(messagesModelSrc, /catch\s*\{[\s\S]*if \(currentChannelIdRef\.current !== requestedChannelId\) return;[\s\S]*setLoadError\(true\)/);
  assert.match(messagesModelSrc, /finally\s*\{[\s\S]*if \(currentChannelIdRef\.current === requestedChannelId\) setLoaded\(true\)/);
});

test("message list render is mutually exclusive with the loading skeleton", () => {
  // Regression: loadCurrentMessages calls setMsgs(ms) before an awaited threadMeta fetch, and only
  // sets loaded=true in the finally block after that fetch resolves. If the message-list render isn't
  // gated on `loaded` too, that in-between render paints the skeleton (`!loaded`) and the real message
  // list (msgs already populated) stacked on top of each other. Reproduced live: a delayed threads
  // endpoint made the skeleton and real messages render together in the same scroll container.
  assert.match(chatSrc, /\{loaded && !loadError && msgs\.map\(/);
});

test("initial message visibility waits for its thread metadata page", () => {
  // P-A9.5 split message and thread ownership into separate hooks. Preserve the former single
  // readiness gate and start metadata I/O before the first message commit, rather than from a
  // post-commit effect that competes with the next channel switch.
  assert.match(threadsModelSrc, /initialMetadataLoaded:\s*boolean/);
  assert.match(messagesModelSrc, /await conversationApi\.getThreadMetadata/);
  assert.match(messagesModelSrc, /threadMetadata/);
  assert.doesNotMatch(threadsModelSrc, /getThreadMetadata\(channelId, initialPage\.messageIds\)/);
  assert.match(chatSrc, /const loaded = messagesLoaded && threadModel\.initialMetadataLoaded/);
});

test("chat load failure copy is localized", () => {
  assert.equal(en.chat.loadFailedTitle, "Could not load this conversation");
  assert.equal(en.chat.loadFailedBody, "Kith-space could not reach its local service. Make sure the Desktop app is running, then retry.");
  assert.equal(en.chat.retryLoad, "Retry");

  assert.equal(zh.chat.loadFailedTitle, "无法加载此对话");
  assert.equal(zh.chat.loadFailedBody, "Kith-space 暂时连不上本机服务。请确认桌面应用仍在运行，然后重试。");
  assert.equal(zh.chat.retryLoad, "重试");
});
