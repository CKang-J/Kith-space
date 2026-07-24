import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { SessionCapabilityBroker } from "../capabilities/sessionCapabilityBroker.js";
import { TurnCapabilityService } from "../capabilities/turnCapabilityService.js";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import type { RuntimeWorkerPort, TurnAdmitCommand } from "../runtime/contract/runtimeWorkerPort.js";
import { turnDispatchAdapter } from "../server/turnDispatchAdapter.js";
import { DurableTurnRecovery, type DurableTurnRecoveryTimer } from "./durableTurnRecovery.js";
import { HarnessTurnScheduler } from "./turnScheduler.js";
import { RuntimeProfileService } from "../model-control/runtimeProfileService.js";
import { runtimeConfigurationEpochGate } from "../runtime/config/runtimeConfigurationEpochGate.js";
import { appDataConnection } from "../app-data/appDatabase.js";
import { AgentModelBindingService } from "../model-control/agentModelBindingService.js";

function controlledTimer() {
  let callback: (() => void) | null = null;
  let intervalMs = 0;
  let clears = 0;
  const handle = {} as ReturnType<typeof setInterval>;
  const timer: DurableTurnRecoveryTimer = {
    setInterval(next, ms) {
      callback = next;
      intervalMs = ms;
      return handle;
    },
    clearInterval(received) {
      assert.equal(received, handle);
      clears += 1;
      callback = null;
    },
  };
  return {
    timer,
    get callback() { return callback; },
    get intervalMs() { return intervalMs; },
    get clears() { return clears; },
  };
}

test("recovery scans on startup and periodically while one unavailable Space fails open", async () => {
  const clock = controlledTimer();
  const calls: string[] = [];
  let periodicDone!: () => void;
  const periodic = new Promise<void>((resolve) => { periodicDone = resolve; });
  const recovery = new DurableTurnRecovery({
    listSpaceIds: () => ["missing", "ready", "ready"],
    async recoverSpace(spaceId) {
      calls.push(spaceId);
      if (spaceId === "missing") throw new Error("Space root is unavailable");
      if (calls.filter((item) => item === "ready").length === 2) periodicDone();
    },
    timer: clock.timer,
  });

  const startup = await recovery.start();
  assert.deepEqual(startup, { skipped: false, attempted: 2, recovered: 1, failed: 1 });
  assert.deepEqual(calls, ["missing", "ready"]);
  assert.equal(clock.intervalMs, 5_000);

  clock.callback?.();
  await periodic;
  assert.deepEqual(calls, ["missing", "ready", "missing", "ready"]);
  recovery.stop();
  assert.equal(clock.clears, 1);
  clock.callback?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["missing", "ready", "missing", "ready"], "a cleared timer cannot schedule another tick");
});

test("recovery skips a reentrant tick until the active scan settles", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const recovery = new DurableTurnRecovery({
    listSpaceIds: () => ["space"],
    recoverSpace: async () => blocked,
  });

  const first = recovery.tick();
  assert.deepEqual(await recovery.tick(), { skipped: true, attempted: 0, recovered: 0, failed: 0 });
  release();
  assert.deepEqual(await first, { skipped: false, attempted: 1, recovered: 1, failed: 0 });
});

test("periodic recovery closes the post-commit kill window without duplicating wake budget or logical work", async () => {
  appDataConnection().prepare(`
    UPDATE runtime_profiles
    SET default_binding_mode = 'unmanaged_cli_native',
        default_model_configuration_id = NULL,
        default_model_configuration_revision = NULL
    WHERE runtime_id = 'claude'
  `).run();
  const binding = new AgentModelBindingService().resolve("claude", { mode: "runtime_default" });
  runtimeConfigurationEpochGate.open(new RuntimeProfileService().runtimeConfigurationEpoch());
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const messageId = randomUUID();
  const deliveryId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "durable-turn-recovery", spaceId);
  registerSpace({ id: spaceId, name: "Recovery", slug: `recovery-${spaceId}`, rootPath });
  const db = dbForSpace(spaceId);
  db.insert(schema.agents).values({
    id: agentId, spaceId, name: "recovery-agent", displayName: "Recovery Agent", runtime: "claude", status: "active",
    ...binding,
  }).run();
  db.insert(schema.channels).values({ id: channelId, spaceId, name: "recovery", type: "channel" }).run();
  db.insert(schema.channelAgentMembers).values({ channelId, agentId, lastReadSeq: 0 }).run();
  db.insert(schema.agentHarnessState).values({ agentId, mode: "v2" }).run();
  db.insert(schema.messages).values({
    id: messageId, seq: 1, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human",
    content: "@recovery-agent recover committed work",
  }).run();
  db.insert(schema.agentDeliveryItems).values({
    id: deliveryId, spaceId, agentId, messageId, sourceChannelId: channelId, sourceSeq: 1,
    cursorOwnerChannelId: channelId, targetSurfaceKind: "channel", targetSurfaceId: channelId,
    directive: "required", reason: "direct_mention", policySnapshot: {}, disposition: "pending",
  }).run();

  const admitted: TurnAdmitCommand[] = [];
  const worker: RuntimeWorkerPort = {
    async start() { throw new Error("legacy path"); },
    async deliver() { throw new Error("legacy path"); },
    async stop() { throw new Error("legacy path"); },
    async reset() { throw new Error("legacy path"); },
    async admitTurn(command) { admitted.push(command); return { status: "admitted", id: command.commandId, generation: 9 }; },
    activateTurn() { return true; },
    cancelTurn() { return true; },
    async closeTurnSessions(command) { return { status: "admitted", id: command.commandId, generation: 9 }; },
    availability() { return { connected: true, generation: 9 }; },
  };
  const capabilities = new TurnCapabilityService(spaceId, new SessionCapabilityBroker(), db);
  const scheduler = new HarnessTurnScheduler({
    runtimeWorker: worker,
    capabilities: () => capabilities,
    dispatch: turnDispatchAdapter,
    agentConfig: async () => ({
      agentId, spaceId, workspaceRoot: rootPath, name: "recovery-agent", displayName: "Recovery Agent",
      runtime: "claude", serverUrl: "http://127.0.0.1:7777",
    }),
  });
  const recovery = new DurableTurnRecovery({ listSpaceIds: () => [spaceId], recoverSpace: (id) => scheduler.schedule(id) });
  try {
    await recovery.tick();
    assert.equal(admitted.length, 1);
    assert.equal(db.select().from(schema.agentTurns).all().length, 1);
    assert.equal(db.select().from(schema.agentTurnAttempts).all().length, 1);
    assert.equal(db.select().from(schema.dispatchWakes).all().length, 1);
    assert.equal(db.select().from(schema.dispatchChains).where(eq(schema.dispatchChains.id, messageId)).get()?.wakeCount, 1);
    assert.equal(db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.id, deliveryId)).get()?.disposition, "bound");

    await recovery.tick();
    assert.equal(admitted.length, 1, "the running logical turn is not admitted twice");
    assert.equal(db.select().from(schema.agentTurns).all().length, 1);
    assert.equal(db.select().from(schema.agentTurnAttempts).all().length, 1);
    assert.equal(db.select().from(schema.dispatchWakes).all().length, 1);
    assert.equal(db.select().from(schema.dispatchChains).where(eq(schema.dispatchChains.id, messageId)).get()?.wakeCount, 1);
  } finally {
    recovery.stop();
    await scheduler.shutdown();
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
