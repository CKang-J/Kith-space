// Unit regression for the compact chat message presentation.
// Run: pnpm exec tsx --test test/messageHeaderLayout.unit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const chatSrc = fs.readFileSync(new URL("../web/src/views/Chat.tsx", import.meta.url), "utf8");
const itemSrc = fs.readFileSync(new URL("../web/src/views/chat-message/ChatMessageItem.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const messageCss = fs.readFileSync(new URL("../web/src/views/chat-message/chatMessage.css", import.meta.url), "utf8");
const zh = fs.readFileSync(new URL("../web/src/locales/zh.json", import.meta.url), "utf8");

function ruleBodyFrom(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  assert.ok(m, `missing CSS rule for ${selector}`);
  return m[1]!;
}

const ruleBody = (selector: string) => ruleBodyFrom(css, selector);
const messageRuleBody = (selector: string) => ruleBodyFrom(messageCss, selector);

test("messages use the shared semantic presentation without repeated agent descriptions", () => {
  assert.match(chatSrc, /<ChatMessageItem/);
  assert.match(chatSrc, /const messageTone = surfaceForSender/);
  assert.match(chatSrc, /surface=\{messageTone\}/);
  assert.match(chatSrc, /<MessageHeader/);
  assert.doesNotMatch(chatSrc, /msg-activity|activity=\{agActivity/);
  assert.doesNotMatch(chatSrc, /msg-subhead|msg-role/);
  assert.doesNotMatch(chatSrc, /ag\.description/);
  assert.doesNotMatch(chatSrc, /\bisMember\b|<span className="member-badge">member<\/span>/);
  assert.doesNotMatch(chatSrc, /activityDetail\?\.trim\(\)|dmAgent\.activityDetail/);
});

test("the shared item owns avatar, header, bubble, and hover toolbar structure", () => {
  assert.match(itemSrc, /<article[\s\S]*?className=\{classes\}/);
  assert.match(itemSrc, /className="chat-message__avatar"/);
  assert.match(itemSrc, /className="chat-message__content"/);
  assert.match(itemSrc, /className="chat-message__header"/);
  assert.match(itemSrc, /className="chat-message__bubble-wrap"/);
  assert.match(itemSrc, /className="chat-message__bubble"/);
  assert.match(itemSrc, /chat-message__toolbar-slot/);
  assert.match(itemSrc, /chat-message__bubble[\s\S]*chat-message__toolbar-slot/);

  const row = messageRuleBody(".chat-message");
  assert.match(row, /grid-template-columns\s*:\s*var\(--chat-message-avatar\) minmax\(0,1fr\)/);
  assert.match(row, /max-width\s*:\s*var\(--chat-stream-max\)/);
  assert.match(row, /margin\s*:\s*0 auto 20px/);

  const bubble = messageRuleBody(".chat-message__bubble");
  assert.match(bubble, /width\s*:\s*fit-content/);
  assert.match(bubble, /padding\s*:\s*8px 14px/);
  assert.match(bubble, /border-radius\s*:\s*var\(--chat-message-radius\)/);
});

test("message density tokens match the accepted design", () => {
  assert.match(messageCss, /--chat-stream-max:1040px/);
  assert.match(messageCss, /--chat-message-avatar:32px/);
  assert.match(messageCss, /--chat-message-font-size:14\.5px/);
  assert.match(messageCss, /--chat-message-line-height:1\.55/);
  assert.match(messageCss, /--chat-message-agent-bg:var\(--ui-muted-bg\)/i);
  assert.match(messageCss, /--chat-message-human-bg:#eff4fb/i);
  assert.match(messageCss, /--chat-composer-reserve:88px/);

  const avatar = messageRuleBody(".chat-message .msg-av");
  assert.match(avatar, /position\s*:\s*relative/);
  assert.match(avatar, /width\s*:\s*var\(--chat-message-avatar\)/);
  assert.match(avatar, /margin\s*:\s*0/);
  assert.match(avatar, /line-height\s*:\s*0/);
});

test("message header keeps bold identity and timestamp on one compact line", () => {
  const header = messageRuleBody(".chat-message__header");
  assert.match(header, /align-items\s*:\s*baseline/);
  assert.match(header, /gap\s*:\s*6px/);
  assert.match(header, /letter-spacing\s*:\s*0/);
  assert.match(header, /margin-bottom\s*:\s*4px/);
  const sender = messageRuleBody(".chat-message__header .who");
  assert.match(sender, /font-size\s*:\s*14\.5px/);
  assert.match(sender, /font-weight\s*:\s*700/);
  assert.match(sender, /line-height\s*:\s*20px/);
  assert.doesNotMatch(messageRuleBody(".chat-message button.msg-av,.chat-message button.who"), /font\s*:/);
  assert.match(ruleBody(".agent-list-item>.grow"), /font-weight\s*:\s*600/);
  const timestamp = messageRuleBody(".chat-message__timestamp");
  assert.match(timestamp, /font-size\s*:\s*11px/);
  assert.match(timestamp, /font-weight\s*:\s*400/);
  assert.match(timestamp, /line-height\s*:\s*16px/);
  assert.match(timestamp, /opacity\s*:\s*0/);
  assert.match(messageCss, /\.chat-message:hover \.chat-message__timestamp,\.chat-message:focus-within \.chat-message__timestamp\{opacity:1\}/);
});

test("chat chrome is compact while non-chat page headings keep their existing typeface", () => {
  assert.match(ruleBody(".head h1"), /font-family\s*:\s*var\(--serif\)/);
  assert.match(ruleBody(".thread-head"), /font-family\s*:\s*var\(--serif\)/);
  const chatHead = ruleBody(".chat-head");
  assert.match(chatHead, /height\s*:\s*52px/);
  assert.match(chatHead, /padding\s*:\s*0 14px/);
  assert.match(chatHead, /border-bottom\s*:\s*1px solid var\(--hair\)/);
  const rail = ruleBody(".chat-head__rail");
  assert.match(rail, /max-width\s*:\s*none/);
  assert.match(rail, /margin\s*:\s*0/);
  assert.match(rail, /gap\s*:\s*8px/);
  const title = ruleBody(".chat-head__rail>h1");
  assert.match(title, /font-family\s*:\s*var\(--sans\)/);
  assert.match(title, /font-size\s*:\s*20px/);
  assert.match(title, /font-weight\s*:\s*600/);
  assert.doesNotMatch(css, /\.chat-head::after\s*\{/);
});

test("agent DM header uses the peer avatar, plain name, and localized lifecycle label", () => {
  assert.match(chatSrc, /import \{ agentStatusLabel \} from "\.\.\/agentStatus\.ts"/);
  assert.match(chatSrc, /className=\{isDm \? "chat-head__dm-title" : "chat-head__channel-title"\}/);
  assert.match(chatSrc, /<Avatar seed=\{dmAgent\.name\} url=\{avFor\(dmAgent\.avatarUrl\)\} size=\{24\} \/>/);
  assert.match(chatSrc, /agentStatusLabel\(t, agentLiveState\(dmAgent\)\)/);
  assert.doesNotMatch(chatSrc, /isDm \? "@ " \+/);
  const dmTitle = ruleBody(".chat-head__rail>.chat-head__dm-title");
  assert.match(dmTitle, /display\s*:\s*flex/);
  assert.match(dmTitle, /align-items\s*:\s*center/);
  assert.match(dmTitle, /gap\s*:\s*7px/);
  assert.match(dmTitle, /font-size\s*:\s*16px/);
  assert.match(dmTitle, /font-weight\s*:\s*700/);
  assert.match(css, /\.head-status\{[^}]*font-size\s*:\s*12px[^}]*font-weight\s*:\s*400/);
  const statusDot = ruleBody(".head-status .dot");
  assert.match(statusDot, /width\s*:\s*5px/);
  assert.match(statusDot, /height\s*:\s*5px/);
  assert.match(zh, /"sleeping"\s*:\s*"已休眠"/);
});

test("avatar and generic status dots use the quiet sleeping gray while keeping active lifecycle colors", () => {
  assert.match(css, /--status-sleeping:#9c9894/i);
  assert.match(css, /\.dot\.sleeping\{background:var\(--status-sleeping\)\}/);
  assert.match(css, /\.dot\.online,\.dot\.active\{background:var\(--status-green\)\}/);
  assert.match(css, /\.dot\.working,\.dot\.thinking\{background:var\(--status-orange\)\}/);
  assert.match(css, /\.av-status\.sleeping\{background:var\(--status-sleeping\)\}/);
  assert.match(css, /\.av-status\.online,\.av-status\.active\{background:var\(--status-green\)\}/);
  assert.match(css, /\.av-status\.working,\.av-status\.thinking\{background:var\(--status-orange\)\}/);
  assert.match(ruleBody(".av-status.working::after"), /animation\s*:\s*lb-ping/);
  assert.doesNotMatch(css, /\.av-status\.thinking::after|\.av-status\.sleeping::after/);
  assert.match(ruleBody(".dot.working:not(.live-bar__pip)::after"), /animation\s*:\s*lb-ping/);
  assert.doesNotMatch(css, /\.dot\.thinking::after/);
});

test("message body typography stays readable without the legacy width penalty", () => {
  const body = messageRuleBody(".chat-message .mbody");
  assert.match(body, /font-size\s*:\s*var\(--chat-message-font-size\)/);
  assert.match(body, /line-height\s*:\s*var\(--chat-message-line-height\)/);
  assert.doesNotMatch(css + messageCss, /max-width\s*:\s*calc\(100% - 64px\)/);

  const thinking = ruleBody(".agent-reply-placeholder");
  assert.match(thinking, /font-weight\s*:\s*700/);
  assert.match(thinking, /font-style\s*:\s*normal/);
  assert.match(thinking, /animation\s*:\s*agent-thinking-shimmer 4s linear infinite/);
  assert.match(css, /@keyframes agent-thinking-shimmer/);
});

test("message rows use avatar status dots without a duplicate activity label", () => {
  assert.doesNotMatch(css + messageCss, /\.msg-activity|chat-message__activity/);
  assert.match(chatSrc, /agLive !== "offline" && <span className=\{"av-status " \+ agLive\}/);
});

test("sender surfaces and hover states stay on the content bubble", () => {
  assert.match(messageCss, /\.chat-message--agent \.chat-message__bubble,\.chat-message--action \.chat-message__bubble\{background:var\(--chat-message-agent-bg\)\}/);
  assert.match(messageCss, /\.chat-message--human \.chat-message__bubble\{background:var\(--chat-message-human-bg\)\}/);
  assert.match(messageCss, /\.chat-message--agent \.chat-message__bubble-wrap:hover \.chat-message__bubble,\.chat-message--action \.chat-message__bubble-wrap:hover \.chat-message__bubble\{background:var\(--chat-message-agent-bg-hover\)\}/);
  assert.match(messageCss, /\.chat-message--human \.chat-message__bubble-wrap:hover \.chat-message__bubble\{background:var\(--chat-message-human-bg-hover\)\}/);
  assert.doesNotMatch(css, /\.msg:hover\s*\{/);
});

test("message toolbar exposes reaction, topic, copy, and more from the bubble", () => {
  assert.match(chatSrc, /<MessageToolbar>/);
  assert.match(chatSrc, /<ReactionToolbarButton/);
  assert.match(chatSrc, /aria-label=\{t\("chat\.openThread"\)\}/);
  assert.match(chatSrc, /aria-label=\{t\("chat\.copyMarkdown"\)\}/);
  assert.match(chatSrc, /aria-label=\{t\("chat\.more"\)\}/);
  const toolbarSlot = messageRuleBody(".chat-message__toolbar-slot");
  assert.match(toolbarSlot, /position\s*:\s*absolute/);
  assert.match(toolbarSlot, /opacity\s*:\s*0/);
  assert.doesNotMatch(toolbarSlot, /visibility\s*:\s*hidden/, "hidden visibility would remove toolbar buttons from keyboard navigation");
  assert.match(itemSrc, /rightBoundary - bubbleRect\.right >= toolbarSlot\.getBoundingClientRect\(\)\.width \+ 8 \? "side" : "above"/);
  assert.match(messageCss, /\.chat-message__bubble-wrap:hover>\.chat-message__toolbar-slot/);
  const button = messageRuleBody(".chat-message__toolbar button");
  assert.match(button, /width\s*:\s*30px/);
  assert.match(button, /height\s*:\s*30px/);
});

test("reaction add moves into the toolbar without creating empty message meta", () => {
  assert.match(chatSrc, /function ReactionToolbarButton/);
  assert.match(chatSrc, /if \(!rs\.length\) return null/);
  assert.match(chatSrc, /const hasInlineMeta = !!m\.taskStatus \|\| !!m\.reactions\?\.length;/);
  assert.match(chatSrc, /\{hasInlineMeta \? <div className="msg-meta">/);
  assert.doesNotMatch(css, /\.msg-rx\.is-empty|\.rx-add/);
  assert.doesNotMatch(messageCss, /\.chat-message \.msg-meta\{width:100%\}/);
});

test("composer, scroll reserve, and date divider align with the message stream", () => {
  const scroll = ruleBody("main.content-col > .scroll");
  assert.match(scroll, /padding-bottom\s*:\s*var\(--chat-composer-reserve\)/);
  assert.match(scroll, /scrollbar-gutter\s*:\s*stable both-edges/);
  assert.match(scroll, /overflow-x\s*:\s*hidden/);
  assert.match(css, /--scrollbar-gutter:10px/);
  assert.match(css, /\*::-webkit-scrollbar\{width:10px;height:10px\}/);
  const dateDivider = ruleBody(".date-divider");
  assert.match(dateDivider, /max-width\s*:\s*var\(--chat-stream-max\)/);
  assert.match(dateDivider, /margin\s*:\s*10px auto/);
  const composer = ruleBody(".composer");
  assert.match(composer, /padding\s*:\s*4px var\(--chat-stream-gutter,20px\) 14px/);
  assert.match(composer, /border-top\s*:\s*0/);
  const composerRail = ruleBody("main.content-col > .composer");
  assert.match(composerRail, /left\s*:\s*var\(--scrollbar-gutter\)/);
  assert.match(composerRail, /right\s*:\s*var\(--scrollbar-gutter\)/);
  const composerBox = ruleBody(".composer-box");
  assert.match(composerBox, /max-width\s*:\s*var\(--chat-stream-max\)/);
  assert.match(composerBox, /margin\s*:\s*0 auto/);
  const mentionMenu = ruleBody(".mention-menu");
  assert.match(mentionMenu, /max-width\s*:\s*var\(--chat-stream-max\)/);
  assert.match(mentionMenu, /margin\s*:\s*0 auto 8px/);
  assert.match(ruleBody(".composer-validation-error"), /margin\s*:\s*0 auto 7px/);
  assert.match(ruleBody(".jump-bottom"), /bottom\s*:\s*calc\(var\(--chat-composer-reserve\) \+ 14px\)/);
});

test("system task events share the centered message rail", () => {
  const systemMessage = ruleBody(".msg-sys");
  assert.match(systemMessage, /width\s*:\s*100%/);
  assert.match(systemMessage, /max-width\s*:\s*var\(--chat-stream-max\)/);
  assert.match(systemMessage, /margin\s*:\s*0 auto/);
  const markdown = ruleBody(".msg-sys>.md");
  assert.match(markdown, /margin\s*:\s*0 auto/);
  assert.match(markdown, /text-align\s*:\s*center/);
});

test("hidden message toolbars do not widen the chat scroll surface", () => {
  assert.match(itemSrc, /useState<"side" \| "above">\("above"\)/);
});

test("new messages still expand from below and honor reduced motion", () => {
  const frames = css.match(/@keyframes msg-enter\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(frames, /translateY\(18px\)/);
  assert.match(frames, /max-height:0/);
  assert.match(frames, /max-height:40rem/);
  const enter = ruleBody(".msg-enter");
  assert.match(enter, /overflow\s*:\s*hidden/);
  assert.match(enter, /animation-duration\s*:\s*1s/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.msg-enter\{animation:none\}\}/);
});

test("composer uses agent lifecycle reachability as the placeholder", () => {
  const composerSrc = fs.readFileSync(new URL("../web/src/views/Composer.tsx", import.meta.url), "utf8");
  const en = fs.readFileSync(new URL("../web/src/locales/en.json", import.meta.url), "utf8");
  const zh = fs.readFileSync(new URL("../web/src/locales/zh.json", import.meta.url), "utf8");
  assert.doesNotMatch(composerSrc, /className="wake-hint|machineOfflineComposerPlaceholder|reachStatusChip|composer-status-chip/);
  assert.match(composerSrc, /const reachPlaceholder = reach \?/);
  assert.match(composerSrc, /agentSleepingComposerPlaceholder|agentOnlineComposerPlaceholder|agentWorkingComposerPlaceholder/);
  assert.match(en, /"agentOnlineComposerPlaceholder"/);
  assert.match(en, /"agentWorkingComposerPlaceholder"/);
  assert.match(zh, /"agentOnlineComposerPlaceholder"/);
  assert.match(zh, /"agentWorkingComposerPlaceholder"/);
});
