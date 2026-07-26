import { randomUUID } from "node:crypto";
import type { Runtime, RuntimeCallbacks, RuntimeSession, TrajectoryEntry } from "../../daemon/runtime.js";
import type {
  AdapterSnapshot,
  NormalizedUsage,
  OpenRuntimeSessionOptions,
  RuntimeEventKind,
  RuntimeEventSink,
  RuntimeSessionV2,
  RuntimeTurnInput,
  RuntimeTurnResult,
  RuntimeV2,
} from "../contract/v2/runtimeContract.js";
import { RUNTIME_V1_CAPABILITY_BASELINE } from "../contract/v2/runtimeCapabilityBaseline.js";
import { claudeRuntime } from "../../daemon/claudeRuntime.js";
import { codexRuntime } from "../../daemon/codexRuntime.js";
import { opencodeRuntime } from "../../daemon/opencodeRuntime.js";
import { createLogger } from "../../log.js";
import { piRpcRuntimeV2 } from "./piRpcRuntimeV2.js";

interface ActiveTurn {
  input: RuntimeTurnInput;
  sink: RuntimeEventSink;
  ordinal: number;
  eventChain: Promise<void>;
  resolve: (result: RuntimeTurnResult) => void;
  settled: boolean;
  usage?: NormalizedUsage;
  deadlineTimer: ReturnType<typeof setTimeout>;
}

class BridgedRuntimeSession implements RuntimeSessionV2 {
  private runtimeSession: RuntimeSession | null = null;
  private active: ActiveTurn | null = null;
  private engineSessionId: string | null;
  private closed = false;
  private cannotResumeAfterCancel = false;

  constructor(
    private readonly runtime: Runtime,
    private readonly options: OpenRuntimeSessionOptions,
    private readonly now: () => number,
  ) {
    const restored = options.restoredSnapshot?.adapterSnapshot;
    const resumable = restored?.schemaVersion === 1
      && restored.payload.runtime === runtime.name
      && restored.payload.resumable !== false;
    this.engineSessionId = restored && !resumable ? null : options.engineSessionId ?? null;
  }

  async runTurn(input: RuntimeTurnInput, sink: RuntimeEventSink): Promise<RuntimeTurnResult> {
    if (this.closed || this.cannotResumeAfterCancel) throw new Error("runtime session is closed");
    if (this.active) throw new Error("runtime session already has an active turn");
    let resolve!: (result: RuntimeTurnResult) => void;
    const result = new Promise<RuntimeTurnResult>((done) => { resolve = done; });
    const delay = Math.max(1, input.deadlineAt - this.now());
    const turn: ActiveTurn = {
      input,
      sink,
      ordinal: 0,
      eventChain: Promise.resolve(),
      resolve,
      settled: false,
      deadlineTimer: setTimeout(() => {
        void (async () => {
          const stopError = await this.stopRuntime();
          this.cannotResumeAfterCancel = true;
          await this.finish("failed", "runtime_deadline_exceeded");
          if (stopError) {
            createLogger(`runtime:v2:${this.runtime.name}`).warn("runtime stop failed after deadline", {
              detail: stopError instanceof Error ? stopError.message : String(stopError),
            });
          }
        })();
      }, delay),
    };
    turn.deadlineTimer.unref?.();
    this.active = turn;
    this.emit("turn_started", {
      runtime: this.runtime.name,
      mcpMode: this.options.mcpBootstrap.mode,
      capabilityMode: this.options.mcpBootstrap.descriptor.capabilityMode ?? "unavailable",
    });
    try {
      await turn.eventChain;
    } catch {
      turn.settled = true;
      clearTimeout(turn.deadlineTimer);
      turn.resolve({ outcome: "failed", engineSessionId: this.engineSessionId, errorCode: "runtime_event_ack_failed" });
      if (this.active === turn) this.active = null;
      return result;
    }
    if (turn.settled || this.active !== turn) return result;

    if (this.runtimeSession) {
      this.runtimeSession.deliver(input.context);
    } else {
      this.runtimeSession = this.runtime.start({
        cwd: this.options.cwd,
        runtimeStateDir: this.options.runtimeStateDir,
        model: this.options.model,
        runtimeConfig: this.options.runtimeConfig,
        sessionId: this.engineSessionId,
        systemPrompt: this.options.systemPrompt.text,
        env: this.options.env,
        mcpBootstrap: this.options.mcpBootstrap,
        initialPrompt: input.context,
      }, this.callbacks());
    }
    return result;
  }

  async cancel(attemptId: string): Promise<void> {
    if (!this.active || this.active.input.attemptId !== attemptId) return;
    const stopError = await this.stopRuntime();
    this.cannotResumeAfterCancel = true;
    await this.finish("cancelled");
    if (stopError) throw stopError;
  }

  async snapshot(): Promise<AdapterSnapshot> {
    return {
      schemaVersion: 1,
      payload: {
        runtime: this.runtime.name,
        engineSessionId: this.engineSessionId,
        resumable: !this.cannotResumeAfterCancel,
      },
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const stopError = await this.stopRuntime();
    this.runtimeSession = null;
    if (this.active) await this.finish("cancelled");
    if (stopError) throw stopError;
  }

  private async stopRuntime(): Promise<unknown | null> {
    try {
      await this.runtimeSession?.stop();
      return null;
    } catch (error) {
      return error;
    }
  }

  private callbacks(): RuntimeCallbacks {
    return {
      onSession: (engineSessionId) => {
        if (!engineSessionId || engineSessionId === this.engineSessionId) return;
        const previous = this.engineSessionId;
        this.engineSessionId = engineSessionId;
        this.emit("session_changed", { previousEngineSessionId: previous, engineSessionId });
      },
      onActivity: (activity, detail) => {
        if (!this.active) return;
        if (activity === "online") queueMicrotask(() => { if (this.active) void this.finish("completed"); });
        else if (activity === "error" || activity === "offline") void this.finish("failed", `runtime_${activity}`);
        else this.emit("activity", { activity, detail: detail ?? "" });
      },
      onTrajectory: (entries) => this.trajectory(entries),
      onUsage: (usage) => {
        if (this.active) this.active.usage = usage;
        this.emit("usage", usage);
      },
      onCompaction: (phase, metadata) => this.emit(
        phase === "started" ? "compaction_started" : "compaction_completed",
        { engineSessionId: this.engineSessionId, ...(metadata ?? {}) },
      ),
      onTurnResult: (result) => { void this.finish(result.outcome, result.errorCode); },
      onExit: (code) => {
        this.runtimeSession = null;
        if (!this.active) return;
        void this.finish(code === 0 ? "failed" : "failed", code === 0 ? "runtime_exited_without_terminal" : "runtime_process_failed");
      },
      log: createLogger(`runtime:v2:${this.runtime.name}`),
    };
  }

  private trajectory(entries: TrajectoryEntry[]): void {
    for (const entry of entries) {
      if (entry.kind === "thinking") this.emit("thinking_summary", { text: entry.text ?? "" });
      else if (entry.kind === "text") this.emit("text_preview", { text: entry.text ?? "" });
      else if (entry.kind === "tool") this.emit(entry.eventKind ?? "tool_started", {
        toolName: entry.toolName ?? "tool",
        toolCallId: entry.toolCallId ?? "",
        toolInput: entry.toolInput ?? "",
        toolOutput: entry.toolOutput ?? "",
      });
      else this.emit("activity", { text: entry.text ?? "" });
    }
  }

  private emit(kind: RuntimeEventKind, payload: Record<string, unknown>): void {
    const turn = this.active;
    if (!turn || turn.settled) return;
    const event = {
      schemaVersion: 2 as const,
      workerGeneration: this.options.workerGeneration,
      sessionId: this.options.runtimeSessionId,
      sessionGeneration: this.options.sessionGeneration,
      turnId: turn.input.turnId,
      attemptId: turn.input.attemptId,
      eventId: randomUUID(),
      ordinal: turn.ordinal++,
      kind,
      payload,
      createdAt: this.now(),
    };
    turn.eventChain = turn.eventChain.then(() => turn.sink.emit(event));
  }

  private async finish(outcome: RuntimeTurnResult["outcome"], errorCode?: string): Promise<void> {
    const turn = this.active;
    if (!turn || turn.settled) return;
    turn.settled = true;
    clearTimeout(turn.deadlineTimer);
    const kind: RuntimeEventKind = outcome === "completed" ? "turn_completed" : "turn_failed";
    const event = {
      schemaVersion: 2 as const,
      workerGeneration: this.options.workerGeneration,
      sessionId: this.options.runtimeSessionId,
      sessionGeneration: this.options.sessionGeneration,
      turnId: turn.input.turnId,
      attemptId: turn.input.attemptId,
      eventId: randomUUID(),
      ordinal: turn.ordinal++,
      kind,
      payload: { outcome, ...(errorCode ? { errorCode } : {}) },
      createdAt: this.now(),
    };
    turn.eventChain = turn.eventChain.then(() => turn.sink.emit(event));
    try {
      await turn.eventChain;
      turn.resolve({
        outcome,
        engineSessionId: this.engineSessionId,
        ...(turn.usage ? { usage: turn.usage } : {}),
        ...(errorCode ? { errorCode } : {}),
      });
    } catch {
      turn.resolve({ outcome: "failed", engineSessionId: this.engineSessionId, errorCode: "runtime_event_ack_failed" });
    } finally {
      if (this.active === turn) this.active = null;
    }
  }
}

export function bridgeRuntimeV2(runtime: Runtime, adapterVersion = "v2-bridge-2", now: () => number = Date.now): RuntimeV2 {
  const baseline = RUNTIME_V1_CAPABILITY_BASELINE[runtime.name as keyof typeof RUNTIME_V1_CAPABILITY_BASELINE];
  if (!baseline) throw new Error(`Runtime ${runtime.name} has no frozen v2 capability baseline`);
  return {
    name: runtime.name,
    capabilities: { ...baseline.capabilities, mcp: "config", usage: "final" },
    async openSession(options) {
      return new BridgedRuntimeSession(runtime, options, now);
    },
  };
}

export const claudeRuntimeV2 = bridgeRuntimeV2(claudeRuntime);
export const codexRuntimeV2 = bridgeRuntimeV2(codexRuntime);
export const opencodeRuntimeV2 = bridgeRuntimeV2(opencodeRuntime);

export function getRuntimeV2(name: string): RuntimeV2 | null {
  if (name === "claude") return claudeRuntimeV2;
  if (name === "codex") return codexRuntimeV2;
  if (name === "opencode") return opencodeRuntimeV2;
  if (name === "pi") return piRpcRuntimeV2;
  return null;
}
