import { randomUUID } from "node:crypto";
import { AdvisorProviderError, type CompiledAdvisorModelConfig, type ProviderExecutionSnapshot } from "../../advisor-provider/contracts.js";
import { currentWorkerLease, isWorkerLeaseCurrent, requestWorkerForLease, type WorkerLease } from "../../local-runtime/workerHub.js";
import { MemoryAdvisorCompletionSchema } from "../contract/maintenanceRuntimePort.js";
import {
  AdvisorCompleteResultSchema,
  AdvisorPrepareResultSchema,
  type AdvisorProviderRuntimePort,
  type PreparedAdvisorRun,
} from "../contract/advisorProviderRuntimePort.js";

function providerError(raw: unknown): AdvisorProviderError {
  const code = raw && typeof raw === "object" && typeof (raw as any).errorCode === "string" ? (raw as any).errorCode : "provider_unavailable";
  const allowed = new Set([
    "provider_unavailable", "provider_auth_required", "provider_model_incompatible", "provider_revision_changed",
    "provider_timeout", "provider_cancelled", "provider_invalid_output", "provider_preflight_destination_mismatch",
    "provider_postflight_destination_mismatch",
  ]);
  return new AdvisorProviderError(allowed.has(code) ? code : "provider_unavailable");
}

export class WorkerAdvisorProviderRuntimePort implements AdvisorProviderRuntimePort {
  private readonly leases = new Map<string, WorkerLease>();

  async prepare(snapshot: ProviderExecutionSnapshot, config: CompiledAdvisorModelConfig): Promise<PreparedAdvisorRun> {
    const runId = randomUUID();
    const lease = currentWorkerLease();
    if (!lease) throw new AdvisorProviderError("provider_unavailable");
    const raw = await requestWorkerForLease(lease, { type: "advisor:prepare", runId, snapshot, config }, 15_000);
    const parsed = AdvisorPrepareResultSchema.safeParse(raw);
    if (!parsed.success) throw providerError(raw);
    if (parsed.data.workerGeneration !== lease.generation || !isWorkerLeaseCurrent(lease)) throw new AdvisorProviderError("provider_revision_changed");
    this.leases.set(runId, lease);
    const { type: _type, requestId: _requestId, ok: _ok, ...prepared } = parsed.data;
    return { runId, snapshot, config, ...prepared };
  }

  async complete(input: PreparedAdvisorRun, prompt: string, credentialHandle: string, signal?: AbortSignal) {
    const cancel = () => { void this.cancel(input.runId); };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const lease = this.leases.get(input.runId);
      if (!lease || lease.generation !== input.workerGeneration || !isWorkerLeaseCurrent(lease)) throw new AdvisorProviderError("provider_revision_changed");
      const raw = await requestWorkerForLease(lease, {
        type: "advisor:complete",
        runId: input.runId,
        localHandle: input.localHandle,
        snapshotDigest: input.snapshot.executionSnapshotDigest,
        providerEpoch: input.snapshot.providerEpoch,
        prompt,
        credentialHandle,
      }, 90_000);
      const parsed = AdvisorCompleteResultSchema.safeParse(raw);
      if (!parsed.success) throw providerError(raw);
      return {
        output: MemoryAdvisorCompletionSchema.parse(parsed.data.output),
        usage: parsed.data.usage as any,
      };
    } finally {
      this.leases.delete(input.runId);
      signal?.removeEventListener("abort", cancel);
    }
  }

  async cancel(runId: string): Promise<void> {
    const lease = this.leases.get(runId);
    this.leases.delete(runId);
    if (!lease || !isWorkerLeaseCurrent(lease)) return;
    await requestWorkerForLease(lease, { type: "advisor:cancel", runId }, 10_000);
  }
}

export const advisorProviderRuntimePort = new WorkerAdvisorProviderRuntimePort();
