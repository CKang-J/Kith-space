import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { WORKER_REPLACED_CODE } from "../daemonProtocol.js";
import {
  workerCommandId,
  type AdmissionResult,
  type RuntimeWorkerCommand,
} from "../runtime/contract/runtimeWorkerPort.js";

export interface WorkerSnapshot {
  runtimes: string[];
  runningAgents: string[];
}

type PendingRequest = {
  resolve: (value: any) => void;
  timer: ReturnType<typeof setTimeout>;
  generation: number;
};

type PendingAdmission = {
  promise: Promise<AdmissionResult>;
  resolve: (value: AdmissionResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class WorkerAdmissionUncertainError extends Error {
  constructor(message: string, public readonly generation: number, public readonly id: string) {
    super(message);
    this.name = "WorkerAdmissionUncertainError";
  }
}

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
const pendingAdmissions = new Map<string, PendingAdmission>();
const resolvedAdmissions = new Map<string, AdmissionResult>();

function settlePending(error: string): void {
  for (const [requestId, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pending.resolve({ error });
    pendingRequests.delete(requestId);
  }
}

function rejectAdmissions(generation: number, error: string): void {
  for (const [key, pending] of pendingAdmissions) {
    if (!key.startsWith(`${generation}:`)) continue;
    clearTimeout(pending.timer);
    const id = key.slice(key.indexOf(":") + 1);
    pending.reject(new WorkerAdmissionUncertainError(error, generation, id));
    pendingAdmissions.delete(key);
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
  rejectAdmissions(previous.generation, "local worker replaced before admission ack");
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
  rejectAdmissions(lease.generation, "local worker disconnected before admission ack");
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

export function currentWorkerGeneration(): number | null {
  return currentLease?.generation ?? null;
}

export function currentWorkerLease(): WorkerLease | null {
  return currentLease;
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

export function requestWorkerAdmission(
  command: RuntimeWorkerCommand,
  timeoutMs = 6_000,
  lease: WorkerLease | null = currentLease,
): Promise<AdmissionResult> {
  const id = workerCommandId(command);
  if (!lease || !isWorkerLeaseCurrent(lease) || lease.socket.readyState !== 1) {
    return Promise.reject(new WorkerAdmissionUncertainError("no local worker online", lease?.generation ?? 0, id));
  }
  const key = `${lease.generation}:${id}`;
  const resolved = resolvedAdmissions.get(key);
  if (resolved) return Promise.resolve(resolved);
  const existing = pendingAdmissions.get(key);
  if (existing) return existing.promise;

  let resolveAdmission!: (value: AdmissionResult) => void;
  let rejectAdmission!: (error: Error) => void;
  const promise = new Promise<AdmissionResult>((resolve, reject) => {
    resolveAdmission = resolve;
    rejectAdmission = reject;
  });
  const timer = setTimeout(() => {
    pendingAdmissions.delete(key);
    rejectAdmission(new WorkerAdmissionUncertainError("local worker admission timeout", lease.generation, id));
  }, timeoutMs);
  timer.unref?.();
  pendingAdmissions.set(key, { promise, resolve: resolveAdmission, reject: rejectAdmission, timer });
  if (!sendToWorkerForLease(lease, { ...command, generation: lease.generation })) {
    clearTimeout(timer);
    pendingAdmissions.delete(key);
    rejectAdmission(new WorkerAdmissionUncertainError("local worker admission send failed", lease.generation, id));
  }
  return promise;
}

export function resolveWorkerAdmission(lease: WorkerLease, message: Record<string, unknown>): boolean {
  if (!isWorkerLeaseCurrent(lease) || message.generation !== lease.generation) return false;
  const id = typeof message.deliveryId === "string"
    ? message.deliveryId
    : typeof message.commandId === "string"
      ? message.commandId
      : null;
  if (!id || (message.status !== "admitted" && message.status !== "queued" && message.status !== "rejected")) return false;
  const key = `${lease.generation}:${id}`;
  if (resolvedAdmissions.has(key)) return true;
  const pending = pendingAdmissions.get(key);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingAdmissions.delete(key);
  const result: AdmissionResult = {
    status: message.status,
    id,
    generation: lease.generation,
    ...(typeof message.reason === "string" ? { reason: message.reason } : {}),
  };
  resolvedAdmissions.set(key, result);
  if (resolvedAdmissions.size > 10_000) resolvedAdmissions.delete(resolvedAdmissions.keys().next().value!);
  pending.resolve(result);
  return true;
}

export function requestWorker(message: Record<string, unknown>, timeoutMs = 6000): Promise<any> {
  const lease = currentLease;
  if (!lease) return Promise.resolve({ error: "no local worker online" });
  return requestWorkerForLease(lease, message, timeoutMs);
}

/** Correlated request that can never be retargeted to a replacement Worker generation. */
export function requestWorkerForLease(lease: WorkerLease, message: Record<string, unknown>, timeoutMs = 6000): Promise<any> {
  if (!isWorkerLeaseCurrent(lease) || lease.socket.readyState !== 1) return Promise.resolve({ error: "local worker lease changed" });
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve({ error: "local worker timeout" });
    }, timeoutMs);
    pendingRequests.set(requestId, { resolve, timer, generation: lease.generation });
    if (!sendToWorkerForLease(lease, { ...message, requestId, expectedGeneration: lease.generation })) {
      clearTimeout(timer);
      pendingRequests.delete(requestId);
      resolve({ error: "local worker send failed" });
    }
  });
}

export function resolveWorkerRequest(requestId: string, data: unknown, lease: WorkerLease | null = currentLease): void {
  const pending = pendingRequests.get(requestId);
  if (!pending || !lease || pending.generation !== lease.generation || !isWorkerLeaseCurrent(lease)) return;
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
