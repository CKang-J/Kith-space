import {
  currentWorkerGeneration,
  isWorkerConnected,
  isWorkerLeaseCurrent,
  requestWorkerAdmission,
  type WorkerLease,
} from "../../local-runtime/workerHub.js";
import type {
  ManualStartCommand,
  ResetCommand,
  RuntimeWorkerPort,
  StopCommand,
  WakeDeliveryCommand,
  WakeStartCommand,
} from "../contract/runtimeWorkerPort.js";

/** Production RuntimeWorkerPort backed by the installation-local trusted raw WebSocket. */
class WebSocketRuntimeWorkerPort implements RuntimeWorkerPort {
  constructor(private readonly lease: WorkerLease | null = null) {}

  start(command: WakeStartCommand | ManualStartCommand) {
    return requestWorkerAdmission(command, 6_000, this.lease ?? undefined);
  }

  deliver(command: WakeDeliveryCommand) {
    return requestWorkerAdmission(command, 6_000, this.lease ?? undefined);
  }

  stop(command: StopCommand) {
    return requestWorkerAdmission(command, 6_000, this.lease ?? undefined);
  }

  reset(command: ResetCommand) {
    return requestWorkerAdmission(command, 6_000, this.lease ?? undefined);
  }

  availability() {
    if (this.lease) {
      return { connected: isWorkerLeaseCurrent(this.lease) && this.lease.socket.readyState === 1, generation: this.lease.generation };
    }
    return { connected: isWorkerConnected(), generation: currentWorkerGeneration() };
  }
}

export const runtimeWorkerPort: RuntimeWorkerPort = new WebSocketRuntimeWorkerPort();

export function runtimeWorkerPortForLease(lease: WorkerLease): RuntimeWorkerPort {
  return new WebSocketRuntimeWorkerPort(lease);
}
