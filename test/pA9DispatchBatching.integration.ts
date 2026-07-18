import test from "node:test";
import assert from "node:assert/strict";
import { createWakeDispatchPort } from "../src/server/messageWakeDispatchAdapter.ts";
import { resolveAgentDispatchSettings } from "../src/agents/agentResponseSettings.ts";
import { channelMembers } from "../src/channels/channelMembership.ts";
import {
  createConversationModules,
  type ConversationEventSink,
  type WakeDispatchPort,
} from "../src/messages/messagePostingModule.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

test("20-Agent response-mode, scope, and membership lookup stays batch-sized", async () => {
  const { db, schema, spaceId } = integrationDatabase("p-a9-dispatch-batch-lookups");
  const agents = await db.insert(schema.agents).values(Array.from({ length: 20 }, (_, index) => ({
    spaceId,
    name: `batch-agent-${index + 1}`,
    displayName: `Batch Agent ${index + 1}`,
    runtime: "fake",
  }))).returning();
  const channels = await db.insert(schema.channels).values([
    { spaceId, name: "batch-one", type: "channel" },
    { spaceId, name: "batch-twenty", type: "channel" },
  ]).returning();
  await db.insert(schema.channelAgentMembers).values([
    { channelId: channels[0]!.id, agentId: agents[0]!.id },
    ...agents.map((agent) => ({ channelId: channels[1]!.id, agentId: agent.id })),
  ]);

  const sqlite = db.$client;
  const originalPrepare = sqlite.prepare.bind(sqlite);
  async function measured(channelId: string, agentIds: string[]) {
    let statements = 0;
    sqlite.prepare = ((...args: Parameters<typeof originalPrepare>) => {
      statements += 1;
      return originalPrepare(...args);
    }) as typeof sqlite.prepare;
    try {
      const members = await channelMembers(spaceId, channelId);
      const settings = await resolveAgentDispatchSettings(spaceId, channelId, agentIds);
      return { members, settings, statements };
    } finally {
      sqlite.prepare = originalPrepare as typeof sqlite.prepare;
    }
  }

  const one = await measured(channels[0]!.id, [agents[0]!.id]);
  const twenty = await measured(channels[1]!.id, agents.map((agent) => agent.id));
  assert.equal(one.members.filter((member) => member.type === "agent").length, 1);
  assert.equal(twenty.members.filter((member) => member.type === "agent").length, 20);
  assert.equal(twenty.settings.length, 20);
  assert.ok(twenty.settings.every((settings) => settings.responseMode.effectiveResponseMode === "active"));
  assert.equal(twenty.statements, one.statements, "candidate lookup statements must not grow with recipient count");
});

test("message fan-out prepares all available Runtime targets once", async () => {
  const { db, schema, spaceId, human } = integrationDatabase("p-a9-dispatch-batch-wakes");
  const [channel] = await db.insert(schema.channels).values({ spaceId, name: "batch-wakes", type: "channel" }).returning();
  const agents = await db.insert(schema.agents).values(Array.from({ length: 20 }, (_, index) => ({
    spaceId,
    name: `wake-agent-${index + 1}`,
    displayName: `Wake Agent ${index + 1}`,
    runtime: "fake",
  }))).returning();
  await db.insert(schema.channelAgentMembers).values(agents.map((agent) => ({ channelId: channel!.id, agentId: agent.id })));
  let prepareCalls = 0;
  let dispatchCalls = 0;
  const wakeDispatch: WakeDispatchPort = {
    async resolveMessageContext(input) {
      return { chainId: input.messageId, dispatchDepth: 0, taskMessageId: input.taskMessageId };
    },
    async ensureChain() {},
    async prepareTargets(input) {
      prepareCalls += 1;
      assert.equal(input.targetAgents.length, 20);
      return { async dispatch() { dispatchCalls += 1; return { status: "sent" }; } };
    },
    async dispatch() { throw new Error("batched message fan-out must use its prepared dispatcher"); },
  };
  const eventSink: ConversationEventSink = { async publish() {} };
  const modules = createConversationModules({
    eventSink,
    wakeDispatch,
    introductionProof: { consume: () => true, complete() {}, restore() {} },
  });
  await modules.messagePosting.post({
    kind: "chat",
    context: { spaceId, channelId: channel!.id, sender: { type: "human", id: human.id, name: human.name } },
    content: "batch fan-out",
  });
  assert.equal(prepareCalls, 1);
  assert.equal(dispatchCalls, 20);
});

test("wake adapter deduplicates target resolution before reservation work", async () => {
  let resolveBatchCalls = 0;
  const port = createWakeDispatchPort<{ ok: true; id: string }>({
    eventSink: { async publish() {} },
    runtimeWorker: {} as never,
    async resolveTarget() { throw new Error("single resolver should not run during batch preparation"); },
    async resolveTargets(_spaceId, agentIds) {
      resolveBatchCalls += 1;
      return new Map(agentIds.map((id) => [id, { ok: true as const, id }]));
    },
    isTarget(value): value is { ok: true; id: string } { return value.ok; },
    wakeStartCommand() { throw new Error("not dispatched in this contract test"); },
    async markUnavailable() {},
  });
  await port.prepareTargets({
    spaceId: "space-1",
    targetAgents: [
      { id: "agent-1", name: "one", displayName: "One" },
      { id: "agent-1", name: "one", displayName: "One" },
      { id: "agent-2", name: "two", displayName: "Two" },
    ],
  });
  assert.equal(resolveBatchCalls, 1);
});
