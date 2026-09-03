import { createHash, randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { spawnRuntimeProcess } from "../../daemon/runtimeProcess.js";
import { terminateProviderProcessTree } from "../worker/maintenance/providerProcessTree.js";
import type {
  AdapterSnapshot, NormalizedUsage, OpenRuntimeSessionOptions, RuntimeEventEnvelope, RuntimeEventKind,
  RuntimeEventSink, RuntimeSessionV2, RuntimeTurnInput, RuntimeTurnResult, RuntimeV2,
} from "../contract/v2/runtimeContract.js";

export const PI_RPC_PROTOCOL_BASELINE = {
  schemaVersion: 1,
  minimumVersion: "0.81.1",
  required: ["strict_lf_jsonl", "correlated_response", "get_state", "session", "abort", "agent_settled", "usage", "compaction"],
  capabilities: {
    resumableSession: true, persistentProcess: true, mcp: "none" as const,
    hooks: { beforeTool: false, afterTool: false, beforeCompact: true, afterCompact: true, stopFinalize: true },
    usage: "final" as const, cancellation: "graceful" as const,
    context: { modelWindow: "reported" as const, tokenEstimator: "provider" as const },
    cwdRelocatableResume: false, toolIsolation: "none" as const,
  },
} as const;

type SpawnPi = (command: string, args: string[], options: {
  cwd: string; env: NodeJS.ProcessEnv; stdio: ["pipe", "pipe", "pipe"];
}) => ChildProcess;

export interface PiRpcSpawnOptions {
  cwd: string; env: NodeJS.ProcessEnv; stdio: ["pipe", "pipe", "pipe"];
}

/**
 * Everything that differs between the external `pi` CLI and the bundled
 * built-in helper. Both speak the identical JSONL RPC protocol, so the
 * session state machine and event mapping are fully shared.
 */
export interface PiRpcSpawnSpec {
  fingerprintRuntime: string;
  eventRuntime: string;
  spawn(args: string[], options: PiRpcSpawnOptions): ChildProcess;
}

type ActiveTurn = {
  input: RuntimeTurnInput;
  sink: RuntimeEventSink;
  ordinal: number;
  chain: Promise<void>;
  resolve: (result: RuntimeTurnResult) => void;
  finished: Promise<void>;
  resolveFinished: () => void;
  settled: boolean;
  cancelRequested: boolean;
  messageStreamedText: string;
  usage?: NormalizedUsage;
  terminalError?: string;
};

const COMMAND_TIMEOUT_MS = 10_000;
const MAX_JSONL_BUFFER = 1024 * 1024;
const MAX_TOOL_DETAIL_CHARS = 16_000;

function serializeToolDetail(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > MAX_TOOL_DETAIL_CHARS
    ? `${text.slice(0, MAX_TOOL_DETAIL_CHARS)}\n…`
    : text;
}

function validOpaqueSessionId(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 256
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function timeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
      timer.unref?.();
    }),
  ]);
}

function usageFromMessage(message: any): NormalizedUsage | undefined {
  const usage = message?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  const value: NormalizedUsage = { source: "final" };
  if (Number.isFinite(usage.input)) value.inputTokens = Math.max(0, Math.trunc(usage.input));
  if (Number.isFinite(usage.output)) value.outputTokens = Math.max(0, Math.trunc(usage.output));
  if (Number.isFinite(usage.cacheRead)) value.cacheReadTokens = Math.max(0, Math.trunc(usage.cacheRead));
  if (Number.isFinite(usage.cacheWrite)) value.cacheWriteTokens = Math.max(0, Math.trunc(usage.cacheWrite));
  if (Number.isFinite(usage.cost?.total)) value.costUsd = Math.max(0, usage.cost.total);
  if (typeof message.model === "string" && message.model) value.model = message.model;
  return Object.keys(value).length > 1 ? value : undefined;
}

function assistantText(message: any): string {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((block: any) => block?.type === "text" && typeof block.text === "string")
    .map((block: any) => block.text)
    .join("");
}

function configFingerprint(options: OpenRuntimeSessionOptions, fingerprintRuntime: string): string {
  const compiled = options.runtimeConfig?.compiledRuntimeConfiguration;
  const stableRuntimeConfig = compiled && typeof compiled === "object"
    && typeof (compiled as { fingerprint?: unknown }).fingerprint === "string"
    ? {
      compiledFingerprint: (compiled as { fingerprint: string }).fingerprint,
      reasoningEffort: options.runtimeConfig?.reasoningEffort ?? null,
    }
    : {
      fingerprint: options.runtimeConfig?.fingerprint ?? null,
      reasoningEffort: options.runtimeConfig?.reasoningEffort ?? null,
    };
  return createHash("sha256").update(JSON.stringify({
    runtime: fingerprintRuntime, model: options.model ?? null, runtimeConfig: stableRuntimeConfig,
    prompt: options.systemPrompt.digest, cwd: path.resolve(options.cwd),
  })).digest("hex");
}

class PiRpcSession implements RuntimeSessionV2 {
  private process: ChildProcess | null = null;
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private stdoutBuffer = "";
  private active: ActiveTurn | null = null;
  private engineSessionId: string | null = null;
  private readonly pending = new Map<string, {
    command: string; resolve: (response: any) => void; reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private closed = false;
  private startup: Promise<void>;
  private readonly generationRoot: string;
  private readonly fingerprint: string;

  constructor(
    private readonly options: OpenRuntimeSessionOptions,
    private readonly spec: PiRpcSpawnSpec,
    private readonly now: () => number,
  ) {
    this.generationRoot = path.join(
      options.runtimeStateDir, "pi-rpc", options.runtimeSessionId, `g${options.sessionGeneration}`,
    );
    this.fingerprint = configFingerprint(options, spec.fingerprintRuntime);
    const restored = options.restoredSnapshot?.adapterSnapshot;
    if (restored?.schemaVersion === 1
      && restored.payload.runtime === spec.fingerprintRuntime
      && restored.payload.configFingerprint === this.fingerprint
      && validOpaqueSessionId(restored.payload.engineSessionId)
      && restored.payload.resumable === true) {
      this.engineSessionId = restored.payload.engineSessionId;
    }
    this.startup = this.start();
  }

  async runTurn(input: RuntimeTurnInput, sink: RuntimeEventSink): Promise<RuntimeTurnResult> {
    await this.startup;
    if (this.closed || this.active) throw new Error(this.closed ? "runtime session is closed" : "runtime session already has an active turn");
    let resolve!: (result: RuntimeTurnResult) => void;
    let resolveFinished!: () => void;
    const result = new Promise<RuntimeTurnResult>((done) => { resolve = done; });
    const finished = new Promise<void>((done) => { resolveFinished = done; });
    this.active = {
      input, sink, ordinal: 0, chain: Promise.resolve(), resolve, finished, resolveFinished,
      settled: false, cancelRequested: false, messageStreamedText: "",
    };
    this.emit("turn_started", { runtime: this.spec.eventRuntime, protocol: "rpc", mcpMode: "none", gateway: "cli" });
    try {
      const response = await this.command(
        "prompt",
        { message: input.context },
        Math.max(1_000, Math.min(COMMAND_TIMEOUT_MS, input.deadlineAt - this.now())),
      );
      if (!response.success) await this.finish("failed", "pi_prompt_rejected");
    } catch {
      await this.finish("failed", "pi_rpc_command_failed");
    }
    return result;
  }

  async cancel(attemptId: string): Promise<void> {
    try {
      await timeout(this.startup, COMMAND_TIMEOUT_MS, "Pi startup");
    } catch {
      const process = this.process;
      this.process = null;
      this.closed = true;
      if (process) await terminateProviderProcessTree(process);
      if (this.active) await this.finish("cancelled", "pi_startup_abort");
      return;
    }
    const turn = this.active;
    if (!turn || turn.input.attemptId !== attemptId) return;
    if (turn.settled) {
      await turn.finished;
      return;
    }
    turn.cancelRequested = true;
    try {
      const response = await this.command("abort", {}, 5_000);
      if (!response.success) throw new Error("Pi rejected abort");
      await Promise.race([
        turn.finished,
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error("Pi abort timeout")), 5_000);
          timer.unref?.();
        }),
      ]);
    } catch {
      const process = this.process;
      this.process = null;
      this.closed = true;
      if (process) await terminateProviderProcessTree(process);
      await this.finish("cancelled", "pi_abort_forced");
    }
  }

  async snapshot(): Promise<AdapterSnapshot> {
    await this.startup;
    return {
      schemaVersion: 1,
      payload: {
        runtime: this.spec.fingerprintRuntime, adapterSchema: 1, engineSessionId: this.engineSessionId,
        resumable: !this.closed && Boolean(this.engineSessionId), configFingerprint: this.fingerprint,
      },
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const process = this.process;
    this.process = null;
    this.rejectPending(new Error("Pi RPC session closed"));
    if (process) await terminateProviderProcessTree(process);
    if (this.active) await this.finish("cancelled", "pi_session_closed");
  }

  private async start(): Promise<void> {
    await mkdir(this.generationRoot, { recursive: true, mode: 0o700 });
    const promptFile = path.join(this.generationRoot, "system-prompt.md");
    const promptHandle = await open(
      promptFile,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await promptHandle.writeFile(this.options.systemPrompt.text, { encoding: "utf8" });
      await promptHandle.sync();
    } finally {
      await promptHandle.close();
    }
    const compiledArgs = this.options.runtimeConfig?.compiledRuntimeConfiguration
      && typeof this.options.runtimeConfig.compiledRuntimeConfiguration === "object"
      && Array.isArray((this.options.runtimeConfig.compiledRuntimeConfiguration as any).args)
      ? (this.options.runtimeConfig.compiledRuntimeConfiguration as any).args.filter((value: unknown) => typeof value === "string")
      : null;
    const args = compiledArgs?.length ? [...compiledArgs] : [
      "--mode", "rpc", "--no-approve", "--no-context-files", "--no-extensions",
      "--no-skills", "--no-prompt-templates", "--no-themes",
      ...(this.options.model ? ["--model", this.options.model] : []),
    ];
    args.push("--session-dir", path.join(this.generationRoot, "sessions"), "--append-system-prompt", promptFile);
    if (this.engineSessionId) args.push("--session-id", this.engineSessionId);
    const env: NodeJS.ProcessEnv = {
      ...this.options.env,
      PI_CODING_AGENT_SESSION_DIR: path.join(this.generationRoot, "sessions"),
      PI_OFFLINE: "1",
      PI_TELEMETRY: "0",
    };
    if (!this.options.env.PI_CODING_AGENT_DIR) delete env.PI_CODING_AGENT_DIR;
    delete env.NODE_OPTIONS;
    const child = this.spec.spawn(args, { cwd: this.options.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    this.process = child;
    child.stdout?.on("data", (chunk: Buffer) => this.onStdout(chunk));
    child.stderr?.on("data", () => { /* Drain diagnostics so the child cannot block on a full pipe. */ });
    child.on("error", (error) => this.onProcessFailure(error));
    child.on("exit", (code) => this.onProcessFailure(new Error(`Pi RPC exited ${code ?? "signal"}`)));
    const state = await this.command("get_state", {}, COMMAND_TIMEOUT_MS);
    if (!state.success || !validOpaqueSessionId(state.data?.sessionId)) throw new Error("Pi RPC get_state capability unavailable");
    this.engineSessionId = state.data.sessionId;
  }

  private command(type: string, fields: Record<string, unknown> = {}, timeoutMs = COMMAND_TIMEOUT_MS): Promise<any> {
    const process = this.process;
    if (!process?.stdin?.writable) return Promise.reject(new Error("Pi RPC stdin unavailable"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi RPC ${type} timeout`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { command: type, resolve, reject, timer });
      process.stdin!.write(`${JSON.stringify({ id, type, ...fields })}\n`, "utf8", (error) => {
        if (error) {
          const pending = this.pending.get(id);
          if (pending) clearTimeout(pending.timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  private onStdout(chunk: Buffer): void {
    let text: string;
    try { text = this.decoder.decode(chunk, { stream: true }); }
    catch { return this.onProcessFailure(new Error("Pi RPC emitted invalid UTF-8")); }
    this.stdoutBuffer += text;
    if (this.stdoutBuffer.length > MAX_JSONL_BUFFER) {
      return this.onProcessFailure(new Error("Pi RPC JSONL frame exceeded the size limit"));
    }
    for (;;) {
      const lf = this.stdoutBuffer.indexOf("\n");
      if (lf < 0) break;
      let line = this.stdoutBuffer.slice(0, lf);
      this.stdoutBuffer = this.stdoutBuffer.slice(lf + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line) continue;
      let event: any;
      try { event = JSON.parse(line); }
      catch { return this.onProcessFailure(new Error("Pi RPC emitted invalid JSONL")); }
      this.onEvent(event);
    }
  }

  private onEvent(event: any): void {
    if (event?.type === "response" && typeof event.id === "string") {
      const pending = this.pending.get(event.id);
      if (!pending || event.command !== pending.command) return this.onProcessFailure(new Error("Pi RPC response correlation failed"));
      this.pending.delete(event.id);
      clearTimeout(pending.timer);
      pending.resolve(event);
      return;
    }
    if (!this.active) return;
    if (event?.type === "agent_start") this.emit("activity", { activity: "working", detail: "agent_start" });
    else if (event?.type === "message_update") {
      const updateType = event.assistantMessageEvent?.type;
      const delta = event.assistantMessageEvent?.delta;
      if (typeof delta === "string" && delta && (updateType === "thinking_delta" || updateType === "text_delta")) {
        if (updateType === "text_delta") this.active.messageStreamedText += delta;
        this.emit(updateType === "thinking_delta" ? "thinking_summary" : "text_preview", { text: delta });
      }
    } else if (event?.type === "message_end" && event.message?.role === "assistant") {
      const usage = usageFromMessage(event.message);
      if (usage) { this.active.usage = usage; this.emit("usage", usage); }
      const finalText = assistantText(event.message);
      if (finalText.startsWith(this.active.messageStreamedText)
        && finalText.length > this.active.messageStreamedText.length) {
        const missingSuffix = finalText.slice(this.active.messageStreamedText.length);
        this.emit("text_preview", { text: missingSuffix });
      }
      // Pi emits one message_end for each assistant message around tool execution. The
      // next message and any retry must start a new comparison window.
      this.active.messageStreamedText = "";
      if (event.message.stopReason === "error") this.active.terminalError = "pi_model_error";
    } else if (event?.type === "tool_execution_start") {
      this.emit("tool_started", {
        toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : "",
        toolName: event.toolName ?? event.toolCall?.name ?? "tool",
        toolInput: serializeToolDetail(event.args ?? event.toolCall?.arguments),
      });
    } else if (event?.type === "tool_execution_end") {
      this.emit(event.isError ? "tool_failed" : "tool_completed", {
        toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : "",
        toolName: event.toolName ?? "tool",
        toolOutput: serializeToolDetail(event.result),
      });
    } else if (event?.type === "compaction_start") this.emit("compaction_started", {});
    else if (event?.type === "compaction_end") this.emit("compaction_completed", {});
    else if (event?.type === "auto_retry_start") {
      this.active.terminalError = undefined;
      this.active.messageStreamedText = "";
      this.emit("activity", { activity: "working", detail: "retry" });
    } else if (event?.type === "agent_settled") {
      void this.finish(
        this.active.cancelRequested ? "cancelled" : this.active.terminalError ? "failed" : "completed",
        this.active.cancelRequested ? undefined : this.active.terminalError,
      );
    }
  }

  private emit(kind: RuntimeEventKind, payload: Record<string, unknown>): void {
    const turn = this.active;
    if (!turn || turn.settled) return;
    const event: RuntimeEventEnvelope = {
      schemaVersion: 2, workerGeneration: this.options.workerGeneration,
      sessionId: this.options.runtimeSessionId, sessionGeneration: this.options.sessionGeneration,
      turnId: turn.input.turnId, attemptId: turn.input.attemptId, eventId: randomUUID(),
      ordinal: turn.ordinal++, kind, payload, createdAt: this.now(),
    };
    turn.chain = turn.chain.then(() => turn.sink.emit(event));
  }

  private async finish(outcome: RuntimeTurnResult["outcome"], errorCode?: string): Promise<void> {
    const turn = this.active;
    if (!turn || turn.settled) return;
    turn.settled = true;
    const kind: RuntimeEventKind = outcome === "completed" ? "turn_completed" : "turn_failed";
    const event: RuntimeEventEnvelope = {
      schemaVersion: 2, workerGeneration: this.options.workerGeneration,
      sessionId: this.options.runtimeSessionId, sessionGeneration: this.options.sessionGeneration,
      turnId: turn.input.turnId, attemptId: turn.input.attemptId, eventId: randomUUID(),
      ordinal: turn.ordinal++, kind, payload: { outcome, ...(errorCode ? { errorCode } : {}) }, createdAt: this.now(),
    };
    turn.chain = turn.chain.then(() => turn.sink.emit(event));
    try {
      await turn.chain;
      turn.resolve({
        outcome, engineSessionId: this.engineSessionId, ...(turn.usage ? { usage: turn.usage } : {}),
        ...(errorCode ? { errorCode } : {}),
      });
    } catch {
      turn.resolve({ outcome: "failed", engineSessionId: this.engineSessionId, errorCode: "runtime_event_ack_failed" });
    } finally {
      if (this.active === turn) this.active = null;
      turn.resolveFinished();
    }
  }

  private onProcessFailure(error: Error): void {
    if (this.closed && !this.process) return;
    const process = this.process;
    this.process = null;
    this.closed = true;
    this.rejectPending(error);
    void (async () => {
      if (process && process.exitCode === null && process.signalCode === null) {
        await terminateProviderProcessTree(process);
      }
      if (this.active) await this.finish(this.active.cancelRequested ? "cancelled" : "failed", "pi_rpc_process_failed");
    })();
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function createPiRpcRuntimeV2WithSpawn(
  spec: PiRpcSpawnSpec,
  now: () => number = Date.now,
): RuntimeV2 {
  return {
    name: spec.eventRuntime,
    capabilities: PI_RPC_PROTOCOL_BASELINE.capabilities,
    async openSession(options) { return new PiRpcSession(options, spec, now); },
  };
}

export function createPiRpcRuntimeV2(
  spawnPi: SpawnPi = (command, args, options) => spawnRuntimeProcess(command, args, options, { rawBytes: true }),
  now: () => number = Date.now,
): RuntimeV2 {
  return createPiRpcRuntimeV2WithSpawn({
    fingerprintRuntime: "pi",
    eventRuntime: "pi",
    spawn: (args, options) => spawnPi("pi", args, options),
  }, now);
}

export const piRpcRuntimeV2 = createPiRpcRuntimeV2();
