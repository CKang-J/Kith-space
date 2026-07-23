import type { IncomingMessage, ServerResponse } from "node:http";
import { providerCredentialPort } from "../advisor-provider/credentialPort.js";
import { isWorkerTrustedRequest } from "../local-runtime/internalCredentials.js";
import { RuntimeProfileService } from "../model-control/runtimeProfileService.js";
import {
  runtimeCredentialActivationPort,
  type RuntimeCredentialActivationDescriptor,
} from "../runtime/config/runtimeCredentialActivationPort.js";
import { readJson, sendErr, sendJson } from "./util.js";
import { currentWorkerGeneration, isWorkerConnected } from "../local-runtime/workerHub.js";

export async function handleRuntimeCredentialRedemption(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (url.pathname !== "/internal/runtime-credentials/redeem") return false;
  if (method !== "POST") return (sendErr(res, 405, "method not allowed"), true);
  if (!isWorkerTrustedRequest(req)) return (sendErr(res, 404, "not found"), true);
  const body = await readJson(req);
  const handle = typeof body?.credentialHandle === "string" ? body.credentialHandle : "";
  const descriptor = body?.binding as RuntimeCredentialActivationDescriptor | undefined;
  if (!handle || !descriptor || descriptor.activationId !== handle) {
    return (sendErr(res, 400, "invalid runtime credential activation"), true);
  }
  if (!isWorkerConnected() || descriptor.workerGeneration !== currentWorkerGeneration()) {
    providerCredentialPort.revoke(handle);
    return (sendErr(res, 409, "runtime worker generation changed"), true);
  }
  try {
    // Scheduler admission owns the epoch read lease. Taking a second read lease here
    // can deadlock behind a queued writer while Core waits for Worker preparation.
    // The durable epoch comparison plus the one-shot, fully bound handle remain the
    // independent fail-closed check for delayed or replayed Worker requests.
    const currentEpoch = new RuntimeProfileService().runtimeConfigurationEpoch();
    if (descriptor.runtimeConfigurationEpoch !== currentEpoch) {
      throw new Error("runtime configuration epoch changed");
    }
    const providerCredential = providerCredentialPort.redeem(handle, {
      runId: descriptor.runtimeSessionId,
      providerEpoch: descriptor.runtimeConfigurationEpoch,
      workerGeneration: descriptor.workerGeneration,
      executionSnapshotDigest: descriptor.effectiveConfigDigest,
    });
    runtimeCredentialActivationPort.issue(descriptor, {
      value: providerCredential.value,
      type: providerCredential.type,
      identityDigest: providerCredential.identityDigest,
    });
    const activated = runtimeCredentialActivationPort.redeem(descriptor);
    return (sendJson(res, 200, activated), true);
  } catch {
    providerCredentialPort.revoke(handle);
    runtimeCredentialActivationPort.revoke(handle);
    return (sendErr(res, 409, "runtime credential activation unavailable"), true);
  }
}
