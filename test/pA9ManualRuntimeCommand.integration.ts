import assert from "node:assert/strict";
import { closeAllDatabases } from "../src/db/index.ts";
import { resetAgent, startAgent, stopAgent } from "../src/server/core.ts";
import { connectAdmittingWorker } from "./helpers/admittingWorker.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

const { db, schema, spaceId } = integrationDatabase("p-a9-manual-runtime-command");
const worker = connectAdmittingWorker({ runtimes: ["fake"] });

try {
  const [agent] = await db.insert(schema.agents).values({
    spaceId,
    name: "manual-agent",
    displayName: "Manual Agent",
    runtime: "fake",
  }).returning();
  assert.ok(agent);

  assert.deepEqual(await startAgent(spaceId, agent.id), { ok: true });
  await stopAgent(spaceId, agent.id);
  await resetAgent(spaceId, agent.id, false);

  assert.equal((await db.select().from(schema.dispatchWakes)).length, 0, "manual/lifecycle commands never mint wake reservations");
  const commands = worker.messages.filter((message) => message.source === "manual" || message.source === "lifecycle");
  assert.deepEqual(commands.map((message) => ({ type: message.type, commandId: typeof message.commandId })), [
    { type: "agent:start", commandId: "string" },
    { type: "agent:stop", commandId: "string" },
    { type: "agent:reset", commandId: "string" },
  ]);
  assert.ok(commands.every((message) => message.deliveryId === undefined));
} finally {
  worker.disconnect();
  closeAllDatabases();
}
