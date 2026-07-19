import { createLogger } from "../../../log.js";
import type { AgentConfig } from "../../../daemon/agentManager.js";
import type {
  AdmissionResult,
  TurnAdmitCommand,
  TurnActivateCommand,
  TurnCancelCommand,
  TurnSessionsCloseCommand,
  WorkerAdmissionCommand,
} from "../../contract/runtimeWorkerPort.js";
import { RuntimeTurnResultSchema, type RuntimeEventEnvelope, type RuntimeTurnResult } from "../../contract/v2/runtimeContract.js";
import { prepareRuntimeSession } from "./runtimeSessionPreparation.js";
import { RuntimeSessionHost } from "./runtimeSessionHost.js";

interface PendingAck {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface AdmittedTurn {
  command: TurnAdmitCommand & { generation: number };
  fingerprint: string;
  cancelled: boolean;
  key: string;
  expiryTimer: ReturnType<typeof setTimeout>;
}

export interface RuntimeTurnControllerOptions {
  maxAdmitted?: number;
  ackTimeoutMs?: number;
  admissionTtlMs?: number;
  terminalRetryMs?: number;
  shutdownTimeoutMs?: number;
  send: (message: unknown) => boolean;
  prepare?: typeof prepareRuntimeSession;
}

/** Worker-only execution controller. Core remains authoritative for leases, capabilities, and outcomes. */
export class RuntimeTurnController {
  private readonly admitted = new Map<string, AdmittedTurn>();
  private readonly completedAdmissions = new Map<string, { fingerprint: string; result: AdmissionResult }>();
  private readonly eventAcks = new Map<string, PendingAck>();
  private readonly terminalAcks = new Map<string, PendingAck>();
  private readonly running = new Set<Promise<void>>();
  private readonly runningCommands = new Map<string, TurnAdmitCommand & { generation: number }>();
  private readonly cancelledAttempts = new Set<string>();
  private readonly terminalCommands = new Map<string, TurnAdmitCommand & { generation: number }>();
  private readonly maxAdmitted: number;
  private readonly ackTimeoutMs: number;
  private readonly admissionTtlMs: number;
  private readonly terminalRetryMs: number;
  private readonly shutdownTimeoutMs: number;
  private latestGeneration = 0;
  private shuttingDown = false;
  private readonly log = createLogger("runtime:turn-controller");

  constructor(private readonly host: RuntimeSessionHost, private readonly options: RuntimeTurnControllerOptions) {
    this.maxAdmitted = options.maxAdmitted ?? 128;
    this.ackTimeoutMs = options.ackTimeoutMs ?? 10_000;
    this.admissionTtlMs = options.admissionTtlMs ?? 120_000;
    this.terminalRetryMs = options.terminalRetryMs ?? 1_000;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 10_000;
  }

  admit(message: WorkerAdmissionCommand): AdmissionResult {
    if (message.type !== "agent:turn:admit" || message.source !== "turn") {
      return { status: "rejected", id: message.source === "wake" ? message.deliveryId : message.commandId, generation: message.generation, reason: "not a v2 turn command" };
    }
    const key = `${message.generation}:${message.commandId}`;
    const fingerprint = JSON.stringify(message);
    const previous = this.completedAdmissions.get(key);
    if (previous) {
      return previous.fingerprint === fingerprint
        ? previous.result
        : this.result(message, "rejected", "stable command id reused for a different turn");
    }
    if (message.generation < this.latestGeneration) return this.remember(key, fingerprint, this.result(message, "rejected", "stale Worker generation"));
    this.latestGeneration = Math.max(this.latestGeneration, message.generation);
    if (this.shuttingDown) return this.remember(key, fingerprint, this.result(message, "rejected", "Worker is shutting down"));
    const existing = this.admitted.get(message.turn.attemptId);
    if (existing) {
      const result = existing.fingerprint === fingerprint
        ? this.result(message, "admitted")
        : this.result(message, "rejected", "attempt id reused for a different turn");
      return this.remember(key, fingerprint, result);
    }
    if (this.admitted.size + this.running.size >= this.maxAdmitted) {
      return this.remember(key, fingerprint, this.result(message, "rejected", "turn admission queue full"));
    }
    const ttlMs = Math.max(1, Math.min(this.admissionTtlMs, message.turn.deadlineAt - Date.now()));
    const admitted = {} as AdmittedTurn;
    const expiryTimer = setTimeout(() => {
      if (this.admitted.get(message.turn.attemptId) !== admitted) return;
      this.admitted.delete(message.turn.attemptId);
      this.remember(key, fingerprint, this.result(message, "rejected", "turn admission expired before activation"));
    }, ttlMs);
    expiryTimer.unref?.();
    Object.assign(admitted, { command: message, fingerprint, cancelled: false, key, expiryTimer });
    this.admitted.set(message.turn.attemptId, admitted);
    return this.remember(key, fingerprint, this.result(message, "admitted"));
  }

  activate(message: TurnActivateCommand): boolean {
    const admitted = this.admitted.get(message.attemptId);
    if (!admitted || admitted.command.generation !== message.generation || admitted.command.turn.capabilityActivationId !== message.activationId) return false;
    this.admitted.delete(message.attemptId);
    clearTimeout(admitted.expiryTimer);
    if (admitted.cancelled || this.shuttingDown) return false;
    this.runningCommands.set(message.attemptId, admitted.command);
    const operation = this.run(admitted.command);
    this.running.add(operation);
    void operation.finally(() => {
      this.running.delete(operation);
      this.runningCommands.delete(message.attemptId);
      this.cancelledAttempts.delete(message.attemptId);
    });
    return true;
  }

  async cancel(message: TurnCancelCommand): Promise<boolean> {
    const admitted = this.admitted.get(message.attemptId);
    if (admitted && admitted.command.generation === message.generation) {
      admitted.cancelled = true;
      this.admitted.delete(message.attemptId);
      clearTimeout(admitted.expiryTimer);
      return true;
    }
    const terminal = this.terminalCommands.get(message.attemptId);
    if (terminal?.generation === message.generation) {
      this.terminalCommands.delete(message.attemptId);
      this.rejectPendingById(this.terminalAcks, message.attemptId, "turn cancelled");
      return true;
    }
    const running = this.runningCommands.get(message.attemptId);
    if (running?.generation === message.generation) {
      this.cancelledAttempts.add(message.attemptId);
      await this.host.cancelAttempt(message.attemptId);
      return true;
    }
    return this.host.cancelAttempt(message.attemptId);
  }

  async advanceGeneration(generation: number): Promise<void> {
    if (!Number.isInteger(generation) || generation <= this.latestGeneration) return;
    this.latestGeneration = generation;
    for (const [attemptId, admitted] of this.admitted) {
      if (admitted.command.generation >= generation) continue;
      clearTimeout(admitted.expiryTimer);
      this.admitted.delete(attemptId);
    }
    for (const [attemptId, command] of this.terminalCommands) {
      if (command.generation >= generation) continue;
      this.terminalCommands.delete(attemptId);
      this.rejectPendingById(this.terminalAcks, attemptId, "Core generation advanced");
    }
    const staleRunning = [...this.runningCommands.entries()].filter(([, command]) => command.generation < generation);
    await Promise.all(staleRunning.map(async ([attemptId]) => {
      this.cancelledAttempts.add(attemptId);
      await this.host.cancelAttempt(attemptId).catch(() => false);
    }));
  }

  async closeAgent(message: TurnSessionsCloseCommand & { generation: number }): Promise<AdmissionResult> {
    if (message.generation < this.latestGeneration) return { status: "rejected", id: message.commandId, generation: message.generation, reason: "stale Worker generation" };
    this.latestGeneration = Math.max(this.latestGeneration, message.generation);
    for (const [attemptId, admitted] of this.admitted) {
      if (admitted.command.agentId === message.agentId) {
        clearTimeout(admitted.expiryTimer);
        this.admitted.delete(attemptId);
      }
    }
    for (const [attemptId, command] of this.terminalCommands) {
      if (command.agentId === message.agentId) {
        this.terminalCommands.delete(attemptId);
        this.rejectPendingById(this.terminalAcks, attemptId, "Agent sessions closed");
      }
    }
    await this.host.closeAgent(message.agentId, message.reason);
    return { status: "admitted", id: message.commandId, generation: message.generation };
  }

  acknowledgeEvent(message: { eventId?: unknown; ok?: unknown; error?: unknown }): boolean {
    return this.acknowledge(this.eventAcks, message.eventId, message.ok, message.error);
  }

  acknowledgeTerminal(message: { attemptId?: unknown; ok?: unknown; error?: unknown }): boolean {
    return this.acknowledge(this.terminalAcks, message.attemptId, message.ok, message.error);
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    for (const attemptId of this.runningCommands.keys()) this.cancelledAttempts.add(attemptId);
    for (const admitted of this.admitted.values()) clearTimeout(admitted.expiryTimer);
    this.admitted.clear();
    this.terminalCommands.clear();
    this.rejectPending(this.eventAcks, "Worker shutdown");
    this.rejectPending(this.terminalAcks, "Worker shutdown");
    await this.host.closeAll();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      Promise.allSettled([...this.running]),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, this.shutdownTimeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
  }

  private async run(command: TurnAdmitCommand & { generation: number }): Promise<void> {
    let result: RuntimeTurnResult;
    try {
      const open = await (this.options.prepare ?? prepareRuntimeSession)({
        config: command.config as AgentConfig,
        record: command.session,
        workerGeneration: command.generation,
        broker: command.broker,
      });
      if (this.shuttingDown || this.cancelledAttempts.has(command.turn.attemptId) || command.generation !== this.latestGeneration) {
        return;
      }
      result = RuntimeTurnResultSchema.parse(await this.host.runTurn({
        record: command.session,
        open,
        broker: command.broker,
        turn: command.turn,
        sink: { emit: (event) => this.emitEvent(event) },
      }));
    } catch (error) {
      if (this.shuttingDown || this.cancelledAttempts.has(command.turn.attemptId) || command.generation !== this.latestGeneration) return;
      this.log.warn("runtime turn failed before terminal acknowledgement", { attemptId: command.turn.attemptId, detail: errorMessage(error) });
      const detail = errorMessage(error);
      result = {
        outcome: "failed",
        engineSessionId: command.session.engineSessionId,
        errorCode: detail.startsWith("mcp_bootstrap_failed:") || detail.startsWith("capability_gateway_unavailable:")
          ? "mcp_bootstrap_failed"
          : "runtime_execution_failed",
      };
    }
    const terminal = {
      type: "agent:turn:terminal",
      generation: command.generation,
      spaceId: command.spaceId,
      agentId: command.agentId,
      turnId: command.turn.turnId,
      attemptId: command.turn.attemptId,
      sessionId: command.session.id,
      sessionGeneration: command.session.sessionGeneration,
      result,
    };
    this.terminalCommands.set(command.turn.attemptId, command);
    try {
      while (!this.shuttingDown
        && this.terminalCommands.get(command.turn.attemptId) === command
        && command.generation === this.latestGeneration) {
        try {
          await this.sendAndWait(this.terminalAcks, command.turn.attemptId, terminal);
          return;
        } catch (error) {
          if (this.shuttingDown || this.terminalCommands.get(command.turn.attemptId) !== command) return;
          this.log.warn("Core did not acknowledge runtime turn terminal state; retrying", {
            attemptId: command.turn.attemptId,
            detail: errorMessage(error),
          });
          await new Promise((resolve) => setTimeout(resolve, this.terminalRetryMs));
        }
      }
    } finally {
      if (this.terminalCommands.get(command.turn.attemptId) === command) this.terminalCommands.delete(command.turn.attemptId);
    }
  }

  private emitEvent(event: RuntimeEventEnvelope): Promise<void> {
    return this.sendAndWait(this.eventAcks, event.eventId, { type: "agent:turn:event", event });
  }

  private sendAndWait(map: Map<string, PendingAck>, id: string, message: unknown): Promise<void> {
    const existing = map.get(id);
    if (existing) return Promise.reject(new Error(`duplicate pending acknowledgement: ${id}`));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        map.delete(id);
        reject(new Error(`Core acknowledgement timed out: ${id}`));
      }, this.ackTimeoutMs);
      timer.unref?.();
      map.set(id, { resolve, reject, timer });
      if (!this.options.send(message)) {
        clearTimeout(timer);
        map.delete(id);
        reject(new Error("Core connection is not available"));
      }
    });
  }

  private acknowledge(map: Map<string, PendingAck>, rawId: unknown, ok: unknown, rawError: unknown): boolean {
    if (typeof rawId !== "string") return false;
    const pending = map.get(rawId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    map.delete(rawId);
    if (ok === true) pending.resolve();
    else pending.reject(new Error(typeof rawError === "string" ? rawError : "Core rejected acknowledgement"));
    return true;
  }

  private rejectPending(map: Map<string, PendingAck>, reason: string): void {
    for (const pending of map.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    map.clear();
  }

  private rejectPendingById(map: Map<string, PendingAck>, id: string, reason: string): void {
    const pending = map.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    map.delete(id);
    pending.reject(new Error(reason));
  }

  private result(command: TurnAdmitCommand & { generation: number }, status: AdmissionResult["status"], reason?: string): AdmissionResult {
    return { status, id: command.commandId, generation: command.generation, ...(reason ? { reason } : {}) };
  }

  private remember(key: string, fingerprint: string, result: AdmissionResult): AdmissionResult {
    this.completedAdmissions.set(key, { fingerprint, result });
    if (this.completedAdmissions.size > 10_000) this.completedAdmissions.delete(this.completedAdmissions.keys().next().value!);
    return result;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
