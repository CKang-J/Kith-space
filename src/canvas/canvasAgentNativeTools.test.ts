import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { CapabilityGateway } from "../capabilities/capabilityGateway.js";
import {
  CanvasAlignNodesCommandSchema,
  CanvasBooleanOpCommandSchema,
  CanvasCreateFrameCommandSchema,
  CanvasCreateImageCommandSchema,
  CanvasCreateShapeCommandSchema,
  CanvasCreateTextCommandSchema,
  CanvasDeleteNodesCommandSchema,
  CanvasSceneSummaryCommandSchema,
  CanvasUpdateFrameCommandSchema,
  CanvasUpdateNodeCommandSchema,
} from "../capabilities/gatewayContracts.js";
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
import { kithSpaceHome } from "../paths.js";
import { TurnInspector } from "../turns/turnInspector.js";
import { TurnOutputService } from "../turns/turnOutputService.js";
import {
  CANVAS_MEDIA_GENERATE_SEAM,
  CANVAS_MUTATION_TOOL_NAMES,
  CANVAS_TYPED_TOOL_DESCRIPTIONS,
  typedCanvasCommandToToolOp,
} from "./canvasAgentTools.js";
import { CanvasCore } from "./canvasCore.js";
import { CanvasAssetStore } from "./canvasAssetStore.js";
import { classifyCanvasTurnIntent, evaluateCanvasEditCompletion } from "./canvasIntentGate.js";
import { mapCanvasToolError } from "./canvasGatewayTools.js";
import { canvasSkillPackText } from "./canvasSkills.js";
import { CanvasToolError, mapCanvasToolOps } from "./canvasToolOps.js";
import type { CanvasAccessGrantRow } from "./canvasAccessGrant.js";
import type { CanvasJson } from "./canvasTypes.js";

const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

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

function posting() {
  const recordDispatch = async () => ({ status: "sent" as const });
  const wakeDispatch: WakeDispatchPort = {
    async resolveMessageContext(input) {
      return { chainId: input.messageId, dispatchDepth: 0, taskMessageId: input.taskMessageId };
    },
    async ensureChain() {},
    async prepareTargets() { return { dispatch: recordDispatch }; },
    dispatch: recordDispatch,
  };
  const eventSink: ConversationEventSink = { async publish() {} };
  return createConversationModules({
    eventSink,
    wakeDispatch,
    introductionProof: { consume: () => true, complete() {}, restore() {} },
    deliveryJournal: new DeliveryJournal(),
  });
}

function fixture(label: string) {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "canvas-native-tools", spaceId);
  registerSpace({
    id: spaceId,
    name: label,
    slug: `${label}-${spaceId.slice(0, 8)}`,
    rootPath,
  });
  const db = dbForSpace(spaceId);
  const core = new CanvasCore(db, spaceId);
  const canvas = core.create({ title: "NativeTools", document: scene });
  return {
    spaceId,
    rootPath,
    humanId: `human-${spaceId.slice(0, 8)}`,
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
    addChannel() {
      return db.insert(schema.channels).values({ spaceId, name: "studio", type: "channel" }).returning().get()!;
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
  messageId: string;
}) {
  const now = Date.now();
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
    surfaceKind: "channel",
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
    deliveryId: delivery.id,
    claims: prepared.claims,
    gateway: new CapabilityGateway(input.spaceId, input.db, () => now),
    outputs: new TurnOutputService(input.spaceId, { async publish() {} }, input.db, () => now),
    assembled: new ContextAssembler(input.spaceId, input.db, () => now).assemble(turnId, prepared.claims.activationId),
  };
}

test("typed Canvas tool schemas reject unknown fields and remote image inputs", () => {
  CanvasCreateTextCommandSchema.parse({
    expectedRevision: 1,
    text: "Hello",
    x: 10,
    y: 20,
    idempotencyKey: "text:1",
  });
  assert.throws(() => CanvasCreateTextCommandSchema.parse({
    expectedRevision: 1,
    text: "Hello",
    x: 10,
    y: 20,
    extra: true,
    idempotencyKey: "text:bad",
  }));
  assert.throws(() => CanvasSceneSummaryCommandSchema.parse({
    snapshotId: "snap",
    hostPath: "/tmp",
    idempotencyKey: "sum:bad",
  }));
  assert.throws(() => CanvasCreateImageCommandSchema.parse({
    expectedRevision: 1,
    assetId: "asset-1",
    url: "https://example.invalid/x.png",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    idempotencyKey: "img:url",
  }));
  assert.throws(() => CanvasCreateImageCommandSchema.parse({
    expectedRevision: 1,
    assetId: "asset-1",
    genPrompt: "a poster",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    idempotencyKey: "img:prompt",
  }));
  assert.throws(() => CanvasCreateImageCommandSchema.parse({
    expectedRevision: 1,
    assetId: "asset-1",
    dataUrl: "data:image/png;base64,AAAA",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    idempotencyKey: "img:data",
  }));
  assert.throws(() => CanvasUpdateNodeCommandSchema.parse({
    expectedRevision: 1,
    extra: true,
    idempotencyKey: "upd-extra",
  }));
  assert.throws(() => CanvasUpdateNodeCommandSchema.parse({
    expectedRevision: 1,
    idempotencyKey: "upd-missing-target",
  }), /nodeId/);
  assert.throws(() => CanvasDeleteNodesCommandSchema.parse({
    expectedRevision: 1,
    confirmDestructive: true,
    idempotencyKey: "del-missing",
  }), /ids/);
  assert.throws(() => CanvasDeleteNodesCommandSchema.parse({
    expectedRevision: 1,
    ids: [],
    confirmDestructive: true,
    idempotencyKey: "del-empty",
  }));
  assert.throws(() => CanvasCreateFrameCommandSchema.parse({
    expectedRevision: 1,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    id: "ROOT",
    idempotencyKey: "frame-root",
  }), /id cannot be ROOT/);
  assert.equal(CANVAS_MEDIA_GENERATE_SEAM.status, "deferred");
  assert.ok(CANVAS_MUTATION_TOOL_NAMES.includes("canvas.create_text"));
  assert.ok(CANVAS_MUTATION_TOOL_NAMES.includes("canvas.elements_apply"));
  assert.ok(CANVAS_MUTATION_TOOL_NAMES.includes("canvas.align_nodes"));
  assert.ok(CANVAS_MUTATION_TOOL_NAMES.includes("canvas.boolean_op"));
  const shape = CanvasCreateShapeCommandSchema.parse({
    expectedRevision: 1,
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    fill: "#FF0000",
    fillType: "solid",
    cornerRadius: 8,
    rotation: 15,
    idempotencyKey: "shape:red",
  });
  assert.equal(shape.fill, "#FF0000");
  CanvasUpdateNodeCommandSchema.parse({
    expectedRevision: 1,
    nodeId: "shape-1",
    fillType: "linear",
    fillEnd: "#000000",
    fontSize: 24,
    idempotencyKey: "upd-style",
  });
  CanvasCreateTextCommandSchema.parse({
    expectedRevision: 1,
    text: "Hello",
    x: 0,
    y: 0,
    rotation: 10,
    opacity: 0.9,
    blendMode: "multiply",
    idempotencyKey: "text-style",
  });
  CanvasAlignNodesCommandSchema.parse({
    expectedRevision: 1,
    nodeIds: ["a", "b"],
    mode: "centerX",
    idempotencyKey: "align-1",
  });
  CanvasUpdateFrameCommandSchema.parse({
    expectedRevision: 1,
    frameId: "frame-1",
    backgroundColor: "#111111",
    locked: true,
    idempotencyKey: "frame-upd",
  });
  CanvasBooleanOpCommandSchema.parse({
    expectedRevision: 1,
    nodeIds: ["a", "b"],
    mode: "subtract",
    confirmDestructive: true,
    idempotencyKey: "bool-1",
  });
  assert.match(CANVAS_TYPED_TOOL_DESCRIPTIONS["canvas.create_shape"], /NEVER put CSS/);
  assert.match(CANVAS_TYPED_TOOL_DESCRIPTIONS["canvas.update_node"], /fillType/);
});

test("typed Canvas commands map onto the same ToolOp names Core already executes", () => {
  const grant = {
    objectScope: { createParents: ["ROOT", "frame-1"], frameIds: ["frame-1"], elementIds: ["shape-1"], emptySelection: false },
  } as CanvasAccessGrantRow;
  const textOp = typedCanvasCommandToToolOp("canvas.create_text", {
    expectedRevision: 1,
    text: "Title",
    x: 12,
    y: 24,
    idempotencyKey: "map-text",
  }, grant);
  assert.equal(textOp.op, "create_text");
  assert.equal(textOp.parentId, "ROOT");
  assert.equal(textOp.frameId, "frame-1");
  assert.equal(textOp.text, "Title");
  const remapped = typedCanvasCommandToToolOp("canvas.create_text", {
    expectedRevision: 1,
    text: "Inside frame",
    x: 0,
    y: 0,
    parentId: "frame-1",
    idempotencyKey: "map-text-frame",
  }, grant);
  assert.equal(remapped.parentId, "ROOT");
  assert.equal(remapped.frameId, "frame-1");
  const updateOp = typedCanvasCommandToToolOp("canvas.update_node", {
    expectedRevision: 1,
    nodeId: "shape-1",
    x: 40,
    idempotencyKey: "map-update",
  }, grant);
  assert.equal(updateOp.op, "update_node");
  assert.equal(updateOp.nodeId, "shape-1");
  const deleteOp = typedCanvasCommandToToolOp("canvas.delete_nodes", {
    expectedRevision: 1,
    ids: ["shape-1"],
    confirmDestructive: true,
    idempotencyKey: "map-del",
  }, grant);
  assert.equal(deleteOp.op, "delete_nodes");
  assert.deepEqual(deleteOp.ids, ["shape-1"]);
  const shapeOp = typedCanvasCommandToToolOp("canvas.create_shape", {
    expectedRevision: 1,
    x: 0,
    y: 0,
    width: 80,
    height: 40,
    fill: "#FF0000",
    fillType: "solid",
    cornerRadius: 4,
    idempotencyKey: "map-shape",
  }, grant);
  assert.equal(shapeOp.op, "create_shape");
  assert.equal((shapeOp.attrs as { fill?: string }).fill, "#FF0000");
  assert.equal((shapeOp.attrs as { fillType?: string }).fillType, "solid");
  const alignOp = typedCanvasCommandToToolOp("canvas.align_nodes", {
    expectedRevision: 1,
    nodeIds: ["shape-1", "shape-2"],
    mode: "left",
    idempotencyKey: "map-align",
  }, grant);
  assert.equal(alignOp.op, "align_nodes");
  assert.equal(alignOp.mode, "left");
  assert.throws(() => CanvasUpdateNodeCommandSchema.parse({
    expectedRevision: 1,
    nodeId: "shape-1",
    url: "https://evil.example",
    idempotencyKey: "upd-url",
  }));
});

test("canvas intent stays unknown from natural language and pure questions do not require mutation", () => {
  assert.equal(classifyCanvasTurnIntent(), "unknown");
  assert.equal(classifyCanvasTurnIntent(null), "unknown");
  assert.equal(classifyCanvasTurnIntent("edit"), "edit");
  assert.equal(classifyCanvasTurnIntent("question"), "question");
  const writeGrant = [{
    objectScope: { emptySelection: false, createParents: ["ROOT"], elementIds: ["shape-1"], frameIds: [] },
    actions: ["create", "write_existing"],
  }] as unknown as CanvasAccessGrantRow[];
  const unknown = evaluateCanvasEditCompletion({ intent: "unknown", grants: writeGrant, committedMutationCount: 0 });
  assert.equal(unknown.mutationRequired, false);
  assert.equal(unknown.canClaimComplete, true);
  assert.equal(unknown.enforcedOnReply, false);
  const qa = evaluateCanvasEditCompletion({ intent: "question", grants: writeGrant, committedMutationCount: 0 });
  assert.equal(qa.mutationRequired, false);
  const explicitEdit = evaluateCanvasEditCompletion({ intent: "edit", grants: writeGrant, committedMutationCount: 0 });
  assert.equal(explicitEdit.mutationRequired, true);
  assert.equal(explicitEdit.enforcedOnReply, false);
  const pack = canvasSkillPackText(writeGrant);
  assert.match(pack, /Do not inspect project source code/);
  assert.match(pack, /canvas\.create_text/);
  assert.match(pack, /You decide whether this turn is edit, question, read, or export/);
  assert.match(pack, /怎么添加文字/);
  assert.match(pack, /如何修改 Frame/);
  assert.match(pack, /heuristic mutation requirement/);
  assert.doesNotMatch(pack, /Turn intent:/);
  assert.match(pack, /does not hard-refuse turn\.reply/);
  assert.match(pack, /Canvas Operation Protocol/);
  assert.match(pack, /Frame-first principle/);
  assert.match(pack, /NEVER use CSS: fill="linear-gradient/);
  assert.match(pack, /Prefer canvas\.update_node on the same id/);
  assert.match(pack, /do not delete\+create/);
});

test("scene_summary is grant-scoped and typed create/update/delete share Gateway→Core with mutation feedback", async () => {
  const f = fixture("native-tools");
  try {
    const executor = f.addAgent("executor");
    const channel = f.addChannel();
    f.addMember(channel.id, executor.id);
    const modules = posting();
    const message = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "给我画一张海报",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["frame:frame-1", "shape-1"] },
      executionBinding: { executorAgentId: executor.id, mode: "required" },
    });
    const turn = await prepareTurn({
      spaceId: f.spaceId,
      db: f.db,
      agentId: executor.id,
      channelId: channel.id,
      messageId: message.id,
    });
    assert.match(turn.assembled.renderedContext, /Do not inspect project source code/);
    assert.match(turn.assembled.renderedContext, /You decide whether this turn is edit, question, read, or export/);
    assert.doesNotMatch(turn.assembled.renderedContext, /Turn intent:.*mutationRequired/);
    assert.doesNotMatch(turn.assembled.renderedContext, /Turn intent: edit/);
    const grant = f.db.select().from(schema.canvasAccessGrants).where(eq(schema.canvasAccessGrants.turnId, turn.turnId)).get();
    assert.ok(grant);
    const summary = turn.gateway.canvasSceneSummary(turn.claims, {
      snapshotId: grant.snapshotId,
      idempotencyKey: "summary-1",
    });
    assert.equal(summary.canvasId, f.canvas.id);
    assert.equal(summary.snapshotId, grant.snapshotId);
    assert.ok(summary.selectedFrames.some((frame) => frame.id === "frame-1"));
    assert.ok(summary.elements.some((element) => element.id === "shape-1"));
    assert.equal(summary.elements.some((element) => element.id === "shape-2"), false);
    assert.ok(summary.allowedCreateParents.includes("frame-1"));
    assert.match(summary.nextSuggestedAction, /typed canvas\.create_/);
    assert.equal(summary.focusFrameId, "frame-1");
    assert.match(summary.contextText, /=== CANVAS_SCENE ===/);
    assert.match(summary.contextText, /FOCUS_FRAME_ID: frame-1/);
    assert.match(summary.contextText, /=== SCENE_FRAMES ===/);
    assert.match(summary.contextText, /=== SCENE_NODES ===/);
    assert.match(summary.contextText, /shape-1/);
    assert.doesNotMatch(summary.contextText, /shape-2/);
    assert.ok(summary.availableFonts.includes("Inter"));

    const baseRevision = f.core.read(f.canvas.id).revisions.revision;
    const created = turn.gateway.canvasCreateText(turn.claims, {
      snapshotId: grant.snapshotId,
      expectedRevision: baseRevision,
      text: "Poster title",
      x: 24,
      y: 32,
      idempotencyKey: "create-text-1",
    });
    assert.equal(created.status, "committed");
    assert.ok(created.mutationId);
    assert.equal(created.operationId.length > 0, true);
    assert.equal(created.canvasId, f.canvas.id);
    assert.equal(created.snapshotId, grant.snapshotId);
    assert.equal(created.previousRevision, baseRevision);
    assert.equal(created.revision > baseRevision, true);
    assert.equal(created.createdIds.length, 1);
    assert.match(created.nextSuggestedAction, /turn\.reply/);
    const createdId = created.createdIds[0]!;
    const liveAfterCreate = f.core.read(f.canvas.id).document as {
      deltaSetLike: Record<string, { text?: string; parentId?: string }>;
    };
    assert.equal(liveAfterCreate.deltaSetLike[createdId]?.text, "Poster title");
    assert.equal(liveAfterCreate.deltaSetLike[createdId]?.parentId, "ROOT");
    assert.equal((liveAfterCreate.deltaSetLike[createdId] as { frameId?: string }).frameId, "frame-1");

    const updated = turn.gateway.canvasUpdateNode(turn.claims, {
      snapshotId: grant.snapshotId,
      expectedRevision: created.revision,
      nodeId: "shape-1",
      x: 48,
      idempotencyKey: "update-1",
    });
    assert.equal(updated.status, "committed");
    assert.ok(updated.updatedIds.includes("shape-1"));
    assert.equal((f.core.read(f.canvas.id).document as { deltaSetLike: Record<string, { x?: number }> }).deltaSetLike["shape-1"]?.x, 48);

    const shaped = turn.gateway.canvasCreateShape(turn.claims, {
      snapshotId: grant.snapshotId,
      expectedRevision: updated.revision,
      shapeType: "rect",
      x: 80,
      y: 90,
      width: 40,
      height: 40,
      fill: "#111111",
      idempotencyKey: "shape-1",
    });
    assert.equal(shaped.createdIds.length, 1);

    const deleted = turn.gateway.canvasDeleteNodes(turn.claims, {
      snapshotId: grant.snapshotId,
      expectedRevision: shaped.revision,
      ids: [shaped.createdIds[0]!],
      confirmDestructive: true,
      idempotencyKey: "delete-1",
    });
    assert.ok(deleted.deletedIds.includes(shaped.createdIds[0]!));

    const compatible = turn.gateway.canvasElementsApply(turn.claims, {
      snapshotId: grant.snapshotId,
      expectedRevision: deleted.revision,
      operations: [{ op: "update_node", nodeId: "shape-1", y: 64 }],
      idempotencyKey: "apply-compat",
    });
    assert.equal(compatible.status, "committed");
    assert.ok(compatible.mutationId);
    assert.ok(compatible.nextSuggestedAction);

    await turn.outputs.reply({
      turnId: turn.turnId,
      attemptId: turn.attemptId,
      idempotencyKey: "reply:poster",
      body: "poster title added on the selected Frame",
      handledInputIds: [turn.deliveryId],
      outputRefs: [{ kind: "canvas_mutation", artifactId: String(created.mutationId) }],
    });
    const inspected = new TurnInspector(f.spaceId, f.db).inspect(turn.turnId);
    assert.equal(inspected?.canvasArtifacts.bound[0]?.mutationId, created.mutationId);
    assert.equal(inspected?.canvasArtifacts.editCompletion?.intent, "unknown");
    assert.equal(inspected?.canvasArtifacts.editCompletion?.mutationRequired, false);
    assert.equal(inspected?.canvasArtifacts.editCompletion?.canClaimComplete, true);
    assert.equal(inspected?.canvasArtifacts.editCompletion?.enforcedOnReply, false);
    assert.ok(inspected?.operations.some((operation) => operation.toolName === "canvas.create_text"));
    assert.ok(inspected?.operations.some((operation) => operation.toolName === "canvas.elements_apply"));
  } finally {
    f.cleanup();
  }
});

test("typed Canvas writes deny unauthorized turns and do not accept remote image fields", async () => {
  const f = fixture("native-deny");
  try {
    const executor = f.addAgent("executor");
    const channel = f.addChannel();
    f.addMember(channel.id, executor.id);
    const modules = posting();
    const message = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "plain chat without canvas",
      structuredMentions: [{ type: "agent", id: executor.id }],
    });
    const turn = await prepareTurn({
      spaceId: f.spaceId,
      db: f.db,
      agentId: executor.id,
      channelId: channel.id,
      messageId: message.id,
    });
    assert.throws(() => turn.gateway.canvasSceneSummary(turn.claims, {
      idempotencyKey: "no-grant-summary",
    }), /activation does not allow canvas\.read|capability_scope_denied/);
    assert.throws(() => turn.gateway.canvasCreateText(turn.claims, {
      expectedRevision: 0,
      text: "nope",
      x: 0,
      y: 0,
      idempotencyKey: "no-grant-text",
    }), /activation does not allow canvas\.write|capability_scope_denied/);
    assert.throws(() => CanvasCreateImageCommandSchema.parse({
      expectedRevision: 0,
      url: "https://example.invalid/x.png",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      idempotencyKey: "img-remote",
    }));
  } finally {
    f.cleanup();
  }
});

test("create_frame custom ids cannot be ROOT or collide with elements or Frames", () => {
  const doc = scene as CanvasJson;
  assert.throws(() => mapCanvasToolOps(doc, [{
    op: "create_frame", id: "ROOT", x: 0, y: 0, width: 120, height: 80,
  }]), /create_frame id collides/);
  assert.throws(() => mapCanvasToolOps(doc, [{
    op: "create_frame", id: "shape-1", x: 0, y: 0, width: 120, height: 80,
  }]), /create_frame id collides/);
  assert.throws(() => mapCanvasToolOps(doc, [{
    op: "create_frame", id: "frame-1", x: 0, y: 0, width: 120, height: 80,
  }]), /create_frame id collides/);
  const created = mapCanvasToolOps(doc, [{
    op: "create_frame", id: "frame-2", x: 40, y: 40, width: 120, height: 80, name: "Poster",
  }]);
  assert.deepEqual(created.createdFrameIds, ["frame-2"]);
  assert.throws(() => mapCanvasToolOps(doc, [{
    op: "create_shape", x: 0, y: 0, width: 40, height: 40,
    attrs: { fill: "linear-gradient(red, blue)" },
  }]), /code=invalid_fill/);
  assert.throws(() => mapCanvasToolOps(doc, [{
    op: "create_shape", x: 0, y: 0, width: 40, height: 40,
    fillType: "linear", fill: "#FF0000",
  }]), /code=missing_gradient_end/);
  assert.throws(() => mapCanvasToolOps(doc, [{
    op: "create_shape", x: 0, y: 0, width: 40, height: 40,
    stroke: "radial-gradient(circle, red, blue)",
  }]), /code=invalid_stroke/);
  assert.throws(() => mapCanvasToolOps(doc, [{
    op: "create_shape", x: 0, y: 0,
  }]), /code=missing_required_param/);
  const aligned = mapCanvasToolOps(doc, [{
    op: "align_nodes", nodeIds: ["shape-1", "shape-2"], mode: "left",
  }]);
  assert.ok(aligned.operation);
  const red = mapCanvasToolOps(doc, [{
    op: "create_shape", id: "red-1", x: 8, y: 8, width: 40, height: 24,
    attrs: { shapeType: "rect", fill: "#FF0000", fillType: "solid" },
  }]);
  assert.deepEqual(red.createdElementIds, ["red-1"]);
});

test("mapCanvasToolError attaches canvasErrorCode/fix/detail for CanvasToolError", () => {
  const error = new CanvasToolError(
    "invalid_fill",
    "use fill=#RRGGBB or rgba(...), never CSS linear-gradient()/radial-gradient()",
    "fill=linear-gradient(red,blue)",
  );
  assert.throws(() => mapCanvasToolError(error), (caught: unknown) => {
    assert.ok(caught instanceof HarnessError);
    assert.equal(caught.code, "capability_scope_denied");
    assert.equal(caught.details.canvasErrorCode, "invalid_fill");
    assert.equal(caught.details.canvasErrorFix, error.fix);
    assert.equal(caught.details.canvasErrorDetail, error.detail);
    return true;
  });
});

test("pure Chinese how-to questions do not inject mutationRequired into Canvas context", async () => {
  const f = fixture("native-question");
  try {
    const executor = f.addAgent("executor");
    const channel = f.addChannel();
    f.addMember(channel.id, executor.id);
    const modules = posting();
    const message = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "怎么添加文字？如何修改 Frame？",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["frame:frame-1", "shape-1"] },
      executionBinding: { executorAgentId: executor.id, mode: "required" },
    });
    const turn = await prepareTurn({
      spaceId: f.spaceId,
      db: f.db,
      agentId: executor.id,
      channelId: channel.id,
      messageId: message.id,
    });
    assert.match(turn.assembled.renderedContext, /You decide whether this turn is edit, question, read, or export/);
    assert.doesNotMatch(turn.assembled.renderedContext, /Turn intent:.*mutationRequired/);
    assert.doesNotMatch(turn.assembled.renderedContext, /Turn intent: edit/);
    await turn.outputs.reply({
      turnId: turn.turnId,
      attemptId: turn.attemptId,
      idempotencyKey: "reply:question",
      body: "Use canvas.create_text to add text; use canvas.update_node to change a Frame child.",
      handledInputIds: [turn.deliveryId],
    });
    const inspected = new TurnInspector(f.spaceId, f.db).inspect(turn.turnId);
    assert.equal(inspected?.canvasArtifacts.editCompletion?.intent, "unknown");
    assert.equal(inspected?.canvasArtifacts.editCompletion?.mutationRequired, false);
    assert.equal(inspected?.canvasArtifacts.editCompletion?.canClaimComplete, true);
    assert.equal(inspected?.canvasArtifacts.editCompletion?.enforcedOnReply, false);
  } finally {
    f.cleanup();
  }
});

test("create_image rejects missing and cross-canvas assets; outputRefs cannot bind another turn", async () => {
  const f = fixture("native-asset-scope");
  try {
    const executor = f.addAgent("executor");
    const channel = f.addChannel();
    f.addMember(channel.id, executor.id);
    const other = f.core.create({ title: "OtherCanvas", document: scene });
    const store = new CanvasAssetStore(f.db, f.spaceId, f.rootPath);
    const localAsset = store.write({
      canvasId: f.canvas.id,
      filename: "local.png",
      mimeType: "image/png",
      bytes: PNG_BYTES,
    });
    const foreignAsset = store.write({
      canvasId: other.id,
      filename: "foreign.png",
      mimeType: "image/png",
      bytes: PNG_BYTES,
    });
    const modules = posting();
    const message = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "place the imported image",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["frame:frame-1"] },
      executionBinding: { executorAgentId: executor.id, mode: "required" },
    });
    const turn = await prepareTurn({
      spaceId: f.spaceId,
      db: f.db,
      agentId: executor.id,
      channelId: channel.id,
      messageId: message.id,
    });
    const grant = f.db.select().from(schema.canvasAccessGrants).where(eq(schema.canvasAccessGrants.turnId, turn.turnId)).get();
    assert.ok(grant);
    const baseRevision = f.core.read(f.canvas.id).revisions.revision;
    assert.throws(() => turn.gateway.canvasCreateImage(turn.claims, {
      snapshotId: grant.snapshotId,
      expectedRevision: baseRevision,
      assetId: "missing-asset",
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      idempotencyKey: "img-missing",
    }), /does not exist on this Canvas|capability_scope_denied/);
    assert.throws(() => turn.gateway.canvasCreateImage(turn.claims, {
      snapshotId: grant.snapshotId,
      expectedRevision: baseRevision,
      assetId: foreignAsset.id,
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      idempotencyKey: "img-cross",
    }), /does not exist on this Canvas|capability_scope_denied/);
    assert.throws(() => turn.gateway.canvasCreateFrame(turn.claims, {
      snapshotId: grant.snapshotId,
      expectedRevision: baseRevision,
      x: 8,
      y: 8,
      width: 200,
      height: 160,
      id: "shape-1",
      idempotencyKey: "frame-collide-element",
    }), /create_frame id collides|capability_scope_denied/);
    const created = turn.gateway.canvasCreateImage(turn.claims, {
      snapshotId: grant.snapshotId,
      expectedRevision: baseRevision,
      assetId: localAsset.id,
      x: 12,
      y: 16,
      width: 80,
      height: 60,
      name: "hero",
      idempotencyKey: "img-ok",
    });
    assert.equal(created.status, "committed");
    assert.ok(created.mutationId);
    const replay = turn.gateway.canvasCreateImage(turn.claims, {
      snapshotId: grant.snapshotId,
      expectedRevision: baseRevision,
      assetId: localAsset.id,
      x: 12,
      y: 16,
      width: 80,
      height: 60,
      name: "hero",
      idempotencyKey: "img-ok",
    });
    assert.equal(replay.mutationId, created.mutationId);
    assert.equal(replay.revision, created.revision);
    await turn.outputs.reply({
      turnId: turn.turnId,
      attemptId: turn.attemptId,
      idempotencyKey: "reply:image",
      body: "placed local asset",
      handledInputIds: [turn.deliveryId],
      outputRefs: [{ kind: "canvas_mutation", artifactId: String(created.mutationId) }],
    });

    const follow = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "another turn",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["frame:frame-1"] },
      executionBinding: { executorAgentId: executor.id, mode: "required" },
    });
    const next = await prepareTurn({
      spaceId: f.spaceId,
      db: f.db,
      agentId: executor.id,
      channelId: channel.id,
      messageId: follow.id,
    });
    await assert.rejects(() => next.outputs.reply({
      turnId: next.turnId,
      attemptId: next.attemptId,
      idempotencyKey: "reply:stolen",
      body: "cannot reuse prior mutation",
      handledInputIds: [next.deliveryId],
      outputRefs: [{ kind: "canvas_mutation", artifactId: String(created.mutationId) }],
    }), (error: unknown) => {
      assert.ok(error instanceof HarnessError);
      assert.match(error.message, /already bound|this turn|capability_scope_denied/);
      return true;
    });
  } finally {
    f.cleanup();
  }
});

test("failed canvas tool persists LAST_CANVAS_ERROR and a later success clears it", async () => {
  const f = fixture("native-last-error");
  try {
    const executor = f.addAgent("executor");
    const channel = f.addChannel();
    f.addMember(channel.id, executor.id);
    const modules = posting();
    const message = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "画一个红色矩形",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["frame:frame-1", "shape-1"] },
      executionBinding: { executorAgentId: executor.id, mode: "required" },
    });
    const turn = await prepareTurn({
      spaceId: f.spaceId,
      db: f.db,
      agentId: executor.id,
      channelId: channel.id,
      messageId: message.id,
    });
    const grant = f.db.select().from(schema.canvasAccessGrants).where(eq(schema.canvasAccessGrants.turnId, turn.turnId)).get();
    assert.ok(grant);
    const revision = f.core.read(f.canvas.id).revisions.revision;
    assert.throws(() => turn.gateway.canvasCreateShape(turn.claims, {
      snapshotId: grant.snapshotId,
      expectedRevision: revision,
      x: 10,
      y: 10,
      width: 80,
      height: 40,
      fill: "linear-gradient(red, blue)",
      idempotencyKey: "bad-fill",
    }), /code=invalid_fill/);
    const afterFail = new ContextAssembler(f.spaceId, f.db, () => Date.now()).assemble(turn.turnId, turn.claims.activationId);
    assert.match(afterFail.renderedContext, /LAST_CANVAS_ERROR: code=invalid_fill/);
    assert.match(afterFail.renderedContext, /fix=use fill=#RRGGBB or rgba\(\.\.\.\)/);
    assert.match(afterFail.renderedContext, /detail=fill=linear-gradient\(red, blue\)/);
    assert.match(afterFail.renderedContext, /The previous canvas operation failed\. Review the fix suggestion/);
    const created = turn.gateway.canvasCreateShape(turn.claims, {
      snapshotId: grant.snapshotId,
      expectedRevision: revision,
      x: 10,
      y: 10,
      width: 80,
      height: 40,
      fill: "#FF0000",
      fillType: "solid",
      idempotencyKey: "red-rect",
    });
    assert.equal(created.status, "committed");
    const live = f.core.read(f.canvas.id).document as {
      deltaSetLike: Record<string, { fill?: string; attrs?: { fill?: string } }>;
    };
    const node = live.deltaSetLike[created.createdIds[0]!];
    assert.equal(node?.fill ?? node?.attrs?.fill, "#FF0000");
    const afterOk = new ContextAssembler(f.spaceId, f.db, () => Date.now()).assemble(turn.turnId, turn.claims.activationId);
    assert.doesNotMatch(afterOk.renderedContext, /LAST_CANVAS_ERROR: code=/);
  } finally {
    f.cleanup();
  }
});
