import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const composer = fs.readFileSync(new URL("../web/src/views/Composer.tsx", import.meta.url), "utf8");
const attachmentsComponent = fs.readFileSync(new URL("../web/src/views/composer/ComposerAttachments.tsx", import.meta.url), "utf8");
const attachmentCard = fs.readFileSync(new URL("../web/src/components/AttachmentCard.tsx", import.meta.url), "utf8");
const reserve = fs.readFileSync(new URL("../web/src/views/composer/useComposerReserve.ts", import.meta.url), "utf8");

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
  const attachmentList = ruleBody(".attachment-list");
  assert.match(attachmentList, /width\s*:\s*100%/);
  assert.match(attachmentList, /max-width\s*:\s*100%/);
  assert.match(attachmentList, /flex-wrap\s*:\s*wrap/);
  assert.match(attachments, /margin\s*:\s*0 0 9px/);
  assert.match(attachments, /padding\s*:\s*0/);
  assert.doesNotMatch(attachments, /position\s*:\s*absolute|left\s*:|right\s*:|bottom\s*:/);

  assert.match(ruleBody(".composer-box"), /padding\s*:\s*10px/);
  assert.match(ruleBody(".composer-input"), /padding\s*:\s*3px 0/);
  assert.match(ruleBody(".attachment-card__remove"), /width\s*:\s*16px/);
  assert.match(ruleBody(".attachment-card__remove"), /height\s*:\s*16px/);
  assert.match(ruleBody(".attachment-card__remove"), /line-height\s*:\s*0/);
  assert.match(ruleBody(".attachment-card"), /border-radius\s*:\s*13px/);
  assert.match(ruleBody(".attachment-card"), /transition\s*:\s*background var\(--dur-fast\) var\(--ease-quint\)/);
  assert.match(ruleBody(".attachment-card:hover,.attachment-card:focus-within"), /background\s*:\s*#f7f7f7/);
  assert.match(ruleBody(".attachment-card__file-icon"), /border\s*:\s*0/);
  assert.match(ruleBody(".attachment-card__file-icon"), /border-radius\s*:\s*10px/);
  assert.doesNotMatch(css, /\.attachment-card__file-icon::after/);
  assert.match(attachmentsComponent, /<AttachmentCard/);
  assert.match(attachmentCard, /data-file-kind=\{visual\.kind\}/);
  assert.match(attachmentCard, /<Lightbox images=\{viewerImages\}/);

  assert.match(composer, /ref=\{composerRootRef\}/);
  assert.match(reserve, /new ResizeObserver\(update\)/);
  assert.match(reserve, /--chat-composer-reserve/);
  assert.match(reserve, /composer\.getBoundingClientRect\(\)\.height \+ MESSAGE_GAP/);
  assert.match(reserve, /scroll\.scrollTop = scroll\.scrollHeight/);

  const threadComposer = ruleBody(".thread-composer");
  assert.match(threadComposer, /padding\s*:\s*14px 18px 18px/);
});
