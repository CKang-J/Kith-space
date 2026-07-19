import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AgentConfig } from "../../../daemon/agentManager.js";
import { buildAgentProcessEnv } from "../../../daemon/agentProcessEnv.js";
import { ensureKithSpaceBin } from "../../../daemon/kithSpaceBin.js";
import { seedMemory } from "../../../daemon/memory.js";
import { ensureSharedMemoryLayers, resolveMemoryLayerPaths } from "../../../daemon/memoryLayers.js";
import { buildHarnessV2SystemPrompt } from "../../../daemon/prompt.js";
import { resolveAgentWorkspacePaths } from "../../../agents/agentWorkspacePaths.js";
import type { OpenRuntimeSessionOptions } from "../../contract/v2/runtimeContract.js";
import type { HostedRuntimeSessionRecord } from "./runtimeSessionHost.js";

export type GatewayCapabilityMode = "mcp_with_cli_fallback" | "mcp_only" | "cli_only";

export interface RuntimeGatewayLaunch {
  capabilityMode: GatewayCapabilityMode;
  cliAvailable: boolean;
  mcpBootstrap: OpenRuntimeSessionOptions["mcpBootstrap"];
}

const verifiedMcpLaunches = new Set<string>();

export async function verifyRuntimeGatewayLaunch(
  launch: RuntimeGatewayLaunch,
  probe: (bootstrap: OpenRuntimeSessionOptions["mcpBootstrap"]) => Promise<void> = probeMcpBootstrap,
): Promise<RuntimeGatewayLaunch> {
  if (launch.mcpBootstrap.mode !== "config") return launch;
  try {
    await probe(launch.mcpBootstrap);
    return launch;
  } catch (error) {
    if (launch.cliAvailable) {
      return {
        capabilityMode: "cli_only",
        cliAvailable: true,
        mcpBootstrap: {
          mode: "none",
          serverName: "kith-core",
          descriptor: { capabilityMode: "cli_only", bootstrapError: "mcp_bootstrap_failed" },
        },
      };
    }
    throw new Error(`mcp_bootstrap_failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function probeMcpBootstrap(bootstrap: OpenRuntimeSessionOptions["mcpBootstrap"]): Promise<void> {
  const descriptor = bootstrap.descriptor;
  const command = typeof descriptor.command === "string" ? descriptor.command : "";
  const args = Array.isArray(descriptor.args) && descriptor.args.every((value) => typeof value === "string") ? descriptor.args : [];
  if (!command || !args.length) throw new Error("invalid MCP launch descriptor");
  const key = JSON.stringify({ command, args, env: descriptor.env });
  if (verifiedMcpLaunches.has(key)) return;
  const transport = new StdioClientTransport({
    command,
    args,
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
      ...(descriptor.env && typeof descriptor.env === "object" ? descriptor.env as Record<string, string> : {}),
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "kith-worker-bootstrap-probe", version: "1" });
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      (async () => {
        await client.connect(transport);
        const tools = await client.listTools();
        if (!tools.tools.some((tool) => tool.name === "session.context_check")
          || !tools.tools.some((tool) => tool.name === "turn.reply")) {
          throw new Error("kith-core MCP required tools are missing");
        }
      })(),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("MCP bootstrap probe timed out")), 5_000); }),
    ]);
    verifiedMcpLaunches.add(key);
  } finally {
    if (timeout) clearTimeout(timeout);
    await client.close().catch(() => {});
  }
}

export function resolveRuntimeGatewayLaunch(input: {
  here: string;
  runtimeStateDir: string;
  sessionId: string;
  execPath?: string;
  platform?: NodeJS.Platform;
  electron?: boolean;
  exists?: (candidate: string) => boolean;
}): RuntimeGatewayLaunch {
  const exists = input.exists ?? existsSync;
  const platform = input.platform ?? process.platform;
  const execPath = input.execPath ?? process.execPath;
  const bundledMcp = path.join(input.here, "kith-core-mcp.mjs");
  const bundledCli = path.join(input.here, "agent-cli.mjs");
  const repoRoot = path.resolve(input.here, "../../../..");
  const tsx = path.join(repoRoot, "node_modules", ".bin", platform === "win32" ? "tsx.cmd" : "tsx");
  const sourceMcp = path.join(repoRoot, "src/server/mcp/stdio.ts");
  const sourceCli = path.join(repoRoot, "src/cli/index.ts");
  const bundled = exists(bundledMcp);
  const source = exists(tsx) && exists(sourceMcp);
  const cliAvailable = exists(bundledCli) || (exists(tsx) && exists(sourceCli));
  if (!bundled && !source && !cliAvailable) {
    throw new Error("capability_gateway_unavailable: neither kith-core MCP nor controlled CLI is executable");
  }
  const capabilityMode: GatewayCapabilityMode = (bundled || source)
    ? (cliAvailable ? "mcp_with_cli_fallback" : "mcp_only")
    : "cli_only";
  if (!bundled && !source) {
    return {
      capabilityMode,
      cliAvailable,
      mcpBootstrap: { mode: "none", serverName: "kith-core", descriptor: { capabilityMode } },
    };
  }
  const command = bundled ? execPath : tsx;
  const args = [bundled ? bundledMcp : sourceMcp];
  const env = input.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};
  const configFile = path.join(input.runtimeStateDir, `kith-core-mcp-${input.sessionId}.json`);
  return {
    capabilityMode,
    cliAvailable,
    mcpBootstrap: {
      mode: "config",
      serverName: "kith-core",
      descriptor: { command, args, env, configFile, capabilityMode },
    },
  };
}

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
  const here = path.dirname(fileURLToPath(import.meta.url));
  let gateway = resolveRuntimeGatewayLaunch({
    here,
    runtimeStateDir: paths.runtimeStateDir,
    sessionId: input.record.id,
    electron: !!process.versions.electron,
  });
  gateway = await verifyRuntimeGatewayLaunch(gateway);
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
    capabilityMode: gateway.capabilityMode,
  });
  const processBinDir = input.binDir ?? (gateway.cliAvailable ? ensureKithSpaceBin() : paths.runtimeStateDir);
  const env = buildAgentProcessEnv({
    binDir: processBinDir,
    serverUrl: input.config.serverUrl,
    agentId: input.config.agentId,
    agentToken: "",
  });
  if (gateway.mcpBootstrap.mode === "config") {
    const descriptor = gateway.mcpBootstrap.descriptor;
    await writeFile(String(descriptor.configFile), JSON.stringify({
      mcpServers: { "kith-core": { command: descriptor.command, args: descriptor.args, env: descriptor.env } },
    }), { encoding: "utf8", mode: 0o600 });
  }
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
    restoredSnapshot: input.record.restoredSnapshot ?? null,
    systemPrompt: {
      text: systemText,
      version: "harness-v2.1",
      digest: createHash("sha256").update(systemText).digest("hex"),
    },
    mcpBootstrap: gateway.mcpBootstrap,
    env,
  };
}
