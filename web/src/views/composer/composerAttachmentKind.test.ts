import test from "node:test";
import assert from "node:assert/strict";
import { composerAttachmentVisual } from "./composerAttachmentKind.ts";

test("composer attachment visuals distinguish common working file types", () => {
  assert.deepEqual(composerAttachmentVisual("README.md"), { kind: "markdown", label: "MD" });
  assert.deepEqual(composerAttachmentVisual("proposal.pdf"), { kind: "pdf", label: "PDF" });
  assert.deepEqual(composerAttachmentVisual("budget.xlsx"), { kind: "sheet", label: "XLS" });
  assert.deepEqual(composerAttachmentVisual("deck.pptx"), { kind: "slides", label: "PPT" });
  assert.deepEqual(composerAttachmentVisual("source.ts"), { kind: "code", label: "</>" });
  assert.deepEqual(composerAttachmentVisual("config.json"), { kind: "data", label: "JSON" });
});
