import "../src/env.ts";
import type { WebSocket } from "ws";
import { initializeHumanProfile } from "../src/app-data/appDatabase.ts";
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
  const { db, schema, serverId, rootPath } = fixture;
  const human = initializeHumanProfile({ name: "Ada", email: `${serverId}@test.local` });
  const [owner] = await db.insert(schema.users).values({ id: human.id, name: "you", displayName: human.name, email: human.email! }).returning();
  await db.insert(schema.servers).values({ id: serverId, name: "Dispatch loop", slug: serverId, ownerId: human.id, rootPath });
  const [channel] = await db.insert(schema.channels).values({ serverId, name: "delivery", type: "channel" }).returning();
  const quietScopes = { granted: [], mode: "custom" as const, revision: 1, updatedAt: new Date().toISOString() };
  const [leader, dev, tester] = await db.insert(schema.agents).values([
    { serverId, name: "leader", displayName: "Leader", scopes: quietScopes },
    { serverId, name: "dev", displayName: "Dev", scopes: quietScopes },
    { serverId, name: "tester", displayName: "Tester", scopes: quietScopes },
  ]).returning();
  await db.insert(schema.channelMembers).values([
    { channelId: channel!.id, memberType: "user", memberId: owner!.id },
    { channelId: channel!.id, memberType: "agent", memberId: leader!.id },
    { channelId: channel!.id, memberType: "agent", memberId: dev!.id },
    { channelId: channel!.id, memberType: "agent", memberId: tester!.id },
  ]);

  const sent: Record<string, unknown>[] = [];
  const socket = { readyState: 1, send(data: string) { sent.push(JSON.parse(data)); } } as unknown as WebSocket;
  const workerLease = registerWorker(socket);
  updateWorkerSnapshot(workerLease, { runtimes: ["claude"], runningAgents: [] });
  try {
    const root = await createMessage({ serverId, channelId: channel!.id, senderType: "user", senderId: owner!.id, senderName: owner!.name, content: "@leader coordinate this" });
    const delegated = await createMessage({ serverId, channelId: channel!.id, senderType: "agent", senderId: leader!.id, senderName: leader!.name, content: "@dev implement; @tester verify" });
    const reported = await createMessage({ serverId, channelId: channel!.id, senderType: "agent", senderId: dev!.id, senderName: dev!.name, content: "@leader implementation ready" });

    check("user wake starts at depth 0", root.dispatchDepth === 0);
    check("leader delegation inherits the chain at depth 1", delegated.dispatchChainId === root.dispatchChainId && delegated.dispatchDepth === 1);
    check("dev report returns on the same chain at depth 2", reported.dispatchChainId === root.dispatchChainId && reported.dispatchDepth === 2);

    const delivers = sent.filter((message) => message.type === "agent:deliver");
    check("initial @leader wakes leader", delivers.some((message) => message.agentId === leader!.id && message.msgShort === root.id.slice(0, 8)));
    check("leader @dev wakes dev", delivers.some((message) => message.agentId === dev!.id && message.msgShort === delegated.id.slice(0, 8)));
    check("leader @tester wakes tester", delivers.some((message) => message.agentId === tester!.id && message.msgShort === delegated.id.slice(0, 8)));
    check("dev @leader report wakes leader again", delivers.some((message) => message.agentId === leader!.id && message.msgShort === reported.id.slice(0, 8)));

    const status = await new SqliteDispatchState(serverId).spaceStatus();
    check("successful wake budget records the four deliveries", status.wakeCount === 4);
  } finally {
    unregisterWorker(workerLease);
  }
}

main()
  .then(() => { console.log(`\n${failures === 0 ? "ALL PASS ✅" : `${failures} CHECK(S) FAILED ❌`}`); process.exit(failures === 0 ? 0 : 1); })
  .catch((error) => { console.error("ERROR:", error); process.exit(1); });
