import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveAgentMemoryDir } from "../src/agents/agentWorkspacePaths.ts";

function responseCapture() {
  const response: { status: number; body: any } = { status: 0, body: undefined };
  return {
    response,
    res: {
      writeHead(status: number) { response.status = status; },
      end(body?: string) { response.body = body ? JSON.parse(body) : undefined; },
    },
  };
}

test("Agent Memory browser resolves the selected agent directory inside its Space", () => {
  const workspaceRoot = path.resolve("C:/Users/example/Kith-space/test01");

  assert.equal(
    resolveAgentMemoryDir(workspaceRoot, "6c10bd3c-5867-4387-899f-3a2454238f0b"),
    path.join(workspaceRoot, ".kith", "agents", "6c10bd3c-5867-4387-899f-3a2454238f0b"),
  );
});

test("Agent Memory browser rejects agent ids that can escape the owned directory", () => {
  const workspaceRoot = path.resolve("C:/Users/example/Kith-space/test01");

  for (const agentId of ["..", "../escape", "..\\escape", "C:\\absolute", "child/agent"]) {
    assert.throws(() => resolveAgentMemoryDir(workspaceRoot, agentId), /safe path segment/);
  }
});

test("workspace-files HTTP handler lists and reads only the selected Agent Memory", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kith-agent-memory-browser-"));
  const previousHome = process.env.KITH_SPACE_HOME;
  const previousSpacesDir = process.env.KITH_SPACE_SPACES_DIR;
  process.env.KITH_SPACE_HOME = path.join(root, "app-data");
  process.env.KITH_SPACE_SPACES_DIR = path.join(root, "spaces");
  let closeDatabases: (() => void) | undefined;
  let unregister: (() => void) | undefined;
  try {
    const { ensurePersonalApp } = await import("../src/db/personalApp.ts");
    const { closeAllDatabases, dbForSpace, schema } = await import("../src/db/index.ts");
    closeDatabases = closeAllDatabases;
    const homeRoot = path.join(root, "Home");
    const { human, home } = await ensurePersonalApp({ name: "Ada", homeRootPath: homeRoot });
    const agentId = "agent-memory-test";
    await dbForSpace(home.id).insert(schema.agents).values({ id: agentId, spaceId: home.id, name: "memory-test", displayName: "Memory Test" });

    const normalizedHomeRoot = fs.realpathSync.native(homeRoot);
    const memoryDir = resolveAgentMemoryDir(normalizedHomeRoot, agentId);
    fs.mkdirSync(path.join(memoryDir, "notes"), { recursive: true });
    fs.writeFileSync(path.join(memoryDir, "MEMORY.md"), "# Agent Memory\n");
    fs.writeFileSync(path.join(normalizedHomeRoot, "README.md"), "# Shared Space file\n");

    const { listWorkspace, readWorkspaceFile } = await import("../src/daemon/workspace.ts");
    const { registerWorker, resolveWorkerRequest, unregisterWorker } = await import("../src/local-runtime/workerHub.ts");
    const socket = {
      readyState: 1,
      send(payload: string) {
        const message = JSON.parse(payload);
        const result = message.type === "agent:workspace:list"
          ? listWorkspace(message.workspaceRoot)
          : readWorkspaceFile(message.workspaceRoot, message.path);
        void result.then((data) => resolveWorkerRequest(message.requestId, data));
      },
      close() {},
    } as any;
    const lease = registerWorker(socket);
    unregister = () => { unregisterWorker(lease); };

    const { handleAgents } = await import("../src/server/routes-api/agents.ts");
    const listCapture = responseCapture();
    await handleAgents({
      req: {} as any,
      res: listCapture.res as any,
      url: new URL(`http://localhost/api/agents/${agentId}/workspace-files`),
      method: "GET",
      p: `/api/agents/${agentId}/workspace-files`,
      humanId: human.id,
      spaceId: home.id,
    });
    assert.equal(listCapture.response.status, 200);
    assert.equal(listCapture.response.body.root, memoryDir);
    assert.deepEqual(listCapture.response.body.files.map((file: any) => file.name).sort(), ["MEMORY.md", "notes"]);

    const readCapture = responseCapture();
    await handleAgents({
      req: {} as any,
      res: readCapture.res as any,
      url: new URL(`http://localhost/api/agents/${agentId}/workspace-files/read?path=MEMORY.md`),
      method: "GET",
      p: `/api/agents/${agentId}/workspace-files/read`,
      humanId: human.id,
      spaceId: home.id,
    });
    assert.equal(readCapture.response.status, 200);
    assert.deepEqual(readCapture.response.body, { path: "MEMORY.md", content: "# Agent Memory\n" });
  } finally {
    unregister?.();
    closeDatabases?.();
    if (previousHome === undefined) delete process.env.KITH_SPACE_HOME;
    else process.env.KITH_SPACE_HOME = previousHome;
    if (previousSpacesDir === undefined) delete process.env.KITH_SPACE_SPACES_DIR;
    else process.env.KITH_SPACE_SPACES_DIR = previousSpacesDir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Agent Memory labels remain canonical in both supported locales", () => {
  const zh = JSON.parse(fs.readFileSync(new URL("../web/src/locales/zh.json", import.meta.url), "utf8"));
  const en = JSON.parse(fs.readFileSync(new URL("../web/src/locales/en.json", import.meta.url), "utf8"));

  assert.equal(zh.members.tabMemory, "记忆");
  assert.equal(zh.common.memory, "记忆");
  assert.equal(zh.members.memoryEmpty, "暂无 Agent 记忆");
  assert.equal(en.members.tabMemory, "Memory");
  assert.equal(en.common.memory, "Memory");
  assert.equal(en.members.memoryEmpty, "No Agent Memory yet");
});
