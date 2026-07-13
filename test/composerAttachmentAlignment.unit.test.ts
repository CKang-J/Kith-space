import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1]!;
}

test("pending attachments share the centered composer box measure", () => {
  const composer = ruleBody(".composer");
  assert.match(composer, /--composer-inline-padding\s*:\s*28px/);

  const attachments = ruleBody(".pending-atts");
  assert.match(attachments, /left\s*:\s*var\(--composer-inline-padding\)/);
  assert.match(attachments, /right\s*:\s*var\(--composer-inline-padding\)/);
  assert.match(attachments, /max-width\s*:\s*var\(--chat-card-width\)/);
  assert.match(attachments, /margin\s*:\s*0 auto 8px/);

  const threadComposer = ruleBody(".thread-composer");
  assert.match(threadComposer, /--composer-inline-padding\s*:\s*18px/);
});
