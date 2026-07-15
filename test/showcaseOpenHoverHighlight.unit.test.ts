// Unit regression for Showcase reuse of the compact message presentation.
// Run: pnpm exec tsx --test test/showcaseOpenHoverHighlight.unit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const messageCss = fs.readFileSync(new URL("../web/src/views/chat-message/chatMessage.css", import.meta.url), "utf8");
const showcaseSrc = fs.readFileSync(new URL("../web/src/views/Showcase.tsx", import.meta.url), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(m, `missing CSS rule for ${selector}`);
  return m[1]!;
}

test("Showcase renders the same semantic message item as Chat", () => {
  assert.match(showcaseSrc, /import \{ ChatMessageItem, MessageHeader \}/);
  assert.match(showcaseSrc, /<ChatMessageItem/);
  assert.match(showcaseSrc, /surface="showcase"/);
  assert.match(showcaseSrc, /tone=\{surfaceForSender\(isYou \? "human" : "agent"\)\}/);
  assert.doesNotMatch(showcaseSrc, /className="msg"|className="msg-col"|className="msg-head"/);
});

test("open Showcase case preserves its fill, accent, and content inset", () => {
  const open = ruleBody(".showcase-case.open");
  assert.match(open, /background\s*:\s*var\(--surface-strong\)/);
  assert.match(open, /box-shadow\s*:\s*inset 3px 0 0 var\(--g-sky\)/);
  const message = ruleBody(".showcase-case.open .chat-message");
  assert.match(message, /margin\s*:\s*0 0 6px/);
  assert.match(message, /padding-left\s*:\s*18px/);
});

test("open-case row stays transparent while sender hover color remains scoped to the bubble", () => {
  assert.match(ruleBody(".showcase-case.open .chat-message:hover"), /background\s*:\s*transparent/);
  assert.match(messageCss, /\.chat-message--agent \.chat-message__bubble-wrap:hover \.chat-message__bubble/);
  assert.match(messageCss, /\.chat-message--human \.chat-message__bubble-wrap:hover \.chat-message__bubble/);
  assert.doesNotMatch(css, /\.msg:hover\s*\{/);
});
