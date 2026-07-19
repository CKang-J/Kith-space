import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import type { AgentConfig } from "../../../daemon/agentManager.js";
import { buildAgentProcessEnv } from "../../../daemon/agentProcessEnv.js";
import { ensureKithSpaceBin } from "../../../daemon/kithSpaceBin.js";
import { seedMemory } from "../../../daemon/memory.js";
import { ensureSharedMemoryLayers, resolveMemoryLayerPaths } from "../../../daemon/memoryLayers.js";
import { buildHarnessV2SystemPrompt } from "../../../daemon/prompt.js";
import { resolveAgentWorkspacePaths } from "../../../agents/agentWorkspacePaths.js";
import type { OpenRuntimeSessionOptions } from "../../contract/v2/runtimeContract.js";
import type { HostedRuntimeSessionRecord } from "./runtimeSessionHost.js";

export async function prepareRuntimeSession(input: {
  config: AgentConfig;
  record: HostedRuntimeSessionRecord;
  workerGeneration: number;
  broker: OpenRuntimeSessionOptions["broker"];
  runtimeStateRoot?: string;
  binDir?: string;
}): Promise<Omit<OpenRuntimeSessionOptions, "runtimeSessionId" | "sessionGeneration" | "broker">> {
  const paths = resolveAgentWorkspacePaths(input.config, input.runtimeStateRoot);
  const memory = resolveMemoryLayerPaths(paths.workspaceRoot, paths.agentMemoryDir);
  await Promise.all([
    mkdir(memory.agent.notesDir, { recursive: true }),
    mkdir(paths.runtimeStateDir, { recursive: true }),
  ]);
  await ensureSharedMemoryLayers(memory);
  try { await access(memory.agent.indexFile); }
  catch { await writeFile(memory.agent.indexFile, seedMemory(input.config.displayName || input.config.name, input.config.description)); }
  const systemText = buildHarnessV2SystemPrompt({
    name: input.config.name,
    displayName: input.config.displayName,
    description: input.config.description,
    agentId: input.config.agentId,
    spaceId: input.config.spaceId,
    hostname: os.hostname(),
    os: `${os.platform()} ${os.arch()}`,
    workspace: paths.workspaceRoot,
    memory,
  });
  const env = buildAgentProcessEnv({
    binDir: input.binDir ?? ensureKithSpaceBin(),
    serverUrl: input.config.serverUrl,
    agentId: input.config.agentId,
    agentToken: "",
  });
  return {
    workerGeneration: input.workerGeneration,
    address: {
      spaceId: input.record.spaceId,
      agentId: input.record.agentId,
      surfaceKind: input.record.surfaceKind,
      surfaceId: input.record.surfaceId,
    },
    cwd: paths.workspaceRoot,
    runtimeStateDir: paths.runtimeStateDir,
    model: input.config.model,
    runtimeConfig: input.config.runtimeConfig ?? undefined,
    engineSessionId: input.record.engineSessionId,
    systemPrompt: {
      text: systemText,
      version: "harness-v2.1",
      digest: createHash("sha256").update(systemText).digest("hex"),
    },
    mcpBootstrap: { mode: "none", serverName: "kith-core", descriptor: {} },
    env,
  };
}
