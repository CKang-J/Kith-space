import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { CanvasCore } from "./canvasCore.js";
import {
  authorizeCanvasMutationImpact,
  CanvasAccessGrantError,
} from "./canvasAccessGrant.js";
import { CapabilityGateway } from "../capabilities/capabilityGateway.js";
import { SessionCapabilityBroker } from "../capabilities/sessionCapabilityBroker.js";
import { TurnCapabilityService } from "../capabilities/turnCapabilityService.js";
import { ContextAssembler } from "../context/contextAssembler.js";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { DeliveryJournal } from "../deliveries/deliveryJournal.js";
import { HarnessError } from "../harness/errors.js";
import {
  createConversationModules,
  type ConversationEventSink,
  type WakeDispatchPort,
} from "../messages/messagePostingModule.js";
import { MessageExecutionBindingError } from "../messages/messageExecutionBinding.js";
import { kithSpaceHome } from "../paths.js";
import { TurnInspector } from "../turns/turnInspector.js";
import { TurnOutputService } from "../turns/turnOutputService.js";
import { mapCanvasToolOps } from "./canvasToolOps.js";
import type { CanvasJson } from "./canvasTypes.js";

const scene = {
  width: 800,
  height: 600,
  deltaSetLike: {
    ROOT: { children: ["shape-1", "shape-2"] },
    "shape-1": { id: "shape-1", key: "shape", x: 10, y: 20, width: 100, height: 80, attrs: {}, children: [] },
    "shape-2": { id: "shape-2", key: "shape", x: 140, y: 20, width: 100, height: 80, attrs: {}, children: [] },
  },
  frames: [{ id: "frame-1", name: "Board", x: 0, y: 0, width: 400, height: 300 }],
  stackOrder: ["shape-1", "shape-2"],
};

function posting(wakeIds: string[] = []) {
  const recordDispatch = async (input: Parameters<WakeDispatchPort["dispatch"]>[0]) => {
    wakeIds.push(input.targetAgent.id);
    return { status: "sent" as const };
  };
  const wakeDispatch: WakeDispatchPort = {
    async resolveMessageContext(input) {
      return { chainId: input.messageId, dispatchDepth: 0, taskMessageId: input.taskMessageId };
    },
    async ensureChain() {},
    async prepareTargets() { return { dispatch: recordDispatch }; },
    dispatch: recordDispatch,
  };
  const eventSink: ConversationEventSink = { async publish() {} };
  return {
    wakeIds,
    modules: createConversationModules({
      eventSink,
      wakeDispatch,
      introductionProof: { consume: () => true, complete() {}, restore() {} },
      deliveryJournal: new DeliveryJournal(),
    }),
  };
}

function fixture(label: string) {
  const spaceId = randomUUID();
  const humanId = `human-${spaceId.slice(0, 8)}`;
  registerSpace({
    id: spaceId,
    name: label,
    slug: `${label}-${spaceId.slice(0, 8)}`,
    rootPath: path.join(kithSpaceHome(), "canvas-stage4", spaceId),
  });
  const db = dbForSpace(spaceId);
  const core = new CanvasCore(db, spaceId);
  const canvas = core.create({ title: "Stage4", document: scene });
  return {
    spaceId,
    humanId,
    db,
    core,
    canvas,
    addAgent(name: string) {
      const agent = db.insert(schema.agents).values({
        spaceId,
        name,
        displayName: name,
        runtime: "claude",
        status: "active",
        defaultResponseMode: "active",
      }).returning().get()!;
      db.insert(schema.agentHarnessState).values({ agentId: agent.id, mode: "v2" }).run();
      return agent;
    },
    addChannel(type: "channel" | "dm" | "private" | "thread", name: string, parentMessageId?: string) {
      return db.insert(schema.channels).values({
        spaceId,
        name,
        type,
        parentMessageId: parentMessageId ?? null,
      }).returning().get()!;
    },
    addMember(channelId: string, agentId: string) {
      db.insert(schema.channelAgentMembers).values({ channelId, agentId, lastReadSeq: 0 }).run();
    },
    cleanup() {
      closeSpaceDb(spaceId);
      unregisterSpace(spaceId);
    },
  };
}

async function prepareTurn(input: {
  spaceId: string;
  db: ReturnType<typeof dbForSpace>;
  agentId: string;
  channelId: string;
  surfaceKind: "channel" | "dm" | "thread" | "private";
  messageId: string;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const sessionId = randomUUID();
  const turnId = randomUUID();
  const attemptId = randomUUID();
  input.db.update(schema.agentTurns).set({
    status: "completed",
    outcome: "replied",
    completedAt: new Date(now),
  }).where(and(
    eq(schema.agentTurns.agentId, input.agentId),
    eq(schema.agentTurns.spaceId, input.spaceId),
  )).run();
  input.db.update(schema.runtimeSessions).set({
    retiredAt: new Date(now),
    status: "evicted",
  }).where(and(
    eq(schema.runtimeSessions.agentId, input.agentId),
    eq(schema.runtimeSessions.surfaceId, input.channelId),
    eq(schema.runtimeSessions.spaceId, input.spaceId),
  )).run();
  const sessionGeneration = 1 + (input.db.select({ generation: schema.runtimeSessions.sessionGeneration })
    .from(schema.runtimeSessions)
    .where(and(
      eq(schema.runtimeSessions.agentId, input.agentId),
      eq(schema.runtimeSessions.surfaceId, input.channelId),
    )).all().reduce((max, row) => Math.max(max, row.generation), 0));
  input.db.insert(schema.runtimeSessions).values({
    id: sessionId,
    spaceId: input.spaceId,
    agentId: input.agentId,
    surfaceKind: input.surfaceKind,
    surfaceId: input.channelId,
    sessionGeneration,
    runtime: "claude",
    runtimeConfigFingerprint: "config",
    adapterVersion: "test",
    workspaceRootFingerprint: "root",
    status: "running",
  }).run();
  input.db.insert(schema.agentTurns).values({
    id: turnId,
    runtimeSessionId: sessionId,
    sessionGeneration,
    spaceId: input.spaceId,
    agentId: input.agentId,
    status: "running",
    effectiveDirective: "required",
  }).run();
  const delivery = input.db.select().from(schema.agentDeliveryItems).where(and(
    eq(schema.agentDeliveryItems.messageId, input.messageId),
    eq(schema.agentDeliveryItems.agentId, input.agentId),
  )).get();
  assert.ok(delivery);
  input.db.update(schema.agentDeliveryItems).set({
    turnId,
    disposition: "bound",
    targetRuntimeSessionId: sessionId,
  }).where(eq(schema.agentDeliveryItems.id, delivery.id)).run();
  input.db.insert(schema.agentTurnAttempts).values({
    id: attemptId,
    turnId,
    attemptNo: 1,
    status: "claimed",
    workerGeneration: 1,
    leaseOwner: "test",
    leaseExpiresAt: new Date(now + 60_000),
  }).run();
  const broker = new SessionCapabilityBroker(() => now);
  const caps = new TurnCapabilityService(input.spaceId, broker, input.db, () => now);
  const prepared = caps.prepare(attemptId);
  input.db.update(schema.agentTurnAttempts).set({ status: "running" }).where(eq(schema.agentTurnAttempts.id, attemptId)).run();
  caps.activate(prepared);
  return {
    turnId,
    attemptId,
    sessionId,
    deliveryId: delivery.id,
    claims: prepared.claims,
    gateway: new CapabilityGateway(input.spaceId, input.db, () => now),
    outputs: new TurnOutputService(input.spaceId, { async publish() {} }, input.db, () => now),
    assembled: new ContextAssembler(input.spaceId, input.db, () => now).assemble(turnId, prepared.claims.activationId),
  };
}

test("ToolOps durable subset maps to Core patches while viewport/export/deferred stay out of scene batch", () => {
  const mapped = mapCanvasToolOps(scene as CanvasJson, [
    { op: "update_node", nodeId: "shape-1", x: 42 },
    { op: "set_viewport", x: 1, y: 2, zoom: 1.5 },
  ]);
  assert.equal(mapped.operation?.type, "document.patch");
  assert.deepEqual(mapped.viewport, { x: 1, y: 2, zoom: 1.5 });
  assert.throws(() => mapCanvasToolOps(scene as CanvasJson, [{ op: "export_canvas" }]), /canvas\.export/);
  assert.throws(() => mapCanvasToolOps(scene as CanvasJson, [{ op: "image_process" }]), /deferred/);
  assert.throws(() => mapCanvasToolOps(scene as CanvasJson, [{ op: "outline_text" }]), /deferred/);
});

test("stage4 grant forge/expand/expiry and snapshot authorization fail closed", async () => {
  const f = fixture("grant-deny");
  try {
    const executor = f.addAgent("executor");
    const other = f.addAgent("other");
    const channel = f.addChannel("channel", "studio");
    f.addMember(channel.id, executor.id);
    f.addMember(channel.id, other.id);
    const { modules, wakeIds } = posting();
    const message = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
      executionBinding: { executorAgentId: executor.id, mode: "required" },
    });
    assert.deepEqual(wakeIds, []);
    const frozenNow = Date.now();
    const turn = await prepareTurn({
      spaceId: f.spaceId,
      db: f.db,
      agentId: executor.id,
      channelId: channel.id,
      surfaceKind: "channel",
      messageId: message.id,
      now: frozenNow,
    });
    assert.ok(turn.claims.scopes.includes("canvas.read"));
    assert.ok(turn.claims.scopes.includes("canvas.write"));
    assert.match(turn.assembled.renderedContext, /Canvas skill pack/);
    const grant = f.db.select().from(schema.canvasAccessGrants).where(eq(schema.canvasAccessGrants.turnId, turn.turnId)).get();
    assert.ok(grant);
    assert.equal(grant.executorAgentId, executor.id);
    const snapshot = turn.gateway.canvasSnapshotGet(turn.claims, {
      snapshotId: grant.snapshotId,
      idempotencyKey: "snap-1",
    });
    assert.equal(snapshot.snapshotId, grant.snapshotId);
    assert.throws(() => turn.gateway.canvasSnapshotGet(turn.claims, {
      snapshotId: randomUUID(),
      idempotencyKey: "snap-forge",
    }), HarnessError);
    assert.throws(() => turn.gateway.canvasElementsApply(turn.claims, {
      expectedRevision: f.core.read(f.canvas.id).revisions.revision,
      operations: [{ op: "update_node", nodeId: "shape-2", x: 99 }],
      idempotencyKey: "expand-element",
    }), HarnessError);
    f.db.update(schema.canvasAccessGrants).set({ expiresAt: new Date(frozenNow - 1) })
      .where(eq(schema.canvasAccessGrants.id, grant.id)).run();
    assert.throws(() => turn.gateway.canvasSnapshotGet(turn.claims, {
      snapshotId: grant.snapshotId,
      idempotencyKey: "snap-expired",
    }), /expired|capability_expired/);
  } finally {
    f.cleanup();
  }
});

test("stage4 same-key replay, payload conflict, CAS, batch rollback, revoke/delete, mutation-reply recovery", async () => {
  const f = fixture("mutation-loop");
  try {
    const executor = f.addAgent("executor");
    const channel = f.addChannel("channel", "loop");
    f.addMember(channel.id, executor.id);
    const { modules } = posting();
    const message = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "edit",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1", "shape-2"] },
      executionBinding: { executorAgentId: executor.id, mode: "required" },
      structuredMentions: [{ type: "agent", id: executor.id }],
    });
    const binding = f.db.select().from(schema.messageExecutionBindings).where(eq(schema.messageExecutionBindings.messageId, message.id)).get();
    assert.equal(binding?.bindingSource, "explicit_picker");
    const turn = await prepareTurn({
      spaceId: f.spaceId,
      db: f.db,
      agentId: executor.id,
      channelId: channel.id,
      surfaceKind: "channel",
      messageId: message.id,
    });
    const baseRevision = f.core.read(f.canvas.id).revisions.revision;
    const first = turn.gateway.canvasElementsApply(turn.claims, {
      expectedRevision: baseRevision,
      operations: [{ op: "update_node", nodeId: "shape-1", x: 55 }],
      idempotencyKey: "apply:shape-1",
    });
    assert.ok(first.mutationId);
    const replay = turn.gateway.canvasElementsApply(turn.claims, {
      expectedRevision: baseRevision,
      operations: [{ op: "update_node", nodeId: "shape-1", x: 55 }],
      idempotencyKey: "apply:shape-1",
    });
    assert.equal(replay.mutationId, first.mutationId);
    assert.throws(() => turn.gateway.canvasElementsApply(turn.claims, {
      expectedRevision: baseRevision,
      operations: [{ op: "update_node", nodeId: "shape-1", x: 56 }],
      idempotencyKey: "apply:shape-1",
    }), /idempotency/);
    const afterFirst = f.core.read(f.canvas.id).revisions.revision;
    assert.throws(() => turn.gateway.canvasElementsApply(turn.claims, {
      expectedRevision: baseRevision,
      operations: [{ op: "update_node", nodeId: "shape-1", x: 200 }],
      idempotencyKey: "apply:stale-cas",
    }), /conflict|capability_scope_denied/);
    assert.throws(() => turn.gateway.canvasElementsApply(turn.claims, {
      expectedRevision: afterFirst,
      operations: [
        { op: "update_node", nodeId: "shape-1", x: 70 },
        { op: "delete_nodes", ids: ["shape-2"] },
      ],
      idempotencyKey: "apply:batch-no-confirm",
    }), /confirmDestructive|capability_scope_denied/);
    assert.equal((f.core.read(f.canvas.id).document as { deltaSetLike: Record<string, unknown> }).deltaSetLike["shape-2"] != null, true);
    const batch = turn.gateway.canvasElementsApply(turn.claims, {
      expectedRevision: afterFirst,
      operations: [
        { op: "update_node", nodeId: "shape-1", x: 70 },
        { op: "update_node", nodeId: "shape-2", y: 88 },
      ],
      idempotencyKey: "apply:batch-ok",
    });
    assert.ok(batch.mutationId);
    await turn.outputs.reply({
      turnId: turn.turnId,
      attemptId: turn.attemptId,
      idempotencyKey: "reply:primary",
      body: "updated layout",
      handledInputIds: [turn.deliveryId],
      outputRefs: [{ kind: "canvas_mutation", artifactId: String(batch.mutationId) }],
    });
    const inspected = new TurnInspector(f.spaceId, f.db).inspect(turn.turnId);
    assert.equal(inspected?.outputs[0]?.artifacts?.[0]?.artifactId, batch.mutationId);
    assert.equal(inspected?.canvasArtifacts?.bound?.[0]?.mutationId, batch.mutationId);

    const crashMessage = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "again",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
      executionBinding: { executorAgentId: executor.id, mode: "required" },
    });
    const crashTurn = await prepareTurn({
      spaceId: f.spaceId,
      db: f.db,
      agentId: executor.id,
      channelId: channel.id,
      surfaceKind: "channel",
      messageId: crashMessage.id,
      now: Date.now() + 1,
    });
    const crashRevision = f.core.read(f.canvas.id).revisions.revision;
    const crashApply = crashTurn.gateway.canvasElementsApply(crashTurn.claims, {
      expectedRevision: crashRevision,
      operations: [{ op: "update_node", nodeId: "shape-1", x: 12 }],
      idempotencyKey: "apply:crash",
    });
    const beforeReply = new TurnInspector(f.spaceId, f.db).inspect(crashTurn.turnId);
    assert.equal(beforeReply?.canvasArtifacts?.unattachedCommitted?.[0]?.mutationId, crashApply.mutationId);
    const recovered = crashTurn.gateway.canvasElementsApply(crashTurn.claims, {
      expectedRevision: crashRevision,
      operations: [{ op: "update_node", nodeId: "shape-1", x: 12 }],
      idempotencyKey: "apply:crash",
    });
    assert.equal(recovered.mutationId, crashApply.mutationId);
    await crashTurn.outputs.reply({
      turnId: crashTurn.turnId,
      attemptId: crashTurn.attemptId,
      idempotencyKey: "reply:crash",
      body: "recovered",
      handledInputIds: [crashTurn.deliveryId],
      outputRefs: [{ kind: "canvas_mutation", artifactId: String(crashApply.mutationId) }],
    });

    f.db.update(schema.canvasAccessGrants).set({ revokedAt: new Date() })
      .where(eq(schema.canvasAccessGrants.turnId, crashTurn.turnId)).run();
    assert.throws(() => crashTurn.gateway.canvasElementsApply(crashTurn.claims, {
      expectedRevision: f.core.read(f.canvas.id).revisions.revision,
      operations: [{ op: "update_node", nodeId: "shape-1", x: 1 }],
      idempotencyKey: "apply:revoked",
    }), /revoked|capability/);

    const deleteMessage = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "delete canvas path",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
      executionBinding: { executorAgentId: executor.id, mode: "required" },
    });
    const deleteTurn = await prepareTurn({
      spaceId: f.spaceId,
      db: f.db,
      agentId: executor.id,
      channelId: channel.id,
      surfaceKind: "channel",
      messageId: deleteMessage.id,
      now: Date.now() + 2,
    });
    const live = f.core.read(f.canvas.id);
    f.core.delete(f.canvas.id, randomUUID(), live.revisions.revision);
    assert.throws(() => deleteTurn.gateway.canvasElementsApply(deleteTurn.claims, {
      expectedRevision: live.revisions.revision,
      operations: [{ op: "update_node", nodeId: "shape-1", x: 3 }],
      idempotencyKey: "apply:deleted-canvas",
    }), /inactive|revoked|capability/);
  } finally {
    f.cleanup();
  }
});

test("stage4 DM/channel/thread executor rules, structured mention, and no optional wake", async () => {
  const f = fixture("executor-rules");
  try {
    const peer = f.addAgent("peer");
    const other = f.addAgent("other");
    const dm = f.addChannel("dm", `dm:${peer.id}`);
    f.addMember(dm.id, peer.id);
    f.db.insert(schema.humanChannelStates).values({ channelId: dm.id, dmAgentId: peer.id, updatedAt: new Date() }).run();
    const { modules, wakeIds } = posting();
    const dmMessage = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: dm.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "dm canvas",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
    });
    const dmBinding = f.db.select().from(schema.messageExecutionBindings).where(eq(schema.messageExecutionBindings.messageId, dmMessage.id)).get();
    assert.equal(dmBinding?.bindingSource, "dm_peer");
    assert.equal(dmBinding?.executorAgentId, peer.id);
    assert.deepEqual(wakeIds, []);

    const channel = f.addChannel("channel", "room");
    f.addMember(channel.id, peer.id);
    f.addMember(channel.id, other.id);
    const channelWakes: string[] = [];
    const mentionMessage = await posting(channelWakes).modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "@other hello",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
      structuredMentions: [{ type: "agent", id: peer.id }],
    });
    const mentionBinding = f.db.select().from(schema.messageExecutionBindings)
      .where(eq(schema.messageExecutionBindings.messageId, mentionMessage.id)).get();
    assert.equal(mentionBinding?.bindingSource, "structured_mention");
    assert.equal(mentionBinding?.executorAgentId, peer.id);
    assert.deepEqual(channelWakes, []);
    const deliveries = f.db.select().from(schema.agentDeliveryItems)
      .where(eq(schema.agentDeliveryItems.messageId, mentionMessage.id)).all();
    assert.deepEqual(deliveries.map((row) => [row.agentId, row.directive]), [[peer.id, "required"]]);

    await assert.rejects(() => modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "@all",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
      executionBinding: { executorAgentId: peer.id, mode: "required" },
    }), MessageExecutionBindingError);

    await assert.rejects(() => modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
      executionBinding: { executorAgentId: peer.id, mode: "required" },
      structuredMentions: [{ type: "agent", id: other.id }],
    }), /do not match/);

    await assert.rejects(() => modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "",
      canvasSelections: [
        { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
        { canvasId: randomUUID(), selectedIds: ["shape-1"] },
      ],
      executionBinding: { executorAgentId: peer.id, mode: "required" },
    }), /one Canvas/);
  } finally {
    f.cleanup();
  }
});

test("authorizeCanvasMutationImpact rejects whole-canvas read-only grants", () => {
  assert.throws(() => authorizeCanvasMutationImpact({
    id: "g",
    spaceId: "s",
    messageId: "m",
    snapshotId: "snap",
    deliveryId: "d",
    turnId: "t",
    executorAgentId: "a",
    canvasId: "c",
    objectScope: {
      snapshotId: "snap",
      canvasId: "c",
      elementIds: [],
      frameIds: [],
      emptySelection: true,
      createParents: [],
    },
    actions: ["read_snapshot"],
    expiresAt: new Date(Date.now() + 1000),
    revokedAt: null,
    createdAt: new Date(),
  }, {
    metadata: false,
    document: true,
    element: true,
    frame: false,
    structure: false,
    elementIds: ["shape-1"],
    frameIds: [],
    readResources: ["element:shape-1"],
    writeResources: ["element:shape-1"],
  }), CanvasAccessGrantError);
});
