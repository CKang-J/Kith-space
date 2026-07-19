import { HarnessError } from "../../../harness/errors.js";
import type {
  OpenRuntimeSessionOptions,
  RuntimeEventEnvelope,
  RuntimeEventSink,
  RuntimeSessionV2,
  RuntimeTurnInput,
  RuntimeTurnResult,
  RuntimeV2,
} from "../../contract/v2/runtimeContract.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

interface HostedSession {
  record: HostedRuntimeSessionRecord;
  runtime: RuntimeV2;
  session: RuntimeSessionV2;
  brokerHandle: string;
  workerGeneration: number;
  activationFile: string;
  lastUsedAt: number;
  active: boolean;
}

const MAX_FORWARDED_EVENTS_PER_ATTEMPT = 2_000;
const MAX_FORWARDED_EVENT_PAYLOAD_BYTES = 64 * 1024;
const MAX_FORWARDED_EVENT_AGGREGATE_BYTES = 8 * 1024 * 1024;
const RESERVED_TERMINAL_EVENT_COUNT = 16;
const RESERVED_TERMINAL_EVENT_BYTES = 256 * 1024;

export interface HostedRuntimeSessionRecord {
  id: string;
  spaceId: string;
  agentId: string;
  surfaceKind: "channel" | "private" | "dm" | "thread";
  surfaceId: string;
  sessionGeneration: number;
  runtime: string;
  engineSessionId: string | null;
}

export interface HostedTurnRequest {
  record: HostedRuntimeSessionRecord;
  open: Omit<OpenRuntimeSessionOptions, "runtimeSessionId" | "sessionGeneration" | "broker">;
  broker: OpenRuntimeSessionOptions["broker"];
  turn: RuntimeTurnInput;
  sink: RuntimeEventSink;
}

export interface RuntimeSessionHostOptions {
  activeTurnLimit?: number;
  residentProcessLimit?: number;
  brokerEndpoint?: string;
  now?: () => number;
}

/** Worker-owned, rebuildable session host with global slots and per-Agent serialization. */
export class RuntimeSessionHost {
  private readonly activeTurnLimit: number;
  private readonly residentProcessLimit: number;
  private readonly brokerEndpoint: string;
  private readonly now: () => number;
  private readonly hosted = new Map<string, HostedSession>();
  private readonly activeAttempts = new Map<string, RuntimeSessionV2>();
  private readonly queuedAttempts = new Map<string, string>();
  private readonly cancelledAttempts = new Set<string>();
  private readonly agentTails = new Map<string, Promise<void>>();
  private readonly activeWaiters: Array<() => void> = [];
  private activeTurns = 0;

  constructor(
    private readonly runtimeResolver: (name: string) => RuntimeV2 | null,
    options: RuntimeSessionHostOptions = {},
  ) {
    this.activeTurnLimit = options.activeTurnLimit ?? 4;
    this.residentProcessLimit = options.residentProcessLimit ?? 4;
    this.brokerEndpoint = options.brokerEndpoint ?? "kith-broker://session";
    this.now = options.now ?? Date.now;
  }

  runTurn(request: HostedTurnRequest): Promise<RuntimeTurnResult> {
    this.queuedAttempts.set(request.turn.attemptId, request.record.agentId);
    const previous = this.agentTails.get(request.record.agentId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => { release = resolve; });
    const chained = previous.catch(() => {}).then(() => tail);
    this.agentTails.set(request.record.agentId, chained);
    return previous.catch(() => {}).then(async () => {
      let acquiredActiveSlot = false;
      try {
        if (this.cancelledAttempts.delete(request.turn.attemptId)) {
          return { outcome: "cancelled", engineSessionId: request.record.engineSessionId, errorCode: "attempt_cancelled_before_start" };
        }
        await this.acquireActiveSlot();
        acquiredActiveSlot = true;
        if (this.cancelledAttempts.delete(request.turn.attemptId)) {
          return { outcome: "cancelled", engineSessionId: request.record.engineSessionId, errorCode: "attempt_cancelled_before_start" };
        }
        return await this.runAdmitted(request);
      } finally {
        this.queuedAttempts.delete(request.turn.attemptId);
        if (acquiredActiveSlot) this.releaseActiveSlot();
        release();
        if (this.agentTails.get(request.record.agentId) === chained) this.agentTails.delete(request.record.agentId);
      }
    });
  }

  async closeAll(): Promise<void> {
    for (const attemptId of this.queuedAttempts.keys()) this.cancelledAttempts.add(attemptId);
    const sessions = [...this.hosted.values()];
    this.hosted.clear();
    await Promise.all(sessions.map(async (hosted) => {
      await hosted.session.close("shutdown");
    }));
  }

  async cancelAttempt(attemptId: string): Promise<boolean> {
    const session = this.activeAttempts.get(attemptId);
    if (!session) {
      if (!this.queuedAttempts.has(attemptId)) return false;
      this.cancelledAttempts.add(attemptId);
      return true;
    }
    await session.cancel(attemptId);
    return true;
  }

  async closeAgent(agentId: string, reason: "stop" | "reset"): Promise<number> {
    for (const [attemptId, queuedAgentId] of this.queuedAttempts) {
      if (queuedAgentId === agentId && !this.activeAttempts.has(attemptId)) this.cancelledAttempts.add(attemptId);
    }
    const sessions = [...this.hosted.values()].filter((hosted) => hosted.record.agentId === agentId);
    for (const hosted of sessions) {
      this.hosted.delete(hosted.record.id);
      await hosted.session.close(reason);
    }
    return sessions.length;
  }

  snapshot(): { activeTurns: number; hostedSessions: number; residentProcesses: number } {
    return {
      activeTurns: this.activeTurns,
      hostedSessions: this.hosted.size,
      residentProcesses: [...this.hosted.values()].filter((hosted) => hosted.runtime.capabilities.persistentProcess).length,
    };
  }

  private async runAdmitted(request: HostedTurnRequest): Promise<RuntimeTurnResult> {
    const hosted = await this.ensureHosted(request);
    hosted.active = true;
    hosted.lastUsedAt = this.now();
    let expectedOrdinal = 0;
    let forwardedOrdinal = 0;
    let forwardedPayloadBytes = 0;
    let previewsTruncated = false;
    const guardedSink: RuntimeEventSink = {
      emit: async (event) => {
        this.assertEvent(request, event, expectedOrdinal);
        expectedOrdinal += 1;
        const preview = event.kind === "activity" || event.kind === "thinking_summary" || event.kind === "text_preview";
        if (previewsTruncated && preview) return;
        const payloadBytes = Buffer.byteLength(JSON.stringify(event.payload), "utf8");
        const previewCountLimit = MAX_FORWARDED_EVENTS_PER_ATTEMPT - RESERVED_TERMINAL_EVENT_COUNT;
        const previewByteLimit = MAX_FORWARDED_EVENT_AGGREGATE_BYTES - RESERVED_TERMINAL_EVENT_BYTES;
        const truncationReason = preview && forwardedOrdinal >= previewCountLimit
          ? "event_count_limit"
          : preview && payloadBytes > MAX_FORWARDED_EVENT_PAYLOAD_BYTES
            ? "payload_byte_limit"
            : preview && forwardedPayloadBytes + payloadBytes > previewByteLimit
              ? "aggregate_byte_limit"
              : null;
        if (truncationReason) {
          previewsTruncated = true;
          const payload = {
            reason: truncationReason,
            eventLimit: MAX_FORWARDED_EVENTS_PER_ATTEMPT,
            aggregateByteLimit: MAX_FORWARDED_EVENT_AGGREGATE_BYTES,
            originalBytes: payloadBytes,
            originalKind: event.kind,
          };
          const summaryBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
          await request.sink.emit({ ...event, ordinal: forwardedOrdinal, kind: "events_truncated", payload });
          forwardedOrdinal += 1;
          forwardedPayloadBytes += summaryBytes;
          return;
        }
        if (payloadBytes > MAX_FORWARDED_EVENT_PAYLOAD_BYTES) {
          throw new HarnessError("context_capacity_exhausted", "critical Runtime event exceeds the payload byte limit", {
            attemptId: event.attemptId,
            kind: event.kind,
            payloadBytes,
          });
        }
        if (forwardedOrdinal >= MAX_FORWARDED_EVENTS_PER_ATTEMPT
          || forwardedPayloadBytes + payloadBytes > MAX_FORWARDED_EVENT_AGGREGATE_BYTES) {
          throw new HarnessError("context_capacity_exhausted", "critical Runtime event exceeds the reserved attempt event capacity", {
            attemptId: event.attemptId,
            kind: event.kind,
          });
        }
        await request.sink.emit({ ...event, ordinal: forwardedOrdinal });
        forwardedOrdinal += 1;
        forwardedPayloadBytes += payloadBytes;
      },
    };
    try {
      await mkdir(path.dirname(hosted.activationFile), { recursive: true });
      await writeFile(hosted.activationFile, JSON.stringify({
        activationId: request.turn.capabilityActivationId,
        turnId: request.turn.turnId,
        attemptId: request.turn.attemptId,
        workerGeneration: request.open.workerGeneration,
      }), { encoding: "utf8", mode: 0o600 });
      if (this.cancelledAttempts.delete(request.turn.attemptId)) {
        if (this.hosted.get(hosted.record.id) === hosted) this.hosted.delete(hosted.record.id);
        await hosted.session.close("stop");
        return { outcome: "cancelled", engineSessionId: request.record.engineSessionId, errorCode: "attempt_cancelled_before_start" };
      }
      this.activeAttempts.set(request.turn.attemptId, hosted.session);
      return await hosted.session.runTurn(request.turn, guardedSink);
    } finally {
      this.activeAttempts.delete(request.turn.attemptId);
      this.cancelledAttempts.delete(request.turn.attemptId);
      await rm(hosted.activationFile, { force: true }).catch(() => {});
      hosted.active = false;
      hosted.lastUsedAt = this.now();
    }
  }

  private async ensureHosted(request: HostedTurnRequest): Promise<HostedSession> {
    const existing = this.hosted.get(request.record.id);
    if (existing) {
      if (existing.record.sessionGeneration !== request.record.sessionGeneration) {
        throw new HarnessError("session_generation_stale", "hosted session generation changed without eviction", {
          sessionId: request.record.id,
        });
      }
      if (existing.workerGeneration === request.open.workerGeneration && existing.brokerHandle === request.broker.sessionHandle) {
        return existing;
      }
      if (existing.active) {
        throw new HarnessError("worker_generation_stale", "active hosted session belongs to another Core generation", {
          sessionId: request.record.id,
          previousWorkerGeneration: existing.workerGeneration,
          workerGeneration: request.open.workerGeneration,
        });
      }
      this.hosted.delete(request.record.id);
      await existing.session.close("idle");
    }
    const runtime = this.runtimeResolver(request.record.runtime);
    if (!runtime) throw new Error(`No Runtime v2 adapter for ${request.record.runtime}`);
    if (runtime.capabilities.persistentProcess) await this.ensureResidentCapacity();
    const brokerHandle = request.broker.sessionHandle;
    const activationFile = path.join(request.open.runtimeStateDir, `turn-activation-${request.record.id}.json`);
    try {
      const session = await runtime.openSession({
        ...request.open,
        env: {
          ...request.open.env,
          KITH_SPACE_BROKER_HANDLE: brokerHandle,
          KITH_SPACE_BROKER_ENDPOINT: request.broker.endpoint || this.brokerEndpoint,
          KITH_SPACE_ACTIVATION_FILE: activationFile,
          KITH_SPACE_WORKER_GENERATION: String(request.open.workerGeneration),
        },
        runtimeSessionId: request.record.id,
        sessionGeneration: request.record.sessionGeneration,
        broker: { sessionHandle: brokerHandle, endpoint: request.broker.endpoint || this.brokerEndpoint },
      });
      const hosted: HostedSession = {
        record: request.record,
        runtime,
        session,
        brokerHandle,
        workerGeneration: request.open.workerGeneration,
        activationFile,
        lastUsedAt: this.now(),
        active: false,
      };
      this.hosted.set(request.record.id, hosted);
      return hosted;
    } catch (error) {
      throw error;
    }
  }

  private async ensureResidentCapacity(): Promise<void> {
    const residents = [...this.hosted.values()].filter((hosted) => hosted.runtime.capabilities.persistentProcess);
    if (residents.length < this.residentProcessLimit) return;
    const evictable = residents.filter((hosted) => !hosted.active).sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0];
    if (!evictable) throw new Error("resident runtime process capacity exhausted");
    this.hosted.delete(evictable.record.id);
    await evictable.session.close("idle");
  }

  private assertEvent(request: HostedTurnRequest, event: RuntimeEventEnvelope, expectedOrdinal: number): void {
    if (event.workerGeneration !== request.open.workerGeneration) {
      throw new HarnessError("worker_generation_stale", "Runtime event came from a stale Worker generation", {
        expected: request.open.workerGeneration,
        actual: event.workerGeneration,
      });
    }
    if (event.sessionId !== request.record.id || event.sessionGeneration !== request.record.sessionGeneration) {
      throw new HarnessError("session_generation_stale", "Runtime event came from a stale session generation", {
        expectedSessionId: request.record.id,
        actualSessionId: event.sessionId,
      });
    }
    if (event.turnId !== request.turn.turnId || event.attemptId !== request.turn.attemptId || event.ordinal !== expectedOrdinal) {
      throw new HarnessError("attempt_lease_conflict", "Runtime event does not match the admitted attempt", {
        expectedOrdinal,
        actualOrdinal: event.ordinal,
      });
    }
  }

  private acquireActiveSlot(): Promise<void> {
    if (this.activeTurns < this.activeTurnLimit) {
      this.activeTurns += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.activeWaiters.push(() => {
      this.activeTurns += 1;
      resolve();
    }));
  }

  private releaseActiveSlot(): void {
    this.activeTurns = Math.max(0, this.activeTurns - 1);
    this.activeWaiters.shift()?.();
  }
}
