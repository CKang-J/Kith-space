import assert from "node:assert/strict";
import test from "node:test";
import { clearAllProjectDrafts, getProjectDraft, putProjectDraft } from "./recombynProjectMemory.ts";

test("draft hydration is idempotent under Strict Mode and isolated across resource switches", async () => {
  await clearAllProjectDrafts();
  const first = { width: 100 };
  const current = { width: 200 };
  await putProjectDraft({ projectId: "canvas-a", name: "A", document: first, cloudRevision: null, baseDocument: null });
  await putProjectDraft({ projectId: "canvas-a", name: "A", document: first, cloudRevision: null, baseDocument: null });
  await putProjectDraft({ projectId: "canvas-b", name: "B", document: current, cloudRevision: null, baseDocument: null });
  assert.deepEqual((await getProjectDraft("canvas-a"))?.document, first);
  assert.deepEqual((await getProjectDraft("canvas-b"))?.document, current);
});
