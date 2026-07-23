import { spawnRuntimeProcess } from "../../../daemon/runtimeProcess.js";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildMaintenanceProcessEnv, buildRestrictedProviderEnv } from "../../../daemon/agentProcessEnv.js";
import {
  MEMORY_ADVISOR_JSON_SCHEMA,
  MemoryAdvisorCompletionSchema,
  type MaintenanceJsonResult,
} from "../../contract/maintenanceRuntimePort.js";
import { NormalizedUsageSchema } from "../../contract/v2/runtimeContract.js";
import { resolveExecutable } from "../../../advisor-provider/providerArtifact.js";
import { sha256File } from "../../../advisor-provider/providerArtifact.js";
import { terminateProviderProcessTree } from "./providerProcessTree.js";
import type { ActivatedAdvisorCredential } from "../../contract/advisorProviderRuntimePort.js";
import { startPinnedOriginProxy } from "./pinnedOriginProxy.js";

const MAX_OUTPUT_BYTES = 256 * 1024;

export function buildClaudeMaintenanceArgs(model?: string | null): string[] {
  const args = [
    "-p",
    "--output-format", "json",
    "--json-schema", JSON.stringify(MEMORY_ADVISOR_JSON_SCHEMA),
    "--tools", "",
    "--mcp-config", JSON.stringify({ mcpServers: {} }),
    "--strict-mcp-config",
    "--permission-mode", "dontAsk",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--safe-mode",
  ];
  if (model) args.push("--model", model);
  return args;
}

function normalizedUsage(value: Record<string, unknown>) {
  const raw = value.usage && typeof value.usage === "object" ? value.usage as Record<string, unknown> : {};
  const candidate = {
    ...(Number.isFinite(raw.input_tokens) ? { inputTokens: Number(raw.input_tokens) } : {}),
    ...(Number.isFinite(raw.output_tokens) ? { outputTokens: Number(raw.output_tokens) } : {}),
    ...(Number.isFinite(raw.cache_read_input_tokens) ? { cacheReadTokens: Number(raw.cache_read_input_tokens) } : {}),
    ...(Number.isFinite(raw.cache_creation_input_tokens) ? { cacheWriteTokens: Number(raw.cache_creation_input_tokens) } : {}),
    ...(Number.isFinite(value.total_cost_usd) ? { costUsd: Number(value.total_cost_usd) } : {}),
    ...(Number.isFinite(value.duration_ms) ? { durationMs: Number(value.duration_ms) } : {}),
    source: "final" as const,
  };
  return NormalizedUsageSchema.safeParse(candidate).success ? candidate : undefined;
}

function parseCompletion(stdout: string): MaintenanceJsonResult {
  const envelope = JSON.parse(stdout) as Record<string, unknown>;
  if (envelope.is_error === true || (typeof envelope.subtype === "string" && envelope.subtype !== "success")) {
    throw new Error("maintenance provider returned an error");
  }
  const structured = envelope.structured_output ?? (typeof envelope.result === "string" ? JSON.parse(envelope.result) : envelope.result);
  return {
    output: MemoryAdvisorCompletionSchema.parse(structured),
    usage: normalizedUsage(envelope),
  };
}

/** Claude-only maintenance profile with built-in tools and all MCP servers physically disabled. */
export async function completeClaudeMaintenanceJson(input: {
  prompt: string;
  model?: string | null;
  credential?: ActivatedAdvisorCredential;
  signal?: AbortSignal;
  canonicalOrigin?: string;
  pinnedAddresses?: string[];
  executablePath?: string;
  executableDigest?: string;
}, timeoutMs = 75_000): Promise<MaintenanceJsonResult> {
  const proxy = input.credential === undefined ? null : await startPinnedOriginProxy(input.canonicalOrigin!, input.pinnedAddresses!);
  return new Promise((resolve, reject) => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kith-maintenance-"));
    const executable = input.credential === undefined ? "claude" : input.executablePath ?? resolveExecutable("claude");
    if (input.credential !== undefined && executable && input.executableDigest && sha256File(executable) !== input.executableDigest) {
      rmSync(cwd, { recursive: true, force: true });
      void proxy?.close().finally(() => reject(new Error("provider_revision_changed")));
      return;
    }
    if (!executable) {
      rmSync(cwd, { recursive: true, force: true });
      void proxy?.close().finally(() => reject(new Error("provider_unavailable")));
      return;
    }
    const child = spawnRuntimeProcess(executable, buildClaudeMaintenanceArgs(input.model), {
      cwd,
      env: input.credential === undefined ? buildMaintenanceProcessEnv() : buildRestrictedProviderEnv(cwd, input.credential, proxy!.baseUrl),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: input.credential !== undefined && process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const terminate = () => input.credential !== undefined ? terminateProviderProcessTree(child) : Promise.resolve().then(() => { try { child.kill("SIGTERM"); } catch {} });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      void (async () => {
        await proxy?.close().catch(() => {});
        try { rmSync(cwd, { recursive: true, force: true }); } catch { /* best-effort ephemeral cleanup */ }
        if (error) reject(error);
        else {
          try { resolve(parseCompletion(stdout)); }
          catch { reject(new Error("maintenance provider returned invalid structured JSON")); }
        }
      })();
    };
    const timer = setTimeout(() => {
      void terminate().finally(() => finish(new Error("maintenance provider timeout")));
    }, timeoutMs);
    timer.unref?.();
    const onAbort = () => {
      void terminate().finally(() => finish(new Error("provider_cancelled")));
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
        void terminate().finally(() => finish(new Error("maintenance provider output limit exceeded")));
      }
    });
    child.stderr?.on("data", (chunk: string | Buffer) => { stderr = (stderr + chunk.toString()).slice(-512); });
    child.on("error", () => finish(new Error("maintenance runtime unavailable")));
    child.on("exit", (code) => finish(code === 0 ? undefined : new Error(stderr ? "maintenance provider failed" : "maintenance runtime exited")));
    child.stdin?.end(input.prompt);
  });
}
