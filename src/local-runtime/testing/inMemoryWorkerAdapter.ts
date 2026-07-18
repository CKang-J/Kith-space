import { performance } from "node:perf_hooks";
import type { WebSocket } from "ws";
import { registerWorker, unregisterWorker, updateWorkerSnapshot } from "../workerHub.js";

export function createInMemoryWorkerAdapter(options: {
  runtimes?: string[];
  runningAgents?: string[];
} = {}): {
  messages(): Record<string, unknown>[];
  socketSendDurationsMs(): number[];
  clear(): void;
  disconnect(): void;
} {
  const messages: Record<string, unknown>[] = [];
  const socketSendDurationsMs: number[] = [];
  let connected = true;
  const socket = {
    readyState: 1,
    send(payload: string) {
      const started = performance.now();
      messages.push(JSON.parse(payload) as Record<string, unknown>);
      socketSendDurationsMs.push(performance.now() - started);
    },
    close() { connected = false; },
  } as unknown as WebSocket;
  const lease = registerWorker(socket);
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
