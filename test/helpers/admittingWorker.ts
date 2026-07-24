import type { WebSocket } from "ws";
import {
  registerWorker,
  resolveWorkerAdmission,
  unregisterWorker,
  updateWorkerSnapshot,
  type WorkerLease,
} from "../../src/local-runtime/workerHub.ts";

export function connectAdmittingWorker(options: { runtimes?: string[]; runningAgents?: string[] } = {}) {
  const messages: Record<string, any>[] = [];
  let lease: WorkerLease;
  const socket = {
    readyState: 1,
    send(payload: string) {
      const message = JSON.parse(payload) as Record<string, any>;
      messages.push(message);
      if (typeof message.generation === "number" && (typeof message.deliveryId === "string" || typeof message.commandId === "string")) {
        queueMicrotask(() => resolveWorkerAdmission(lease, {
          type: "worker:admission",
          generation: message.generation,
          ...(typeof message.deliveryId === "string" ? { deliveryId: message.deliveryId } : { commandId: message.commandId }),
          status: "admitted",
        }));
      }
    },
    close() { /* controlled by disconnect */ },
  } as unknown as WebSocket;
  lease = registerWorker(socket);
  updateWorkerSnapshot(lease, {
    runtimes: options.runtimes ?? ["claude"],
    runningAgents: options.runningAgents ?? [],
  });
  return {
    messages,
    clear() { messages.length = 0; },
    disconnect() { unregisterWorker(lease); },
  };
}

export function admittedWakeDeliveries(messages: Record<string, any>[]): Record<string, any>[] {
  return messages.flatMap((message) => {
    if (message.source !== "wake") return [];
    if (message.type === "agent:deliver") return [message];
    if (message.type === "agent:start" && message.delivery) return [{ agentId: message.agentId, ...message.delivery }];
    return [];
  });
}
