import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { assertAgentSurfaceAccessInTransaction } from "./agentSurfaceAccess.js";
import { revokeAgentChannelAccess } from "./channelAgentAccessRevocation.js";
import { transitionTaskRecord } from "../tasks/taskRepository.js";
import { registerActiveAdvisorRun } from "../advisor-provider/activeAdvisorRuns.js";
import { revokeChannelAgentAccess } from "../server/channelAccessRevocation.js";

test("channel revocation waits for matching Advisor cancellation before removing membership", async () => {
  const spaceId = randomUUID(); const agentId = randomUUID(); const channelId = randomUUID();
  registerSpace({ id: spaceId, name: "Advisor ACL", slug: `advisor-acl-${spaceId}`, rootPath: path.join(kithSpaceHome(), "advisor-acl", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "advisor-agent", displayName: "Advisor Agent", runtime: "claude", status: "active" }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "private", type: "private" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
    let cancelledWhileAuthorized = false;
    const unregister = registerActiveAdvisorRun({ runId: randomUUID(), spaceId, agentId, channelIds: [channelId], cancel: async () => {
      cancelledWhileAuthorized = Boolean(db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, channelId)).get());
    } });
    try { await revokeChannelAgentAccess(spaceId, channelId, agentId); } finally { unregister(); }
    assert.equal(cancelledWhileAuthorized, true);
    assert.equal(db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, channelId)).get(), undefined);
  } finally { closeSpaceDb(spaceId); unregisterSpace(spaceId); }
});

test("parent membership revocation atomically disables ordinary thread execution but preserves task-scoped access", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const parentId = randomUUID();
  const threadId = randomUUID();
  const taskThreadId = randomUUID();
  registerSpace({ id: spaceId, name: "ACL", slug: `acl-${spaceId}`, rootPath: path.join(kithSpaceHome(), "acl", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "acl-agent", displayName: "ACL Agent", runtime: "claude", status: "active" }).run();
    db.insert(schema.channels).values({ id: parentId, spaceId, name: "private", type: "private" }).run();
    const rootId = randomUUID();
    const taskRootId = randomUUID();
    db.insert(schema.messages).values([
      { id: rootId, seq: 1, spaceId, channelId: parentId, senderType: "human", senderId: "human", senderName: "Human", content: "root", threadId },
      { id: taskRootId, seq: 2, spaceId, channelId: parentId, senderType: "human", senderId: "human", senderName: "Human", content: "task", threadId: taskThreadId, taskStatus: "todo", taskNumber: 1 },
    ]).run();
    db.insert(schema.channels).values([
      { id: threadId, spaceId, name: "ordinary", type: "thread", parentMessageId: rootId },
      { id: taskThreadId, spaceId, name: "task", type: "thread", parentMessageId: taskRootId },
    ]).run();
    db.insert(schema.channelAgentMembers).values([
      { channelId: parentId, agentId },
      { channelId: threadId, agentId, accessKind: "member" },
      { channelId: taskThreadId, agentId, accessKind: "task_scoped", taskScope: { taskId: taskRootId } },
    ]).run();
    const sessionId = randomUUID();
    db.insert(schema.runtimeSessions).values({
      id: sessionId, spaceId, agentId, surfaceKind: "thread", surfaceId: threadId, sessionGeneration: 1,
      runtime: "claude", runtimeConfigFingerprint: "config", adapterVersion: "test", workspaceRootFingerprint: "root", status: "running",
    }).run();
    const turnId = randomUUID();
    db.insert(schema.agentTurns).values({ id: turnId, runtimeSessionId: sessionId, sessionGeneration: 1, spaceId, agentId, status: "running", effectiveDirective: "required" }).run();
    const attemptId = randomUUID();
    db.insert(schema.agentTurnAttempts).values({ id: attemptId, turnId, attemptNo: 1, status: "running", workerGeneration: 7, leaseOwner: "worker", leaseExpiresAt: new Date(Date.now() + 60_000) }).run();
    db.insert(schema.turnCapabilityActivations).values({ id: randomUUID(), turnId, attemptId, sessionGeneration: 1, workerGeneration: 7, claimsDigest: "digest", status: "active", expiresAt: new Date(Date.now() + 60_000) }).run();
    db.insert(schema.sessionWakeups).values({ runtimeSessionId: sessionId, sessionGeneration: 1, ownerAgentId: agentId, dueAt: new Date(Date.now() + 10_000), reason: "later", idempotencyKey: "wake", status: "scheduled" }).run();

    db.transaction((tx) => assertAgentSurfaceAccessInTransaction(tx, { spaceId, channelId: threadId, agentId }));
    const revoked = revokeAgentChannelAccess(spaceId, parentId, agentId, db, 123_000);
    assert.equal(revoked.changed, true);
    assert.deepEqual(revoked.threadIds, [threadId]);
    assert.deepEqual(revoked.attempts, [{ id: attemptId, workerGeneration: 7 }]);
    assert.equal(db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, sessionId)).get()?.status, "disabled");
    assert.equal(db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, turnId)).get()?.status, "cancelled");
    assert.equal(db.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, attemptId)).get()?.errorCode, "parent_access_revoked");
    assert.equal(db.select().from(schema.turnCapabilityActivations).where(eq(schema.turnCapabilityActivations.attemptId, attemptId)).get()?.status, "revoked");
    assert.equal(db.select().from(schema.sessionWakeups).where(eq(schema.sessionWakeups.runtimeSessionId, sessionId)).get()?.status, "cancelled");
    assert.throws(
      () => db.transaction((tx) => assertAgentSurfaceAccessInTransaction(tx, { spaceId, channelId: threadId, agentId })),
      /no longer a member/,
    );
    db.transaction((tx) => assertAgentSurfaceAccessInTransaction(tx, { spaceId, channelId: taskThreadId, agentId }));
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});

test("terminal task transition atomically revokes its task-scoped execution grant", () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const parentId = randomUUID();
  const taskThreadId = randomUUID();
  const taskId = randomUUID();
  registerSpace({ id: spaceId, name: "Task ACL", slug: `task-acl-${spaceId}`, rootPath: path.join(kithSpaceHome(), "task-acl", spaceId) });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "task-agent", displayName: "Task Agent", runtime: "claude", status: "active" }).run();
    db.insert(schema.channels).values({ id: parentId, spaceId, name: "private", type: "private" }).run();
    db.insert(schema.messages).values({
      id: taskId, seq: 1, spaceId, channelId: parentId, senderType: "human", senderId: "human", senderName: "Human",
      content: "task", threadId: taskThreadId, taskStatus: "in_progress", taskNumber: 1, taskAssigneeType: "agent",
      taskAssigneeId: agentId, taskClaimedAt: new Date(), taskRevision: 1,
    }).run();
    db.insert(schema.channels).values({ id: taskThreadId, spaceId, name: "task", type: "thread", parentMessageId: taskId }).run();
    db.insert(schema.channelAgentMembers).values({
      channelId: taskThreadId, agentId, accessKind: "task_scoped", taskScope: { taskId, allowedObjectIds: [taskId] },
      accessExpiresAt: new Date(Date.now() + 60_000),
    }).run();
    const sessionId = randomUUID();
    db.insert(schema.runtimeSessions).values({
      id: sessionId, spaceId, agentId, surfaceKind: "thread", surfaceId: taskThreadId, sessionGeneration: 1,
      runtime: "claude", runtimeConfigFingerprint: "config", adapterVersion: "test", workspaceRootFingerprint: "root", status: "running",
    }).run();
    const turnId = randomUUID();
    db.insert(schema.agentTurns).values({
      id: turnId, runtimeSessionId: sessionId, sessionGeneration: 1, spaceId, agentId, status: "running", effectiveDirective: "required",
    }).run();
    const attemptId = randomUUID();
    db.insert(schema.agentTurnAttempts).values({
      id: attemptId, turnId, attemptNo: 1, status: "running", workerGeneration: 7, leaseOwner: "worker",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }).run();
    db.insert(schema.turnCapabilityActivations).values({
      id: randomUUID(), turnId, attemptId, sessionGeneration: 1, workerGeneration: 7, claimsDigest: "digest", status: "active",
      expiresAt: new Date(Date.now() + 60_000),
    }).run();
    db.insert(schema.sessionWakeups).values({
      runtimeSessionId: sessionId, sessionGeneration: 1, ownerAgentId: agentId, dueAt: new Date(Date.now() + 10_000),
      reason: "later", idempotencyKey: "task-wake", status: "scheduled",
    }).run();
    const deliveryId = randomUUID();
    db.insert(schema.agentDeliveryItems).values({
      id: deliveryId, spaceId, agentId, messageId: taskId, sourceChannelId: parentId, sourceSeq: 1,
      cursorOwnerChannelId: parentId, targetSurfaceKind: "thread", targetSurfaceId: taskThreadId,
      targetRuntimeSessionId: sessionId, directive: "required", reason: "task_assignment", policySnapshot: {},
      disposition: "bound", turnId,
    }).run();

    db.transaction((tx) => assertAgentSurfaceAccessInTransaction(tx, { spaceId, channelId: taskThreadId, agentId }));
    const transitioned = transitionTaskRecord({
      spaceId, messageId: taskId, to: "closed", from: "in_progress", expectedRevision: 1,
      audit: {
        id: randomUUID(), seq: 2, spaceId, channelId: taskThreadId, senderType: "system", senderName: "System",
        content: "task closed",
      },
      agentMembership: { channelId: taskThreadId, agentId, watermark: 2 },
    });
    assert.equal(transitioned?.task.taskStatus, "closed");
    assert.equal(db.select().from(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, taskThreadId)).get(), undefined);
    assert.equal(db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, sessionId)).get()?.status, "disabled");
    assert.equal(db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, turnId)).get()?.status, "cancelled");
    assert.equal(db.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, attemptId)).get()?.errorCode, "task_scope_ended");
    assert.equal(db.select().from(schema.turnCapabilityActivations).where(eq(schema.turnCapabilityActivations.attemptId, attemptId)).get()?.status, "revoked");
    assert.equal(db.select().from(schema.sessionWakeups).where(eq(schema.sessionWakeups.runtimeSessionId, sessionId)).get()?.status, "cancelled");
    assert.equal(db.select().from(schema.agentDeliveryItems).where(eq(schema.agentDeliveryItems.id, deliveryId)).get()?.disposition, "dismissed");
    assert.equal(db.select().from(schema.agentDeliveryItems).all().every((item) => item.disposition === "dismissed"), true);
    assert.throws(
      () => db.transaction((tx) => assertAgentSurfaceAccessInTransaction(tx, { spaceId, channelId: taskThreadId, agentId })),
      /no longer a member/,
    );
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
