// listWorkspace returns the registered Space root shared by its agents.
// Run: npx tsx --test --test-force-exit test/workspaceRoot.unit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const HOME = mkdtempSync(path.join(tmpdir(), "ot-ws-root-"));

const { listWorkspace, readWorkspaceFile } = await import("../src/daemon/workspace.ts");

test("listWorkspace returns the absolute workspace root + the file tree", async () => {
  const workspaceRoot = path.join(HOME, "space");
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(path.join(workspaceRoot, "README.md"), "# test");

  const r = await listWorkspace(workspaceRoot);

  assert.equal(r.root, workspaceRoot);
  assert.ok(r.files!.some((f) => f.name === "README.md"), "file tree includes Space files");
  assert.deepEqual(await readWorkspaceFile(workspaceRoot, "README.md"), { path: "README.md", content: "# test" });
  assert.deepEqual(await readWorkspaceFile(workspaceRoot, "../outside.txt"), { error: "invalid path" });
});

test("listWorkspace returns root even when the Space root is missing", async () => {
  const workspaceRoot = path.join(HOME, "missing-space");
  const r = await listWorkspace(workspaceRoot);

  assert.equal(r.root, workspaceRoot);
  assert.ok(!r.error, "missing root returns an empty tree");
});
