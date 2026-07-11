// Real DB integration: the `target=` string shown to an agent for a message MUST resolve back
// (via resolveTarget) to that message's location/thread. Regression for the thread-addressing bug:
// a task (thread-anchor) message rendered `target=#chan:<threadChannelId8>`, but resolveTarget parses
// the suffix as a PARENT MESSAGE id prefix — a thread channel id never matches a message id → null →
// the agent reusing the shown target got "404 channel not found", so thread replies silently misfired.
// Fix: fmt() emits `:<m.id8>` (the anchor message id = the thread's parent) so the round-trip resolves.
// Runs against an isolated SQLite workspace; no external services required.
import { and, eq } from "drizzle-orm";
import { integrationDatabase } from "./helpers/workspace.ts";
import { createMessage, resolveTarget } from "../src/server/core.ts";
import { addressableTarget, fmt } from "../src/server/routes-agent.ts";

const ts = Date.now();
const chName = `tr-${ts}`;
const fixture = integrationDatabase("thread-target-roundtrip");
const { db, schema, spaceId, human } = fixture;
const ownerId = human.id;
let agentId = "", channelId = "";
let failures = 0;
const check = (label: string, cond: boolean) => { console.log(`  ${cond ? "✔" : "✗ FAIL"} ${label}`); if (!cond) failures++; };

const targetOf = async (messageId: string): Promise<string> => {
  const row = (await db.select().from(schema.messages).where(eq(schema.messages.id, messageId)))[0]!;
  const ch = (await db.select().from(schema.channels).where(eq(schema.channels.id, row.channelId)))[0]!;
  const header = fmt(row, await addressableTarget(spaceId, ch, agentId));
  return header.match(/\[target=(\S+)/)![1]!; // the exact string an agent is told to reuse
};

async function setup() {
  const [ag] = await db.insert(schema.agents).values({ spaceId, name: `agent_${ts}`, displayName: "Agent" }).returning();
  agentId = ag!.id;
  const [c] = await db.insert(schema.channels).values({ spaceId, name: chName, type: "channel" }).returning();
  channelId = c!.id;
  await db.insert(schema.channelAgentMembers).values({ channelId, agentId });
}

async function cleanup() {
  const msgs = await db.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.spaceId, spaceId));
  for (const m of msgs) await db.delete(schema.messageMentions).where(eq(schema.messageMentions.messageId, m.id));
  await db.delete(schema.messages).where(eq(schema.messages.spaceId, spaceId));
  const chans = await db.select({ id: schema.channels.id }).from(schema.channels).where(eq(schema.channels.spaceId, spaceId));
  for (const c of chans) {
    await db.delete(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, c.id));
    await db.delete(schema.humanChannelStates).where(eq(schema.humanChannelStates.channelId, c.id));
  }
  await db.delete(schema.channels).where(eq(schema.channels.spaceId, spaceId));
  await db.delete(schema.agents).where(eq(schema.agents.spaceId, spaceId));
}

async function main() {
  await setup();

  console.log("\n[1] a task (thread-anchor) message's shown target round-trips to its thread");
  const task = await createMessage({ spaceId, channelId, senderType: "human", senderId: ownerId, senderName: "owner", content: "please do the thing", asTask: true });
  const taskRow = (await db.select().from(schema.messages).where(eq(schema.messages.id, task.id)))[0]!;
  check("task message has a thread (threadId set)", !!taskRow.threadId);
  const shown = await targetOf(task.id);
  console.log(`     shown target = ${shown}`);
  const resolved = await resolveTarget(spaceId, shown, agentId);
  check("shown target RESOLVES (not null) — the bug returned null", resolved !== null);
  check("shown target resolves to the message's OWN thread", resolved?.channelId === taskRow.threadId);

  console.log("\n[2] regression: a plain (non-thread) message's target resolves to its channel");
  const plain = await createMessage({ spaceId, channelId, senderType: "human", senderId: ownerId, senderName: "owner", content: "just a message" });
  const shownPlain = await targetOf(plain.id);
  console.log(`     shown target = ${shownPlain}`);
  const resolvedPlain = await resolveTarget(spaceId, shownPlain, agentId);
  check("plain target resolves to the base channel", resolvedPlain?.channelId === channelId && resolvedPlain?.threadId === null);
}

main()
  .then(cleanup)
  .then(() => { console.log(`\n${failures === 0 ? "ALL PASS ✅" : `${failures} CHECK(S) FAILED ❌`}`); process.exit(failures === 0 ? 0 : 1); })
  .catch(async (e) => { console.error("ERROR:", e); try { await cleanup(); } catch { /* */ } process.exit(1); });
