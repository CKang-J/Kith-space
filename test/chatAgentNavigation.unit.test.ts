import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const chat = fs.readFileSync(new URL("../web/src/views/Chat.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const zh = fs.readFileSync(new URL("../web/src/locales/zh.json", import.meta.url), "utf8");
const en = fs.readFileSync(new URL("../web/src/locales/en.json", import.meta.url), "utf8");

test("an Agent DM header links to that Agent's module profile", () => {
  assert.match(chat, /className="chat-agent-profile-btn"/);
  assert.match(chat, /onClick=\{\(\) => openAgentProfile\(dmAgent\.id\)\}/);
  assert.match(chat, /t\("chat\.openAgentProfile"/);
  assert.match(css, /\.chat-agent-profile-btn\{[^}]*margin-left:auto[^}]*align-items:center[^}]*justify-content:center/);
  assert.match(zh, /"openAgentProfile"\s*:\s*"打开 Agent 页面"/);
  assert.match(en, /"openAgentProfile"\s*:\s*"Open Agent profile"/);
});
