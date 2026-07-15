import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const composer = fs.readFileSync(new URL("../web/src/views/Composer.tsx", import.meta.url), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1]!;
}

test("pending attachments render inside the centered composer surface", () => {
  const composerBoxIndex = composer.indexOf('className={`composer-box');
  const attachmentsIndex = composer.indexOf("<ComposerAttachments");
  const inputIndex = composer.indexOf('<textarea className="composer-input"');
  assert.ok(
    composerBoxIndex >= 0 && composerBoxIndex < attachmentsIndex && attachmentsIndex < inputIndex,
    "attachment previews should be part of the input surface and precede the draft",
  );

  const attachments = ruleBody(".composer-attachments");
  assert.match(attachments, /width\s*:\s*100%/);
  assert.match(attachments, /margin\s*:\s*0 0 9px/);
  assert.doesNotMatch(attachments, /position\s*:\s*absolute|left\s*:|right\s*:|bottom\s*:/);

  const threadComposer = ruleBody(".thread-composer");
  assert.match(threadComposer, /padding\s*:\s*14px 18px 18px/);
});
