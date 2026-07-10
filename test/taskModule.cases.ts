import test from "node:test";
import assert from "node:assert/strict";
import { sql, eq } from "drizzle-orm";
import { integrationDatabase } from "./helpers/workspace.ts";
import { unregisterWorkspace } from "../src/db/index.ts";
import { assignTask, claimTask, convertMessageToTask, createMessage, setTaskStatus } from "../src/server/core.ts";
import { getTaskDetails, reportTask, submitTaskDelivery } from "../src/server/tasks/taskService.ts";
import { TaskOperationError, parseTaskActionMetadata } from "../src/server/tasks/taskTypes.ts";

async function fixture(name: string) {
  const f = integrationDatabase(name);
  const suffix = f.serverId.slice(0, 8);
  const [owner] = await f.db.insert(f.schema.users).values({
    name: `owner_${suffix}`,
    displayName: "Owner",
    email: `owner_${suffix}@tasks.local`,
  }).returning();
  await f.db.insert(f.schema.servers).values({ id: f.serverId, name, slug: `${name}-${suffix}`, ownerId: owner!.id, rootPath: f.rootPath });
  await f.db.insert(f.schema.serverMembers).values({ serverId: f.serverId, userId: owner!.id, role: "owner" });
  const [channel] = await f.db.insert(f.schema.channels).values({ serverId: f.serverId, name: "all", type: "channel" }).returning();
  await f.db.insert(f.schema.channelMembers).values({ channelId: channel!.id, memberType: "user", memberId: owner!.id });
  const agents = [];
  for (const name of ["leader", "dev", "tester"]) {
    const [agent] = await f.db.insert(f.schema.agents).values({ serverId: f.serverId, name: `${name}_${suffix}`, displayName: name, runtime: "claude" }).returning();
    agents.push(agent!);
    await f.db.insert(f.schema.channelMembers).values({ channelId: channel!.id, memberType: "agent", memberId: agent!.id });
  }
  return { ...f, owner: owner!, channel: channel!, leader: agents[0]!, dev: agents[1]!, tester: agents[2]! };
}

function taskError(code: string) {
  return (error: unknown) => error instanceof TaskOperationError && error.code === code;
}

test("task creation and conversion roll back task number, message promotion, and thread together", async (t) => {
  const f = await fixture("task-transaction-rollback");
  t.after(() => unregisterWorkspace(f.serverId));
  f.db.run(sql.raw(`CREATE TRIGGER fail_task_thread BEFORE INSERT ON channels WHEN NEW.type = 'thread' BEGIN SELECT RAISE(ABORT, 'thread failure'); END`));

  await assert.rejects(() => createMessage({
    serverId: f.serverId,
    channelId: f.channel.id,
    senderType: "user",
    senderId: f.owner.id,
    senderName: f.owner.name,
    content: "transactional create",
    asTask: true,
  }), /thread failure/);
  assert.equal((await f.db.select().from(f.schema.messages).where(eq(f.schema.messages.content, "transactional create"))).length, 0);
  assert.equal((await f.db.select().from(f.schema.taskNumberCounters)).length, 0);

  const plain = await createMessage({ serverId: f.serverId, channelId: f.channel.id, senderType: "user", senderId: f.owner.id, senderName: f.owner.name, content: "transactional convert" });
  await assert.rejects(() => convertMessageToTask(f.serverId, plain.id, { type: "user", id: f.owner.id }), /thread failure/);
  const unchanged = (await f.db.select().from(f.schema.messages).where(eq(f.schema.messages.id, plain.id)))[0]!;
  assert.equal(unchanged.taskStatus, null);
  assert.equal(unchanged.taskNumber, null);
  assert.equal(unchanged.threadId, null);
  assert.equal((await f.db.select().from(f.schema.taskNumberCounters)).length, 0);
});

test("concurrent claim and assign have a single winner", async (t) => {
  const f = await fixture("task-concurrency");
  t.after(() => unregisterWorkspace(f.serverId));
  const claimable = await createMessage({ serverId: f.serverId, channelId: f.channel.id, senderType: "user", senderId: f.owner.id, senderName: f.owner.name, content: "claim race", asTask: true });
  const claims = await Promise.allSettled([
    claimTask(f.serverId, claimable.id, "agent", f.dev.id, claimable.taskRevision),
    claimTask(f.serverId, claimable.id, "agent", f.tester.id, claimable.taskRevision),
  ]);
  assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(claims.filter((result) => result.status === "rejected" && taskError("CONFLICT")(result.reason)).length, 1);
  const claimed = (await f.db.select().from(f.schema.messages).where(eq(f.schema.messages.id, claimable.id)))[0]!;
  assert.ok(claimed.taskAssigneeId === f.dev.id || claimed.taskAssigneeId === f.tester.id);

  const assignable = await createMessage({ serverId: f.serverId, channelId: f.channel.id, senderType: "user", senderId: f.owner.id, senderName: f.owner.name, content: "assign race", asTask: true });
  const assigns = await Promise.allSettled([
    assignTask(f.serverId, assignable.id, f.dev.id, { type: "user", id: f.owner.id }, assignable.taskRevision),
    assignTask(f.serverId, assignable.id, f.tester.id, { type: "user", id: f.owner.id }, assignable.taskRevision),
  ]);
  assert.equal(assigns.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(assigns.filter((result) => result.status === "rejected" && taskError("CONFLICT")(result.reason)).length, 1);
  const assigned = (await f.db.select().from(f.schema.messages).where(eq(f.schema.messages.id, assignable.id)))[0]!;
  assert.ok(assigned.taskAssigneeId === f.dev.id || assigned.taskAssigneeId === f.tester.id);
  assert.equal(assigned.taskRevision, assignable.taskRevision + 1);
});

test("illegal task transitions are visible and leave state unchanged", async (t) => {
  const f = await fixture("task-transitions");
  t.after(() => unregisterWorkspace(f.serverId));
  const task = await createMessage({ serverId: f.serverId, channelId: f.channel.id, senderType: "user", senderId: f.owner.id, senderName: f.owner.name, content: "transition rules", asTask: true });
  await assert.rejects(
    () => setTaskStatus(f.serverId, task.id, "done", { type: "user", id: f.owner.id }, { from: "todo", expectedRevision: task.taskRevision }),
    taskError("INVALID_TRANSITION"),
  );
  const unchanged = (await f.db.select().from(f.schema.messages).where(eq(f.schema.messages.id, task.id)))[0]!;
  assert.equal(unchanged.taskStatus, "todo");
  assert.equal(unchanged.taskRevision, task.taskRevision);

  f.db.run(sql.raw(`CREATE TRIGGER fail_review_transition BEFORE INSERT ON messages WHEN NEW.sender_type = 'system' AND instr(NEW.content, 'to In Review') > 0 BEGIN SELECT RAISE(ABORT, 'status failure'); END`));
  const claimed = await claimTask(f.serverId, task.id, "user", f.owner.id, task.taskRevision);
  await assert.rejects(() => setTaskStatus(f.serverId, task.id, "in_review", { type: "user", id: f.owner.id }, { expectedRevision: claimed!.taskRevision }), /status failure/);
  const rolledBack = (await f.db.select().from(f.schema.messages).where(eq(f.schema.messages.id, task.id)))[0]!;
  assert.equal(rolledBack.taskStatus, "in_progress");
  assert.equal(rolledBack.taskRevision, claimed!.taskRevision);
});

test("thread reports and channel delivery retain queryable parent, thread, and report links", async (t) => {
  const f = await fixture("task-delivery-chain");
  t.after(() => unregisterWorkspace(f.serverId));
  const root = await createMessage({ serverId: f.serverId, channelId: f.channel.id, senderType: "agent", senderId: f.leader.id, senderName: f.leader.name, content: "ship feature", asTask: true });
  const claimedRoot = await claimTask(f.serverId, root.id, "agent", f.leader.id, root.taskRevision);
  const devTask = await createMessage({ serverId: f.serverId, channelId: f.channel.id, senderType: "agent", senderId: f.leader.id, senderName: f.leader.name, content: "implement", asTask: true, taskParentId: root.id });
  const testTask = await createMessage({ serverId: f.serverId, channelId: f.channel.id, senderType: "agent", senderId: f.leader.id, senderName: f.leader.name, content: "verify", asTask: true, taskParentId: root.id });

  const devReport = await reportTask({ serverId: f.serverId, taskId: devTask.id, actor: { type: "agent", id: f.dev.id, name: f.dev.name }, kind: "result", content: "implementation ready" });
  const testerReport = await reportTask({ serverId: f.serverId, taskId: testTask.id, actor: { type: "agent", id: f.tester.id, name: f.tester.name }, kind: "result", content: "tests passed" });
  const result = await submitTaskDelivery({
    serverId: f.serverId,
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
  const details = await getTaskDetails(f.serverId, root.id);
  assert.equal(details?.children.length, 2);
  assert.equal(details?.reports.length, 2);
  assert.equal(details?.deliveries.length, 1);
});
