import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const itemSrc = fs.readFileSync(new URL("../web/src/views/chat-message/ChatMessageItem.tsx", import.meta.url), "utf8");
const presentationSrc = fs.readFileSync(new URL("../web/src/views/chat-message/messagePresentation.ts", import.meta.url), "utf8");
const messageCss = fs.readFileSync(new URL("../web/src/views/chat-message/chatMessage.css", import.meta.url), "utf8");
const globalCss = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const chatSrc = fs.readFileSync(new URL("../web/src/views/Chat.tsx", import.meta.url), "utf8");
const skeletonSrc = fs.readFileSync(new URL("../web/src/views/Skeleton.tsx", import.meta.url), "utf8");
const topicPreviewSrc = fs.readFileSync(new URL("../web/src/views/chat-message/MessageTopicPreview.tsx", import.meta.url), "utf8");

test("message presentation has one semantic skeleton and sender surface mapping", () => {
  assert.match(itemSrc, /<article/);
  assert.match(itemSrc, /chat-message__avatar/);
  assert.match(itemSrc, /chat-message__header/);
  assert.match(itemSrc, /chat-message__bubble/);
  assert.match(itemSrc, /chat-message__footer-timestamp/);
  assert.match(itemSrc, /chat-message__toolbar/);
  assert.match(presentationSrc, /senderType: "agent" \| "human"/);
  assert.match(presentationSrc, /"action" \| "thread"/);
});

test("main chat, thread replies, action cards, and skeletons reuse ChatMessageItem", () => {
  const chatUses = chatSrc.match(/<ChatMessageItem\b/g) ?? [];
  assert.ok(chatUses.length >= 3, `expected main, thread, and action-card uses, got ${chatUses.length}`);
  assert.match(skeletonSrc, /<ChatMessageItem\b/);
  assert.match(chatSrc, /surface="thread"/);
  assert.doesNotMatch(chatSrc, /className=\{"msg"/);
  assert.match(chatSrc, /const conversationReadOnly = isArchived/);
  assert.match(chatSrc, /readOnly=\{conversationReadOnly\}/);
  assert.match(chatSrc, /!conversationReadOnly \? <ReactionToolbarButton/);
  assert.match(chatSrc, /!readOnly \? <button className="ctx-item"/);
});

test("message density tokens match the reference-driven split bubble design", () => {
  assert.match(messageCss, /--chat-stream-max:\s*1040px/);
  assert.match(messageCss, /--chat-message-avatar:\s*36px/);
  assert.match(messageCss, /--chat-message-font-size:\s*var\(--font-size-base\)/);
  assert.match(messageCss, /--chat-message-line-height:\s*var\(--line-height-reading\)/);
  assert.match(messageCss, /--chat-message-human-bg:\s*#e7f0fe/i);
  assert.match(messageCss, /--chat-message-agent-bg:\s*#f7f8fa/i);
  assert.match(messageCss, /grid-template-columns:\s*var\(--chat-message-avatar\) minmax\(0,1fr\)/);
  assert.match(messageCss, /\.chat-message--human\{[\s\S]*?grid-template-columns:minmax\(0,1fr\) var\(--chat-message-avatar\)/);
  assert.match(messageCss, /\.chat-message--human \.chat-message__content\{[\s\S]*?justify-self:end;[\s\S]*?align-items:flex-end/);
  assert.match(messageCss, /\.chat-message--human \.chat-message__header\{display:none\}/);
  assert.match(messageCss, /width:\s*fit-content/);
  assert.match(messageCss, /\.chat-message__bubble\{[\s\S]*?padding:\s*16px 18px/);
  assert.match(messageCss, /\.chat-message \.md\{[\s\S]*?--md-paragraph-gap:\.85em/);
  assert.match(messageCss, /\.chat-message \.md h1,[\s\S]*?font-size:var\(--font-size-title\)[\s\S]*?font-weight:var\(--font-weight-strong\)/);
  assert.match(messageCss, /margin:\s*0 auto 26px/);
  assert.match(messageCss, /\.chat-message__footer-timestamp\s*\{[\s\S]*?margin-top:\s*6px/);
  assert.match(messageCss, /\.chat-message__bubble-wrap:hover>\.chat-message__toolbar-slot/);
  assert.match(messageCss, /\.chat-message__bubble-wrap:focus-within>\.chat-message__toolbar-slot/);
});

test("message timestamps and preview metadata use the shared auxiliary type scale", () => {
  assert.match(messageCss, /\.chat-message__continuation-timestamp\{[^}]*font-size:var\(--font-size-meta\)!important/);
  assert.match(messageCss, /\.chat-message__footer-timestamp\{[^}]*font-size:var\(--font-size-meta\)!important/);
  assert.match(messageCss, /\.message-topic-preview__footer\{[^}]*font-size:var\(--font-size-meta\)!important/);
});

test("legacy full-card width penalty and repeated agent description are removed", () => {
  assert.doesNotMatch(globalCss, /\.msg \.md\s*\{[^}]*calc\(100% - 64px\)/);
  assert.doesNotMatch(chatSrc, /msg-subhead/);
  assert.doesNotMatch(chatSrc, /msg-role/);
  assert.doesNotMatch(chatSrc, /ag && ag\.description/);
});

test("chat title, scroll reserve, and composer align to the shared stream", () => {
  assert.match(globalCss, /\.chat-head\{[^}]*height:\s*52px/);
  assert.match(globalCss, /\.chat-head\{[^}]*padding:\s*0 14px/);
  assert.match(globalCss, /\.chat-head__rail\{[^}]*max-width:\s*none[^}]*margin:\s*0/);
  assert.doesNotMatch(globalCss, /\.chat-head::after/);
  assert.match(globalCss, /main\.content-col > \.scroll,[\s\S]*?\.thread-panel > \.scroll\{[^}]*padding-right:\s*max\(0px,calc\(var\(--chat-stream-gutter,20px\) - var\(--chat-scrollbar-width,0px\)\)\)[^}]*padding-bottom:\s*var\(--chat-composer-reserve\)[^}]*scrollbar-gutter:\s*stable[^}]*overflow-x:\s*hidden/);
  assert.doesNotMatch(globalCss, /--scrollbar-gutter:10px/);
  assert.match(globalCss, /\.date-divider\{[^}]*max-width:\s*var\(--chat-stream-max\)[^}]*margin:\s*18px auto 24px/);
  assert.match(globalCss, /\.composer-box\{[^}]*max-width:\s*var\(--chat-stream-max\)[^}]*margin:\s*0 auto/);
  assert.match(chatSrc, /className="jump-bottom" type="button" aria-label=\{t\("chat\.backToBottom"\)\} title=\{t\("chat\.backToBottom"\)\}/);
  assert.doesNotMatch(chatSrc, /<ArrowDown size=\{14\} \/> \{t\("chat\.backToBottom"\)\}/);
  assert.match(globalCss, /\.jump-bottom\{[^}]*overflow:hidden[^}]*padding:0[^}]*\}/);
});

test("topic replies render as a separate reference-style card and preserve relative recency", () => {
  assert.match(chatSrc, /const hasInlineMeta = !!m\.taskStatus \|\| !!m\.reactions\?\.length;/);
  assert.match(chatSrc, /\{hasInlineMeta \? <div className="msg-meta">/);
  assert.match(chatSrc, /afterBubble=\{tm\?\.replyCount \? <MessageTopicPreview/);
  assert.match(itemSrc, /className="chat-message__after-bubble"/);
  const previewBlock = messageCss.match(/\.message-topic-preview\{([^}]*)\}/)?.[1] ?? "";
  assert.match(previewBlock, /border:1px solid #ededed/);
  assert.match(previewBlock, /border-radius:16px/);
  assert.match(previewBlock, /background:#fff/);
  assert.match(messageCss, /\.message-topic-preview:hover\{border-color:#e4e4e4;background:#f7f7f7\}/);
  assert.match(topicPreviewSrc, /meta\.previews/);
  assert.match(topicPreviewSrc, /relativeTimeLabel\(meta\.lastReplyAt,\s*t\)/);
  assert.match(topicPreviewSrc, /message-topic-preview__footer/);
  assert.match(topicPreviewSrc, /message-topic-preview__latest/);
  assert.match(topicPreviewSrc, /message-topic-preview__reply/);
});

test("consecutive messages suppress repeated identity while keeping bubble alignment", () => {
  assert.match(chatSrc, /shouldGroupMessage\(prevMsg, m\)/);
  assert.match(chatSrc, /shouldGroupMessage\(m, nextMsg\)/);
  assert.doesNotMatch(chatSrc, /continuationTimestamp=\{m\.senderType === "agent"/);
  assert.match(chatSrc, /footerTimestamp=\{fmtMessageTime\(m\.createdAt\)\}/);
  assert.match(messageCss, /\.chat-message:hover \.chat-message__continuation-timestamp/);
  assert.match(messageCss, /\.chat-message--has-continuation\{margin-bottom:6px\}/);
});

test("direct messages omit the repeated sender name and align the bubble with the avatar", () => {
  assert.match(chatSrc, /isDm \? "chat-message--direct" : ""/);
  assert.match(chatSrc, /header=\{continuation \|\| isDm \? null : <MessageHeader sender=\{sender\} \/\>\}/);
});
