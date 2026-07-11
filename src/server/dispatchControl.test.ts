import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { dbFor, registerWorkspace, schema } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { registerWorker, unregisterWorker } from "../local-runtime/workerHub.js";
import { resumeSpaceDispatch, resumeTaskDispatch, stopSpaceDispatch, stopTaskDispatch } from "./dispatchControl.js";
import { SqliteDispatchState } from "./dispatchGuard.js";

process.env.KITH_SPACE_HOME = path.join(process.env.KITH_SPACE_HOME ?? tmpdir(), `dispatch-control-unit-${process.pid}`);

test("task stop interrupts involved agents while space stop interrupts every live agent", async () => {
  const serverId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "dispatch-control-test", serverId);
  registerWorkspace({ id: serverId, name: "Dispatch control", rootPath });
  const db = dbFor(serverId);
  const ownerId = randomUUID();
  const channelId = randomUUID();
  const taskId = randomUUID();
  const involvedAgentId = randomUUID();
  const otherAgentId = randomUUID();
  await db.insert(schema.users).values({ id: ownerId, name: "owner", displayName: "Owner", email: `${serverId}@test.local` });
  await db.insert(schema.servers).values({ id: serverId, name: "Dispatch control", slug: serverId, ownerId, rootPath });
  await db.insert(schema.channels).values({ id: channelId, serverId, name: "all", type: "channel" });
  await db.insert(schema.agents).values([
    { id: involvedAgentId, serverId, name: "leader", displayName: "Leader" },
    { id: otherAgentId, serverId, name: "tester", displayName: "Tester" },
  ]);

  const sent: Record<string, unknown>[] = [];
  const socket = {
    readyState: 1,
    send(data: string) { sent.push(JSON.parse(data)); },
  } as unknown as WebSocket;
  const workerLease = registerWorker(socket);
  try {
    const state = new SqliteDispatchState(serverId);
    await state.ensureChain({ chainId: taskId, dispatchDepth: 0, taskMessageId: taskId, rootMessageId: taskId, channelId });
    const wake = await state.reserveWake({ chainId: taskId, dispatchDepth: 0, taskMessageId: taskId, messageId: taskId, targetAgentId: involvedAgentId });
    assert.equal(wake.allowed, true);
    if (!wake.allowed) return;
    await state.commitWake(wake.reservationId, { agentId: involvedAgentId, channelId, chainId: taskId, dispatchDepth: 0 });

    const taskStopped = await stopTaskDispatch(serverId, taskId, "task emergency stop");
    assert.equal(taskStopped.stopped, true);
    assert.deepEqual(taskStopped.stoppedAgentIds, [involvedAgentId]);
    assert.deepEqual(sent.filter((msg) => msg.type === "agent:stop").map((msg) => msg.agentId), [involvedAgentId]);
    assert.equal((await resumeTaskDispatch(serverId, taskId)).stopped, false);

    sent.length = 0;
    const spaceStopped = await stopSpaceDispatch(serverId, "space emergency stop");
    assert.equal(spaceStopped.stopped, true);
    assert.deepEqual(new Set(spaceStopped.stoppedAgentIds), new Set([involvedAgentId, otherAgentId]));
    assert.deepEqual(new Set(sent.filter((msg) => msg.type === "agent:stop").map((msg) => msg.agentId)), new Set([involvedAgentId, otherAgentId]));
    assert.equal((await resumeSpaceDispatch(serverId)).stopped, false);
  } finally {
    unregisterWorker(workerLease);
  }
});
