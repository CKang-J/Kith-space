import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const readSource = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

test("advisor polling is serial, three-second, and refreshes structured views", () => {
  const source = readSource("./AgentMemoryPanel.tsx");
  assert.match(source, /window\.setTimeout\(async \(\) =>/);
  assert.match(source, /3_000/);
  assert.match(source, /result !== "settled" && consecutiveFailures < 5/);
  assert.match(source, /setStructuredRefresh/);
  assert.match(source, /refreshToken=\{structuredRefresh\}/);
});

test("non-proposal memory details expose revision mutations and guarded message links", () => {
  const detail = readSource("./MemoryDetailPane.tsx");
  const editor = readSource("./MemoryRevisionEditor.tsx");
  const structured = readSource("./StructuredMemoryView.tsx");
  assert.match(detail, /!showProposalActions \? <MemoryRevisionEditor/);
  assert.match(detail, /memoryEvidencePath/);
  assert.match(detail, /advisorJob\.validation/);
  assert.match(editor, /MemoryRevisionMutationAction \| null/);
  assert.match(editor, /replacementMemoryId/);
  assert.match(editor, /relationType/);
  assert.match(structured, /schemaVersion: 1/);
  assert.match(structured, /expectedRevision: detail\.memory\.currentRevision/);
  assert.match(structured, /idempotencyKey: uniqueKey\(`memory-\$\{name\}`\)/);
  assert.match(detail, /memory\.sourceAccess !== "available"/);
  assert.match(detail, /onAction\("retain_independent"\)/);
  assert.match(structured, /name === "retain_independent"/);
});

test("suppression rows expose their private or shared scope", () => {
  const source = readSource("./AdvisorStatusCard.tsx");
  assert.match(source, /members\.memoryPanel\.scope\.\$\{item\.scope\}/);
});
