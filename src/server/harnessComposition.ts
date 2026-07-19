import { SessionCapabilityBroker } from "../capabilities/sessionCapabilityBroker.js";
import { TurnCapabilityService } from "../capabilities/turnCapabilityService.js";
import { TurnOutputService } from "../turns/turnOutputService.js";
import { HarnessTurnScheduler } from "../turns/turnScheduler.js";
import { runtimeWorkerPort } from "../runtime/control/runtimeWorkerAdapter.js";
import { turnDispatchAdapter } from "./turnDispatchAdapter.js";
import { publish } from "./realtime.js";
import { CapabilityGateway } from "../capabilities/capabilityGateway.js";
import { configureTaskWorkflowEvents } from "../tasks/taskService.js";
import { runTemporaryAttachmentMaintenance } from "../files/temporaryAttachmentCleanup.js";
import { createLogger } from "../log.js";

const log = createLogger("harness:composition");

configureTaskWorkflowEvents({
  async publish(spaceId, event) {
    await publish(spaceId, event);
    if ((event as { type?: unknown } | null)?.type === "message") await scheduleV2Turns(spaceId);
  },
});

export const coreSessionCapabilityBroker = new SessionCapabilityBroker();
const capabilities = new Map<string, TurnCapabilityService>();
const outputs = new Map<string, TurnOutputService>();
const gateways = new Map<string, CapabilityGateway>();
export const harnessTurnScheduler = new HarnessTurnScheduler({
  runtimeWorker: runtimeWorkerPort,
  capabilities: turnCapabilityService,
  dispatch: turnDispatchAdapter,
  async agentConfig(spaceId, agentId) {
    const core = await import("./core.js");
    const config = await core.agentConfig(spaceId, agentId);
    return config ? {
      ...config,
      model: config.model ?? undefined,
      runtimeConfig: config.runtimeConfig ?? undefined,
    } : null;
  },
});

export async function scheduleV2Turns(spaceId: string): Promise<void> {
  const core = await import("./core.js");
  const maintenance = await runTemporaryAttachmentMaintenance(spaceId);
  if (!maintenance.ok) {
    log.warn("temporary attachment maintenance failed open", {
      spaceId,
      detail: maintenance.error instanceof Error ? maintenance.error.message : String(maintenance.error),
    });
  }
  await core.recoverLegacyTurnOutputMentions(spaceId);
  await harnessTurnScheduler.schedule(spaceId);
}

export function turnCapabilityService(spaceId: string): TurnCapabilityService {
  let service = capabilities.get(spaceId);
  if (!service) {
    service = new TurnCapabilityService(spaceId, coreSessionCapabilityBroker);
    capabilities.set(spaceId, service);
  }
  return service;
}

export function turnOutputService(spaceId: string): TurnOutputService {
  let service = outputs.get(spaceId);
  if (!service) {
    service = new TurnOutputService(spaceId, {
      publish,
      schedulePending: scheduleV2Turns,
      async dispatchLegacyMentions(input) {
        const core = await import("./core.js");
        await core.dispatchLegacyTurnOutputMentions(input);
      },
      async recoverLegacyMentions(targetSpaceId) {
        const core = await import("./core.js");
        await core.recoverLegacyTurnOutputMentions(targetSpaceId);
      },
    });
    outputs.set(spaceId, service);
  }
  return service;
}

export function capabilityGateway(spaceId: string): CapabilityGateway {
  let gateway = gateways.get(spaceId);
  if (!gateway) {
    gateway = new CapabilityGateway(spaceId);
    gateways.set(spaceId, gateway);
  }
  return gateway;
}
