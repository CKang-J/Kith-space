import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const chatSrc = fs.readFileSync(new URL("../web/src/views/Chat.tsx", import.meta.url), "utf8");
const attachmentCardSrc = fs.readFileSync(new URL("../web/src/components/AttachmentCard.tsx", import.meta.url), "utf8");
const lightboxSrc = fs.readFileSync(new URL("../web/src/Lightbox.tsx", import.meta.url), "utf8");
const aggregateSrc = fs.readFileSync(new URL("../web/src/views/conversation-aggregate/ConversationFiles.tsx", import.meta.url), "utf8");
const aggregateCss = fs.readFileSync(new URL("../web/src/views/conversation-aggregate/conversationAggregate.css", import.meta.url), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1]!;
}

function assertDecl(body: string, prop: string, value: string): void {
  assert.match(body, new RegExp(`${prop}\\s*:\\s*${value}(?:;|$)`), `expected ${prop}:${value} in:\n${body}`);
}

test("message attachments reuse the responsive Composer card without overflowing the bubble", () => {
  const list = ruleBody(".attachment-list");
  assertDecl(list, "display", "flex");
  assertDecl(list, "max-width", "100%");
  assertDecl(list, "min-width", "0");
  assertDecl(list, "flex-wrap", "wrap");

  const card = ruleBody(".attachment-card");
  assertDecl(card, "max-width", "100%");
  assertDecl(card, "min-width", "0");
  assert.match(ruleBody(".attachment-card.is-file"), /flex\s*:\s*1 1 200px/);
  assert.match(ruleBody(".attachment-card.is-image"), /flex\s*:\s*0 0 56px/);
  assert.equal((chatSrc.match(/isSingleImageMessage\(m\.attachments\)/g) ?? []).length, 2);
  assert.match(chatSrc, /return <AttachmentCard filename=\{a\.filename\}/);
  assert.match(attachmentCardSrc, /className="attachment-card__preview"/);
  assert.match(aggregateSrc, /<AttachmentTypeIcon filename=\{file\.filename\} mimeType=\{file\.mimeType\}/);
  assert.match(aggregateCss, /\.conversation-file:hover,[\s\S]*?background:\s*var\(--muted\)/);
});

test("lightbox exposes visible and keyboard zoom controls with a focus loop", () => {
  assert.match(lightboxSrc, /className="lightbox-panel"/);
  assert.match(lightboxSrc, /role="dialog"/);
  assert.match(lightboxSrc, /aria-modal="true"/);
  assert.match(lightboxSrc, /closeRef\.current\?\.focus/);
  assert.match(lightboxSrc, /prevFocus\.current\?\.focus/);
  assert.match(lightboxSrc, /e\.key === "Tab"/);
  assert.match(lightboxSrc, /e\.key === "\+"/);
  assert.match(lightboxSrc, /e\.key === "-"/);
  assert.match(lightboxSrc, /e\.key === "0"/);
  assert.match(lightboxSrc, /className="lightbox-toolbar"/);
  assert.match(lightboxSrc, /className="lightbox-control lightbox-scale"/);
  assert.match(lightboxSrc, /Math\.min\(8, Math\.max\(\.25,/);
  assert.match(lightboxSrc, /e\.key === "ArrowLeft"/);
  assert.match(lightboxSrc, /e\.key === "ArrowRight"/);
  assert.match(lightboxSrc, /className="lightbox-control lightbox-nav lightbox-prev"/);
  assert.match(lightboxSrc, /className="lightbox-control lightbox-nav lightbox-next"/);
});

test("lightbox is portaled to body and backdrop or empty-stage clicks close it", () => {
  assert.match(lightboxSrc, /import\s*\{\s*createPortal\s*\}\s*from\s*"react-dom"/);
  assert.match(lightboxSrc, /createPortal\(\s*[\s\S]*?className="lightbox-bg"[\s\S]*?,\s*document\.body\s*,?\s*\)/);
  assert.match(lightboxSrc, /className="lightbox-panel" onClick=\{\(\) => onCloseRef\.current\(\)\}/);
  assert.match(lightboxSrc, /onClick=\{\(e\) => \{ e\.stopPropagation\(\)/);
});

test("both Composer and message images reach the shared Lightbox through AttachmentCard", () => {
  assert.match(chatSrc, /import\s*\{\s*AttachmentCard\s*\}\s*from\s*"\.\.\/components\/AttachmentCard/);
  assert.match(attachmentCardSrc, /import\s*\{\s*Lightbox,\s*type LightboxImage\s*\}\s*from\s*"\.\.\/Lightbox/);
  assert.match(attachmentCardSrc, /previewOpen && viewerImages\.length \? <Lightbox/);
  assert.match(attachmentCardSrc, /initialImageId=\{imageId/);
  assert.doesNotMatch(chatSrc, /function Lightbox\(/);
});

test("a message containing only one image uses the large intrinsic preview", () => {
  assert.match(chatSrc, /isSingleImageMessage\(m\.attachments\)/);
  assert.match(chatSrc, /attachment-list--single-image/);
  const card = ruleBody(".attachment-list--single-image .attachment-card.is-image");
  assertDecl(card, "width", "fit-content");
  assertDecl(card, "height", "auto");
  assertDecl(card, "max-width", "min\\(100%,320px\\)");
  const image = ruleBody(".attachment-list--single-image .attachment-card__preview img");
  assertDecl(image, "width", "auto");
  assertDecl(image, "max-height", "320px");
});

test("lightbox fits at 100% but lets zoomed media pan across the full viewport", () => {
  const panel = ruleBody(".lightbox-panel");
  assertDecl(panel, "width", "100vw");
  assertDecl(panel, "height", "100dvh");
  assertDecl(panel, "max-height", "none");
  assertDecl(panel, "background", "transparent");
  assertDecl(panel, "border", "0");
  assertDecl(panel, "overflow", "visible");
  const image = ruleBody(".lightbox-img");
  assertDecl(image, "max-width", "calc\\(100vw - 128px\\)");
  assertDecl(image, "max-height", "calc\\(100dvh - 96px\\)");
  assertDecl(image, "object-fit", "contain");
});
