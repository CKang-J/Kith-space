import type { TurnCapabilityClaims } from "../../../capabilities/contracts.js";
import { SessionCapabilityBroker } from "../../../capabilities/sessionCapabilityBroker.js";
import { HarnessError } from "../../../harness/errors.js";
import type { RuntimeSessionRecord } from "../../../sessions/sessionModule.js";
import type {
  OpenRuntimeSessionOptions,
  RuntimeEventEnvelope,
  RuntimeEventSink,
  RuntimeSessionV2,
  RuntimeTurnInput,
  RuntimeTurnResult,
  RuntimeV2,
} from "../../contract/v2/runtimeContract.js";

interface HostedSession {
  record: RuntimeSessionRecord;
  runtime: RuntimeV2;
  session: RuntimeSessionV2;
  brokerHandle: string;
  lastUsedAt: number;
  active: boolean;
}

export interface HostedTurnRequest {
  record: RuntimeSessionRecord;
  open: Omit<OpenRuntimeSessionOptions, "runtimeSessionId" | "sessionGeneration" | "broker">;
  turn: RuntimeTurnInput;
  claims: TurnCapabilityClaims;
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
  private readonly agentTails = new Map<string, Promise<void>>();
  private readonly activeWaiters: Array<() => void> = [];
  private activeTurns = 0;

  constructor(
    private readonly runtimeResolver: (name: string) => RuntimeV2 | null,
    private readonly broker: SessionCapabilityBroker,
    options: RuntimeSessionHostOptions = {},
  ) {
    this.activeTurnLimit = options.activeTurnLimit ?? 4;
    this.residentProcessLimit = options.residentProcessLimit ?? 4;
    this.brokerEndpoint = options.brokerEndpoint ?? "kith-broker://session";
    this.now = options.now ?? Date.now;
  }

  runTurn(request: HostedTurnRequest): Promise<RuntimeTurnResult> {
    const previous = this.agentTails.get(request.record.agentId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => { release = resolve; });
    const chained = previous.catch(() => {}).then(() => tail);
    this.agentTails.set(request.record.agentId, chained);
    return previous.catch(() => {}).then(async () => {
      await this.acquireActiveSlot();
      try {
        return await this.runAdmitted(request);
      } finally {
        this.releaseActiveSlot();
        release();
        if (this.agentTails.get(request.record.agentId) === chained) this.agentTails.delete(request.record.agentId);
      }
    });
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.hosted.values()];
    this.hosted.clear();
    await Promise.all(sessions.map(async (hosted) => {
      this.broker.closeSession(hosted.brokerHandle);
      await hosted.session.close("shutdown");
    }));
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
    this.broker.activate(hosted.brokerHandle, request.claims);
    let expectedOrdinal = 0;
    const guardedSink: RuntimeEventSink = {
      emit: async (event) => {
        this.assertEvent(request, event, expectedOrdinal);
        expectedOrdinal += 1;
        await request.sink.emit(event);
      },
    };
    try {
      return await hosted.session.runTurn(request.turn, guardedSink);
    } finally {
      hosted.active = false;
      hosted.lastUsedAt = this.now();
      this.broker.deactivate(hosted.brokerHandle, request.claims.activationId);
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
      return existing;
    }
    const runtime = this.runtimeResolver(request.record.runtime);
    if (!runtime) throw new Error(`No Runtime v2 adapter for ${request.record.runtime}`);
    if (runtime.capabilities.persistentProcess) await this.ensureResidentCapacity();
    const brokerHandle = this.broker.openSession({
      sessionId: request.record.id,
      sessionGeneration: request.record.sessionGeneration,
      spaceId: request.record.spaceId,
      agentId: request.record.agentId,
    });
    try {
      const session = await runtime.openSession({
        ...request.open,
        runtimeSessionId: request.record.id,
        sessionGeneration: request.record.sessionGeneration,
        broker: { sessionHandle: brokerHandle, endpoint: this.brokerEndpoint },
      });
      const hosted: HostedSession = {
        record: request.record,
        runtime,
        session,
        brokerHandle,
        lastUsedAt: this.now(),
        active: false,
      };
      this.hosted.set(request.record.id, hosted);
      return hosted;
    } catch (error) {
      this.broker.closeSession(brokerHandle);
      throw error;
    }
  }

  private async ensureResidentCapacity(): Promise<void> {
    const residents = [...this.hosted.values()].filter((hosted) => hosted.runtime.capabilities.persistentProcess);
    if (residents.length < this.residentProcessLimit) return;
    const evictable = residents.filter((hosted) => !hosted.active).sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0];
    if (!evictable) throw new Error("resident runtime process capacity exhausted");
    this.hosted.delete(evictable.record.id);
    this.broker.closeSession(evictable.brokerHandle);
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
