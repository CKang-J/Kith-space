// Real DB integration for task handoff.
// Verifies assignTask updates assignee, preserves/advances status correctly,
// records the handoff in the task thread, and adds the assignee to that thread.
// Runs against an isolated SQLite workspace; no external services required.
import "../src/env.ts";
import { and, eq } from "drizzle-orm";
import { integrationDatabase } from "./helpers/workspace.ts";
import { assignTask, claimTask, convertMessageToTask, createMessage, setTaskStatus } from "../src/server/core.ts";

const ts = Date.now();
let failures = 0;
const check = (label: string, cond: boolean) => { console.log(`  ${cond ? "✔" : "✗ FAIL"} ${label}`); if (!cond) failures++; };

const fixture = integrationDatabase("task-assign");
const { db, schema, spaceId, human, all } = fixture;
const ownerId = human.id;
const channelId = all.id;
let srcAgentId = "";
let dstAgentId = "";
let deletedAgentId = "";

async function setup() {
  const [src] = await db.insert(schema.agents).values({
    spaceId,
    name: `src_${ts}`,
    displayName: "Source Agent",
    runtime: "claude",
    model: "sonnet",
  }).returning();
  srcAgentId = src!.id;

  const [dst] = await db.insert(schema.agents).values({
    spaceId,
    name: `dst_${ts}`,
    displayName: "Destination Agent",
    runtime: "claude",
    model: "sonnet",
  }).returning();
  dstAgentId = dst!.id;

  const [deleted] = await db.insert(schema.agents).values({
    spaceId,
    name: `deleted_${ts}`,
    displayName: "Deleted Agent",
    runtime: "claude",
    model: "sonnet",
  }).returning();
  deletedAgentId = deleted!.id;
  await db.update(schema.agents).set({ deletedAt: new Date() }).where(eq(schema.agents.id, deletedAgentId));

  await db.insert(schema.channelAgentMembers).values([
    { channelId, agentId: srcAgentId },
    { channelId, agentId: dstAgentId },
  ]).onConflictDoNothing();
}

async function cleanup() {
  const msgs = await db.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.spaceId, spaceId));
  for (const m of msgs) await db.delete(schema.messageMentions).where(eq(schema.messageMentions.messageId, m.id));
  await db.delete(schema.messages).where(eq(schema.messages.spaceId, spaceId));

  const chans = await db.select({ id: schema.channels.id }).from(schema.channels).where(eq(schema.channels.spaceId, spaceId));
  for (const c of chans) await db.delete(schema.channelAgentMembers).where(eq(schema.channelAgentMembers.channelId, c.id));
  await db.delete(schema.channels).where(eq(schema.channels.spaceId, spaceId));

  await db.delete(schema.agents).where(and(eq(schema.agents.spaceId, spaceId), eq(schema.agents.id, srcAgentId)));
  await db.delete(schema.agents).where(and(eq(schema.agents.spaceId, spaceId), eq(schema.agents.id, dstAgentId)));
  await db.delete(schema.agents).where(eq(schema.agents.id, deletedAgentId));
}

async function main() {
  await setup();

  console.log("\n[1] assign todo task -> destination agent, status becomes in_progress");
  const msg1 = await createMessage({ spaceId, channelId, senderType: "human", senderId: ownerId, senderName: `owner_${ts}`, content: "handoff todo" });
  const task1 = await convertMessageToTask(spaceId, msg1.id, { type: "human", id: ownerId });
  const assigned1 = await assignTask(spaceId, task1!.id, dstAgentId, { type: "agent", id: srcAgentId });
  check("assignTask returns an updated task", !!assigned1);
  check("assignee type becomes agent", assigned1?.taskAssigneeType === "agent");
  check("assignee id becomes destination agent", assigned1?.taskAssigneeId === dstAgentId);
  check("todo becomes in_progress on handoff", assigned1?.taskStatus === "in_progress");

  console.log("\n[2] assign in_review task preserves current status");
  const msg2 = await createMessage({ spaceId, channelId, senderType: "human", senderId: ownerId, senderName: `owner_${ts}`, content: "handoff review" });
  const task2 = await convertMessageToTask(spaceId, msg2.id, { type: "human", id: ownerId });
  await claimTask(spaceId, task2!.id, "agent", srcAgentId);
  await setTaskStatus(spaceId, task2!.id, "in_review", { type: "agent", id: srcAgentId });
  const assigned2 = await assignTask(spaceId, task2!.id, dstAgentId, { type: "agent", id: srcAgentId });
  check("handoff preserves in_review status", assigned2?.taskStatus === "in_review");

  console.log("\n[3] handoff writes a system message into the task thread");
  const sysRows = assigned2?.threadId
    ? await db.select().from(schema.messages).where(and(eq(schema.messages.channelId, assigned2.threadId), eq(schema.messages.senderType, "system")))
    : [];
  check("thread exists on assigned task", !!assigned2?.threadId);
  check("thread contains a handoff system message", sysRows.some((m) => m.content.includes("assigned") && m.content.includes(`#${assigned2?.taskNumber}`) && m.content.includes("Destination Agent")));

  console.log("\n[4] destination agent is added to the task thread");
  const threadMember = assigned2?.threadId
    ? (await db.select().from(schema.channelAgentMembers).where(and(eq(schema.channelAgentMembers.channelId, assigned2.threadId), eq(schema.channelAgentMembers.agentId, dstAgentId))))[0]
    : null;
  check("destination agent is a thread member after handoff", !!threadMember);

  console.log("\n[5] deleted target agent is rejected");
  const msg3 = await createMessage({ spaceId, channelId, senderType: "human", senderId: ownerId, senderName: `owner_${ts}`, content: "handoff fail" });
  const task3 = await convertMessageToTask(spaceId, msg3.id, { type: "human", id: ownerId });
  const rejected = await assignTask(spaceId, task3!.id, deletedAgentId, { type: "agent", id: srcAgentId });
  check("assignTask returns null for a deleted target agent", rejected === null);

  console.log("\n[6] assigning to the same assignee is idempotent (no duplicate audit)");
  const msg4 = await createMessage({ spaceId, channelId, senderType: "human", senderId: ownerId, senderName: `owner_${ts}`, content: "handoff idempotent" });
  const task4 = await convertMessageToTask(spaceId, msg4.id, { type: "human", id: ownerId });
  const first = await assignTask(spaceId, task4!.id, dstAgentId, { type: "agent", id: srcAgentId });
  const before = await db.select().from(schema.messages).where(and(eq(schema.messages.channelId, first!.threadId!), eq(schema.messages.senderType, "system")));
  const second = await assignTask(spaceId, task4!.id, dstAgentId, { type: "agent", id: srcAgentId });
  const after = await db.select().from(schema.messages).where(and(eq(schema.messages.channelId, first!.threadId!), eq(schema.messages.senderType, "system")));
  check("same-assignee retry returns the existing task", second?.id === first?.id);
  check("same-assignee retry does not append another system handoff message", after.length === before.length);
}

main()
  .then(cleanup)
  .then(() => { console.log(`\n${failures === 0 ? "ALL PASS ✅" : `${failures} CHECK(S) FAILED ❌`}`); process.exit(failures === 0 ? 0 : 1); })
  .catch(async (e) => { console.error("ERROR:", e); try { await cleanup(); } catch { /* */ } process.exit(1); });
