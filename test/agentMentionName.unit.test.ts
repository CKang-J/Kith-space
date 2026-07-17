import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("web/src/views/chat-message/AgentMentionName.tsx", "utf8");
const humanCard = readFileSync("web/src/views/chat-message/HumanMessageCard.tsx", "utf8");
const chat = readFileSync("web/src/views/Chat.tsx", "utf8");
const composer = readFileSync("web/src/views/Composer.tsx", "utf8");
const css = readFileSync("web/src/views/chat-message/chatMessage.css", "utf8");
const globalCss = readFileSync("web/src/styles.css", "utf8");

test("Agent message names expose a dedicated click-to-mention control", () => {
  assert.match(component, /className="who agent-mention-name"/);
  assert.match(component, /onClick=\{\(\) => onMention\(mentionName\)\}/);
  assert.match(component, /agent-mention-name__at/);
  assert.match(chat, /<AgentMentionName displayName=\{m\.senderName\} mentionName=\{ag\.name\}/);
  assert.match(chat, /<Composer\s+ref=\{composerRef\}/);
});

test("Composer exposes a focused insertion API instead of message rows querying the DOM", () => {
  assert.match(composer, /export interface ComposerHandle/);
  assert.match(composer, /useImperativeHandle\(ref/);
  assert.match(composer, /insertAgentMention\(text, start, end, agentName\)/);
  assert.match(composer, /inputRef\.current\?\.setSelectionRange\(insertion\.caret, insertion\.caret\)/);
  assert.doesNotMatch(chat, /querySelector\([^)]*composer/i);
});

test("Agent names reveal a spaced @ and darken without changing weight", () => {
  assert.match(css, /button\.agent-mention-name[^{]*\{[^}]*grid-template-columns:0 minmax\(0,1fr\)/s);
  assert.match(css, /button\.agent-mention-name:hover[^{]*,[^{]*button\.agent-mention-name:focus-visible[^{]*\{[^}]*color:var\(--ink\)[^}]*grid-template-columns:14px/s);
  assert.doesNotMatch(css, /button\.agent-mention-name:hover[^{]*,[^{]*button\.agent-mention-name:focus-visible[^{]*\{[^}]*font-weight:700/s);
  assert.match(css, /agent-mention-name:hover \.agent-mention-name__at[^{]*,[^{]*agent-mention-name:focus-visible \.agent-mention-name__at[^{]*\{[^}]*opacity:1/s);
});

test("Human names are static while avatars open a minimal self identity card", () => {
  assert.match(chat, /onClick=\{\(event\) => openMessageHumanCard\(m\.senderName, senderAvatar\(m\), event\.currentTarget\)\}/);
  assert.match(chat, /\? <span className="who">\{m\.senderName\}<\/span>/);
  assert.doesNotMatch(chat, /className="who clickable"/);
  assert.doesNotMatch(globalCss, /\.who\.clickable/);
  assert.match(humanCard, /<Avatar seed=\{name\} url=\{avatarUrl\} size=\{42\}/);
  assert.match(humanCard, /chat\.currentHumanSuffix/);
  assert.doesNotMatch(humanCard, /button|MessageCircle|responseMode/);
});
