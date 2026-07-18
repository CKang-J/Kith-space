import { createLogger } from "../../log.js";
import {
  workerCommandId,
  type AdmissionResult,
  type RuntimeWorkerCommand,
  type WakeDeliveryCommand,
  type WorkerAdmissionCommand,
  type WorkerQueueOutcome,
} from "../contract/runtimeWorkerPort.js";

export type { WorkerAdmissionCommand } from "../contract/runtimeWorkerPort.js";

type StartCommand = Extract<WorkerAdmissionCommand, { type: "agent:start" }>;
type ResetCommand = Extract<WorkerAdmissionCommand, { type: "agent:reset" }>;

export interface RuntimeAdmissionBackend {
  isRunning(agentId: string): boolean;
  start(command: StartCommand): Promise<boolean>;
  deliver(command: WakeDeliveryCommand): void;
  stop(agentId: string): void;
  sleep(agentId: string): void;
  reset(agentId: string, command: ResetCommand): Promise<void>;
  stopAllAndWait(): Promise<void>;
}

export interface RuntimeAdmissionOptions {
  capacity?: number;
  maxQueue?: number;
  queueTtlMs?: number;
  agingMs?: number;
  now?: () => number;
  onOutcome?: (outcome: WorkerQueueOutcome) => void;
}

interface QueuedCommand {
  command: WorkerAdmissionCommand;
  id: string;
  enqueuedAt: number;
  sequence: number;
}

const DEFAULT_CAPACITY = 4;
const DEFAULT_MAX_QUEUE = 128;
const DEFAULT_QUEUE_TTL_MS = 120_000;
const DEFAULT_AGING_MS = 5_000;

/** Installation-level capacity and ordering policy around the existing AgentManager/Runtime seam. */
export class RuntimeAdmissionController {
  private readonly capacity: number;
  private readonly maxQueue: number;
  private readonly queueTtlMs: number;
  private readonly agingMs: number;
  private readonly now: () => number;
  private readonly autoTimers: boolean;
  private readonly onOutcome: (outcome: WorkerQueueOutcome) => void;
  private readonly activeOrStarting = new Set<string>();
  private readonly queue: QueuedCommand[] = [];
  private readonly results = new Map<string, { fingerprint: string; result: AdmissionResult }>();
  private readonly inFlight = new Set<Promise<void>>();
  private sequence = 0;
  private latestGeneration = 0;
  private peakActiveOrStarting = 0;
  private lastSpaceId: string | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private pumping: Promise<void> | null = null;
  private shuttingDown = false;
  private readonly log = createLogger("runtime:admission");

  constructor(private readonly backend: RuntimeAdmissionBackend, options: RuntimeAdmissionOptions = {}) {
    this.capacity = positiveInteger(options.capacity, DEFAULT_CAPACITY);
    this.maxQueue = positiveInteger(options.maxQueue, DEFAULT_MAX_QUEUE);
    this.queueTtlMs = positiveInteger(options.queueTtlMs, DEFAULT_QUEUE_TTL_MS);
    this.agingMs = positiveInteger(options.agingMs, DEFAULT_AGING_MS);
    this.now = options.now ?? Date.now;
    this.autoTimers = !options.now;
    this.onOutcome = options.onOutcome ?? (() => {});
  }

  async admit(command: WorkerAdmissionCommand): Promise<AdmissionResult> {
    const id = workerCommandId(command);
    const key = `${command.generation}:${id}`;
    const fingerprint = JSON.stringify(command);
    const previous = this.results.get(key);
    if (previous) {
      return previous.fingerprint === fingerprint
        ? previous.result
        : this.result(command, "rejected", "stable id reused for a different command");
    }
    if (command.generation < this.latestGeneration) {
      return this.remember(key, fingerprint, this.result(command, "rejected", "stale Worker generation"));
    }
    this.latestGeneration = Math.max(this.latestGeneration, command.generation);
    if (this.shuttingDown) {
      return this.remember(key, fingerprint, this.result(command, "rejected", "Worker is shutting down"));
    }

    if (command.source === "lifecycle") {
      this.cancelQueuedForAgent(command.agentId, command.type === "agent:reset" ? "replaced by reset" : "cancelled by lifecycle command");
      try {
        if (command.type === "agent:stop") this.backend.stop(command.agentId);
        else if (command.type === "agent:sleep") this.backend.sleep(command.agentId);
        else if (command.type === "agent:reset") await this.backend.reset(command.agentId, command);
        this.sessionEnded(command.agentId);
        return this.remember(key, fingerprint, this.result(command, "admitted"));
      } catch (error) {
        return this.remember(key, fingerprint, this.result(command, "rejected", errorMessage(error)));
      }
    }

    if (this.backend.isRunning(command.agentId)) {
      if (command.type === "agent:deliver") this.backend.deliver(command);
      else if (command.source === "wake") this.backend.deliver(deliveryCommand(command));
      return this.remember(key, fingerprint, this.result(command, "admitted"));
    }

    if (command.type === "agent:deliver") {
      return this.remember(key, fingerprint, this.result(command, "rejected", "agent is not running"));
    }

    const sameLogicalQueue = this.queue.find((item) => item.id === id);
    if (sameLogicalQueue) {
      return this.remember(key, fingerprint, this.result(command, "queued"));
    }
    const hasOlderAgentWork = this.queue.some((item) => item.command.agentId === command.agentId);
    if (!hasOlderAgentWork && this.activeOrStarting.size < this.capacity) {
      this.startAccepted(command, 0);
      this.lastSpaceId = command.spaceId;
      return this.remember(key, fingerprint, this.result(command, "admitted"));
    }
    if (this.queue.length >= this.maxQueue) {
      return this.remember(key, fingerprint, this.result(command, "rejected", "runtime admission queue full"));
    }
    this.queue.push({ command, id, enqueuedAt: this.now(), sequence: ++this.sequence });
    this.armExpiryTimer();
    this.log.debug("runtime command queued", { id, agentId: command.agentId, spaceId: command.spaceId, queued: this.queue.length });
    return this.remember(key, fingerprint, this.result(command, "queued"));
  }

  sessionEnded(agentId: string): boolean {
    if (!this.activeOrStarting.delete(agentId)) return false;
    this.schedulePump();
    return true;
  }

  sweepExpired(): number {
    return this.removeExpired(this.now());
  }

  snapshot(): {
    capacity: number;
    activeOrStarting: number;
    peakActiveOrStarting: number;
    queued: number;
  } {
    return {
      capacity: this.capacity,
      activeOrStarting: this.activeOrStarting.size,
      peakActiveOrStarting: this.peakActiveOrStarting,
      queued: this.queue.length,
    };
  }

  async settled(): Promise<void> {
    while (this.pumping || this.inFlight.size) {
      if (this.pumping) await this.pumping;
      const pending = [...this.inFlight];
      if (pending.length) await Promise.all(pending);
    }
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    for (const item of this.queue.splice(0)) this.emitOutcome(item, "cancelled", "Worker shutdown");
    await this.settled();
    await this.backend.stopAllAndWait();
    this.activeOrStarting.clear();
  }

  private startAccepted(command: StartCommand, queuedMs: number): void {
    this.activeOrStarting.add(command.agentId);
    this.peakActiveOrStarting = Math.max(this.peakActiveOrStarting, this.activeOrStarting.size);
    const operation = (async () => {
      try {
        if (command.source === "wake") this.backend.deliver(deliveryCommand(command));
        const running = await this.backend.start(command);
        if (!running) {
          this.activeOrStarting.delete(command.agentId);
          this.onOutcome(outcomeFor(command, "failed", queuedMs, "runtime did not start"));
        }
      } catch (error) {
        this.activeOrStarting.delete(command.agentId);
        this.onOutcome(outcomeFor(command, "failed", queuedMs, errorMessage(error)));
      }
    })();
    this.inFlight.add(operation);
    void operation.finally(() => {
      this.inFlight.delete(operation);
      this.schedulePump();
    });
  }

  private schedulePump(): void {
    if (this.pumping || this.shuttingDown) return;
    this.pumping = Promise.resolve().then(() => this.pump()).finally(() => { this.pumping = null; });
  }

  private pump(): void {
    this.removeExpired(this.now());
    while (true) {
      const next = this.pickNext();
      if (!next) break;
      this.queue.splice(this.queue.indexOf(next), 1);
      const wait = Math.max(0, this.now() - next.enqueuedAt);
      this.lastSpaceId = next.command.spaceId;
      if (next.command.type === "agent:deliver") {
        this.backend.deliver(next.command);
        this.emitOutcome(next, "completed");
        continue;
      }
      if (this.backend.isRunning(next.command.agentId)) {
        if (next.command.source === "wake") this.backend.deliver(deliveryCommand(next.command));
        this.emitOutcome(next, "completed");
        continue;
      }
      if (next.command.type !== "agent:start") {
        this.emitOutcome(next, "failed", "queued command is not startable");
        continue;
      }
      this.startAccepted(next.command, wait);
      this.emitOutcome(next, "completed");
    }
    this.armExpiryTimer();
  }

  private pickNext(): QueuedCommand | null {
    const firstPerAgent = new Map<string, QueuedCommand>();
    for (const item of this.queue) if (!firstPerAgent.has(item.command.agentId)) firstPerAgent.set(item.command.agentId, item);
    const eligible = [...firstPerAgent.values()].filter((item) => {
      if (this.backend.isRunning(item.command.agentId)) return true;
      return item.command.type === "agent:start" && this.activeOrStarting.size < this.capacity;
    });
    if (!eligible.length) return null;
    const now = this.now();
    const bestScore = Math.max(...eligible.map((item) => priority(item.command) + Math.floor((now - item.enqueuedAt) / this.agingMs) * 100));
    const best = eligible.filter((item) => priority(item.command) + Math.floor((now - item.enqueuedAt) / this.agingMs) * 100 === bestScore);
    return best.find((item) => item.command.spaceId !== this.lastSpaceId)
      ?? best.sort((left, right) => left.sequence - right.sequence)[0]
      ?? null;
  }

  private cancelQueuedForAgent(agentId: string, reason: string): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const item = this.queue[index]!;
      if (item.command.agentId !== agentId) continue;
      this.queue.splice(index, 1);
      this.emitOutcome(item, "cancelled", reason);
    }
    this.armExpiryTimer();
  }

  private removeExpired(now: number): number {
    let removed = 0;
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const item = this.queue[index]!;
      if (now - item.enqueuedAt < this.queueTtlMs) continue;
      this.queue.splice(index, 1);
      this.emitOutcome(item, "expired", "runtime admission queue expired");
      removed += 1;
    }
    this.armExpiryTimer();
    return removed;
  }

  private armExpiryTimer(): void {
    if (!this.autoTimers || this.shuttingDown) return;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    if (!this.queue.length) return;
    const delay = Math.max(1, Math.min(...this.queue.map((item) => item.enqueuedAt + this.queueTtlMs - this.now())));
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.removeExpired(this.now());
      this.schedulePump();
    }, delay);
    this.expiryTimer.unref?.();
  }

  private emitOutcome(item: QueuedCommand, status: WorkerQueueOutcome["status"], reason?: string): void {
    this.onOutcome(outcomeFor(item.command, status, Math.max(0, this.now() - item.enqueuedAt), reason));
  }

  private result(command: WorkerAdmissionCommand, status: AdmissionResult["status"], reason?: string): AdmissionResult {
    return { status, id: workerCommandId(command), generation: command.generation, ...(reason ? { reason } : {}) };
  }

  private remember(key: string, fingerprint: string, result: AdmissionResult): AdmissionResult {
    this.results.set(key, { fingerprint, result });
    if (this.results.size > 10_000) this.results.delete(this.results.keys().next().value!);
    return result;
  }
}

function deliveryCommand(command: Extract<StartCommand, { source: "wake" }>): WakeDeliveryCommand {
  return {
    type: "agent:deliver",
    source: "wake",
    deliveryId: command.deliveryId,
    spaceId: command.spaceId,
    agentId: command.agentId,
    ...command.delivery,
  };
}

function priority(command: RuntimeWorkerCommand): number {
  if (command.source === "lifecycle") return 400;
  if (command.source === "manual") return 300;
  const directive = command.type === "agent:start" ? command.delivery.responseDirective : command.responseDirective;
  return directive === "required" ? 200 : 100;
}

function outcomeFor(command: WorkerAdmissionCommand, status: WorkerQueueOutcome["status"], queuedMs: number, reason?: string): WorkerQueueOutcome {
  return {
    id: workerCommandId(command),
    source: command.source,
    generation: command.generation,
    spaceId: command.spaceId,
    agentId: command.agentId,
    status,
    queuedMs,
    ...(reason ? { reason } : {}),
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
