import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { SessionWakeupService } from "../sessions/sessionWakeupService.js";
import type { TurnCapabilityClaims } from "./contracts.js";
import { CapabilityGateway } from "./capabilityGateway.js";
import { configureTaskGatewayPort, taskGatewayPort } from "./taskGatewayPort.js";
import "../server/core.js";

test("Capability Gateway owns refresh, audited queries, checklist, progress and short wake semantics", async () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const privateId = randomUUID();
  const sessionId = randomUUID();
  const turnId = randomUUID();
  const attemptId = randomUUID();
  let now = 100_000;
  registerSpace({ id: spaceId, name: "Gateway", slug: `gateway-${spaceId}`, rootPath: path.join(kithSpaceHome(), "gateway", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "gateway", displayName: "Gateway", status: "active" }).run();
    db.insert(schema.agentHarnessState).values({ agentId, mode: "v2" }).run();
    db.insert(schema.channels).values([
      { id: channelId, spaceId, name: "surface", type: "channel" },
      { id: privateId, spaceId, name: "secret", type: "private" },
    ]).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId, lastReadSeq: 0 }).run();
    db.insert(schema.runtimeSessions).values({
      id: sessionId, spaceId, agentId, surfaceKind: "channel", surfaceId: channelId, sessionGeneration: 1,
      runtime: "claude", runtimeConfigFingerprint: "config", adapterVersion: "v2-bridge-2",
      workspaceRootFingerprint: "root", status: "running",
    }).run();
    db.insert(schema.agentTurns).values({
      id: turnId, runtimeSessionId: sessionId, sessionGeneration: 1, spaceId, agentId,
      status: "running", effectiveDirective: "required", contextEnvelope: {},
    }).run();
    db.insert(schema.agentTurnAttempts).values({
      id: attemptId, turnId, attemptNo: 1, status: "running", workerGeneration: 4,
      leaseOwner: "test", leaseExpiresAt: new Date(now + 600_000),
    }).run();
    db.insert(schema.turnCapabilityActivations).values({
      id: "activation", turnId, attemptId, sessionGeneration: 1, workerGeneration: 4,
      claimsDigest: "test", status: "active", expiresAt: new Date(now + 600_000),
    }).run();
    const initial = db.insert(schema.messages).values({
      seq: 1, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human",
      content: "initial requirement", searchText: "initial requirement",
    }).returning().get();
    const delivery = db.insert(schema.agentDeliveryItems).values({
      spaceId, agentId, messageId: initial.id, sourceChannelId: channelId, sourceSeq: 1,
      cursorOwnerChannelId: channelId, targetSurfaceKind: "channel", targetSurfaceId: channelId,
      targetRuntimeSessionId: sessionId, directive: "required", reason: "direct_mention", policySnapshot: {},
      disposition: "bound", turnId,
    }).returning().get();
    const later = db.insert(schema.messages).values({
      seq: 2, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human",
      content: "new authoritative detail", searchText: "new authoritative detail",
    }).returning().get();
    const privateMessage = db.insert(schema.messages).values({
      seq: 3, spaceId, channelId: privateId, senderType: "human", senderId: "human", senderName: "Human",
      content: "private canonical body", searchText: "private canonical body",
    }).returning().get();
    const claims: TurnCapabilityClaims = {
      schemaVersion: 1, activationId: "activation", turnId, attemptId, sessionId, sessionGeneration: 1,
      workerGeneration: 4, spaceId, agentId, allowedOutputSurfaceIds: [channelId], allowedInputIds: [delivery.id],
      seenWatermarks: [{ channelId, throughSeq: 1 }],
      scopes: ["context.check", "turn.progress", "session.checklist", "session.schedule_wakeup", "conversation.read", "conversation.search", "turn.get", "task.read", "task.write", "capability.describe"],
      disclosureGrantIds: [], expiresAt: now + 600_000,
    };
    const gateway = new CapabilityGateway(spaceId, db, () => now);
    gateway.observeTransport(claims, "cli");
    const refreshed = gateway.contextCheck(claims, true);
    assert.equal(refreshed.capabilityMode, "cli_fallback");
    assert.equal(refreshed.inputs[0]?.id, delivery.id);
    assert.deepEqual(refreshed.later.map((message) => message.id), [later.id]);
    assert.equal(refreshed.refreshedThroughSeq, 2);
    assert.equal(db.select().from(schema.turnContextSources).where(and(
      eq(schema.turnContextSources.turnId, turnId),
      eq(schema.turnContextSources.sourceKind, "surface_watermark"),
    )).get()?.sourceRevision, 2);

    assert.deepEqual(gateway.conversationRead(claims, { channelId, limit: 10 }).messages.map((message) => message.id), [initial.id, later.id]);
    assert.deepEqual(gateway.conversationSearch(claims, { query: "authoritative", limit: 10 }).results.map((message) => message.id), [later.id]);
    assert.throws(() => gateway.conversationRead(claims, { channelId: privateId, limit: 10 }), /no longer a member/);
    db.insert(schema.channelAgentMembers).values({ channelId: privateId, agentId, lastReadSeq: 0 }).run();
    const privateRead = gateway.conversationRead(claims, { channelId: privateId, limit: 10 });
    assert.equal(privateRead.messages[0]?.projection, "ref_only");
    assert.equal(privateRead.messages[0]?.content, null);
    assert.deepEqual(gateway.conversationSearch(claims, { query: "private canonical", limit: 10 }).results, []);
    assert.equal(db.select().from(schema.turnContextSources).where(and(
      eq(schema.turnContextSources.turnId, turnId),
      eq(schema.turnContextSources.sourceId, privateMessage.id),
    )).get()?.disclosureProjection, "ref_only");

    const first = gateway.checklistUpsert(claims, {
      text: "Verify the answer", status: "in_progress", order: 1, idempotencyKey: "checklist:create",
    });
    const retry = gateway.checklistUpsert(claims, {
      text: "Verify the answer", status: "in_progress", order: 1, idempotencyKey: "checklist:create",
    });
    assert.deepEqual(retry, first);
    const item = first.item as { id: string; rowVersion: number };
    const done = gateway.checklistUpsert(claims, {
      id: item.id, text: "Verify the answer", status: "done", order: 1,
      expectedRevision: item.rowVersion, idempotencyKey: "checklist:done",
    });
    assert.equal((done.item as { status: string }).status, "done");
    assert.throws(() => gateway.checklistUpsert(claims, {
      text: "different", status: "pending", order: 2, idempotencyKey: "checklist:create",
    }), /different request/);
    assert.equal((gateway.progress(claims, { text: "Halfway", idempotencyKey: "progress:1" }).progress as { text: string }).text, "Halfway");

    const createdTask = await gateway.taskCreate(claims, {
      channel: channelId, title: "Gateway task", executionMode: "autopilot", idempotencyKey: "task:create",
    });
    assert.deepEqual(await gateway.taskCreate(claims, {
      channel: channelId, title: "Gateway task", executionMode: "autopilot", idempotencyKey: "task:create",
    }), createdTask);
    const taskId = createdTask.taskId as string;
    await assert.rejects(() => gateway.taskGet(claims, { taskId: "%%%%%%" }), /task reference is invalid/);
    assert.equal((gateway.taskList(claims, { channel: channelId }).tasks[0] as { status: string }).status, "todo");
    const [claimed, concurrentClaim] = await Promise.all([
      gateway.taskClaim(claims, { taskId, expectedRevision: 1, idempotencyKey: "task:claim" }),
      gateway.taskClaim(claims, { taskId, expectedRevision: 1, idempotencyKey: "task:claim" }),
    ]);
    assert.deepEqual(concurrentClaim, claimed);
    assert.equal(claimed.status, "in_progress");
    assert.deepEqual(await gateway.taskClaim(claims, { taskId, expectedRevision: 1, idempotencyKey: "task:claim" }), claimed);
    const reported = await gateway.taskReport(claims, {
      taskId, kind: "progress", content: "Gateway progress", idempotencyKey: "task:report",
    });
    assert.deepEqual(await gateway.taskReport(claims, {
      taskId, kind: "progress", content: "Gateway progress", idempotencyKey: "task:report",
    }), reported);
    const reportId = reported.reportMessageId as string;
    assert.equal(db.select().from(schema.messages).where(eq(schema.messages.id, reportId)).all().length, 1);
    const delivered = await gateway.taskDeliver(claims, {
      taskId, expectedRevision: claimed.revision as number, summary: "Gateway delivery", childTaskIds: [], idempotencyKey: "task:deliver",
    });
    assert.equal(delivered.status, "in_review");
    assert.deepEqual(await gateway.taskDeliver(claims, {
      taskId, expectedRevision: claimed.revision as number, summary: "Gateway delivery", childTaskIds: [], idempotencyKey: "task:deliver",
    }), delivered);
    assert.equal(db.select().from(schema.messages).where(eq(schema.messages.id, delivered.deliveryMessageId as string)).all().length, 1);

    const realTaskPort = taskGatewayPort();
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    configureTaskGatewayPort({
      ...realTaskPort,
      async report(input) {
        entered();
        await releasePromise;
        return realTaskPort.report(input);
      },
    });
    try {
      const revokedReport = gateway.taskReport(claims, {
        taskId, kind: "progress", content: "must not commit after revocation", idempotencyKey: "task:revoked",
      });
      await enteredPromise;
      db.delete(schema.channelAgentMembers).where(and(
        eq(schema.channelAgentMembers.channelId, channelId), eq(schema.channelAgentMembers.agentId, agentId),
      )).run();
      release();
      await assert.rejects(() => revokedReport, /no longer/);
      const operation = db.select().from(schema.turnOperations).where(and(
        eq(schema.turnOperations.turnId, turnId), eq(schema.turnOperations.idempotencyKey, "task:revoked"),
      )).get();
      assert.equal(operation?.status, "failed");
      assert.equal(db.select().from(schema.messages).where(eq(schema.messages.id, operation!.id)).get(), undefined);
    } finally {
      configureTaskGatewayPort(realTaskPort);
      db.insert(schema.channelAgentMembers).values({ channelId, agentId, lastReadSeq: 0 }).onConflictDoNothing().run();
    }

    const scheduled = gateway.scheduleWakeup(claims, { delaySeconds: 60, reason: "check result", idempotencyKey: "wake:1" });
    assert.equal((scheduled.wakeup as { dueAt: number }).dueAt, now + 60_000);
    now += 60_000;
    const fired = await new SessionWakeupService(spaceId, db, () => now).fireDue();
    assert.equal(fired.fired, 1);
    const wakeDelivery = db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.reason, "session_wakeup")).get();
    assert.equal(wakeDelivery?.targetRuntimeSessionId, sessionId);
    assert.equal(wakeDelivery?.directive, "optional");
    assert.equal(db.select().from(schema.sessionWakeups).where(eq(schema.sessionWakeups.id, (scheduled.wakeup as { id: string }).id)).get()?.status, "fired");

    const nextTurnId = randomUUID();
    const nextAttemptId = randomUUID();
    db.update(schema.agentTurnAttempts).set({ status: "succeeded" }).where(eq(schema.agentTurnAttempts.id, attemptId)).run();
    db.update(schema.agentTurns).set({ status: "completed" }).where(eq(schema.agentTurns.id, turnId)).run();
    db.insert(schema.agentTurns).values({
      id: nextTurnId, runtimeSessionId: sessionId, sessionGeneration: 1, spaceId, agentId,
      status: "running", effectiveDirective: "optional", contextEnvelope: {},
    }).run();
    db.insert(schema.agentTurnAttempts).values({
      id: nextAttemptId, turnId: nextTurnId, attemptNo: 1, status: "running", workerGeneration: 4,
      leaseOwner: "test", leaseExpiresAt: new Date(now + 600_000),
    }).run();
    db.insert(schema.turnCapabilityActivations).values({
      id: "activation-next", turnId: nextTurnId, attemptId: nextAttemptId, sessionGeneration: 1, workerGeneration: 4,
      claimsDigest: "test-next", status: "active", expiresAt: new Date(now + 600_000),
    }).run();
    const nextClaims = { ...claims, turnId: nextTurnId, attemptId: nextAttemptId, activationId: "activation-next" };
    const rescheduled = gateway.scheduleWakeup(nextClaims, { delaySeconds: 60, reason: "check again", idempotencyKey: "wake:1" });
    assert.notEqual((rescheduled.wakeup as { id: string }).id, (scheduled.wakeup as { id: string }).id);
    assert.equal((rescheduled.wakeup as { status: string }).status, "scheduled");
    db.update(schema.turnCapabilityActivations).set({ status: "revoked" }).where(eq(schema.turnCapabilityActivations.id, "activation-next")).run();
    assert.throws(() => gateway.checklistUpsert(nextClaims, {
      text: "must not commit", status: "pending", order: 2, idempotencyKey: "checklist:revoked",
    }), /no longer active/);
    assert.equal(db.select().from(schema.sessionChecklistItems).where(eq(schema.sessionChecklistItems.text, "must not commit")).get(), undefined);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
