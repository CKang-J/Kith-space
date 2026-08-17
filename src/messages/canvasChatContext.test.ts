import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { ALL_AGENT_SCOPE_KEYS } from "../agents/agentScopes.js";
import { CanvasCore } from "../canvas/canvasCore.js";
import { ContextAssembler } from "../context/contextAssembler.js";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { DeliveryJournal } from "../deliveries/deliveryJournal.js";
import { kithSpaceHome } from "../paths.js";
import { TurnInspector } from "../turns/turnInspector.js";
import {
  createConversationModules,
  type ConversationEventSink,
  type WakeDispatchPort,
} from "./messagePostingModule.js";
import { MessageExecutionBindingError } from "./messageExecutionBinding.js";

const scene = {
  width: 800,
  height: 600,
  deltaSetLike: {
    ROOT: { children: ["shape-1"] },
    "shape-1": { id: "shape-1", key: "shape", x: 10, y: 20, width: 100, height: 80, attrs: {}, children: [] },
  },
  frames: [{ id: "frame-1", name: "Board", x: 0, y: 0, width: 400, height: 300 }],
  stackOrder: ["shape-1"],
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
    rootPath: path.join(kithSpaceHome(), "canvas-chat", spaceId),
  });
  const db = dbForSpace(spaceId);
  const core = new CanvasCore(db, spaceId);
  const canvas = core.create({ title: "Moodboard", document: scene });
  return {
    spaceId,
    humanId,
    db,
    core,
    canvas,
    addAgent(name: string, options: {
      harness?: "v2" | "legacy";
      deleted?: boolean;
      scopes?: string[];
      responseMode?: "active" | "mention_only" | "silent";
    } = {}) {
      const agent = db.insert(schema.agents).values({
        spaceId,
        name,
        displayName: name,
        runtime: "claude",
        status: "active",
        defaultResponseMode: options.responseMode ?? "active",
        deletedAt: options.deleted ? new Date() : null,
        scopes: options.scopes
          ? { granted: options.scopes, mode: "custom", revision: 1, updatedAt: new Date().toISOString() }
          : null,
      }).returning().get()!;
      if (options.harness !== "legacy") {
        db.insert(schema.agentHarnessState).values({ agentId: agent.id, mode: "v2" }).run();
      } else {
        db.insert(schema.agentHarnessState).values({ agentId: agent.id, mode: "legacy" }).run();
      }
      return agent;
    },
    addChannel(type: "channel" | "dm" | "thread", name: string, parentMessageId?: string) {
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
    counts() {
      return {
        messages: db.select().from(schema.messages).all().length,
        snapshots: db.select().from(schema.canvasSelectionSnapshots).all().length,
        bindings: db.select().from(schema.messageExecutionBindings).all().length,
        deliveries: db.select().from(schema.agentDeliveryItems).all().length,
      };
    },
    cleanup() {
      closeSpaceDb(spaceId);
      unregisterSpace(spaceId);
    },
  };
}

async function assembleCanvasTurn(input: {
  spaceId: string;
  db: ReturnType<typeof dbForSpace>;
  agentId: string;
  channelId: string;
  surfaceKind: "channel" | "dm" | "thread";
  messageId: string;
}) {
  const sessionId = randomUUID();
  const turnId = randomUUID();
  input.db.insert(schema.runtimeSessions).values({
    id: sessionId,
    spaceId: input.spaceId,
    agentId: input.agentId,
    surfaceKind: input.surfaceKind,
    surfaceId: input.channelId,
    sessionGeneration: 1,
    runtime: "claude",
    runtimeConfigFingerprint: "config",
    adapterVersion: "test",
    workspaceRootFingerprint: "root",
    status: "idle",
  }).run();
  input.db.insert(schema.agentTurns).values({
    id: turnId,
    runtimeSessionId: sessionId,
    sessionGeneration: 1,
    spaceId: input.spaceId,
    agentId: input.agentId,
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
  return {
    turnId,
    assembled: new ContextAssembler(input.spaceId, input.db, () => Date.now()).assemble(turnId, `act-${turnId}`),
    inspected: new TurnInspector(input.spaceId, input.db).inspect(turnId),
  };
}

test("DM canvas context derives the peer executor and writes snapshot, binding and required delivery atomically", async () => {
  const f = fixture("canvas-dm");
  try {
    const peer = f.addAgent("peer");
    const other = f.addAgent("other");
    const dm = f.addChannel("dm", `dm:${peer.id}`);
    f.addMember(dm.id, peer.id);
    f.db.insert(schema.humanChannelStates).values({ channelId: dm.id, dmAgentId: peer.id, updatedAt: new Date() }).run();
    const { modules, wakeIds } = posting();
    const message = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: dm.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "look at this",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1", "frame:frame-1"] },
    });
    assert.equal(message.channelId, dm.id);
    assert.equal(message.threadId, null);
    const snapshot = f.db.select().from(schema.canvasSelectionSnapshots).where(eq(schema.canvasSelectionSnapshots.messageId, message.id)).get();
    const binding = f.db.select().from(schema.messageExecutionBindings).where(eq(schema.messageExecutionBindings.messageId, message.id)).get();
    const deliveries = f.db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.messageId, message.id)).all();
    assert.ok(snapshot);
    assert.equal(binding?.executorAgentId, peer.id);
    assert.equal(binding?.mode, "required");
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0]?.agentId, peer.id);
    assert.equal(deliveries[0]?.directive, "required");
    assert.equal(deliveries[0]?.targetSurfaceKind, "dm");
    assert.equal(deliveries[0]?.targetSurfaceId, dm.id);
    assert.deepEqual(wakeIds, []);
    assert.equal(deliveries.some((row) => row.agentId === other.id), false);
    const snapshotRef = (message.contextSnapshot as { openObjectRefs?: Array<{ type: string; id: string }> } | null)
      ?.openObjectRefs?.[0];
    assert.equal(snapshotRef?.type, "canvas_selection_snapshot");
    assert.equal(snapshotRef?.id, snapshot.id);
  } finally {
    f.cleanup();
  }
});

test("channel and thread canvas context stay on the original surface and do not wake other Agents", async () => {
  const f = fixture("canvas-channel");
  try {
    const executor = f.addAgent("executor");
    const other = f.addAgent("bystander", { responseMode: "active" });
    const channel = f.addChannel("channel", "studio");
    f.addMember(channel.id, executor.id);
    f.addMember(channel.id, other.id);
    const { modules, wakeIds } = posting();
    const context = { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human" as const, id: f.humanId, name: "Human" } };
    const channelMessage = await modules.messagePosting.post({
      kind: "chat",
      context,
      content: "@bystander please ignore",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
      executionBinding: { executorAgentId: executor.id, mode: "required" },
    });
    assert.equal(channelMessage.threadId, null, "canvas context must not create a direct-mention thread");
    const channelDeliveries = f.db.select().from(schema.agentDeliveryItems)
      .where(eq(schema.agentDeliveryItems.messageId, channelMessage.id)).all();
    assert.deepEqual(channelDeliveries.map((row) => [row.agentId, row.directive, row.targetSurfaceId]), [
      [executor.id, "required", channel.id],
    ]);
    assert.deepEqual(wakeIds, []);

    const parent = await modules.messagePosting.post({ kind: "chat", context, content: "parent for thread" });
    const thread = f.addChannel("thread", "topic", parent.id);
    f.addMember(thread.id, executor.id);
    f.addMember(thread.id, other.id);
    const threadWakes: string[] = [];
    const threadMessage = await posting(threadWakes).modules.messagePosting.post({
      kind: "chat",
      context: { ...context, channelId: thread.id },
      content: "",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: [] },
      executionBinding: { executorAgentId: executor.id, mode: "required" },
    });
    const threadSnapshot = f.db.select().from(schema.canvasSelectionSnapshots)
      .where(eq(schema.canvasSelectionSnapshots.messageId, threadMessage.id)).get();
    assert.equal((threadSnapshot?.projection as { wholeCanvas?: boolean }).wholeCanvas, true);
    const threadDeliveries = f.db.select().from(schema.agentDeliveryItems)
      .where(eq(schema.agentDeliveryItems.messageId, threadMessage.id)).all();
    assert.equal(threadMessage.channelId, thread.id);
    assert.deepEqual(threadDeliveries.map((row) => [row.agentId, row.directive, row.targetSurfaceKind, row.targetSurfaceId]), [
      [executor.id, "required", "thread", thread.id],
    ]);
    assert.deepEqual(threadWakes, []);
  } finally {
    f.cleanup();
  }
});

test("ineligible executors and failed sends leave no snapshot, message, binding or delivery", async () => {
  const f = fixture("canvas-rollback");
  try {
    const live = f.addAgent("live");
    const deleted = f.addAgent("deleted", { deleted: true });
    const legacy = f.addAgent("legacy", { harness: "legacy" });
    const outsider = f.addAgent("outsider");
    const muted = f.addAgent("muted", {
      scopes: ALL_AGENT_SCOPE_KEYS.filter((scope) => scope !== "message:send"),
    });
    const channel = f.addChannel("channel", "gate");
    f.addMember(channel.id, live.id);
    f.addMember(channel.id, legacy.id);
    f.addMember(channel.id, muted.id);
    const context = { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human" as const, id: f.humanId, name: "Human" } };
    const { modules } = posting();
    const baseline = f.counts();
    const rejects = [
      modules.messagePosting.post({
        kind: "chat", context, content: "no executor",
        canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
      }),
      modules.messagePosting.post({
        kind: "chat", context, content: "deleted",
        canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
        executionBinding: { executorAgentId: deleted.id, mode: "required" },
      }),
      modules.messagePosting.post({
        kind: "chat", context, content: "legacy",
        canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
        executionBinding: { executorAgentId: legacy.id, mode: "required" },
      }),
      modules.messagePosting.post({
        kind: "chat", context, content: "no access",
        canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
        executionBinding: { executorAgentId: outsider.id, mode: "required" },
      }),
      modules.messagePosting.post({
        kind: "chat", context, content: "no send",
        canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
        executionBinding: { executorAgentId: muted.id, mode: "required" },
      }),
    ];
    for (const pending of rejects) {
      await assert.rejects(pending, MessageExecutionBindingError);
    }
    assert.deepEqual(f.counts(), baseline);
  } finally {
    f.cleanup();
  }
});

test("executor assembly injects the frozen snapshot; later edits and unauthorized turns cannot change or steal it", async () => {
  const f = fixture("canvas-assemble");
  try {
    const executor = f.addAgent("executor");
    const other = f.addAgent("other");
    const channel = f.addChannel("channel", "inspect");
    f.addMember(channel.id, executor.id);
    f.addMember(channel.id, other.id);
    const { modules } = posting();
    const message = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "layout this",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
      executionBinding: { executorAgentId: executor.id, mode: "required" },
    });
    f.core.apply({
      canvasId: f.canvas.id,
      operationId: randomUUID(),
      expectedRevision: f.canvas.revisions.revision,
      operation: { type: "document.patch", patches: [{ op: "set", path: ["deltaSetLike", "shape-1", "x"], value: 999 }] },
    });
    const { assembled, inspected } = await assembleCanvasTurn({
      spaceId: f.spaceId,
      db: f.db,
      agentId: executor.id,
      channelId: channel.id,
      surfaceKind: "channel",
      messageId: message.id,
    });
    const canvasSource = assembled.envelope.objectSnapshots.find((ref) => ref.sourceKind === "canvas_selection_snapshot");
    assert.ok(canvasSource);
    const payload = f.db.select().from(schema.turnContextSnapshots)
      .where(eq(schema.turnContextSnapshots.id, canvasSource.snapshotId!)).get()?.payload as {
        projection?: { elements?: Array<{ x: number }> };
        canvasAvailable?: boolean;
        liveReadWrite?: string;
        documentRevision?: number;
      };
    assert.equal(payload?.projection?.elements?.[0]?.x, 10);
    assert.equal(payload?.documentRevision, 0);
    assert.equal(payload?.canvasAvailable, true);
    assert.equal(payload?.liveReadWrite, "snapshot_only");
    assert.ok(inspected?.context.sources.some((source) => source.sourceKind === "canvas_selection_snapshot" && source.content));

    const otherSession = randomUUID();
    const otherTurn = randomUUID();
    f.db.insert(schema.runtimeSessions).values({
      id: otherSession, spaceId: f.spaceId, agentId: other.id, surfaceKind: "channel", surfaceId: channel.id,
      sessionGeneration: 1, runtime: "claude", runtimeConfigFingerprint: "config", adapterVersion: "test",
      workspaceRootFingerprint: "root", status: "idle",
    }).run();
    f.db.insert(schema.agentTurns).values({
      id: otherTurn, runtimeSessionId: otherSession, sessionGeneration: 1, spaceId: f.spaceId, agentId: other.id,
      effectiveDirective: "required",
    }).run();
    f.db.insert(schema.agentDeliveryItems).values({
      spaceId: f.spaceId,
      agentId: other.id,
      messageId: message.id,
      sourceChannelId: channel.id,
      sourceSeq: message.seq,
      cursorOwnerChannelId: channel.id,
      targetSurfaceKind: "channel",
      targetSurfaceId: channel.id,
      targetRuntimeSessionId: otherSession,
      directive: "required",
      reason: "forged_non_executor_binding",
      policySnapshot: {},
      disposition: "bound",
      turnId: otherTurn,
    }).run();
    const otherAssembled = new ContextAssembler(f.spaceId, f.db, () => Date.now()).assemble(otherTurn, `act-${otherTurn}`);
    assert.equal(
      otherAssembled.envelope.objectSnapshots.some((ref) => ref.sourceKind === "canvas_selection_snapshot"),
      false,
      "a non-executor turn must not receive the Canvas snapshot",
    );
  } finally {
    f.cleanup();
  }
});

test("deleting the canvas after send still injects an auditable snapshot and fail-closes live read/write", async () => {
  const f = fixture("canvas-deleted-audit");
  try {
    const executor = f.addAgent("executor");
    const channel = f.addChannel("channel", "audit");
    f.addMember(channel.id, executor.id);
    const { modules } = posting();
    const message = await modules.messagePosting.post({
      kind: "chat",
      context: { spaceId: f.spaceId, channelId: channel.id, sender: { type: "human", id: f.humanId, name: "Human" } },
      content: "keep the snapshot",
      canvasSelection: { canvasId: f.canvas.id, selectedIds: ["shape-1"] },
      executionBinding: { executorAgentId: executor.id, mode: "required" },
    });
    const current = f.core.read(f.canvas.id);
    f.core.delete(f.canvas.id, randomUUID(), current.revisions.revision);
    const { assembled, inspected } = await assembleCanvasTurn({
      spaceId: f.spaceId,
      db: f.db,
      agentId: executor.id,
      channelId: channel.id,
      surfaceKind: "channel",
      messageId: message.id,
    });
    const canvasSource = assembled.envelope.objectSnapshots.find((ref) => ref.sourceKind === "canvas_selection_snapshot");
    assert.ok(canvasSource);
    const payload = f.db.select().from(schema.turnContextSnapshots)
      .where(eq(schema.turnContextSnapshots.id, canvasSource.snapshotId!)).get()?.payload as {
        canvasAvailable?: boolean;
        liveReadWrite?: string;
        projection?: { elements?: Array<{ x: number }> };
      };
    assert.equal(payload?.canvasAvailable, false);
    assert.equal(payload?.liveReadWrite, "fail_closed");
    assert.equal(payload?.projection?.elements?.[0]?.x, 10);
    const inspectedSource = inspected?.context.sources.find((source) => source.sourceKind === "canvas_selection_snapshot");
    assert.equal((inspectedSource?.content as { canvasAvailable?: boolean }).canvasAvailable, false);
    assert.equal(assembled.envelope.uiSnapshot?.module, "canvas");
  } finally {
    f.cleanup();
  }
});
