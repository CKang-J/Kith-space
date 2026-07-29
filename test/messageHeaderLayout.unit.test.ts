// Unit regression for the compact chat message presentation.
// Run: pnpm exec tsx --test test/messageHeaderLayout.unit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const chatSrc = fs.readFileSync(new URL("../web/src/views/Chat.tsx", import.meta.url), "utf8");
const itemSrc = fs.readFileSync(new URL("../web/src/views/chat-message/ChatMessageItem.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const messageCss = fs.readFileSync(new URL("../web/src/views/chat-message/chatMessage.css", import.meta.url), "utf8");
const shellCss = fs.readFileSync(new URL("../web/src/shell/shell.css", import.meta.url), "utf8");
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

test("the shared item owns avatar, header, bubble, footer time, and hover toolbar structure", () => {
  assert.match(itemSrc, /<article[\s\S]*?className=\{classes\}/);
  assert.match(itemSrc, /className="chat-message__avatar"/);
  assert.match(itemSrc, /className="chat-message__content"/);
  assert.match(itemSrc, /className="chat-message__header"/);
  assert.match(itemSrc, /className="chat-message__bubble-wrap"/);
  assert.match(itemSrc, /className="chat-message__bubble"/);
  assert.match(itemSrc, /className="chat-message__footer-timestamp ts"/);
  assert.match(itemSrc, /chat-message__toolbar-slot/);
  assert.match(itemSrc, /chat-message__bubble[\s\S]*chat-message__toolbar-slot/);

  const row = messageRuleBody(".chat-message");
  assert.match(row, /grid-template-columns\s*:\s*var\(--chat-message-avatar\) minmax\(0,1fr\)/);
  assert.match(row, /max-width\s*:\s*var\(--chat-stream-max\)/);
  assert.match(row, /margin\s*:\s*0 auto 26px/);

  const bubble = messageRuleBody(".chat-message__bubble");
  assert.match(bubble, /width\s*:\s*fit-content/);
  assert.match(bubble, /padding\s*:\s*16px 18px/);
  assert.match(bubble, /border-radius\s*:\s*var\(--chat-message-radius\)/);
});

test("message density tokens match the accepted design", () => {
  assert.match(messageCss, /--chat-stream-max:1040px/);
  assert.match(messageCss, /--chat-message-avatar:36px/);
  assert.match(messageCss, /--chat-message-font-size:var\(--font-size-base\)/);
  assert.match(messageCss, /--chat-message-line-height:var\(--line-height-reading\)/);
  assert.match(messageCss, /--chat-message-agent-bg:var\(--chat-agent-bg\)/i);
  assert.match(messageCss, /--chat-message-human-bg:var\(--chat-human-bg\)/i);
  assert.match(messageCss, /--chat-composer-reserve:88px/);

  const avatar = messageRuleBody(".chat-message .msg-av");
  assert.match(avatar, /position\s*:\s*relative/);
  assert.match(avatar, /width\s*:\s*var\(--chat-message-avatar\)/);
  assert.match(avatar, /margin\s*:\s*0/);
  assert.match(avatar, /line-height\s*:\s*0/);
});

test("agent identity remains compact while Human messages move to the right without a repeated header", () => {
  const header = messageRuleBody(".chat-message__header");
  assert.match(header, /align-items\s*:\s*baseline/);
  assert.match(header, /gap\s*:\s*6px/);
  assert.match(header, /letter-spacing\s*:\s*0/);
  assert.match(header, /min-height\s*:\s*18px/);
  assert.match(header, /margin-bottom\s*:\s*0/);
  const sender = messageRuleBody(".chat-message__header .who");
  assert.match(sender, /font-size\s*:\s*var\(--font-size-base\)/);
  assert.match(sender, /font-weight\s*:\s*400/);
  const agentName = messageRuleBody(".chat-message .chat-message__header button.agent-mention-name");
  assert.match(agentName, /font-weight\s*:\s*400/);
  assert.match(agentName, /margin-left\s*:\s*-8px/);
  assert.match(sender, /line-height\s*:\s*18px/);
  assert.doesNotMatch(messageRuleBody(".chat-message button.msg-av,.chat-message button.who"), /font\s*:/);
  assert.match(ruleBody(".agent-list-item>.grow"), /font-weight\s*:\s*600/);
  const timestamp = messageRuleBody(".chat-message__footer-timestamp");
  assert.match(timestamp, /margin-top\s*:\s*6px/);
  assert.match(timestamp, /margin-left\s*:\s*0/);
  assert.doesNotMatch(timestamp, /padding-left/);
  assert.match(timestamp, /font-size\s*:\s*var\(--font-size-meta\)!important/);
  assert.match(timestamp, /font-weight\s*:\s*400/);
  assert.match(timestamp, /line-height\s*:\s*16px/);
  assert.match(timestamp, /opacity\s*:\s*0/);
  assert.match(messageCss, /\.chat-message:hover \.chat-message__footer-timestamp,\.chat-message:focus-within \.chat-message__footer-timestamp\{opacity:1\}/);
  assert.match(chatSrc, /footerTimestamp=\{fmtMessageTime\(m\.createdAt\)\}/);
  assert.doesNotMatch(chatSrc, /continuationTimestamp=\{m\.senderType === "agent" \? null : continuation/);
  assert.doesNotMatch(chatSrc, /fmtMessageTimestamp/);
  assert.match(chatSrc, /header=\{continuation \|\| isDm \? null : <MessageHeader sender=\{sender\} \/\>\}/);
  assert.match(messageCss, /\.chat-message--human \.chat-message__avatar\{[^}]*grid-column:2[^}]*justify-self:end/s);
  assert.match(messageCss, /\.chat-message--human \.chat-message__header\{display:none\}/);
});

test("chat chrome is compact while non-chat page headings keep their existing typeface", () => {
  assert.match(ruleBody(".head h1"), /font-family\s*:\s*var\(--serif\)/);
  assert.match(ruleBody(".thread-head"), /font-family\s*:\s*var\(--sans\)/);
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
  assert.match(css, /body :where\(h1,h2,h3,h4,h5,h6\)\{font-size:var\(--font-size-title\)!important;font-weight:400!important\}/);
  assert.doesNotMatch(css, /\.chat-head::after\s*\{/);
});

test("agent DM header uses a regular-weight plain name without an avatar and keeps the localized lifecycle label", () => {
  assert.match(chatSrc, /import \{ agentStatusLabel \} from "\.\.\/agentStatus\.ts"/);
  assert.match(chatSrc, /className=\{isDm \? "chat-head__dm-title" : "chat-head__channel-title"\}/);
  assert.doesNotMatch(chatSrc, /<Avatar seed=\{dmAgent\.name\} url=\{avFor\(dmAgent\.avatarUrl\)\} size=\{24\} \/>/);
  assert.match(chatSrc, /agentStatusLabel\(t, agentLiveState\(dmAgent\)\)/);
  assert.doesNotMatch(chatSrc, /isDm \? "@ " \+/);
  const dmTitle = ruleBody(".chat-head__rail>.chat-head__dm-title");
  assert.match(dmTitle, /font-size\s*:\s*16px/);
  assert.match(dmTitle, /font-weight\s*:\s*400/);
  assert.doesNotMatch(css, /\.chat-head__dm-title \.av-img\{/);
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
  assert.match(ruleBody(".dot.working::after"), /animation\s*:\s*lb-ping/);
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
  assert.doesNotMatch(messageCss, /\.chat-message--(?:agent|human|action) \.chat-message__bubble-wrap:hover \.chat-message__bubble/);
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
  assert.match(itemSrc, /const sideSpace = isHuman[\s\S]*?\? bubbleRect\.left - leftBoundary[\s\S]*?: rightBoundary - bubbleRect\.right/);
  assert.match(itemSrc, /const bottomSpace = bottomBoundary - bubbleRect\.bottom/);
  assert.match(itemSrc, /sideSpace >= toolbarRect\.width \+ 8[\s\S]*?\? "side"[\s\S]*?topSpace >= toolbarRect\.height \+ toolbarGap[\s\S]*?\? "above"[\s\S]*?bottomSpace >= toolbarRect\.height \+ toolbarGap[\s\S]*?\? "below"[\s\S]*?topSpace >= bottomSpace \? "above" : "below"/);
  assert.match(itemSrc, /const observer = new ResizeObserver\(schedulePlacementUpdate\)/);
  assert.match(itemSrc, /observer\.observe\(scroll\)/);
  assert.match(itemSrc, /onPointerLeave=\{handleBubblePointerLeave\}/);
  assert.match(itemSrc, /onBlurCapture=\{handleBubbleBlur\}/);
  assert.match(messageCss, /\.chat-message--human \.chat-message__toolbar-slot--side\{right:calc\(100% \+ 8px\);left:auto\}/);
  assert.match(messageCss, /\.chat-message__bubble-wrap:hover>\.chat-message__toolbar-slot/);
  assert.match(messageCss, /\.chat-message:hover,\.chat-message:focus-within\{[^}]*z-index:10[^}]*content-visibility:visible/s);
  const button = messageRuleBody(".chat-message__toolbar button");
  assert.match(button, /width\s*:\s*30px/);
  assert.match(button, /height\s*:\s*30px/);
  const toolbar = messageRuleBody(".chat-message__toolbar");
  assert.match(toolbar, /border\s*:\s*1px solid var\(--border\)/);
  assert.match(toolbar, /border-radius\s*:\s*12px/);
  assert.match(toolbar, /background\s*:\s*var\(--popover\)/);
  assert.match(toolbar, /box-shadow\s*:\s*0 2px 10px color-mix\(in oklch,var\(--foreground\) 8%,transparent\)/);
  assert.match(css, /\.ctx-menu\{[^}]*background:var\(--popover\)[^}]*border:1px solid var\(--border\)[^}]*border-radius:12px[^}]*box-shadow:0 8px 24px rgba\(15,23,42,.12\)/);
  assert.match(css, /\.ctx-item:hover\{background:var\(--muted\)\}/);
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
  const scroll = ruleBody("main.content-col > .scroll,.thread-panel > .scroll");
  assert.match(scroll, /padding-bottom\s*:\s*var\(--chat-composer-reserve\)/);
  assert.match(scroll, /padding-right\s*:\s*max\(0px,calc\(var\(--chat-stream-gutter,20px\) - var\(--chat-scrollbar-width,0px\)\)\)/);
  assert.match(scroll, /scrollbar-gutter\s*:\s*stable/);
  assert.match(scroll, /overflow-x\s*:\s*hidden/);
  assert.doesNotMatch(css, /--scrollbar-gutter:10px/);
  assert.match(css, /\*::-webkit-scrollbar\{width:10px;height:10px\}/);
  const dateDivider = ruleBody(".date-divider");
  assert.match(dateDivider, /max-width\s*:\s*var\(--chat-stream-max\)/);
  assert.match(dateDivider, /margin\s*:\s*18px auto 24px/);
  assert.match(ruleBody(".date-divider::before"), /content\s*:\s*none/);
  assert.match(ruleBody(".date-divider-label"), /border-radius\s*:\s*7px/);
  const composer = ruleBody(".composer");
  assert.match(composer, /padding\s*:\s*4px var\(--chat-stream-gutter,20px\) 14px/);
  assert.match(composer, /border-top\s*:\s*0/);
  const composerRail = ruleBody("main.content-col > .composer,.thread-panel > .composer");
  assert.match(composerRail, /left\s*:\s*0/);
  assert.match(composerRail, /right\s*:\s*var\(--chat-scrollbar-width,0px\)/);
  assert.match(composerRail, /padding-right\s*:\s*max\(0px,calc\(var\(--chat-stream-gutter,20px\) - var\(--chat-scrollbar-width,0px\)\)\)/);
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
  assert.match(itemSrc, /useState<"side" \| "above" \| "below">\("below"\)/);
  assert.match(messageCss, /\.chat-message__toolbar-slot\{[^}]*position:absolute[^}]*opacity:0/s);
});

test("thread panel starts below the conversation header and shares message edge alignment", () => {
  assert.match(shellCss, /\.shell-chat-surface > \.thread-panel \{[\s\S]*?height: calc\(100% - 52px\);[\s\S]*?margin-top: 52px;/);
  assert.match(shellCss, /\.shell-chat-surface > \.thread-panel::before \{[\s\S]*?height: 52px;[\s\S]*?border-bottom: 1px solid var\(--shell-border\)/);
  assert.match(chatSrc, /thread && !threadOnly \? "content-col--with-thread" : ""/);
  assert.match(chatSrc, /"--chat-thread-occupied-width": `\$\{threadConstraints\.width \+ 10\}px`/);
  assert.match(shellCss, /\.shell-chat-surface > main\.content-col--with-thread \{[\s\S]*?overflow: visible;/);
  assert.match(shellCss, /\.shell-chat-surface > main\.content-col--with-thread > \.chat-head \{[\s\S]*?width: calc\(100% \+ var\(--chat-thread-occupied-width\)\);/);
  assert.match(css, /\.thread-head\{[^}]*min-height:44px[^}]*flex:0 0 44px[^}]*padding:0 12px[^}]*font-size:16px[^}]*font-weight:600/);
  assert.match(css, /\.tp-link,\.tp-close\{[^}]*width:28px[^}]*height:28px[^}]*padding:0/);
  assert.match(css, /\.thread-parent\{margin-bottom:6px\}/);
  assert.doesNotMatch(css, /\.thread-parent\{[^}]*background/);
  assert.match(css, /\.thread-panel > \.scroll\{[^}]*padding-bottom:var\(--chat-composer-reserve\)[^}]*scrollbar-gutter:stable/);
  assert.match(css, /\.thread-panel\{[^}]*--chat-stream-gutter:16px/);
  assert.match(css, /\.thread-panel > \.composer\{[^}]*position:absolute[^}]*left:0[^}]*right:var\(--chat-scrollbar-width,0px\)[^}]*bottom:0/);
  assert.match(messageCss, /\.thread-panel \.chat-message--agent \.chat-message__content\{max-width:none\}/);
  assert.match(messageCss, /\.thread-panel \.chat-message--human \.chat-message__content\{max-width:none\}/);
  assert.match(messageCss, /\.thread-panel \.chat-message--agent \.chat-message__bubble-wrap,[\s\S]*?\.thread-panel \.chat-message--agent \.chat-message__bubble\{width:100%\}/);
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
