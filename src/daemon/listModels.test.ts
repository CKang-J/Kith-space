import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { listModels, parseOpencodeModels } from "./listModels.js";

test("OpenCode model parsing de-duplicates provider/model ids", () => {
  assert.deepEqual(parseOpencodeModels("openai/gpt-5\nopenai/gpt-5\ndeepseek/chat\n"), [
    { id: "openai/gpt-5", label: "openai/gpt-5", provider: "openai" },
    { id: "deepseek/chat", label: "deepseek/chat", provider: "deepseek" },
  ]);
});

test("OpenCode model discovery launches Windows npm cmd shims", { skip: process.platform !== "win32" }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kith-space-opencode-models-"));
  const previousPath = process.env.PATH;

  try {
    writeFileSync(
      path.join(root, "opencode.cmd"),
      "@echo off\r\necho opencode/free-model\r\necho custom/coding-model\r\nexit /b 0\r\n",
    );
    process.env.PATH = root;

    assert.deepEqual(await listModels("opencode"), [
      { id: "opencode/free-model", label: "opencode/free-model", provider: "opencode" },
      { id: "custom/coding-model", label: "custom/coding-model", provider: "custom" },
    ]);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});
