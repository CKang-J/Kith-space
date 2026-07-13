import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const chat = fs.readFileSync(new URL("../web/src/views/Chat.tsx", import.meta.url), "utf8");

test("thread follow control toggles state without closing the panel", () => {
  assert.match(chat, /followed=\{thread\.followed\}/);
  assert.match(chat, /onFollowChange=\{\(followed\) =>/);
  assert.match(chat, /followed \? <Bell size=\{14\} \/> : <BellOff size=\{14\} \/>/);
  assert.match(chat, /followed \? t\("chat\.unfollowThread"\) : t\("chat\.followThread"\)/);
  assert.doesNotMatch(chat, /threads\/unfollow"[^\n]+onClose\(\)/);
});
