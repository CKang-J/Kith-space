import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const globalCss = read("../web/src/styles.css");
const aggregateCss = read("../web/src/views/conversation-aggregate/conversationAggregate.css");

test("selected Chat header controls use the neutral selected surface", () => {
  assert.match(globalCss, /\.chat-head-icon-btn\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--canvas\)/s);
});

test("file filters and search use the shared neutral surface", () => {
  assert.match(aggregateCss, /\.conversation-files__filter\s*\{[^}]*background:\s*var\(--canvas\)/s);
  assert.match(aggregateCss, /\.conversation-files__search-field\s*\{[^}]*background:\s*var\(--canvas\)/s);
});
