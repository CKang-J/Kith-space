import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Agent messages expose the audited turn Context, Steps, Usage and Outcome panel", () => {
  const chat = fs.readFileSync(new URL("../web/src/views/Chat.tsx", import.meta.url), "utf8");
  const panel = fs.readFileSync(new URL("../web/src/views/chat-message/TurnDetailsButton.tsx", import.meta.url), "utf8");
  assert.match(chat, /m\.producedByTurnId \? <TurnDetailsButton turnId=\{m\.producedByTurnId\}/);
  assert.match(panel, /\/api\/turns\/\$\{turnId\}/);
  for (const tab of ["context", "steps", "usage", "outcome"]) assert.match(panel, new RegExp(`"${tab}"`));
  assert.match(panel, /turn-source-state is-\$\{source\.state\}/);
});
