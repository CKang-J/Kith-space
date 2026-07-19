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

test("a v2 manual start returns only a body-free per-surface inbox summary", async () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const privateId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "v2-manual-summary", spaceId);
  registerSpace({ id: spaceId, name: "V2 summary", slug: `v2-summary-${spaceId}`, rootPath });
  const db = dbForSpace(spaceId);
  try {
    db.insert(schema.agents).values({
      id: agentId, spaceId, name: "summary-agent", displayName: "Summary Agent", status: "inactive",
    }).run();
    db.insert(schema.agentHarnessState).values({ agentId, mode: "v2" }).run();
    db.insert(schema.channels).values([
      { id: channelId, spaceId, name: "public-summary", type: "channel" },
      { id: privateId, spaceId, name: "private-summary", type: "private" },
    ]).run();
    const messages = db.insert(schema.messages).values([
      { seq: 1, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human", content: "public body must stay hidden" },
      { seq: 2, spaceId, channelId: privateId, senderType: "human", senderId: "human", senderName: "Human", content: "private body must stay hidden" },
    ]).returning().all();
    db.insert(schema.agentDeliveryItems).values(messages.map((message, index) => ({
      spaceId,
      agentId,
      messageId: message.id,
      sourceChannelId: message.channelId,
      sourceSeq: message.seq,
      cursorOwnerChannelId: message.channelId,
      targetSurfaceKind: index === 0 ? "channel" as const : "private" as const,
      targetSurfaceId: message.channelId,
      directive: index === 0 ? "required" as const : "optional" as const,
      reason: "manual-summary-test",
      policySnapshot: {},
      disposition: "pending" as const,
    }))).run();

    const result = await startAgent(spaceId, agentId);
    assert.equal(result.ok, true);
    assert.equal(result.inboxSummary?.pendingCount, 2);
    assert.deepEqual(result.inboxSummary?.surfaces.map((surface) => ({
      surfaceKind: surface.surfaceKind,
      count: surface.count,
      required: surface.required,
    })).sort((left, right) => left.surfaceKind.localeCompare(right.surfaceKind)), [
      { surfaceKind: "channel", count: 1, required: 1 },
      { surfaceKind: "private", count: 1, required: 0 },
    ]);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("public body"), false);
    assert.equal(serialized.includes("private body"), false);
  } finally {
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
