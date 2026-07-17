import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const conversationList = fs.readFileSync(new URL("../web/src/views/ConversationListContent.tsx", import.meta.url), "utf8");
const members = fs.readFileSync(new URL("../web/src/views/Members.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

test("Agent rows share a small vertical gap across lists and pickers", () => {
  assert.equal((conversationList.match(/agent-list-item/g) || []).length, 2);
  assert.equal((members.match(/agent-list-item/g) || []).length, 1);
  assert.match(css, /\.agent-list-item\+\.agent-list-item\{margin-top:4px\}/);
});
