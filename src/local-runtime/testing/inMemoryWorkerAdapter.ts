import { performance } from "node:perf_hooks";
import type { WebSocket } from "ws";
import { registerWorker, resolveWorkerAdmission, unregisterWorker, updateWorkerSnapshot, type WorkerLease } from "../workerHub.js";

export function createInMemoryWorkerAdapter(options: {
  runtimes?: string[];
  runningAgents?: string[];
  admissionStatus?: "admitted" | "queued" | "rejected";
} = {}): {
  messages(): Record<string, unknown>[];
  socketSendDurationsMs(): number[];
  clear(): void;
  disconnect(): void;
} {
  const messages: Record<string, unknown>[] = [];
  const socketSendDurationsMs: number[] = [];
  let connected = true;
  let lease: WorkerLease;
  const socket = {
    readyState: 1,
    send(payload: string) {
      const started = performance.now();
      const message = JSON.parse(payload) as Record<string, unknown>;
      messages.push(message);
      socketSendDurationsMs.push(performance.now() - started);
      if (typeof message.generation === "number" && (typeof message.deliveryId === "string" || typeof message.commandId === "string")) {
        queueMicrotask(() => resolveWorkerAdmission(lease, {
          type: "worker:admission",
          generation: message.generation,
          ...(typeof message.deliveryId === "string" ? { deliveryId: message.deliveryId } : { commandId: message.commandId }),
          status: options.admissionStatus ?? "admitted",
        }));
      }
    },
    close() { connected = false; },
  } as unknown as WebSocket;
  lease = registerWorker(socket);
  updateWorkerSnapshot(lease, {
    runtimes: options.runtimes ?? ["fake"],
    runningAgents: options.runningAgents ?? [],
  });

  return {
    messages: () => messages.map((message) => structuredClone(message)),
    socketSendDurationsMs: () => [...socketSendDurationsMs],
    clear() {
      messages.length = 0;
      socketSendDurationsMs.length = 0;
    },
    disconnect() {
      if (!connected) return;
      connected = false;
      unregisterWorker(lease);
    },
  };
}
