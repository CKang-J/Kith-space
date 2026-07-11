import "../src/env.ts";
import type { WebSocket } from "ws";
import { integrationDatabase } from "./helpers/workspace.ts";
import { createMessage } from "../src/server/core.ts";
import { registerWorker, unregisterWorker, updateWorkerSnapshot } from "../src/local-runtime/workerHub.ts";
import { SqliteDispatchState } from "../src/server/dispatchGuard.ts";

let failures = 0;
const check = (label: string, condition: boolean) => {
  console.log(`  ${condition ? "✔" : "✗ FAIL"} ${label}`);
  if (!condition) failures++;
};

async function main() {
  const fixture = integrationDatabase("dispatch-loop");
  const { db, schema, spaceId, human: owner } = fixture;
  const [channel] = await db.insert(schema.channels).values({ spaceId, name: "delivery", type: "channel" }).returning();
  const quietScopes = { granted: [], mode: "custom" as const, revision: 1, updatedAt: new Date().toISOString() };
  const [leader, dev, tester] = await db.insert(schema.agents).values([
    { spaceId, name: "leader", displayName: "Leader", scopes: quietScopes },
    { spaceId, name: "dev", displayName: "Dev", scopes: quietScopes },
    { spaceId, name: "tester", displayName: "Tester", scopes: quietScopes },
  ]).returning();
  await db.insert(schema.channelAgentMembers).values([
    { channelId: channel!.id, agentId: leader!.id },
    { channelId: channel!.id, agentId: dev!.id },
    { channelId: channel!.id, agentId: tester!.id },
  ]);

  const sent: Record<string, unknown>[] = [];
  const socket = { readyState: 1, send(data: string) { sent.push(JSON.parse(data)); } } as unknown as WebSocket;
  const workerLease = registerWorker(socket);
  updateWorkerSnapshot(workerLease, { runtimes: ["claude"], runningAgents: [] });
  try {
    const root = await createMessage({ spaceId, channelId: channel!.id, senderType: "human", senderId: owner!.id, senderName: owner!.name, content: "@leader coordinate this" });
    const delegated = await createMessage({ spaceId, channelId: channel!.id, senderType: "agent", senderId: leader!.id, senderName: leader!.name, content: "@dev implement; @tester verify" });
    const reported = await createMessage({ spaceId, channelId: channel!.id, senderType: "agent", senderId: dev!.id, senderName: dev!.name, content: "@leader implementation ready" });

    check("Human wake starts at depth 0", root.dispatchDepth === 0);
    check("leader delegation inherits the chain at depth 1", delegated.dispatchChainId === root.dispatchChainId && delegated.dispatchDepth === 1);
    check("dev report returns on the same chain at depth 2", reported.dispatchChainId === root.dispatchChainId && reported.dispatchDepth === 2);

    const delivers = sent.filter((message) => message.type === "agent:deliver");
    check("initial @leader wakes leader", delivers.some((message) => message.agentId === leader!.id && message.msgShort === root.id.slice(0, 8)));
    check("leader @dev wakes dev", delivers.some((message) => message.agentId === dev!.id && message.msgShort === delegated.id.slice(0, 8)));
    check("leader @tester wakes tester", delivers.some((message) => message.agentId === tester!.id && message.msgShort === delegated.id.slice(0, 8)));
    check("dev @leader report wakes leader again", delivers.some((message) => message.agentId === leader!.id && message.msgShort === reported.id.slice(0, 8)));

    const status = await new SqliteDispatchState(spaceId).spaceStatus();
    check("successful wake budget records the four deliveries", status.wakeCount === 4);
  } finally {
    unregisterWorker(workerLease);
  }
}

main()
  .then(() => { console.log(`\n${failures === 0 ? "ALL PASS ✅" : `${failures} CHECK(S) FAILED ❌`}`); process.exit(failures === 0 ? 0 : 1); })
  .catch((error) => { console.error("ERROR:", error); process.exit(1); });
