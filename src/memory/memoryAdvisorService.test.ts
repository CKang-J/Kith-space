import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace, type SpaceDb } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import type {
  MaintenanceJsonInput,
  MaintenanceJsonResult,
  MaintenanceRuntimePort,
} from "../runtime/contract/maintenanceRuntimePort.js";
import { enqueueMemoryAdvisorJobInTransaction, MemoryAdvisorService } from "./memoryAdvisorService.js";
import { EpisodicMemoryService } from "./episodicMemoryService.js";
import { clearAgentPrivateMemory } from "./memoryLifecycle.js";

class FakeMaintenancePort implements MaintenanceRuntimePort {
  calls: MaintenanceJsonInput[] = [];
  outputs: MaintenanceJsonResult[] = [];
  error: Error | null = null;
  support(runtime: string) {
    return runtime === "claude" ? { toolIsolation: "enforced" as const } : { toolIsolation: "unsupported" as const };
  }
  async completeJson(input: MaintenanceJsonInput): Promise<MaintenanceJsonResult> {
    this.calls.push(input);
    if (this.error) throw this.error;
    const output = this.outputs.shift();
    if (!output) throw new Error("missing fake output");
    return output;
  }
}

class DeferredMaintenancePort extends FakeMaintenancePort {
  private releaseGate!: () => void;
  private enteredGate!: () => void;
  readonly entered = new Promise<void>((resolve) => { this.enteredGate = resolve; });
  private readonly released = new Promise<void>((resolve) => { this.releaseGate = resolve; });
  release() { this.releaseGate(); }
  override async completeJson(input: MaintenanceJsonInput): Promise<MaintenanceJsonResult> {
    this.calls.push(input);
    this.enteredGate();
    await this.released;
    const output = this.outputs.shift();
    if (!output) throw new Error("missing fake output");
    return output;
  }
}

function fixture(runtime = "claude") {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const sessionId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "advisor-test", spaceId);
  registerSpace({ id: spaceId, name: "Advisor", slug: `advisor-${spaceId}`, rootPath });
  const db = dbForSpace(spaceId);
  db.insert(schema.agents).values({ id: agentId, spaceId, name: "advisor", displayName: "Advisor", runtime, status: "active" }).run();
  db.insert(schema.channels).values({ id: channelId, spaceId, name: "source", type: "dm" }).run();
  db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
  db.insert(schema.runtimeSessions).values({
    id: sessionId, spaceId, agentId, surfaceKind: "dm", surfaceId: channelId, sessionGeneration: 1,
    runtime, runtimeConfigFingerprint: "config", adapterVersion: "test", workspaceRootFingerprint: "root", status: "idle",
  }).run();
  let seq = 0;
  function turn(content: string, memoryPolicy: "eligible" | "exclude" | null = "eligible", senderType = "human") {
    const messageId = randomUUID();
    const turnId = randomUUID();
    db.insert(schema.messages).values({
      id: messageId, seq: ++seq, spaceId, channelId, senderType,
      senderId: senderType === "human" ? "human" : agentId,
      senderName: senderType === "human" ? "Human" : "Advisor",
      content, memoryPolicy,
    }).run();
    db.insert(schema.agentTurns).values({
      id: turnId, runtimeSessionId: sessionId, sessionGeneration: 1, spaceId, agentId,
      status: "completed", outcome: "ceded", effectiveDirective: "optional", completedAt: new Date(),
    }).run();
    db.insert(schema.agentDeliveryItems).values({
      id: randomUUID(), spaceId, agentId, messageId, sourceChannelId: channelId, sourceSeq: seq,
      cursorOwnerChannelId: channelId, targetSurfaceKind: "dm", targetSurfaceId: channelId,
      targetRuntimeSessionId: sessionId, directive: "optional", reason: "test", policySnapshot: {},
      disposition: "ceded", turnId, settledAt: new Date(),
    }).run();
    return { messageId, turnId };
  }
  return {
    spaceId, agentId, channelId, db, turn,
    cleanup() { closeSpaceDb(spaceId); unregisterSpace(spaceId); },
  };
}

function candidate(sourceIds: string[], canonicalText = "Human prefers a concise weekly report") {
  return {
    scope: "agent_private" as const,
    kind: "preference" as const,
    subjectRef: { kind: "human" as const, id: "human" },
    subjectKey: "human",
    predicateKey: "weekly_report_style",
    canonicalText,
    internalSummary: "Weekly report format preference",
    shareableSummary: "Prefers concise weekly reports",
    sensitivity: "normal" as const,
    disclosure: "shareable_summary" as const,
    confidence: 0.95,
    importance: 0.8,
    tags: ["reporting"],
    evidenceSourceIds: sourceIds,
  };
}

test("advisor admits only eligible Human sources and creates an auto-active private memory", async () => {
  const f = fixture();
  const port = new FakeMaintenancePort();
  try {
    const human = f.turn("我偏好简洁的周报格式");
    const agent = f.turn("Human prefers concise reports", "exclude", "agent");
    assert.equal(f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, human.turnId)), true);
    assert.equal(f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, agent.turnId)), false);
    const job = f.db.select().from(schema.memoryAdvisorJobs).get()!;
    assert.deepEqual(job.sourceRefs, [{ sourceKind: "message", sourceId: human.messageId }]);
    port.outputs.push({ output: { schemaVersion: 1, candidates: [candidate([human.messageId])] }, usage: { inputTokens: 10, outputTokens: 5, source: "final" } });
    const result = await new MemoryAdvisorService(f.spaceId, f.db, port).processDue();
    assert.deepEqual(result, { processed: 1, created: 1 });
    const memory = f.db.select().from(schema.episodicMemories).get()!;
    assert.equal(memory.status, "active");
    assert.deepEqual(f.db.select().from(schema.memoryAdvisorJobs).get()!.validation, { received: 1, stored: 1, rejected: 0 });
    assert.deepEqual(memory.createdBy, { type: "system", id: `memory-advisor:${job.id}` });
    const evidence = f.db.select().from(schema.memoryEvidence).get()!;
    assert.deepEqual(evidence.assertedBy, { type: "human", id: "human" });
    assert.equal(evidence.claimType, "human_assertion");
    assert.equal(port.calls[0]!.prompt.includes("Human prefers concise reports"), false, "Agent echo must not reach the provider");
  } finally { f.cleanup(); }
});

test("exclude, legacy, CLI/seq/ack/tool-output, low-information, and secret-shaped sources are removed before provider invocation", async () => {
  const f = fixture();
  const port = new FakeMaintenancePort();
  try {
    for (const [text, policy] of [
      ["不要记住这个", "exclude"],
      ["历史消息", null],
      ["ok", "eligible"],
      ["ack", "eligible"],
      ["/kith-space turn reply --input payload.json", "eligible"],
      ["seq=abcdef12", "eligible"],
      ["api_key=abcdefghijklmnop", "eligible"],
    ] as const) {
      const item = f.turn(text, policy);
      assert.equal(f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, item.turnId)), false);
    }
    const toolOutput = f.turn("tool stdout: build completed", "eligible", "agent");
    assert.equal(f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, toolOutput.turnId)), false);
    assert.equal(await new MemoryAdvisorService(f.spaceId, f.db, port).processDue().then((value) => value.processed), 0);
    assert.equal(port.calls.length, 0);
  } finally { f.cleanup(); }
});

test("advisor rechecks current source access before invoking the maintenance provider", async () => {
  const f = fixture();
  const port = new FakeMaintenancePort();
  try {
    const item = f.turn("我偏好简洁的周报格式");
    f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, item.turnId));
    f.db.delete(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, f.channelId)).run();
    assert.deepEqual(await new MemoryAdvisorService(f.spaceId, f.db, port).processDue(), { processed: 0, created: 0 });
    assert.equal(port.calls.length, 0);
    assert.equal(f.db.select().from(schema.memoryAdvisorJobs).get()!.status, "cancelled");
  } finally { f.cleanup(); }
});

test("same-Agent jobs batch into one provider call and exact facts do not append duplicate items", async () => {
  const f = fixture();
  const port = new FakeMaintenancePort();
  try {
    const first = f.turn("我偏好简洁的周报格式");
    const second = f.turn("周报仍然要保持简洁");
    f.db.transaction((tx) => {
      enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, first.turnId);
      enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, second.turnId);
    });
    port.outputs.push({ output: { schemaVersion: 1, candidates: [candidate([first.messageId, second.messageId])] } });
    const service = new MemoryAdvisorService(f.spaceId, f.db, port);
    assert.equal((await service.processDue()).processed, 2);
    assert.equal(port.calls.length, 1);
    assert.equal(f.db.select().from(schema.episodicMemories).all().length, 1);

    const third = f.turn("我还是偏好简洁的周报格式");
    f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, third.turnId));
    port.outputs.push({ output: { schemaVersion: 1, candidates: [candidate([third.messageId])] } });
    await service.processDue();
    assert.equal(f.db.select().from(schema.episodicMemories).all().length, 1);

    const fourth = f.turn("我偏好简洁的周报格式");
    f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, fourth.turnId));
    port.outputs.push({ output: { schemaVersion: 1, candidates: [{ ...candidate([fourth.messageId]), subjectKey: "provider-controlled-alias" }] } });
    await service.processDue();
    assert.equal(f.db.select().from(schema.episodicMemories).all().length, 1, "typed subject plus canonical text dedupes provider key drift");
  } finally { f.cleanup(); }
});

test("advisor cancellation during provider execution cannot resurrect cleared private memory", async () => {
  const f = fixture();
  const port = new DeferredMaintenancePort();
  try {
    const item = f.turn("我偏好简洁的周报格式");
    f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, item.turnId));
    port.outputs.push({ output: { schemaVersion: 1, candidates: [candidate([item.messageId])] } });
    const processing = new MemoryAdvisorService(f.spaceId, f.db, port).processDue();
    await port.entered;
    clearAgentPrivateMemory(f.spaceId, f.agentId);
    port.release();
    assert.deepEqual(await processing, { processed: 1, created: 0 });
    assert.equal(f.db.select().from(schema.episodicMemories).all().length, 0);
    assert.equal(f.db.select().from(schema.memoryAdvisorJobs).get()!.status, "cancelled");
  } finally { f.cleanup(); }
});

test("advisor proposal and conflict relation roll back with the canonical memory on failure", () => {
  const f = fixture();
  try {
    const source = f.turn("我偏好简洁的周报格式");
    f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, source.turnId));
    const job = f.db.select().from(schema.memoryAdvisorJobs).get()!;
    const service = new EpisodicMemoryService(f.spaceId, f.db);
    assert.throws(() => service.createFromAdvisor({
      schemaVersion: 1,
      scope: "agent_private",
      ownerAgentId: f.agentId,
      kind: "preference",
      subjectRef: { kind: "human", id: "human" },
      subjectKey: "human:human",
      predicateKey: "weekly_report_style",
      canonicalText: "Human prefers concise weekly reports",
      internalSummary: "Concise weekly reports",
      shareableSummary: "Prefers concise reports",
      status: "proposed",
      confidence: 0.9,
      importance: 0.8,
      sensitivity: "normal",
      disclosure: "shareable_summary",
      validFrom: null,
      validTo: null,
      tags: ["reporting"],
      evidence: [{
        sourceSpaceId: f.spaceId,
        sourceKind: "message",
        sourceId: source.messageId,
        sourceSurfaceId: f.channelId,
        visibilityAtOccurrence: "dm",
        assertedBy: { type: "human", id: "human" },
        quotedFrom: null,
        claimType: "human_assertion",
        memoryPolicy: "eligible",
        excerpt: "我偏好简洁的周报格式",
        occurredAt: Date.now(),
      }],
      actor: { type: "system", id: `memory-advisor:${job.id}` },
      idempotencyKey: randomUUID(),
    }, {
      jobId: job.id,
      proposal: { validation: { accepted: true }, providerConfigDigest: job.configDigest },
      conflict: { memoryId: randomUUID(), revision: 1 },
    }), /conflict target changed/);
    assert.equal(f.db.select().from(schema.episodicMemories).all().length, 0);
    assert.equal(f.db.select().from(schema.episodicMemoryRevisions).all().length, 0);
    assert.equal(f.db.select().from(schema.memoryEvidence).all().length, 0);
    assert.equal(f.db.select().from(schema.memoryTags).all().length, 0);
    assert.equal(f.db.select().from(schema.memoryAdvisorProposals).all().length, 0);
    assert.equal(f.db.select().from(schema.memoryRelations).all().length, 0);
    assert.equal(f.db.select().from(schema.memoryMutations).all().length, 0);
  } finally { f.cleanup(); }
});

test("advisor rechecks source access after provider execution before writing", async () => {
  const f = fixture();
  const port = new DeferredMaintenancePort();
  try {
    const item = f.turn("我偏好简洁的周报格式");
    f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, item.turnId));
    port.outputs.push({ output: { schemaVersion: 1, candidates: [candidate([item.messageId])] } });
    const processing = new MemoryAdvisorService(f.spaceId, f.db, port).processDue();
    await port.entered;
    f.db.delete(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, f.channelId)).run();
    port.release();
    assert.deepEqual(await processing, { processed: 1, created: 0 });
    assert.equal(f.db.select().from(schema.episodicMemories).all().length, 0);
    assert.equal(f.db.select().from(schema.memoryAdvisorJobs).get()!.status, "failed");
  } finally { f.cleanup(); }
});

test("advisor batches only equal retry levels and preserves each job's attempt ceiling", async () => {
  const f = fixture();
  const port = new FakeMaintenancePort();
  port.error = new Error("provider unavailable");
  try {
    const first = f.turn("我偏好简洁的周报格式");
    const second = f.turn("我也偏好稳定的标题格式");
    f.db.transaction((tx) => {
      enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, first.turnId);
      enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, second.turnId);
    });
    const jobs = f.db.select().from(schema.memoryAdvisorJobs).orderBy(schema.memoryAdvisorJobs.createdAt).all();
    const now = Date.now() + 1_000;
    f.db.update(schema.memoryAdvisorJobs).set({ status: "failed", attemptCount: 0, nextAttemptAt: new Date(now - 1) })
      .where(eq(schema.memoryAdvisorJobs.id, jobs[0]!.id)).run();
    f.db.update(schema.memoryAdvisorJobs).set({ status: "failed", attemptCount: 4, nextAttemptAt: new Date(now - 1) })
      .where(eq(schema.memoryAdvisorJobs.id, jobs[1]!.id)).run();
    const service = new MemoryAdvisorService(f.spaceId, f.db, port, () => now);
    await service.processDue();
    assert.equal(f.db.select().from(schema.memoryAdvisorJobs).where(eq(schema.memoryAdvisorJobs.id, jobs[0]!.id)).get()!.attemptCount, 1);
    assert.equal(f.db.select().from(schema.memoryAdvisorJobs).where(eq(schema.memoryAdvisorJobs.id, jobs[1]!.id)).get()!.attemptCount, 4);
    await service.processDue();
    const exhausted = f.db.select().from(schema.memoryAdvisorJobs).where(eq(schema.memoryAdvisorJobs.id, jobs[1]!.id)).get()!;
    assert.equal(exhausted.attemptCount, 5);
    assert.equal(exhausted.status, "blocked");
  } finally { f.cleanup(); }
});

test("advisor source budget leaves the next job queued instead of silently succeeding it", async () => {
  const f = fixture();
  const port = new FakeMaintenancePort();
  try {
    const first = f.turn(`我的长偏好${"甲".repeat(12_000)}`);
    const second = f.turn("我偏好简洁的周报格式");
    f.db.transaction((tx) => {
      enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, first.turnId);
      enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, second.turnId);
    });
    port.outputs.push({ output: { schemaVersion: 1, candidates: [candidate([first.messageId])] } });
    await new MemoryAdvisorService(f.spaceId, f.db, port).processDue();
    assert.equal(f.db.select().from(schema.memoryAdvisorJobs).where(eq(schema.memoryAdvisorJobs.sourceTurnId, first.turnId)).get()!.status, "succeeded");
    assert.equal(f.db.select().from(schema.memoryAdvisorJobs).where(eq(schema.memoryAdvisorJobs.sourceTurnId, second.turnId)).get()!.status, "queued");
  } finally { f.cleanup(); }
});

test("advisor retry is stable when the provider reverses candidate order", async () => {
  const f = fixture();
  const port = new FakeMaintenancePort();
  try {
    const first = f.turn("我偏好简洁周报");
    const second = f.turn("我偏好中文标题");
    f.db.transaction((tx) => {
      enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, first.turnId);
      enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, second.turnId);
    });
    const concise = { ...candidate([first.messageId], "Human prefers concise weekly reports"), predicateKey: "weekly_report_style" };
    const chinese = { ...candidate([second.messageId], "Human prefers Chinese headings"), predicateKey: "heading_language" };
    port.outputs.push({ output: { schemaVersion: 1, candidates: [concise, chinese] } });
    const service = new MemoryAdvisorService(f.spaceId, f.db, port);
    assert.deepEqual(await service.processDue(), { processed: 2, created: 2 });
    const retryAt = new Date(Date.now() - 1);
    f.db.update(schema.memoryAdvisorJobs).set({
      status: "failed",
      nextAttemptAt: retryAt,
      completedAt: null,
    }).run();
    port.outputs.push({ output: { schemaVersion: 1, candidates: [chinese, concise] } });
    assert.deepEqual(await service.processDue(), { processed: 2, created: 0 });
    assert.equal(f.db.select().from(schema.episodicMemories).all().length, 2);
    assert.ok(f.db.select().from(schema.memoryAdvisorJobs).all().every((job) => job.status === "succeeded"));
  } finally { f.cleanup(); }
});

test("forget suppression uses typed subject identity instead of provider subjectKey aliases", async () => {
  const f = fixture();
  const port = new FakeMaintenancePort();
  try {
    const source = f.turn("我偏好简洁的周报格式");
    f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, source.turnId));
    port.outputs.push({ output: { schemaVersion: 1, candidates: [candidate([source.messageId])] } });
    const service = new MemoryAdvisorService(f.spaceId, f.db, port);
    await service.processDue();
    const memory = f.db.select().from(schema.episodicMemories).get()!;
    new EpisodicMemoryService(f.spaceId, f.db).mutate({
      schemaVersion: 1,
      action: "forget_suppress",
      memoryId: memory.id,
      expectedRevision: memory.currentRevision,
      idempotencyKey: randomUUID(),
      payload: {},
    }, { type: "human", id: "human" });

    const retry = f.turn("稍后继续处理");
    f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, retry.turnId));
    f.db.update(schema.memoryAdvisorJobs).set({ sourceRefs: [{ sourceKind: "message", sourceId: source.messageId }] })
      .where(eq(schema.memoryAdvisorJobs.sourceTurnId, retry.turnId)).run();
    port.outputs.push({ output: { schemaVersion: 1, candidates: [{
      ...candidate([source.messageId]),
      subjectKey: "provider-alias-after-forget",
    }] } });
    assert.deepEqual(await service.processDue(), { processed: 1, created: 0 });
    assert.equal(f.db.select().from(schema.episodicMemories).all().length, 0);
  } finally { f.cleanup(); }
});

test("conflicting advisor claim stays proposed until Human accepts the replacement", async () => {
  const f = fixture();
  const port = new FakeMaintenancePort();
  try {
    const first = f.turn("我偏好简洁的周报格式");
    f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, first.turnId));
    port.outputs.push({ output: { schemaVersion: 1, candidates: [candidate([first.messageId])] } });
    const service = new MemoryAdvisorService(f.spaceId, f.db, port);
    await service.processDue();
    const old = f.db.select().from(schema.episodicMemories).get()!;

    const correction = f.turn("我现在偏好详细的周报格式");
    f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, correction.turnId));
    port.outputs.push({ output: { schemaVersion: 1, candidates: [candidate([correction.messageId], "Human prefers a detailed weekly report")] } });
    await service.processDue();
    const proposed = f.db.select().from(schema.episodicMemories).where(eq(schema.episodicMemories.status, "proposed")).get()!;
    assert.ok(proposed);
    assert.equal(f.db.select().from(schema.memoryRelations).where(eq(schema.memoryRelations.relationType, "contradicts")).all().length, 1);
    service.decideProposal(proposed.id, "accept", { type: "human", id: "human" }, randomUUID());
    assert.equal(f.db.select().from(schema.episodicMemories).where(eq(schema.episodicMemories.id, proposed.id)).get()!.status, "active");
    assert.equal(f.db.select().from(schema.episodicMemories).where(eq(schema.episodicMemories.id, old.id)).get()!.status, "superseded");
  } finally { f.cleanup(); }
});

test("provider failure backs off without changing the completed chat turn", async () => {
  const f = fixture();
  const port = new FakeMaintenancePort();
  port.error = new Error("429 with provider payload that must not persist");
  try {
    const item = f.turn("我偏好简洁的周报格式");
    f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, item.turnId));
    const now = Date.now() + 1_000;
    await new MemoryAdvisorService(f.spaceId, f.db, port, () => now).processDue();
    const job = f.db.select().from(schema.memoryAdvisorJobs).get()!;
    assert.equal(job.status, "failed");
    assert.equal(job.errorCode, "provider_unavailable");
    assert.equal(job.errorDetailRedacted?.includes("provider payload"), false);
    assert.ok(job.nextAttemptAt.getTime() > now);
    assert.equal(f.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, item.turnId)).get()!.status, "completed");
  } finally { f.cleanup(); }
});

test("runtimes without a verified maintenance profile remain visibly blocked", () => {
  const f = fixture("codex");
  try {
    const item = f.turn("我偏好简洁的周报格式");
    assert.equal(f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, item.turnId)), true);
    const job = f.db.select().from(schema.memoryAdvisorJobs).get()!;
    assert.equal(job.status, "blocked");
    assert.equal(job.errorCode, "tool_isolation_unsupported");
  } finally { f.cleanup(); }
});

test("forget+suppress cancels queued advisor work that still references the forgotten source", async () => {
  const f = fixture();
  const port = new FakeMaintenancePort();
  try {
    const first = f.turn("我偏好简洁的周报格式");
    f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, first.turnId));
    port.outputs.push({ output: { schemaVersion: 1, candidates: [candidate([first.messageId])] } });
    const advisor = new MemoryAdvisorService(f.spaceId, f.db, port);
    await advisor.processDue();
    const memory = f.db.select().from(schema.episodicMemories).get()!;

    const later = f.turn("稍后仍应保持简洁");
    f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, later.turnId));
    const queued = f.db.select().from(schema.memoryAdvisorJobs).where(eq(schema.memoryAdvisorJobs.sourceTurnId, later.turnId)).get()!;
    f.db.update(schema.memoryAdvisorJobs).set({ sourceRefs: [{ sourceKind: "message", sourceId: first.messageId }] })
      .where(eq(schema.memoryAdvisorJobs.id, queued.id)).run();
    const otherAgentId = randomUUID();
    const otherSessionId = randomUUID();
    const otherTurnId = randomUUID();
    f.db.insert(schema.agents).values({ id: otherAgentId, spaceId: f.spaceId, name: "other-advisor", displayName: "Other Advisor", runtime: "claude", status: "active" }).run();
    f.db.insert(schema.channelAgentMembers).values({ channelId: f.channelId, agentId: otherAgentId }).run();
    f.db.insert(schema.runtimeSessions).values({
      id: otherSessionId, spaceId: f.spaceId, agentId: otherAgentId, surfaceKind: "dm", surfaceId: f.channelId,
      sessionGeneration: 1, runtime: "claude", runtimeConfigFingerprint: "config", adapterVersion: "test",
      workspaceRootFingerprint: "root", status: "idle",
    }).run();
    f.db.insert(schema.agentTurns).values({
      id: otherTurnId, runtimeSessionId: otherSessionId, sessionGeneration: 1, spaceId: f.spaceId,
      agentId: otherAgentId, status: "completed", outcome: "ceded", effectiveDirective: "optional", completedAt: new Date(),
    }).run();
    f.db.insert(schema.agentDeliveryItems).values({
      id: randomUUID(), spaceId: f.spaceId, agentId: otherAgentId, messageId: first.messageId,
      sourceChannelId: f.channelId, sourceSeq: 1, cursorOwnerChannelId: f.channelId,
      targetSurfaceKind: "dm", targetSurfaceId: f.channelId, targetRuntimeSessionId: otherSessionId,
      directive: "optional", reason: "test", policySnapshot: {}, disposition: "ceded", turnId: otherTurnId, settledAt: new Date(),
    }).run();
    f.db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, f.spaceId, otherTurnId));
    const otherJob = f.db.select().from(schema.memoryAdvisorJobs).where(eq(schema.memoryAdvisorJobs.sourceTurnId, otherTurnId)).get()!;
    new EpisodicMemoryService(f.spaceId, f.db).mutate({
      schemaVersion: 1, action: "forget_suppress", memoryId: memory.id, expectedRevision: memory.currentRevision,
      idempotencyKey: randomUUID(), payload: {},
    }, { type: "human", id: "human" });
    assert.equal(f.db.select().from(schema.memoryAdvisorJobs).where(eq(schema.memoryAdvisorJobs.id, queued.id)).get()!.status, "cancelled");
    assert.equal(f.db.select().from(schema.memoryAdvisorJobs).where(eq(schema.memoryAdvisorJobs.id, otherJob.id)).get()!.status, "queued");
  } finally { f.cleanup(); }
});

test("advisor write authority rejects Agent self-evidence and mismatched system actors", () => {
  const f = fixture();
  try {
    const source = f.turn("我偏好简洁的周报格式");
    const base = {
      schemaVersion: 1 as const,
      scope: "agent_private" as const,
      ownerAgentId: f.agentId,
      kind: "preference" as const,
      subjectRef: { kind: "human" as const, id: "human" },
      subjectKey: "human",
      predicateKey: "style",
      canonicalText: "Human prefers concise reports",
      internalSummary: null,
      shareableSummary: null,
      status: "active" as const,
      confidence: 1,
      importance: 1,
      sensitivity: "normal" as const,
      disclosure: "internal_use" as const,
      validFrom: null,
      validTo: null,
      tags: [],
      evidence: [{
        sourceSpaceId: f.spaceId, sourceKind: "message" as const, sourceId: source.messageId,
        sourceSurfaceId: f.channelId, visibilityAtOccurrence: "dm" as const,
        assertedBy: { type: "agent" as const, id: f.agentId }, quotedFrom: null,
        claimType: "agent_derived" as const, memoryPolicy: "eligible" as const,
        excerpt: "derived", occurredAt: Date.now(),
      }],
      actor: { type: "system" as const, id: "memory-advisor:right-job" },
      idempotencyKey: randomUUID(),
    };
    assert.throws(() => new EpisodicMemoryService(f.spaceId, f.db).createFromAdvisor(base, "right-job"), /eligible Human evidence/);
    assert.throws(() => new EpisodicMemoryService(f.spaceId, f.db).createFromAdvisor({
      ...base,
      evidence: [{
        sourceSpaceId: f.spaceId, sourceKind: "message" as const, sourceId: source.messageId,
        sourceSurfaceId: f.channelId, visibilityAtOccurrence: "dm" as const,
        assertedBy: { type: "human" as const, id: "human" }, quotedFrom: null,
        claimType: "human_assertion" as const, memoryPolicy: "eligible" as const,
        excerpt: "Human prefers concise reports", occurredAt: Date.now(),
      }],
    }, "wrong-job"), /matching typed system actor/);
  } finally { f.cleanup(); }
});
