import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import type { WebSocket } from "ws";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import {
  registerWorker,
  resolveWorkerAdmission,
  unregisterWorker,
  updateWorkerSnapshot,
  type WorkerLease,
} from "../local-runtime/workerHub.js";
import { kithSpaceHome } from "../paths.js";
import { startAgent } from "./core.js";

test("a queued manual start does not claim the Agent is already working", async () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "queued-agent-start", spaceId);
  registerSpace({ id: spaceId, name: "Queued start", slug: `queued-${spaceId}`, rootPath });
  const db = dbForSpace(spaceId);
  await db.insert(schema.agents).values({
    id: agentId,
    spaceId,
    name: "queued-agent",
    displayName: "Queued Agent",
    runtime: "fake",
  });

  let lease: WorkerLease;
  const socket = {
    readyState: 1,
    send(data: string) {
      const message = JSON.parse(data) as { generation: number; commandId: string };
      queueMicrotask(() => resolveWorkerAdmission(lease, {
        type: "worker:admission",
        generation: message.generation,
        commandId: message.commandId,
        status: "queued",
      }));
    },
    close() { /* controlled by the test */ },
  } as unknown as WebSocket;
  lease = registerWorker(socket);
  updateWorkerSnapshot(lease, { runtimes: ["fake"], runningAgents: [] });

  try {
    assert.deepEqual(await startAgent(spaceId, agentId), { ok: true });
    const agent = db.select().from(schema.agents).get()!;
    assert.equal(agent.status, "inactive");
    assert.equal(agent.activity, "offline");
  } finally {
    unregisterWorker(lease);
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
