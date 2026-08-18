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

const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

test("stage4 review fixes: multi-grant snapshotId, background auth, reorder, renew, asset import, inspector", async () => {
  const f = fixture("stage4-review");
  try {
    const executor = f.addAgent("executor");
    const channel = f.addChannel("channel", "review");
    f.addMember(channel.id, executor.id);
    const { modules } = posting();

    // Two selections on the same Canvas → two grants; ambiguous resolve must require snapshotId.
    const message = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "multi",
      canvasSelections: [
        { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
        { canvasId: f.canvas.id, selectedIds: ["shape-2"] },
      ],
      executionBinding: { executorAgentId: executor.id, mode: "required" },
    });
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
    const grants = f.db.select().from(schema.canvasAccessGrants)
      .where(eq(schema.canvasAccessGrants.turnId, turn.turnId)).all();
    assert.equal(grants.length, 2);
    assert.ok(grants.every((grant) => grant.actions.includes("import")));
    assert.ok(grants.every((grant) => !grant.actions.includes("set_canvas_background")));

    assert.throws(() => turn.gateway.canvasElementsGet(turn.claims, {
      canvasId: f.canvas.id,
      idempotencyKey: "ambiguous-grant",
    }), /snapshotId is required|capability_scope_denied/);

    const first = turn.gateway.canvasElementsGet(turn.claims, {
      canvasId: f.canvas.id,
      snapshotId: grants[0]!.snapshotId,
      idempotencyKey: "grant-a",
    });
    assert.equal(first.snapshotId, grants[0]!.snapshotId);
    const second = turn.gateway.canvasElementsGet(turn.claims, {
      canvasId: f.canvas.id,
      snapshotId: grants[1]!.snapshotId,
      idempotencyKey: "grant-b",
    });
    assert.equal(second.snapshotId, grants[1]!.snapshotId);
    assert.notEqual(first.snapshotId, second.snapshotId);

    // Partial selection cannot set_canvas_background (action never signed).
    assert.throws(() => turn.gateway.canvasElementsApply(turn.claims, {
      snapshotId: grants[0]!.snapshotId,
      expectedRevision: f.core.read(f.canvas.id).revisions.revision,
      operations: [{ op: "set_canvas_background", background: "#112233" }],
      idempotencyKey: "bg-deny",
    }), /set_canvas_background|capability_scope_denied/);

    // Explicit whole-canvas write grant (injected) may set background; product does not issue these yet.
    const wholeGrant = grants[0]!;
    f.db.update(schema.canvasAccessGrants).set({
      actions: ["read_snapshot", "read_live", "set_canvas_background"],
      objectScope: {
        ...wholeGrant.objectScope,
        emptySelection: true,
        elementIds: [],
        frameIds: [],
        createParents: [],
      },
    }).where(eq(schema.canvasAccessGrants.id, wholeGrant.id)).run();
    const bg = turn.gateway.canvasElementsApply(turn.claims, {
      snapshotId: wholeGrant.snapshotId,
      expectedRevision: f.core.read(f.canvas.id).revisions.revision,
      operations: [{ op: "set_canvas_background", background: "#112233" }],
      idempotencyKey: "bg-allow",
    });
    assert.ok(bg.mutationId);
    // Restore a partial-selection grant for reorder/import tests on the other grant.
    const partial = grants[1]!;
    assert.equal(partial.objectScope.emptySelection, false);

    // Partial reorder of authorized node succeeds even though stack contains unauthorized neighbors.
    const beforeReorder = f.core.read(f.canvas.id).revisions.revision;
    const reordered = turn.gateway.canvasElementsApply(turn.claims, {
      snapshotId: partial.snapshotId,
      expectedRevision: beforeReorder,
      operations: [{ op: "reorder_nodes", ids: ["shape-2"] }],
      idempotencyKey: "reorder-ok",
    });
    assert.ok(reordered.mutationId);
    assert.throws(() => turn.gateway.canvasElementsApply(turn.claims, {
      snapshotId: partial.snapshotId,
      expectedRevision: f.core.read(f.canvas.id).revisions.revision,
      operations: [{ op: "reorder_nodes", ids: ["shape-1"] }],
      idempotencyKey: "reorder-deny",
    }), /outside the grant|capability_scope_denied/);
    assert.throws(() => turn.gateway.canvasElementsApply(turn.claims, {
      snapshotId: partial.snapshotId,
      expectedRevision: beforeReorder,
      operations: [{ op: "reorder_nodes", ids: ["shape-2"] }],
      idempotencyKey: "reorder-cas",
    }), /conflict|capability_scope_denied|idempotency/);

    // RenewAttempt extends live grant expiry; revoked grants stay revoked.
    const caps = new TurnCapabilityService(f.spaceId, new SessionCapabilityBroker(() => frozenNow + 30_000), f.db, () => frozenNow + 30_000);
    // Re-bind broker handle by preparing through the existing activation path isn't available;
    // use the turn's capability service from prepareTurn by renewing via a fresh service that
    // shares DB state — renew needs the in-memory broker handle. Rebuild from prepareTurn's gateway path:
    const attempt = f.db.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, turn.attemptId)).get()!;
    const newLease = frozenNow + 120_000;
    f.db.update(schema.agentTurnAttempts).set({ leaseExpiresAt: new Date(newLease) })
      .where(eq(schema.agentTurnAttempts.id, attempt.id)).run();

    // Use the same TurnCapabilityService instance that holds the broker handle.
    const broker = new SessionCapabilityBroker(() => frozenNow);
    const renewService = new TurnCapabilityService(f.spaceId, broker, f.db, () => frozenNow);
    // Re-open session handle by prepare is blocked (grants already exist). Manually open + renew path:
    // The prepareTurn already activated via a different broker. Re-activate on renewService:
    const activation = f.db.select().from(schema.turnCapabilityActivations)
      .where(eq(schema.turnCapabilityActivations.attemptId, turn.attemptId)).get()!;
    const handle = broker.openSession({
      sessionId: turn.sessionId,
      sessionGeneration: turn.claims.sessionGeneration,
      spaceId: f.spaceId,
      agentId: executor.id,
    });
    broker.activate(handle, { ...turn.claims, expiresAt: frozenNow + 60_000 });
    // Point renewService handles map via prepare-like side channel: renewAttempt reads this.handles
    (renewService as unknown as { handles: Map<string, string> }).handles.set(turn.sessionId, handle);

    f.db.update(schema.canvasAccessGrants).set({ revokedAt: new Date(frozenNow) })
      .where(eq(schema.canvasAccessGrants.id, wholeGrant.id)).run();
    const liveBefore = f.db.select().from(schema.canvasAccessGrants)
      .where(eq(schema.canvasAccessGrants.id, partial.id)).get()!;
    renewService.renewAttempt(turn.attemptId, newLease);
    const liveAfter = f.db.select().from(schema.canvasAccessGrants)
      .where(eq(schema.canvasAccessGrants.id, partial.id)).get()!;
    const revokedAfter = f.db.select().from(schema.canvasAccessGrants)
      .where(eq(schema.canvasAccessGrants.id, wholeGrant.id)).get()!;
    assert.equal(liveAfter.expiresAt.getTime(), newLease);
    assert.ok(revokedAfter.revokedAt);
    assert.notEqual(revokedAfter.expiresAt.getTime(), newLease);
    assert.ok(liveBefore.expiresAt.getTime() < newLease);

    // Asset import: message-bound attachment succeeds; foreign attachment / URL denied.
    const { saveObject } = await import("../files/localObjectStorage.js");
    const { Readable } = await import("node:stream");
    const saved = await saveObject(f.spaceId, "shot.png", Readable.from([PNG_BYTES]));
    const attachment = f.db.insert(schema.attachments).values({
      spaceId: f.spaceId,
      messageId: message.id,
      channelId: channel.id,
      uploaderType: "human",
      uploaderId: f.humanId,
      filename: "shot.png",
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.length,
      storageKey: saved.key,
    }).returning().get()!;
    const foreign = f.db.insert(schema.attachments).values({
      spaceId: f.spaceId,
      messageId: null,
      channelId: channel.id,
      uploaderType: "human",
      uploaderId: f.humanId,
      filename: "other.png",
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.length,
      storageKey: saved.key,
    }).returning().get()!;

    // Refresh claims scopes to include canvas.import (already present from grant actions).
    assert.ok(turn.claims.scopes.includes("canvas.import"));
    const imported = turn.gateway.canvasAssetImport(turn.claims, {
      snapshotId: partial.snapshotId,
      attachmentId: attachment.id,
      idempotencyKey: "import-ok",
    });
    assert.ok(imported.assetId);
    const replay = turn.gateway.canvasAssetImport(turn.claims, {
      snapshotId: partial.snapshotId,
      attachmentId: attachment.id,
      idempotencyKey: "import-ok",
    });
    assert.equal(replay.assetId, imported.assetId);
    assert.throws(() => turn.gateway.canvasAssetImport(turn.claims, {
      snapshotId: partial.snapshotId,
      attachmentId: attachment.id,
      idempotencyKey: "import-ok",
      // different payload under same key
      canvasId: f.canvas.id,
    } as never), /idempotency/);
    // Force conflict with different attachment under same key via second call with same key different body:
    assert.throws(() => turn.gateway.canvasAssetImport(turn.claims, {
      snapshotId: partial.snapshotId,
      attachmentId: foreign.id,
      idempotencyKey: "import-ok",
    }), /idempotency/);
    assert.throws(() => turn.gateway.canvasAssetImport(turn.claims, {
      snapshotId: partial.snapshotId,
      attachmentId: foreign.id,
      idempotencyKey: "import-foreign",
    }), /not bound|capability_scope_denied/);
    assert.throws(() => turn.gateway.canvasAssetImport(turn.claims, {
      snapshotId: partial.snapshotId,
      url: "https://example.invalid/x.png",
      idempotencyKey: "import-url",
    }), /remote|capability_scope_denied/);
    assert.throws(() => turn.gateway.canvasAssetImport(turn.claims, {
      snapshotId: partial.snapshotId,
      dataUrl: "data:image/png;base64,AAAA",
      idempotencyKey: "import-data",
    }), /remote|capability_scope_denied/);

    // Failure cleanup: invalid mime leaves no ready canvas asset for a fresh key.
    const badSaved = await saveObject(f.spaceId, "bad.bin", Readable.from([Buffer.from("not-an-image")]));
    const badAttachment = f.db.insert(schema.attachments).values({
      spaceId: f.spaceId,
      messageId: message.id,
      channelId: channel.id,
      uploaderType: "human",
      uploaderId: f.humanId,
      filename: "bad.bin",
      mimeType: "application/octet-stream",
      sizeBytes: 11,
      storageKey: badSaved.key,
    }).returning().get()!;
    const readyBefore = f.db.select().from(schema.canvasAssets)
      .where(eq(schema.canvasAssets.canvasId, f.canvas.id)).all()
      .filter((row) => row.state === "ready").length;
    assert.throws(() => turn.gateway.canvasAssetImport(turn.claims, {
      snapshotId: partial.snapshotId,
      attachmentId: badAttachment.id,
      idempotencyKey: "import-bad",
    }), /not allowed|capability_scope_denied|Canvas asset/);
    const readyAfter = f.db.select().from(schema.canvasAssets)
      .where(eq(schema.canvasAssets.canvasId, f.canvas.id)).all()
      .filter((row) => row.state === "ready").length;
    assert.equal(readyAfter, readyBefore);

    // Context bundle + Turn Inspector bound/unattached.
    const bundle = turn.gateway.canvasContextBundleCreate(turn.claims, {
      snapshotId: partial.snapshotId,
      idempotencyKey: "bundle-1",
    }) as { bundle: { snapshot: { snapshotId: string } } };
    assert.equal(bundle.bundle.snapshot.snapshotId, partial.snapshotId);
    const inspected = new TurnInspector(f.spaceId, f.db).inspect(turn.turnId);
    assert.ok(inspected);
    assert.ok(Array.isArray(inspected!.canvasArtifacts.unattachedCommitted));
    assert.ok(inspected!.canvasArtifacts.unattachedCommitted.length >= 1);
  } finally {
    f.cleanup();
  }
});

function withCanvasAgentExecutionFlag<T>(value: string | undefined, run: () => Promise<T> | T): Promise<T> {
  const previous = process.env.KITH_CANVAS_AGENT_EXECUTION;
  if (value === undefined) delete process.env.KITH_CANVAS_AGENT_EXECUTION;
  else process.env.KITH_CANVAS_AGENT_EXECUTION = value;
  return Promise.resolve().then(run).finally(() => {
    if (previous === undefined) delete process.env.KITH_CANVAS_AGENT_EXECUTION;
    else process.env.KITH_CANVAS_AGENT_EXECUTION = previous;
  });
}

test("stage4 prepare→activate→capability.describe→snapshot_get/elements_apply success path", async () => {
  const f = fixture("auth-success");
  try {
    const executor = f.addAgent("executor");
    const channel = f.addChannel("channel", "poster");
    f.addMember(channel.id, executor.id);
    const { modules } = posting();
    const message = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "draw a poster",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
      executionBinding: { executorAgentId: executor.id, mode: "required" },
    });
    const turn = await prepareTurn({
      spaceId: f.spaceId,
      db: f.db,
      agentId: executor.id,
      channelId: channel.id,
      surfaceKind: "channel",
      messageId: message.id,
    });
    const described = turn.gateway.capabilityDescribe(turn.claims);
    assert.ok(described.scopes.includes("canvas.read"));
    assert.ok(described.scopes.includes("canvas.write"));
    assert.ok(described.scopes.includes("canvas.import"));
    assert.ok(described.scopes.includes("canvas.export"));
    assert.deepEqual(described.scopes, turn.claims.scopes);
    const grant = f.db.select().from(schema.canvasAccessGrants).where(eq(schema.canvasAccessGrants.turnId, turn.turnId)).get();
    assert.ok(grant);
    const snapshot = turn.gateway.canvasSnapshotGet(turn.claims, {
      snapshotId: grant.snapshotId,
      idempotencyKey: "poster-snap",
    });
    assert.equal(snapshot.snapshotId, grant.snapshotId);
    const applied = turn.gateway.canvasElementsApply(turn.claims, {
      snapshotId: grant.snapshotId,
      expectedRevision: f.core.read(f.canvas.id).revisions.revision,
      operations: [{ op: "update_node", nodeId: "shape-1", x: 33 }],
      idempotencyKey: "poster-apply",
    });
    assert.ok(applied.mutationId);
  } finally {
    f.cleanup();
  }
});

test("stage4 canvas agent execution flag off stays fail-closed", async () => {
  const f = fixture("flag-off");
  try {
    const executor = f.addAgent("executor");
    const channel = f.addChannel("channel", "closed");
    f.addMember(channel.id, executor.id);
    const { modules } = posting();
    const message = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "closed",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
      executionBinding: { executorAgentId: executor.id, mode: "required" },
    });
    const turn = await withCanvasAgentExecutionFlag("0", async () => prepareTurn({
      spaceId: f.spaceId,
      db: f.db,
      agentId: executor.id,
      channelId: channel.id,
      surfaceKind: "channel",
      messageId: message.id,
    }));
    assert.equal(turn.claims.scopes.includes("canvas.read"), false);
    assert.equal(turn.claims.scopes.includes("canvas.write"), false);
    const grants = f.db.select().from(schema.canvasAccessGrants).where(eq(schema.canvasAccessGrants.turnId, turn.turnId)).all();
    assert.equal(grants.length, 0);
    const described = turn.gateway.capabilityDescribe(turn.claims);
    assert.equal(described.scopes.includes("canvas.read"), false);
    assert.throws(() => turn.gateway.canvasSnapshotGet(turn.claims, {
      snapshotId: randomUUID(),
      idempotencyKey: "flag-off-snap",
    }), /activation does not allow canvas\.read|capability_scope_denied/);
  } finally {
    f.cleanup();
  }
});

test("stage4 without bound canvas snapshot or required executor denies canvas scopes", async () => {
  const f = fixture("no-grant-binding");
  try {
    const executor = f.addAgent("executor");
    const channel = f.addChannel("channel", "plain");
    f.addMember(channel.id, executor.id);
    const { modules } = posting();
    const message = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "plain chat without canvas",
      structuredMentions: [{ type: "agent", id: executor.id }],
    });
    const binding = f.db.select().from(schema.messageExecutionBindings)
      .where(eq(schema.messageExecutionBindings.messageId, message.id)).get();
    assert.equal(binding, undefined);
    const snapshots = f.db.select().from(schema.canvasSelectionSnapshots)
      .where(eq(schema.canvasSelectionSnapshots.messageId, message.id)).all();
    assert.equal(snapshots.length, 0);
    const turn = await prepareTurn({
      spaceId: f.spaceId,
      db: f.db,
      agentId: executor.id,
      channelId: channel.id,
      surfaceKind: "channel",
      messageId: message.id,
    });
    assert.equal(turn.claims.scopes.includes("canvas.read"), false);
    assert.equal(f.db.select().from(schema.canvasAccessGrants)
      .where(eq(schema.canvasAccessGrants.turnId, turn.turnId)).all().length, 0);
    assert.throws(() => turn.gateway.canvasSnapshotGet(turn.claims, {
      snapshotId: randomUUID(),
      idempotencyKey: "no-grant-snap",
    }), /activation does not allow canvas\.read|capability_scope_denied/);
    assert.throws(() => turn.gateway.canvasElementsApply(turn.claims, {
      expectedRevision: f.core.read(f.canvas.id).revisions.revision,
      operations: [{ op: "update_node", nodeId: "shape-1", x: 1 }],
      idempotencyKey: "no-grant-apply",
    }), /activation does not allow canvas\.write|capability_scope_denied/);
  } finally {
    f.cleanup();
  }
});
