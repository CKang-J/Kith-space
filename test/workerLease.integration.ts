import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { WebSocket } from "ws";
import { closeAllDatabases, dbForSpace, schema } from "../src/db/index.ts";
import { ensurePersonalApp } from "../src/db/personalApp.ts";
import { registerWorker, unregisterWorker } from "../src/local-runtime/workerHub.ts";
import { markAllAgentsOffline, reconcileWorkerReady } from "../src/server/ws.ts";

function fakeWorker(): WebSocket {
  return {
    readyState: 1,
    send() {},
    close() {},
  } as unknown as WebSocket;
}

const root = process.env.KITH_SPACE_HOME;
assert.ok(root, "KITH_SPACE_HOME is required");

try {
  const { home } = await ensurePersonalApp({ name: "Ada", homeRootPath: path.join(root, "home") });
  const db = dbForSpace(home.id);
  const agentId = randomUUID();
  await db.insert(schema.agents).values({
    id: agentId,
    serverId: home.id,
    name: "lease-agent",
    displayName: "Lease Agent",
    status: "inactive",
    activity: "offline",
  });

  // A ready reconciliation pauses on its first DB await. If a newer Worker takes over there,
  // the stale generation must not promote the agent using its old runningAgents snapshot.
  const firstLease = registerWorker(fakeWorker());
  const staleReady = reconcileWorkerReady([agentId], firstLease);
  const secondLease = registerWorker(fakeWorker());
  assert.equal(await staleReady, false);
  let agent = (await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)))[0]!;
  assert.equal(agent.status, "inactive");
  assert.equal(agent.activity, "offline");

  // Likewise, disconnect reconciliation may run only while its generation remains the latest.
  await db.update(schema.agents).set({ status: "active", activity: "working" }).where(eq(schema.agents.id, agentId));
  assert.equal(unregisterWorker(secondLease), true);
  const staleDisconnect = markAllAgentsOffline(secondLease);
  const thirdLease = registerWorker(fakeWorker());
  assert.equal(await staleDisconnect, false);
  agent = (await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)))[0]!;
  assert.equal(agent.status, "active");
  assert.equal(agent.activity, "working");

  // The current generation still performs normal reconciliation, and sleeping remains durable.
  assert.equal(await reconcileWorkerReady([], thirdLease), true);
  agent = (await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)))[0]!;
  assert.equal(agent.status, "inactive");
  assert.equal(agent.activity, "offline");
  await db.update(schema.agents).set({ status: "sleeping", activity: "sleeping" }).where(eq(schema.agents.id, agentId));
  assert.equal(await reconcileWorkerReady([], thirdLease), true);
  assert.equal(unregisterWorker(thirdLease), true);
  assert.equal(await markAllAgentsOffline(thirdLease), true);
  agent = (await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)))[0]!;
  assert.equal(agent.status, "sleeping");
  assert.equal(agent.activity, "sleeping");
} finally {
  closeAllDatabases();
}
