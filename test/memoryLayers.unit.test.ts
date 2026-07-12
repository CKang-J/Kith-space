import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureSharedMemoryLayers, resolveMemoryLayerPaths } from "../src/daemon/memoryLayers.ts";

test("three memory layers resolve to app data, Space root, and Space-local Agent Memory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kith-space-memory-layers-"));
  const previousHome = process.env.KITH_SPACE_HOME;
  process.env.KITH_SPACE_HOME = path.join(root, "home");
  const workspaceRoot = path.join(root, "workspace");
  const agentMemoryDir = path.join(workspaceRoot, ".kith", "agents", "agent-1");

  try {
    const paths = resolveMemoryLayerPaths(workspaceRoot, agentMemoryDir);
    assert.equal(paths.user.indexFile, path.join(root, "home", "memory", "MEMORY.md"));
    assert.equal(paths.space.indexFile, path.join(workspaceRoot, ".kith", "memory", "MEMORY.md"));
    assert.equal(paths.agent.indexFile, path.join(agentMemoryDir, "MEMORY.md"));

    await ensureSharedMemoryLayers(paths);
    assert.match(await readFile(paths.user.indexFile, "utf8"), /^# User Memory/);
    assert.match(await readFile(paths.space.indexFile, "utf8"), /^# Space Memory/);

    const userTopic = path.join(paths.user.notesDir, "preferences.md");
    const spaceTopic = path.join(paths.space.notesDir, "project-context.md");
    await writeFile(userTopic, "user preference");
    await writeFile(spaceTopic, "space context");
    assert.equal(await readFile(userTopic, "utf8"), "user preference");
    assert.equal(await readFile(spaceTopic, "utf8"), "space context");

    await writeFile(paths.space.indexFile, "# Curated space memory\n");
    await ensureSharedMemoryLayers(paths);
    assert.equal(await readFile(paths.space.indexFile, "utf8"), "# Curated space memory\n", "startup never overwrites curated memory");
  } finally {
    if (previousHome === undefined) delete process.env.KITH_SPACE_HOME;
    else process.env.KITH_SPACE_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
});
