import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../src/db/index.ts";
import { kithSpaceHome } from "../src/paths.ts";
import { agentIntroductionTokenStatus, completeAgentIntroductionTurn, consumeAgentIntroductionTurn, setAgentIntroductionTurn } from "../src/server/agentIntroduction.ts";
import { AgentIntroductionAlreadyCompletedError, AgentIntroductionTokenRejectedError, createMessage } from "../src/server/core.ts";

test("the server-authorized introduction token is single-use and revocable by a real wake", () => {
  setAgentIntroductionTurn("space", "agent", "first");
  assert.equal(consumeAgentIntroductionTurn("space", "agent", "wrong"), false);
  assert.equal(consumeAgentIntroductionTurn("space", "agent", "first"), true);
  completeAgentIntroductionTurn("space", "agent", "first");
  assert.equal(agentIntroductionTokenStatus("space", "agent", "first"), "completed");
  assert.equal(consumeAgentIntroductionTurn("space", "agent", "first"), false);

  setAgentIntroductionTurn("space", "agent", "second");
  setAgentIntroductionTurn("space", "agent", null);
  assert.equal(consumeAgentIntroductionTurn("space", "agent", "second"), false);
});

test("introduction message and completion marker commit atomically and only once", async () => {
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "agent-introduction-test", spaceId);
  registerSpace({ id: spaceId, name: "Introduction", slug: `introduction-${spaceId}`, rootPath });
  const db = dbForSpace(spaceId);

  try {
    await db.insert(schema.agents).values({ id: agentId, spaceId, name: "helper", displayName: "Helper" });
    const [humanDm] = await db.insert(schema.channels).values({ spaceId, name: `dm:${agentId}:human`, type: "dm" }).returning();
    await db.insert(schema.humanChannelStates).values({ channelId: humanDm!.id, dmAgentId: agentId });
    await db.insert(schema.channelAgentMembers).values({ channelId: humanDm!.id, agentId });

    await createMessage({
      spaceId,
      channelId: humanDm!.id,
      senderType: "agent",
      senderId: agentId,
      senderName: "helper",
      content: "ordinary wake reply",
    });
    let [agent] = await db.select().from(schema.agents).where(and(eq(schema.agents.id, agentId), eq(schema.agents.spaceId, spaceId)));
    assert.equal(agent!.introducedAt, null, "ordinary Human DM replies must not complete onboarding");

    setAgentIntroductionTurn(spaceId, agentId, "revoked-token");
    setAgentIntroductionTurn(spaceId, agentId, null);
    await assert.rejects(
      createMessage({
        spaceId,
        channelId: humanDm!.id,
        senderType: "agent",
        senderId: agentId,
        senderName: "helper",
        content: "late introduction",
        introductionAgentId: agentId,
        introductionToken: "revoked-token",
      }),
      AgentIntroductionTokenRejectedError,
    );

    setAgentIntroductionTurn(spaceId, agentId, "introduction-token");
    await createMessage({
      spaceId,
      channelId: humanDm!.id,
      senderType: "agent",
      senderId: agentId,
      senderName: "helper",
      content: "introduction",
      introductionAgentId: agentId,
      introductionToken: "introduction-token",
    });
    [agent] = await db.select().from(schema.agents).where(and(eq(schema.agents.id, agentId), eq(schema.agents.spaceId, spaceId)));
    assert.ok(agent!.introducedAt instanceof Date);

    await assert.rejects(
      createMessage({
        spaceId,
        channelId: humanDm!.id,
        senderType: "agent",
        senderId: agentId,
        senderName: "helper",
        content: "same-token duplicate introduction",
        introductionAgentId: agentId,
        introductionToken: "introduction-token",
      }),
      AgentIntroductionTokenRejectedError,
    );

    setAgentIntroductionTurn(spaceId, agentId, "duplicate-token");
    await assert.rejects(
      createMessage({
        spaceId,
        channelId: humanDm!.id,
        senderType: "agent",
        senderId: agentId,
        senderName: "helper",
        content: "duplicate introduction",
        introductionAgentId: agentId,
        introductionToken: "duplicate-token",
      }),
      AgentIntroductionAlreadyCompletedError,
    );
    const messages = await db.select().from(schema.messages).where(eq(schema.messages.senderId, agentId));
    assert.equal(messages.length, 2, "the rejected duplicate must not persist another message");
  } finally {
    setAgentIntroductionTurn(spaceId, agentId, null);
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
  }
});
