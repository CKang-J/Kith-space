import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const files = [
  "web/src/views/Chat.tsx",
  "web/src/views/model-settings/RuntimeSettings.tsx",
  "web/src/views/agent-memory/FilesMemoryView.tsx",
];

test("renderer features use the shared clipboard fallback boundary", () => {
  for (const file of files) {
    const source = readFileSync(path.resolve(file), "utf8");
    assert.doesNotMatch(source, /navigator\.clipboard/);
    assert.match(source, /copyText/);
  }
});

test("chat and memory file copy actions surface clipboard failures", () => {
  for (const file of [files[0], files[2]]) {
    const source = readFileSync(path.resolve(file), "utf8");
    assert.match(source, /clipboard\.copyFailed/);
  }
});
