import { requestWorker } from "../../local-runtime/workerHub.js";
import {
  MaintenanceWorkerResultSchema,
  maintenanceRuntimeSupport,
  type MaintenanceJsonInput,
  type MaintenanceJsonResult,
  type MaintenanceRuntimePort,
  type MaintenanceRuntimeSupport,
} from "../contract/maintenanceRuntimePort.js";

/** Core-side transport; the installation-local Worker remains the only process that launches runtime CLIs. */
export class WorkerMaintenanceRuntimePort implements MaintenanceRuntimePort {
  support(runtime: string): MaintenanceRuntimeSupport {
    return maintenanceRuntimeSupport(runtime);
  }

  async completeJson(input: MaintenanceJsonInput): Promise<MaintenanceJsonResult> {
    const support = this.support(input.runtime);
    if (support.toolIsolation !== "enforced") throw new Error(support.reason ?? "maintenance runtime unsupported");
    const raw = await requestWorker({
      type: "maintenance:complete-json",
      runtime: input.runtime,
      model: input.model ?? null,
      configDigest: input.configDigest,
      purpose: input.purpose,
      prompt: input.prompt,
    }, 90_000);
    const parsed = MaintenanceWorkerResultSchema.safeParse(raw);
    if (!parsed.success) throw new Error("invalid maintenance response from local runtime worker");
    if (!parsed.data.ok || !parsed.data.output) {
      throw new Error(parsed.data.errorCode ?? "maintenance completion failed");
    }
    return { output: parsed.data.output, usage: parsed.data.usage };
  }
}

export const maintenanceRuntimePort = new WorkerMaintenanceRuntimePort();
