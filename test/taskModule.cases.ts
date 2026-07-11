import test from "node:test";
import assert from "node:assert/strict";
import { sql, eq } from "drizzle-orm";
import { integrationDatabase } from "./helpers/workspace.ts";
import { unregisterSpace } from "../src/db/index.ts";
import { assignTask, claimTask, convertMessageToTask, createMessage, setTaskStatus } from "../src/server/core.ts";
import { getTaskDetails, reportTask, submitTaskDelivery } from "../src/server/tasks/taskService.ts";
import { TaskOperationError, parseTaskActionMetadata } from "../src/server/tasks/taskTypes.ts";

async function fixture(name: string) {
  const f = integrationDatabase(name);
  const suffix = f.spaceId.slice(0, 8);
  const agents = [];
  for (const role of ["leader", "dev", "tester"]) {
    const [agent] = await f.db.insert(f.schema.agents).values({ spaceId: f.spaceId, name: `${role}_${suffix}`, displayName: role, runtime: "claude" }).returning();
    agents.push(agent!);
    await f.db.insert(f.schema.channelAgentMembers).values({ channelId: f.all.id, agentId: agent!.id });
  }
  return { ...f, owner: f.human, channel: f.all, leader: agents[0]!, dev: agents[1]!, tester: agents[2]! };
}

function taskError(code: string) {
  return (error: unknown) => error instanceof TaskOperationError && error.code === code;
}

test("task creation and conversion roll back task number, message promotion, and thread together", async (t) => {
  const f = await fixture("task-transaction-rollback");
  t.after(() => unregisterSpace(f.spaceId));
  f.db.run(sql.raw(`CREATE TRIGGER fail_task_thread BEFORE INSERT ON channels WHEN NEW.type = 'thread' BEGIN SELECT RAISE(ABORT, 'thread failure'); END`));

  await assert.rejects(() => createMessage({
    spaceId: f.spaceId,
    channelId: f.channel.id,
    senderType: "human",
    senderId: f.owner.id,
    senderName: f.owner.name,
    content: "transactional create",
    asTask: true,
  }), /thread failure/);
  assert.equal((await f.db.select().from(f.schema.messages).where(eq(f.schema.messages.content, "transactional create"))).length, 0);
  assert.equal((await f.db.select().from(f.schema.taskNumberCounters)).length, 0);

  const plain = await createMessage({ spaceId: f.spaceId, channelId: f.channel.id, senderType: "human", senderId: f.owner.id, senderName: f.owner.name, content: "transactional convert" });
  await assert.rejects(() => convertMessageToTask(f.spaceId, plain.id, { type: "human", id: f.owner.id }), /thread failure/);
  const unchanged = (await f.db.select().from(f.schema.messages).where(eq(f.schema.messages.id, plain.id)))[0]!;
  assert.equal(unchanged.taskStatus, null);
  assert.equal(unchanged.taskNumber, null);
  assert.equal(unchanged.threadId, null);
  assert.equal((await f.db.select().from(f.schema.taskNumberCounters)).length, 0);
});

test("concurrent claim and assign have a single winner", async (t) => {
  const f = await fixture("task-concurrency");
  t.after(() => unregisterSpace(f.spaceId));
  const claimable = await createMessage({ spaceId: f.spaceId, channelId: f.channel.id, senderType: "human", senderId: f.owner.id, senderName: f.owner.name, content: "claim race", asTask: true });
  const claims = await Promise.allSettled([
    claimTask(f.spaceId, claimable.id, "agent", f.dev.id, claimable.taskRevision),
    claimTask(f.spaceId, claimable.id, "agent", f.tester.id, claimable.taskRevision),
  ]);
  assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(claims.filter((result) => result.status === "rejected" && taskError("CONFLICT")(result.reason)).length, 1);
  const claimed = (await f.db.select().from(f.schema.messages).where(eq(f.schema.messages.id, claimable.id)))[0]!;
  assert.ok(claimed.taskAssigneeId === f.dev.id || claimed.taskAssigneeId === f.tester.id);

  const assignable = await createMessage({ spaceId: f.spaceId, channelId: f.channel.id, senderType: "human", senderId: f.owner.id, senderName: f.owner.name, content: "assign race", asTask: true });
  const assigns = await Promise.allSettled([
    assignTask(f.spaceId, assignable.id, f.dev.id, { type: "human", id: f.owner.id }, assignable.taskRevision),
    assignTask(f.spaceId, assignable.id, f.tester.id, { type: "human", id: f.owner.id }, assignable.taskRevision),
  ]);
  assert.equal(assigns.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(assigns.filter((result) => result.status === "rejected" && taskError("CONFLICT")(result.reason)).length, 1);
  const assigned = (await f.db.select().from(f.schema.messages).where(eq(f.schema.messages.id, assignable.id)))[0]!;
  assert.ok(assigned.taskAssigneeId === f.dev.id || assigned.taskAssigneeId === f.tester.id);
  assert.equal(assigned.taskRevision, assignable.taskRevision + 1);
});

test("illegal task transitions are visible and leave state unchanged", async (t) => {
  const f = await fixture("task-transitions");
  t.after(() => unregisterSpace(f.spaceId));
  const task = await createMessage({ spaceId: f.spaceId, channelId: f.channel.id, senderType: "human", senderId: f.owner.id, senderName: f.owner.name, content: "transition rules", asTask: true });
  await assert.rejects(
    () => setTaskStatus(f.spaceId, task.id, "done", { type: "human", id: f.owner.id }, { from: "todo", expectedRevision: task.taskRevision }),
    taskError("INVALID_TRANSITION"),
  );
  const unchanged = (await f.db.select().from(f.schema.messages).where(eq(f.schema.messages.id, task.id)))[0]!;
  assert.equal(unchanged.taskStatus, "todo");
  assert.equal(unchanged.taskRevision, task.taskRevision);

  f.db.run(sql.raw(`CREATE TRIGGER fail_review_transition BEFORE INSERT ON messages WHEN NEW.sender_type = 'system' AND instr(NEW.content, 'to In Review') > 0 BEGIN SELECT RAISE(ABORT, 'status failure'); END`));
  const claimed = await claimTask(f.spaceId, task.id, "human", f.owner.id, task.taskRevision);
  await assert.rejects(() => setTaskStatus(f.spaceId, task.id, "in_review", { type: "human", id: f.owner.id }, { expectedRevision: claimed!.taskRevision }), /status failure/);
  const rolledBack = (await f.db.select().from(f.schema.messages).where(eq(f.schema.messages.id, task.id)))[0]!;
  assert.equal(rolledBack.taskStatus, "in_progress");
  assert.equal(rolledBack.taskRevision, claimed!.taskRevision);
});

test("thread reports and channel delivery retain queryable parent, thread, and report links", async (t) => {
  const f = await fixture("task-delivery-chain");
  t.after(() => unregisterSpace(f.spaceId));
  const root = await createMessage({ spaceId: f.spaceId, channelId: f.channel.id, senderType: "agent", senderId: f.leader.id, senderName: f.leader.name, content: "ship feature", asTask: true });
  const claimedRoot = await claimTask(f.spaceId, root.id, "agent", f.leader.id, root.taskRevision);
  const devTask = await createMessage({ spaceId: f.spaceId, channelId: f.channel.id, senderType: "agent", senderId: f.leader.id, senderName: f.leader.name, content: "implement", asTask: true, taskParentId: root.id });
  const testTask = await createMessage({ spaceId: f.spaceId, channelId: f.channel.id, senderType: "agent", senderId: f.leader.id, senderName: f.leader.name, content: "verify", asTask: true, taskParentId: root.id });

  const devReport = await reportTask({ spaceId: f.spaceId, taskId: devTask.id, actor: { type: "agent", id: f.dev.id, name: f.dev.name }, kind: "result", content: "implementation ready" });
  const testerReport = await reportTask({ spaceId: f.spaceId, taskId: testTask.id, actor: { type: "agent", id: f.tester.id, name: f.tester.name }, kind: "result", content: "tests passed" });
  const result = await submitTaskDelivery({
    spaceId: f.spaceId,
    taskId: root.id,
    actor: { type: "agent", id: f.leader.id, name: f.leader.name },
    expectedRevision: claimedRoot!.taskRevision,
    summary: "feature delivered",
    childTaskIds: [devTask.id, testTask.id],
  });

  assert.equal(result.task.taskStatus, "in_review");
  assert.equal(result.delivery.channelId, root.channelId);
  const metadata = parseTaskActionMetadata(result.delivery.actionMetadata);
  assert.equal(metadata?.kind, "task-delivery");
  if (metadata?.kind === "task-delivery") {
    assert.deepEqual(new Set(metadata.childTaskIds), new Set([devTask.id, testTask.id]));
    assert.deepEqual(new Set(metadata.sourceThreadIds), new Set([devTask.threadId!, testTask.threadId!]));
    assert.deepEqual(new Set(metadata.reportMessageIds), new Set([devReport.report.id, testerReport.report.id]));
  }
  const details = await getTaskDetails(f.spaceId, root.id);
  assert.equal(details?.children.length, 2);
  assert.equal(details?.reports.length, 2);
  assert.equal(details?.deliveries.length, 1);
});
