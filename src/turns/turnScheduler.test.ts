import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { SessionCapabilityBroker } from "../capabilities/sessionCapabilityBroker.js";
import { TurnCapabilityService } from "../capabilities/turnCapabilityService.js";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { WorkerAdmissionUncertainError } from "../local-runtime/workerHub.js";
import { kithSpaceHome } from "../paths.js";
import type { RuntimeWorkerPort, TurnAdmitCommand } from "../runtime/contract/runtimeWorkerPort.js";
import { HarnessTurnScheduler } from "./turnScheduler.js";
import { TurnLedger } from "./turnLedger.js";

function setup() {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "turn-scheduler", spaceId);
  registerSpace({ id: spaceId, name: "Scheduler", slug: `scheduler-${spaceId}`, rootPath });
  const db = dbForSpace(spaceId);
  db.insert(schema.agents).values({ id: agentId, spaceId, name: "scheduler-agent", displayName: "Scheduler Agent", runtime: "claude", status: "active" }).run();
  db.insert(schema.channels).values({ id: channelId, spaceId, name: "scheduler", type: "channel" }).run();
  db.insert(schema.channelAgentMembers).values({ channelId, agentId, lastReadSeq: 0 }).run();
  db.insert(schema.agentHarnessState).values({ agentId, mode: "v2" }).run();
  const messageId = randomUUID();
  db.insert(schema.messages).values({ id: messageId, seq: 1, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human", content: "@scheduler-agent work" }).run();
  const deliveryId = randomUUID();
  db.insert(schema.agentDeliveryItems).values({
    id: deliveryId,
    spaceId,
    agentId,
    messageId,
    sourceChannelId: channelId,
    sourceSeq: 1,
    cursorOwnerChannelId: channelId,
    targetSurfaceKind: "channel",
    targetSurfaceId: channelId,
    directive: "required",
    reason: "direct_mention",
    policySnapshot: {},
    disposition: "pending",
  }).run();
  return { spaceId, agentId, channelId, rootPath, deliveryId, db };
}

function config(f: ReturnType<typeof setup>) {
  return {
    agentId: f.agentId,
    spaceId: f.spaceId,
    workspaceRoot: f.rootPath,
    name: "scheduler-agent",
    displayName: "Scheduler Agent",
    runtime: "claude",
    serverUrl: "http://127.0.0.1:7777",
  };
}

test("scheduler binds a durable delivery and activates exactly one leased Worker attempt", async () => {
  const f = setup();
  const admitted: TurnAdmitCommand[] = [];
  const activated: any[] = [];
  const worker: RuntimeWorkerPort = {
    async start() { throw new Error("legacy path"); },
    async deliver() { throw new Error("legacy path"); },
    async stop() { throw new Error("legacy path"); },
    async reset() { throw new Error("legacy path"); },
    async admitTurn(command) { admitted.push(command); return { status: "admitted", id: command.commandId, generation: 4 }; },
    activateTurn(command) { activated.push(command); return true; },
    cancelTurn() { return true; },
    async closeTurnSessions(command) { return { status: "admitted", id: command.commandId, generation: 4 }; },
    availability() { return { connected: true, generation: 4 }; },
  };
  const broker = new SessionCapabilityBroker();
  const capabilities = new TurnCapabilityService(f.spaceId, broker, f.db);
  const scheduler = new HarnessTurnScheduler({ runtimeWorker: worker, capabilities: () => capabilities, agentConfig: async () => config(f) });
  try {
    await scheduler.schedule(f.spaceId);
    assert.equal(admitted.length, 1);
    assert.equal(activated.length, 1);
    assert.equal(admitted[0]!.session.surfaceId, f.channelId);
    assert.equal(admitted[0]!.turn.attemptId, admitted[0]!.commandId);
    assert.match(admitted[0]!.turn.context, /@scheduler-agent work/);
    assert.equal((f.db.select().from(schema.agentTurns).all()[0]?.contextEnvelope as any)?.session?.surfaceId, f.channelId);
    assert.equal(f.db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.id, f.deliveryId)).get()?.disposition, "bound");
    assert.equal(f.db.select().from(schema.agentTurns).all()[0]?.status, "running");
    assert.equal(f.db.select().from(schema.agentTurnAttempts).all()[0]?.status, "running");
    assert.equal(f.db.select().from(schema.turnCapabilityActivations).all()[0]?.status, "active");
    const attemptId = admitted[0]!.turn.attemptId;
    const renewedExpiry = new TurnLedger(f.spaceId, f.db).heartbeat(attemptId, "core-worker-4", 120_000);
    assert.equal(capabilities.renewAttempt(attemptId, renewedExpiry).expiresAt, renewedExpiry);
    assert.equal(f.db.select().from(schema.turnCapabilityActivations).all()[0]?.expiresAt.getTime(), renewedExpiry);
    await scheduler.schedule(f.spaceId);
    assert.equal(admitted.length, 1);
  } finally {
    await scheduler.shutdown();
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("expired task-scoped access is revoked before Worker admission or context disclosure", async () => {
  const f = setup();
  const admitted: TurnAdmitCommand[] = [];
  const threadId = randomUUID();
  const delivery = f.db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.id, f.deliveryId)).get()!;
  f.db.update(schema.messages).set({ threadId }).where(eq(schema.messages.id, delivery.messageId)).run();
  f.db.insert(schema.channels).values({ id: threadId, spaceId: f.spaceId, name: "expired-task", type: "thread", parentMessageId: delivery.messageId }).run();
  f.db.delete(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, f.channelId)).run();
  f.db.insert(schema.channelAgentMembers).values({
    channelId: threadId,
    agentId: f.agentId,
    accessKind: "task_scoped",
    taskScope: { taskId: delivery.messageId, allowedObjectIds: [delivery.messageId] },
    accessExpiresAt: new Date(Date.now() - 1_000),
  }).run();
  f.db.update(schema.agentDeliveryItems).set({ targetSurfaceKind: "thread", targetSurfaceId: threadId })
    .where(eq(schema.agentDeliveryItems.id, f.deliveryId)).run();
  const worker: RuntimeWorkerPort = {
    async start() { throw new Error("legacy path"); },
    async deliver() { throw new Error("legacy path"); },
    async stop() { throw new Error("legacy path"); },
    async reset() { throw new Error("legacy path"); },
    async admitTurn(command) { admitted.push(command); return { status: "admitted", id: command.commandId, generation: 4 }; },
    activateTurn() { return true; },
    cancelTurn() { return true; },
    async closeTurnSessions(command) { return { status: "admitted", id: command.commandId, generation: 4 }; },
    availability() { return { connected: true, generation: 4 }; },
  };
  const capabilities = new TurnCapabilityService(f.spaceId, new SessionCapabilityBroker(), f.db);
  const scheduler = new HarnessTurnScheduler({ runtimeWorker: worker, capabilities: () => capabilities, agentConfig: async () => config(f) });
  try {
    await scheduler.schedule(f.spaceId);
    assert.equal(admitted.length, 0);
    assert.equal(f.db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, threadId)).get(), undefined);
    assert.equal(f.db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.surfaceId, threadId)).get()?.status, "disabled");
    assert.equal(f.db.select().from(schema.agentTurns).all()[0]?.status, "cancelled");
    assert.equal(f.db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.id, f.deliveryId)).get()?.disposition, "dismissed");
    assert.equal(f.db.select().from(schema.turnContextSources).all().length, 0);
  } finally {
    await scheduler.shutdown();
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("uncertain admission is not double-dispatched before its lease expires", async () => {
  const f = setup();
  let now = 1_000;
  let calls = 0;
  let configuredRuntime = "claude";
  const worker: RuntimeWorkerPort = {
    async start() { throw new Error("legacy path"); },
    async deliver() { throw new Error("legacy path"); },
    async stop() { throw new Error("legacy path"); },
    async reset() { throw new Error("legacy path"); },
    async admitTurn(command) { calls += 1; throw new WorkerAdmissionUncertainError("timeout", 9, command.commandId); },
    activateTurn() { return false; },
    cancelTurn() { return true; },
    async closeTurnSessions(command) { return { status: "admitted", id: command.commandId, generation: 9 }; },
    availability() { return { connected: true, generation: 9 }; },
  };
  const capabilities = new TurnCapabilityService(f.spaceId, new SessionCapabilityBroker(() => now), f.db, () => now);
  const scheduler = new HarnessTurnScheduler({
    runtimeWorker: worker,
    capabilities: () => capabilities,
    agentConfig: async () => ({ ...config(f), runtime: configuredRuntime }),
    now: () => now,
  });
  try {
    await scheduler.schedule(f.spaceId);
    await scheduler.schedule(f.spaceId);
    assert.equal(calls, 1);
    assert.equal(f.db.select().from(schema.agentTurnAttempts).all()[0]?.status, "claimed");
    now += 100_000;
    await scheduler.schedule(f.spaceId);
    assert.equal(f.db.select().from(schema.agentTurnAttempts).all()[0]?.status, "lost");
    assert.equal(f.db.select().from(schema.agentTurns).all()[0]?.status, "retry_wait");
    assert.equal(f.db.select().from(schema.turnCapabilityActivations).all()[0]?.status, "expired");
    assert.equal(calls, 1);
    configuredRuntime = "codex";
    now += 2_000;
    await scheduler.schedule(f.spaceId);
    assert.equal(f.db.select().from(schema.agentTurns).all()[0]?.status, "cancelled");
    assert.equal(f.db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.id, f.deliveryId)).get()?.disposition, "pending");
    assert.equal(calls, 1);
  } finally {
    await scheduler.shutdown();
    closeSpaceDb(f.spaceId);
    unregisterSpace(f.spaceId);
  }
});

test("scheduler serializes Space batches through one installation-level FIFO", async () => {
  const first = setup();
  const second = setup();
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let firstConfigStarted = false;
  const admittedSpaces: string[] = [];
  const worker: RuntimeWorkerPort = {
    async start() { throw new Error("legacy path"); }, async deliver() { throw new Error("legacy path"); },
    async stop() { throw new Error("legacy path"); }, async reset() { throw new Error("legacy path"); },
    async admitTurn(command) { admittedSpaces.push(command.spaceId); return { status: "admitted", id: command.commandId, generation: 5 }; },
    activateTurn() { return true; }, cancelTurn() { return true; },
    async closeTurnSessions(command) { return { status: "admitted", id: command.commandId, generation: 5 }; },
    availability() { return { connected: true, generation: 5 }; },
  };
  const services = new Map<string, TurnCapabilityService>([
    [first.spaceId, new TurnCapabilityService(first.spaceId, new SessionCapabilityBroker(), first.db)],
    [second.spaceId, new TurnCapabilityService(second.spaceId, new SessionCapabilityBroker(), second.db)],
  ]);
  const scheduler = new HarnessTurnScheduler({
    runtimeWorker: worker,
    capabilities: (spaceId) => services.get(spaceId)!,
    async agentConfig(spaceId) {
      if (spaceId === first.spaceId) {
        firstConfigStarted = true;
        await firstBlocked;
        return config(first);
      }
      return config(second);
    },
  });
  try {
    const firstRun = scheduler.schedule(first.spaceId);
    for (let index = 0; index < 50 && !firstConfigStarted; index += 1) await new Promise((resolve) => setTimeout(resolve, 1));
    const secondRun = scheduler.schedule(second.spaceId);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(admittedSpaces, []);
    releaseFirst();
    await Promise.all([firstRun, secondRun]);
    assert.deepEqual(admittedSpaces, [first.spaceId, second.spaceId]);
  } finally {
    releaseFirst();
    await scheduler.shutdown();
    closeSpaceDb(first.spaceId); unregisterSpace(first.spaceId);
    closeSpaceDb(second.spaceId); unregisterSpace(second.spaceId);
  }
});
