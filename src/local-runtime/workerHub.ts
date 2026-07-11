import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { WORKER_REPLACED_CODE } from "../daemonProtocol.js";

export interface WorkerSnapshot {
  runtimes: string[];
  runningAgents: string[];
}

type PendingRequest = {
  resolve: (value: any) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Capability for one accepted Worker connection. The monotonically increasing generation lets
 * asynchronous consumers prove that the connection which started their work is still authoritative.
 */
export interface WorkerLease {
  readonly socket: WebSocket;
  readonly generation: number;
}

let currentLease: WorkerLease | null = null;
let latestGeneration = 0;
let snapshot: WorkerSnapshot = { runtimes: [], runningAgents: [] };
const pendingRequests = new Map<string, PendingRequest>();

function settlePending(error: string): void {
  for (const [requestId, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pending.resolve({ error });
    pendingRequests.delete(requestId);
  }
}

/** Install-level invariant: exactly one local runtime worker may own the control plane. */
export function registerWorker(ws: WebSocket): WorkerLease {
  if (currentLease?.socket === ws) return currentLease;
  const previous = currentLease;
  const lease = Object.freeze({ socket: ws, generation: ++latestGeneration });
  currentLease = lease;
  snapshot = { runtimes: [], runningAgents: [] };
  if (!previous) return lease;
  settlePending("local worker replaced");
  try {
    if (previous.socket.readyState === 1) {
      previous.socket.close(WORKER_REPLACED_CODE, "replaced by a newer local runtime worker");
    }
  } catch { /* replacement remains authoritative */ }
  return lease;
}

/** Returns true only when this socket was the current worker and was removed. */
export function unregisterWorker(lease: WorkerLease): boolean {
  if (!isWorkerLeaseCurrent(lease)) return false;
  currentLease = null;
  snapshot = { runtimes: [], runningAgents: [] };
  settlePending("local worker disconnected");
  return true;
}

/** True only while this exact connection still owns the live Worker control plane. */
export function isWorkerLeaseCurrent(lease: WorkerLease): boolean {
  return currentLease?.generation === lease.generation && currentLease.socket === lease.socket;
}

/**
 * True while no newer Worker generation has been accepted. This remains true after the current
 * lease disconnects so its offline reconciliation may run, then flips false as soon as a replacement arrives.
 */
export function isWorkerLeaseLatest(lease: WorkerLease): boolean {
  return latestGeneration === lease.generation;
}

export function isWorkerConnected(): boolean {
  return currentLease?.socket.readyState === 1;
}

export function sendToWorker(message: unknown): boolean {
  const lease = currentLease;
  if (!lease) return false;
  return sendToWorkerForLease(lease, message);
}

/** Send only if the caller's Worker generation is still authoritative; never retarget stale work. */
export function sendToWorkerForLease(lease: WorkerLease, message: unknown): boolean {
  if (!isWorkerLeaseCurrent(lease) || lease.socket.readyState !== 1) return false;
  try {
    lease.socket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

export function requestWorker(message: Record<string, unknown>, timeoutMs = 6000): Promise<any> {
  if (!isWorkerConnected()) return Promise.resolve({ error: "no local worker online" });
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve({ error: "local worker timeout" });
    }, timeoutMs);
    pendingRequests.set(requestId, { resolve, timer });
    if (!sendToWorker({ ...message, requestId })) {
      clearTimeout(timer);
      pendingRequests.delete(requestId);
      resolve({ error: "local worker send failed" });
    }
  });
}

export function resolveWorkerRequest(requestId: string, data: unknown): void {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingRequests.delete(requestId);
  pending.resolve(data);
}

export function updateWorkerSnapshot(lease: WorkerLease, next: WorkerSnapshot): boolean {
  if (!isWorkerLeaseCurrent(lease)) return false;
  snapshot = {
    runtimes: [...next.runtimes],
    runningAgents: [...next.runningAgents],
  };
  return true;
}

export function workerRuntimes(): string[] {
  return [...snapshot.runtimes];
}

export function workerRunningAgents(): string[] {
  return [...snapshot.runningAgents];
}
