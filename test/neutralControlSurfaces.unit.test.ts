import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const globalCss = read("../web/src/styles.css");
const shellCss = read("../web/src/shell/shell.css");
const aggregateCss = read("../web/src/views/conversation-aggregate/conversationAggregate.css");
const searchField = read("../web/src/components/SearchField.tsx");

test("selected Chat header controls use the neutral selected surface", () => {
  assert.match(globalCss, /\.chat-head-icon-btn\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--canvas\)/s);
});

test("file filters and the shared search pill use their approved neutral surfaces", () => {
  assert.match(aggregateCss, /\.conversation-files__filter\s*\{[^}]*background:\s*var\(--canvas\)/s);
  assert.match(searchField, /bg-\[var\(--surface-strong\)\]/);
  assert.doesNotMatch(aggregateCss, /\.conversation-files__search-field/);
});

test("conversation aggregate panel shares the Chat boundary divider instead of drawing a second line", () => {
  assert.match(shellCss, /\.shell-chat-workspace\s*\{[^}]*border-right:\s*1px solid var\(--shell-border\)/s);
  assert.doesNotMatch(aggregateCss, /\.conversation-aggregate\s*\{[^}]*border-left:/s);
});
