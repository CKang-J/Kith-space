// Real DB integration: resolveTarget must REJECT threading onto a SYSTEM message.
// A target like #channel:<shortid> that resolved to a system message ("X created task / claimed / moved …")
// used to silently create a thread hanging off it. System messages render with no "open thread" affordance,
// so the reply became UNREACHABLE in the UI (delivered + persisted, but invisible). resolveTarget now returns
// null for a system parent so the caller (/agent-api/message/send) surfaces TARGET_FAILED instead of burying it.
// Runs against an isolated SQLite workspace; no external services required.
import { and, eq } from "drizzle-orm";
import { integrationDatabase } from "./helpers/workspace.ts";
import { createMessage, resolveTarget } from "../src/server/core.ts";

const ts = Date.now();
const chName = `tt-${ts}`;
const fixture = integrationDatabase("thread-target");
const { db, schema, spaceId, human } = fixture;
const ownerId = human.id;
let agentId = "";
let failures = 0;
const check = (label: string, cond: boolean) => { console.log(`  ${cond ? "✔" : "✗ FAIL"} ${label}`); if (!cond) failures++; };

async function setup() {
  const [ag] = await db.insert(schema.agents).values({ spaceId, name: `agent_${ts}`, displayName: "Agent" }).returning();
  agentId = ag!.id;
  const [c] = await db.insert(schema.channels).values({ spaceId, name: chName, type: "channel" }).returning();
}

async function cleanup() {
  // FK-safe order, scoped to this run's Space only (covers threads created dynamically by resolveTarget)
  const chans = await db.select({ id: schema.channels.id }).from(schema.channels).where(eq(schema.channels.spaceId, spaceId));
  const msgs = await db.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.spaceId, spaceId));
  for (const m of msgs) await db.delete(schema.messageMentions).where(eq(schema.messageMentions.messageId, m.id));
  await db.delete(schema.messages).where(eq(schema.messages.spaceId, spaceId));
  for (const c of chans) {
    await db.delete(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, c.id));
    await db.delete(schema.humanChannelStates).where(eq(schema.humanChannelStates.channelId, c.id));
  }
  await db.delete(schema.channels).where(eq(schema.channels.spaceId, spaceId));
  await db.delete(schema.agents).where(eq(schema.agents.spaceId, spaceId));
}

async function main() {
  await setup();
  const real = await createMessage({ spaceId, channelId: (await chan()).id, senderType: "human", senderId: ownerId, senderName: "owner", content: "real parent message" });
  const sys = await createMessage({ spaceId, channelId: (await chan()).id, senderType: "system", senderId: null, senderName: "system", messageType: "system", content: "owner created task #1" });

  console.log("\n[1] threading onto a REAL (Human/agent) message still works");
  const ok = await resolveTarget(spaceId, `#${chName}:${real.id.slice(0, 8)}`, agentId);
  check("resolveTarget returns a thread channel for a real message", !!ok && typeof ok.channelId === "string");

  console.log("\n[2] threading onto a SYSTEM message is rejected (no unreachable thread)");
  const bad = await resolveTarget(spaceId, `#${chName}:${sys.id.slice(0, 8)}`, agentId);
  check("resolveTarget returns null for a system message", bad === null);
  const orphan = await db.select().from(schema.channels).where(and(eq(schema.channels.spaceId, spaceId), eq(schema.channels.parentMessageId, sys.id)));
  check("no thread channel was created off the system message", orphan.length === 0);
}

async function chan() {
  return (await db.select().from(schema.channels).where(and(eq(schema.channels.spaceId, spaceId), eq(schema.channels.name, chName))))[0]!;
}

main()
  .then(cleanup)
  .then(() => { console.log(`\n${failures === 0 ? "ALL PASS ✅" : `${failures} CHECK(S) FAILED ❌`}`); process.exit(failures === 0 ? 0 : 1); })
  .catch(async (e) => { console.error("ERROR:", e); try { await cleanup(); } catch { /* */ } process.exit(1); });
