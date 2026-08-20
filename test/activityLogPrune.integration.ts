// Real DB integration: agent_activity_log must stay bounded per agent. Trajectory entries stream
// continuously, so logActivity prunes to the newest ACTIVITY_LOG_CAP rows per agent on every insert —
// otherwise the table grows unbounded (see docs/tech-debt-tracker.md). Verifies the cap holds, the
// OLDEST rows are the ones dropped, and pruning is scoped to a single agent.
// Runs against an isolated SQLite workspace; no external services required.
// Run: npx tsx test/activityLogPrune.integration.ts
import { eq } from "drizzle-orm";
import { integrationDatabase } from "./helpers/workspace.ts";
import { pruneAgentActivityLog, logActivity, ACTIVITY_LOG_CAP } from "../src/server/ws.ts";
import { loadAgentActivitySources } from "../src/server/agentActivityPresentation.ts";
import { listConversationActivityHistory } from "../src/server/conversationActivityHistory.ts";

const ts = Date.now();
const fixture = integrationDatabase("activity-log-prune");
const { db, schema, spaceId } = fixture;
let agentId = "", otherAgentId = "";
let failures = 0;
const check = (label: string, cond: boolean) => { console.log(`  ${cond ? "✔" : "✗ FAIL"} ${label}`); if (!cond) failures++; };

const countFor = async (aid: string) =>
  (await db.select({ id: schema.agentActivityLog.id }).from(schema.agentActivityLog).where(eq(schema.agentActivityLog.agentId, aid))).length;
const tsRangeFor = async (aid: string) => {
  const rows = await db.select({ ts: schema.agentActivityLog.ts }).from(schema.agentActivityLog).where(eq(schema.agentActivityLog.agentId, aid));
  const vals = rows.map((r) => r.ts);
  return { min: Math.min(...vals), max: Math.max(...vals) };
};

async function setup() {
  const [ag] = await db.insert(schema.agents).values({ spaceId, name: `agent_${ts}`, displayName: "Agent" }).returning();
  agentId = ag!.id;
  const [ag2] = await db.insert(schema.agents).values({ spaceId, name: `agent2_${ts}`, displayName: "Agent2" }).returning();
  otherAgentId = ag2!.id;
}

async function cleanup() {
  await db.delete(schema.agentActivityLog).where(eq(schema.agentActivityLog.spaceId, spaceId));
  await db.delete(schema.agents).where(eq(schema.agents.spaceId, spaceId));
}

async function main() {
  await setup();
  const OVER = ACTIVITY_LOG_CAP + 10; // 510

  console.log(`\n[1] prune trims ${OVER} rows down to the newest ${ACTIVITY_LOG_CAP}, dropping the oldest`);
  // Distinct, increasing ts so "newest kept / oldest dropped" is deterministic (ts = base + i).
  const base = ts;
  await db.insert(schema.agentActivityLog).values(
    Array.from({ length: OVER }, (_, i) => ({ spaceId, agentId, ts: base + i, kind: "text" as const, text: `e${i}` }))
  );
  check(`inserted ${OVER} rows`, (await countFor(agentId)) === OVER);
  await pruneAgentActivityLog(spaceId, agentId);
  check(`row count capped at ${ACTIVITY_LOG_CAP}`, (await countFor(agentId)) === ACTIVITY_LOG_CAP);
  const r = await tsRangeFor(agentId);
  check("oldest 10 rows were the ones dropped (min ts = base+10)", r.min === base + 10);
  check("newest row retained (max ts = base+509)", r.max === base + OVER - 1);

  console.log("\n[2] the insert path (logActivity) keeps the table bounded");
  for (let i = 0; i < 5; i++) await logActivity(spaceId, agentId, { kind: "tool", toolName: "Read", toolInput: `f${i}` });
  check(`still capped at ${ACTIVITY_LOG_CAP} after 5 more logActivity inserts`, (await countFor(agentId)) === ACTIVITY_LOG_CAP);

  console.log("\n[3] pruning is scoped to a single agent (does not touch other agents)");
  await db.insert(schema.agentActivityLog).values(
    Array.from({ length: 20 }, (_, i) => ({ spaceId, agentId: otherAgentId, ts: base + i, kind: "text" as const, text: `o${i}` }))
  );
  await pruneAgentActivityLog(spaceId, agentId); // prune agent A again
  check("other agent's 20 rows untouched by A's prune", (await countFor(otherAgentId)) === 20);

  console.log("\n[4] activity history keeps and presents its channel / DM source");
  const [channel] = await db.insert(schema.channels).values({
    spaceId,
    name: "research",
    type: "channel",
  }).returning();
  const [dm] = await db.insert(schema.channels).values({
    spaceId,
    name: `dm:${agentId}`,
    type: "dm",
  }).returning();
  const [threadParent] = await db.insert(schema.messages).values({
    spaceId,
    channelId: channel!.id,
    seq: 1,
    senderType: "human",
    senderId: fixture.human.id,
    senderName: fixture.human.name,
    content: "Compare local-first runtime designs",
  }).returning();
  const [thread] = await db.insert(schema.channels).values({
    spaceId,
    name: `thread:${threadParent!.id}`,
    type: "thread",
    parentMessageId: threadParent!.id,
  }).returning();
  await db.insert(schema.channelAgentMembers).values({ channelId: dm!.id, agentId });
  await db.insert(schema.humanChannelStates).values({ channelId: dm!.id, dmAgentId: agentId });
  await logActivity(spaceId, agentId, {
    kind: "turn_started",
    activity: "working",
    channelId: channel!.id,
    conversationId: channel!.id,
    streamId: "turn-channel",
  });
  await logActivity(spaceId, agentId, {
    kind: "turn_started",
    activity: "working",
    channelId: dm!.id,
    conversationId: dm!.id,
    streamId: "turn-dm",
  });
  await logActivity(spaceId, agentId, {
    kind: "turn_started",
    activity: "working",
    channelId: thread!.id,
    conversationId: channel!.id,
    streamId: "turn-thread",
  });
  const scopedRows = await db.select().from(schema.agentActivityLog)
    .where(eq(schema.agentActivityLog.agentId, agentId));
  const sourceByRow = await loadAgentActivitySources(db, scopedRows);
  const channelRow = scopedRows.find((row) => row.streamId === "turn-channel")!;
  const dmRow = scopedRows.find((row) => row.streamId === "turn-dm")!;
  const threadRow = scopedRows.find((row) => row.streamId === "turn-thread")!;
  check("channel scope persists its stable ids", channelRow.channelId === channel!.id && channelRow.conversationId === channel!.id);
  check("channel source resolves a human-readable channel name", sourceByRow.get(channelRow.id)?.kind === "channel" && sourceByRow.get(channelRow.id)?.name === "research");
  check("DM source resolves the Human peer without exposing the internal dm key", sourceByRow.get(dmRow.id)?.kind === "dm" && sourceByRow.get(dmRow.id)?.name === fixture.human.name);
  check(
    "thread source resolves its parent channel and deep-link metadata",
    sourceByRow.get(threadRow.id)?.kind === "thread"
      && sourceByRow.get(threadRow.id)?.name === "research"
      && sourceByRow.get(threadRow.id)?.parentMessageId === threadParent!.id
      && sourceByRow.get(threadRow.id)?.parentPreview === "Compare local-first runtime designs",
  );

  console.log("\n[5] conversation history restores every agent in one base conversation");
  await logActivity(spaceId, otherAgentId, {
    kind: "text_preview",
    text: "another agent",
    channelId: thread!.id,
    conversationId: channel!.id,
    streamId: "turn-other",
  });
  const conversationHistory = await listConversationActivityHistory(
    db,
    spaceId,
    channel!.id,
    300,
  );
  check(
    "base conversation includes direct and thread activity from both agents",
    conversationHistory.some((row) => row.streamId === "turn-channel")
      && conversationHistory.some((row) => row.streamId === "turn-thread")
      && conversationHistory.some((row) => row.streamId === "turn-other"),
  );
  check(
    "conversation history resolves persisted agent names",
    conversationHistory.find((row) => row.streamId === "turn-other")?.name === `agent2_${ts}`,
  );
  check(
    "unrelated DM activity is excluded",
    !conversationHistory.some((row) => row.streamId === "turn-dm"),
  );
}

main()
  .then(cleanup)
  .then(() => { console.log(`\n${failures === 0 ? "ALL PASS ✅" : `${failures} CHECK(S) FAILED ❌`}`); process.exit(failures === 0 ? 0 : 1); })
  .catch(async (e) => { console.error("ERROR:", e); try { await cleanup(); } catch { /* */ } process.exit(1); });
