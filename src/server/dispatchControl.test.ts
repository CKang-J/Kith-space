import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { dbForSpace, registerSpace, schema } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { registerWorker, resolveWorkerAdmission, unregisterWorker, type WorkerLease } from "../local-runtime/workerHub.js";
import { resumeSpaceDispatch, resumeTaskDispatch, stopSpaceDispatch, stopTaskDispatch } from "./dispatchControl.js";
import { SqliteDispatchState } from "./dispatchGuard.js";

process.env.KITH_SPACE_HOME = path.join(process.env.KITH_SPACE_HOME ?? tmpdir(), `dispatch-control-unit-${process.pid}`);

test("task stop interrupts involved agents while space stop interrupts every live agent", async () => {
  const spaceId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "dispatch-control-test", spaceId);
  registerSpace({ id: spaceId, name: "Dispatch control", rootPath });
  const db = dbForSpace(spaceId);
  const channelId = randomUUID();
  const taskId = randomUUID();
  const involvedAgentId = randomUUID();
  const otherAgentId = randomUUID();
  await db.insert(schema.channels).values({ id: channelId, spaceId, name: "dispatch", type: "channel" });
  await db.insert(schema.agents).values([
    { id: involvedAgentId, spaceId, name: "leader", displayName: "Leader" },
    { id: otherAgentId, spaceId, name: "tester", displayName: "Tester" },
  ]);

  const sent: Record<string, unknown>[] = [];
  let workerLease: WorkerLease;
  const socket = {
    readyState: 1,
    send(data: string) {
      const message = JSON.parse(data);
      sent.push(message);
      if (typeof message.generation === "number" && typeof message.commandId === "string") {
        queueMicrotask(() => resolveWorkerAdmission(workerLease, {
          type: "worker:admission",
          generation: message.generation,
          commandId: message.commandId,
          status: "admitted",
        }));
      }
    },
  } as unknown as WebSocket;
  workerLease = registerWorker(socket);
  try {
    const state = new SqliteDispatchState(spaceId);
    await state.ensureChain({ chainId: taskId, dispatchDepth: 0, taskMessageId: taskId, rootMessageId: taskId, channelId });
    const wake = await state.getOrReserveWake({ chainId: taskId, dispatchDepth: 0, taskMessageId: taskId, messageId: taskId, targetAgentId: involvedAgentId });
    assert.equal(wake.allowed, true);
    if (!wake.allowed) return;
    await state.commitWake(wake.reservationId, { agentId: involvedAgentId, channelId, chainId: taskId, dispatchDepth: 0 });

    const taskStopped = await stopTaskDispatch(spaceId, taskId, "task emergency stop");
    assert.equal(taskStopped.stopped, true);
    assert.deepEqual(taskStopped.stoppedAgentIds, [involvedAgentId]);
    assert.deepEqual(sent.filter((msg) => msg.type === "agent:stop").map((msg) => msg.agentId), [involvedAgentId]);
    assert.equal((await resumeTaskDispatch(spaceId, taskId)).stopped, false);

    sent.length = 0;
    const spaceStopped = await stopSpaceDispatch(spaceId, "space emergency stop");
    assert.equal(spaceStopped.stopped, true);
    assert.deepEqual(new Set(spaceStopped.stoppedAgentIds), new Set([involvedAgentId, otherAgentId]));
    assert.deepEqual(new Set(sent.filter((msg) => msg.type === "agent:stop").map((msg) => msg.agentId)), new Set([involvedAgentId, otherAgentId]));
    assert.equal((await resumeSpaceDispatch(spaceId)).stopped, false);
  } finally {
    unregisterWorker(workerLease);
  }
});
