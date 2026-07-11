import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { dbForSpace, registerSpace, schema } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import {
  DEFAULT_MAX_DISPATCH_DEPTH,
  DEFAULT_MAX_DISPATCH_WAKES,
  SqliteDispatchState,
  decideDispatch,
  normalizeTaskExecutionMode,
  readDispatchLimits,
} from "./dispatchGuard.js";

// The unit runner executes files concurrently against one parent KITH_SPACE_HOME. Give this
// DB-backed unit its own registry so listSpaces assertions in unrelated tests stay isolated.
process.env.KITH_SPACE_HOME = path.join(process.env.KITH_SPACE_HOME ?? tmpdir(), `dispatch-guard-unit-${process.pid}`);

test("dispatch depth allows 0..4 and rejects the next agent hop", () => {
  assert.equal(DEFAULT_MAX_DISPATCH_DEPTH, 4);
  assert.deepEqual(decideDispatch({ dispatchDepth: 4, wakeCount: 0, spaceStopped: false, taskStopped: false }), { allowed: true });
  assert.equal(decideDispatch({ dispatchDepth: 5, wakeCount: 0, spaceStopped: false, taskStopped: false }).code, "DEPTH_LIMIT");
});

test("wake budget allows 16 successful wakes and rejects the next", () => {
  assert.equal(DEFAULT_MAX_DISPATCH_WAKES, 16);
  assert.deepEqual(decideDispatch({ dispatchDepth: 0, wakeCount: 15, spaceStopped: false, taskStopped: false }), { allowed: true });
  assert.equal(decideDispatch({ dispatchDepth: 0, wakeCount: 16, spaceStopped: false, taskStopped: false }).code, "WAKE_BUDGET");
});

test("dispatch limits use approved env names and fall back on empty or invalid values", () => {
  assert.deepEqual(readDispatchLimits({ KITH_SPACE_MAX_DISPATCH_DEPTH: "2", KITH_SPACE_MAX_DISPATCH_WAKES: "7" }), { maxDepth: 2, maxWakes: 7 });
  assert.deepEqual(readDispatchLimits({ KITH_SPACE_MAX_DISPATCH_DEPTH: "", KITH_SPACE_MAX_DISPATCH_WAKES: "invalid" }), { maxDepth: 4, maxWakes: 16 });
});

test("task stop and space stop take precedence over numeric limits", () => {
  assert.equal(decideDispatch({ dispatchDepth: 99, wakeCount: 99, spaceStopped: false, taskStopped: true }).code, "TASK_STOPPED");
  assert.equal(decideDispatch({ dispatchDepth: 99, wakeCount: 99, spaceStopped: true, taskStopped: true }).code, "SPACE_STOPPED");
});

test("task mode defaults to autopilot and accepts only the two approved values", () => {
  assert.equal(normalizeTaskExecutionMode(undefined), "autopilot");
  assert.equal(normalizeTaskExecutionMode("autopilot"), "autopilot");
  assert.equal(normalizeTaskExecutionMode("plan-first"), "plan-first");
  assert.equal(normalizeTaskExecutionMode("auto"), null);
});

test("SQLite adapter persists budget, same-channel context, and task/space emergency stops", async () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "dispatch-guard-test", spaceId);
  registerSpace({ id: spaceId, name: "Dispatch guard", rootPath });
  const db = dbForSpace(spaceId);
  const humanId = randomUUID();
  const channelId = (await db.select().from(schema.channels).where(eq(schema.channels.name, "all")))[0]!.id;
  const threadId = randomUUID();
  const taskId = randomUUID();
  const leaderId = randomUUID();
  await db.insert(schema.channels).values({ id: threadId, spaceId, name: `thread-${taskId}`, type: "thread", parentMessageId: taskId });
  await db.insert(schema.messages).values({
    id: taskId,
    seq: 1,
    spaceId,
    channelId,
    senderType: "human",
    senderId: humanId,
    senderName: "you",
    content: "Coordinate delivery",
    threadId,
    taskStatus: "todo",
    taskNumber: 1,
  });

  const state = new SqliteDispatchState(spaceId);
  const root = await state.resolveMessageContext({
    messageId: taskId,
    channelId,
    senderType: "human",
    senderId: humanId,
    taskMessageId: taskId,
  });
  assert.deepEqual(root, { chainId: taskId, dispatchDepth: 0, taskMessageId: taskId });
  await state.ensureChain({ ...root, rootMessageId: taskId, channelId });

  const first = await state.reserveWake({
    chainId: root.chainId,
    dispatchDepth: root.dispatchDepth,
    taskMessageId: taskId,
    messageId: taskId,
    targetAgentId: leaderId,
  });
  assert.equal(first.allowed, true);
  if (!first.allowed) return;
  await state.commitWake(first.reservationId, { agentId: leaderId, channelId: threadId, chainId: root.chainId, dispatchDepth: 0 });

  const delegated = await state.resolveMessageContext({
    messageId: randomUUID(),
    channelId: threadId,
    senderType: "agent",
    senderId: leaderId,
    taskMessageId: taskId,
  });
  assert.equal(delegated.chainId, root.chainId);
  assert.equal(delegated.dispatchDepth, 1);
  assert.equal((await state.taskStatus(taskId)).wakeCount, 1);

  await state.stopTask(taskId, "human stop");
  const taskStopped = await state.reserveWake({ ...delegated, messageId: randomUUID(), targetAgentId: randomUUID() });
  assert.equal(taskStopped.allowed ? null : taskStopped.code, "TASK_STOPPED");
  await state.resumeTask(taskId);
  const resumed = await state.reserveWake({ ...delegated, messageId: randomUUID(), targetAgentId: randomUUID() });
  assert.equal(resumed.allowed, true);
  if (resumed.allowed) await state.releaseWake(resumed.reservationId);

  await state.stopSpace("space stop");
  const spaceStopped = await state.reserveWake({ ...delegated, messageId: randomUUID(), targetAgentId: randomUUID() });
  assert.equal(spaceStopped.allowed ? null : spaceStopped.code, "SPACE_STOPPED");
  assert.equal((await state.spaceStatus()).stopped, true);
  await state.resumeSpace();
  assert.equal((await state.spaceStatus()).stopped, false);

  const persistedTask = (await db.select().from(schema.messages))[0]!;
  assert.equal(persistedTask.taskExecutionMode, "autopilot");
});
