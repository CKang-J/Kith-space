import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { SpaceTransaction } from "../counters.js";
import { schema } from "../db/index.js";

export const DEFAULT_MAX_DISPATCH_DEPTH = 4;
export const DEFAULT_MAX_DISPATCH_WAKES = 16;

export type DispatchBlockCode = "SPACE_STOPPED" | "TASK_STOPPED" | "DEPTH_LIMIT" | "WAKE_BUDGET";

export interface DispatchLimits {
  maxDepth: number;
  maxWakes: number;
}

export interface DispatchGuardInput {
  dispatchDepth: number;
  wakeCount: number;
  spaceStopped: boolean;
  taskStopped: boolean;
}

export interface DispatchDecision {
  allowed: boolean;
  code?: DispatchBlockCode;
  reason?: string;
}

export type WakeReservation =
  | { allowed: true; reservationId: string; wakeCount: number }
  | { allowed: false; code: DispatchBlockCode; reason: string; wakeCount: number };

const configuredInt = (value: string | undefined, fallback: number, minimum: number): number => {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
};

export function readDispatchLimits(env: NodeJS.ProcessEnv = process.env): DispatchLimits {
  return {
    maxDepth: configuredInt(env.KITH_SPACE_MAX_DISPATCH_DEPTH, DEFAULT_MAX_DISPATCH_DEPTH, 0),
    maxWakes: configuredInt(env.KITH_SPACE_MAX_DISPATCH_WAKES, DEFAULT_MAX_DISPATCH_WAKES, 1),
  };
}

/** Wake count remains a dispatch-count proxy until every runtime exposes normalized usage. */
export function decideDispatch(input: DispatchGuardInput, limits: DispatchLimits = readDispatchLimits()): DispatchDecision {
  if (input.spaceStopped) return { allowed: false, code: "SPACE_STOPPED", reason: "space dispatch is stopped" };
  if (input.taskStopped) return { allowed: false, code: "TASK_STOPPED", reason: "task dispatch is stopped" };
  if (input.dispatchDepth > limits.maxDepth) {
    return { allowed: false, code: "DEPTH_LIMIT", reason: `dispatch depth ${input.dispatchDepth} exceeds maximum ${limits.maxDepth}` };
  }
  if (input.wakeCount >= limits.maxWakes) {
    return { allowed: false, code: "WAKE_BUDGET", reason: `dispatch wake budget ${limits.maxWakes} is exhausted` };
  }
  return { allowed: true };
}

/** Atomically reserves the durable dispatch intent with the message/output transaction when required. */
export function reserveDispatchWakeInTransaction(
  tx: SpaceTransaction,
  input: {
    spaceId: string;
    chainId: string;
    dispatchDepth: number;
    taskMessageId: string | null;
    messageId: string;
    targetAgentId: string;
  },
  limits: DispatchLimits = readDispatchLimits(),
): WakeReservation {
  const chain = tx.select().from(schema.dispatchChains).where(and(
    eq(schema.dispatchChains.id, input.chainId),
    eq(schema.dispatchChains.spaceId, input.spaceId),
  )).get();
  if (!chain) return { allowed: false, code: "WAKE_BUDGET", reason: "dispatch chain not found", wakeCount: 0 };
  const spaceStopped = Boolean(tx.select().from(schema.dispatchStops).where(and(
    eq(schema.dispatchStops.spaceId, input.spaceId),
    eq(schema.dispatchStops.scopeType, "space"),
    eq(schema.dispatchStops.scopeId, input.spaceId),
  )).get());
  const taskMessageId = input.taskMessageId ?? chain.taskMessageId;
  const taskStopped = Boolean(taskMessageId && tx.select().from(schema.dispatchStops).where(and(
    eq(schema.dispatchStops.spaceId, input.spaceId),
    eq(schema.dispatchStops.scopeType, "task"),
    eq(schema.dispatchStops.scopeId, taskMessageId),
  )).get());
  if (spaceStopped || taskStopped) {
    const decision = decideDispatch({ dispatchDepth: input.dispatchDepth, wakeCount: chain.wakeCount, spaceStopped, taskStopped }, limits);
    return { allowed: false, code: decision.code!, reason: decision.reason!, wakeCount: chain.wakeCount };
  }
  const existing = tx.select().from(schema.dispatchWakes).where(and(
    eq(schema.dispatchWakes.spaceId, input.spaceId),
    eq(schema.dispatchWakes.chainId, input.chainId),
    eq(schema.dispatchWakes.messageId, input.messageId),
    eq(schema.dispatchWakes.targetAgentId, input.targetAgentId),
  )).get();
  if (existing) return { allowed: true, reservationId: existing.id, wakeCount: chain.wakeCount };
  const decision = decideDispatch({
    dispatchDepth: input.dispatchDepth,
    wakeCount: chain.wakeCount,
    spaceStopped,
    taskStopped,
  }, limits);
  if (!decision.allowed) {
    tx.update(schema.dispatchChains).set({
      lastRejectionCode: decision.code!,
      lastRejectionReason: decision.reason!,
      lastRejectedAt: new Date(),
      lastRejectedMessageId: input.messageId,
      lastRejectedAgentId: input.targetAgentId,
      updatedAt: new Date(),
    }).where(eq(schema.dispatchChains.id, input.chainId)).run();
    return { allowed: false, code: decision.code!, reason: decision.reason!, wakeCount: chain.wakeCount };
  }
  const reservationId = randomUUID();
  tx.update(schema.dispatchChains).set({
    wakeCount: sql`${schema.dispatchChains.wakeCount} + 1`,
    maxDepthSeen: Math.max(chain.maxDepthSeen, input.dispatchDepth),
    updatedAt: new Date(),
  }).where(eq(schema.dispatchChains.id, input.chainId)).run();
  tx.insert(schema.dispatchWakes).values({
    id: reservationId,
    spaceId: input.spaceId,
    chainId: input.chainId,
    messageId: input.messageId,
    targetAgentId: input.targetAgentId,
    dispatchDepth: input.dispatchDepth,
    status: "reserved",
  }).run();
  return { allowed: true, reservationId, wakeCount: chain.wakeCount + 1 };
}

/** Removes an unused reservation and refunds its chain budget in the same transaction. */
export function releaseDispatchWakeInTransaction(
  tx: SpaceTransaction,
  input: { spaceId: string; reservationId: string },
): boolean {
  const wake = tx.select().from(schema.dispatchWakes).where(and(
    eq(schema.dispatchWakes.id, input.reservationId),
    eq(schema.dispatchWakes.spaceId, input.spaceId),
  )).get();
  if (!wake || wake.status !== "reserved") return false;
  tx.delete(schema.dispatchWakes).where(eq(schema.dispatchWakes.id, input.reservationId)).run();
  tx.update(schema.dispatchChains).set({
    wakeCount: sql`max(${schema.dispatchChains.wakeCount} - 1, 0)`,
    updatedAt: new Date(),
  }).where(eq(schema.dispatchChains.id, wake.chainId)).run();
  return true;
}
