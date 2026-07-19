// Integration test for /agent-api/task/assign.
// Verifies agent-side task handoff works by message id and by channel + task number.
// Runs against an isolated SQLite workspace; no external services required.
import "../src/env.ts";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { and, eq } from "drizzle-orm";
import { integrationDatabase } from "./helpers/workspace.ts";
import { handleAgentApi } from "../src/server/routes-agent.ts";
import {
  agentConfig,
  assignTask,
  createMessage,
  convertMessageToTask,
  setTaskStatus,
  unclaimTask,
} from "../src/server/core.ts";

const ts = Date.now();
let failures = 0;
const check = (label: string, cond: boolean) => { console.log(`  ${cond ? "✔" : "✗ FAIL"} ${label}`); if (!cond) failures++; };

const fixture = integrationDatabase("task-assign-agent");
const { db, schema, spaceId, human, all } = fixture;
const ownerId = human.id;
const channelId = all.id;
const channelName = all.name;
let privateChannelId = "";
let privateChannelName = "";
let dmChannelId = "";
let assignerId = "";
let assigneeId = "";
let replacementId = "";
let assignerToken = "";

function mkReq(path: string, token: string, agentId: string, body?: unknown) {
  const raw = body ? JSON.stringify(body) : "";
  const readable = Readable.from(raw ? [Buffer.from(raw)] : []);
  return Object.assign(readable, {
    method: "POST",
    url: path,
    headers: {
      authorization: `Bearer ${token}`,
      "x-agent-id": agentId,
      "content-type": "application/json",
    },
  }) as unknown as IncomingMessage;
}

function mkRes() {
  let status = 0;
  let raw = "";
  const emitter = new EventEmitter();
  const finished = EventEmitter.once(emitter, "finish");
  const res = Object.assign(emitter, {
    statusCode: 0,
    headersSent: false,
    setHeader() {},
    writeHead(c: number) { status = c; this.statusCode = c; },
    end(d?: string | Buffer) { raw = d ? String(d) : ""; emitter.emit("finish"); },
  }) as unknown as ServerResponse;
  return { res, done: () => finished, status: () => status, body: () => (raw ? JSON.parse(raw) : {}) };
}

async function call(path: string, token: string, agentId: string, body?: unknown) {
  const { res, done, status, body: getBody } = mkRes();
  await handleAgentApi(mkReq(path, token, agentId, body), res, new URL(`http://localhost${path}`), "POST");
  await done();
  return { status: status(), body: getBody() };
}

async function setup() {
  const [priv] = await db.insert(schema.channels).values({ spaceId, name: `priv_${ts}`, type: "private" }).returning();
  privateChannelId = priv!.id;
  privateChannelName = priv!.name;

  const [assigner] = await db.insert(schema.agents).values({
    spaceId,
    name: `assigner_${ts}`,
    displayName: "Assigner",
    runtime: "claude",
    model: "sonnet",
    creatorType: "human",
    creatorId: ownerId,
  }).returning();
  assignerId = assigner!.id;

  const [assignee] = await db.insert(schema.agents).values({
    spaceId,
    name: `assignee_${ts}`,
    displayName: "Assignee",
    runtime: "claude",
    model: "sonnet",
    creatorType: "human",
    creatorId: ownerId,
  }).returning();
  assigneeId = assignee!.id;
  const [replacement] = await db.insert(schema.agents).values({
    spaceId,
    name: `replacement_${ts}`,
    displayName: "Replacement",
    runtime: "claude",
    model: "sonnet",
    creatorType: "human",
    creatorId: ownerId,
  }).returning();
  replacementId = replacement!.id;

  await db.insert(schema.channelAgentMembers).values([
    { channelId, agentId: assignerId },
    { channelId, agentId: assigneeId },
    { channelId: privateChannelId, agentId: assignerId },
  ]).onConflictDoNothing();

  const [dm] = await db.insert(schema.channels).values({ spaceId, name: `dm:${[ownerId, assignerId].sort().join(":")}`, type: "dm" }).returning();
  dmChannelId = dm!.id;
  await db.insert(schema.channelAgentMembers).values({ channelId: dmChannelId, agentId: assignerId }).onConflictDoNothing();
  await db.insert(schema.humanChannelStates).values({ channelId: dmChannelId, dmAgentId: assignerId }).onConflictDoNothing();

  const cfg = await agentConfig(spaceId, assignerId);
  if (!cfg?.agentToken) throw new Error("assigner token was not minted");
  assignerToken = cfg.agentToken;
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

  await db.delete(schema.agents).where(and(eq(schema.agents.spaceId, spaceId), eq(schema.agents.id, assignerId)));
  await db.delete(schema.agents).where(and(eq(schema.agents.spaceId, spaceId), eq(schema.agents.id, assigneeId)));
  await db.delete(schema.agents).where(and(eq(schema.agents.spaceId, spaceId), eq(schema.agents.id, replacementId)));
}

async function main() {
  await setup();
  console.log("\n[1] /agent-api/task/assign by message id");
  const msg1 = await createMessage({ spaceId, channelId, senderType: "human", senderId: ownerId, senderName: `owner_assign_${ts}`, content: "assign by id" });
  const task1 = await convertMessageToTask(spaceId, msg1.id, { type: "human", id: ownerId });
  const byId = await call("/agent-api/task/assign", assignerToken, assignerId, { messageId: task1!.id, to: `@assignee_${ts}` });
  check("assign by message id returns 200", byId.status === 200);

  console.log("\n[2] /agent-api/task/assign by channel + task number");
  const msg2 = await createMessage({ spaceId, channelId, senderType: "human", senderId: ownerId, senderName: `owner_assign_${ts}`, content: "assign by number" });
  const task2 = await convertMessageToTask(spaceId, msg2.id, { type: "human", id: ownerId });
  const byNumber = await call("/agent-api/task/assign", assignerToken, assignerId, { channel: `#${channelName}`, number: task2!.taskNumber, to: `assignee_${ts}` });
  check("assign by channel + task number returns 200", byNumber.status === 200);

  console.log("\n[3] returned threadTarget is readable by assignee in private threads");
  const privMsg = await createMessage({ spaceId, channelId: privateChannelId, senderType: "human", senderId: ownerId, senderName: `owner_assign_${ts}`, content: "private handoff" });
  const privTask = await convertMessageToTask(spaceId, privMsg.id, { type: "human", id: ownerId });
  const privAssign = await call("/agent-api/task/assign", assignerToken, assignerId, { messageId: privTask!.id, to: `assignee_${ts}` });
  check("private assign returns 200", privAssign.status === 200);
  const assigneeCfg = await agentConfig(spaceId, assigneeId);
  if (!assigneeCfg?.agentToken) throw new Error("assignee token was not minted");
  const privReadReq = Object.assign(Readable.from([] as Buffer[]), {
    method: "GET",
    url: `/agent-api/message/read?channel=${encodeURIComponent(String((privAssign.body as any).threadTarget))}`,
    headers: { authorization: `Bearer ${assigneeCfg.agentToken}`, "x-agent-id": assigneeId },
  }) as unknown as IncomingMessage;
  const privReadRes = mkRes();
  await handleAgentApi(privReadReq, privReadRes.res, new URL(`http://localhost/agent-api/message/read?channel=${encodeURIComponent(String((privAssign.body as any).threadTarget))}`), "GET");
  await privReadRes.done();
  check("assignee can read thread via returned private threadTarget", privReadRes.status() === 200);

  console.log("\n[4] returned threadTarget is readable by assignee in DM threads");
  const dmMsg = await createMessage({ spaceId, channelId: dmChannelId, senderType: "human", senderId: ownerId, senderName: `owner_assign_${ts}`, content: "dm handoff" });
  const dmTask = await convertMessageToTask(spaceId, dmMsg.id, { type: "human", id: ownerId });
  const dmAssign = await call("/agent-api/task/assign", assignerToken, assignerId, { messageId: dmTask!.id, to: `assignee_${ts}` });
  check("dm assign returns 200", dmAssign.status === 200);
  const dmReadReq = Object.assign(Readable.from([] as Buffer[]), {
    method: "GET",
    url: `/agent-api/message/read?channel=${encodeURIComponent(String((dmAssign.body as any).threadTarget))}`,
    headers: { authorization: `Bearer ${assigneeCfg.agentToken}`, "x-agent-id": assigneeId },
  }) as unknown as IncomingMessage;
  const dmReadRes = mkRes();
  await handleAgentApi(dmReadReq, dmReadRes.res, new URL(`http://localhost/agent-api/message/read?channel=${encodeURIComponent(String((dmAssign.body as any).threadTarget))}`), "GET");
  await dmReadRes.done();
  check("assignee can read thread via returned dm threadTarget", dmReadRes.status() === 200);

  console.log("\n[5] assignee message-check surfaces stable thread target for DM handoff");
  const dmCheckReq = Object.assign(Readable.from([] as Buffer[]), {
    method: "GET",
    url: "/agent-api/message/check",
    headers: { authorization: `Bearer ${assigneeCfg.agentToken}`, "x-agent-id": assigneeId },
  }) as unknown as IncomingMessage;
  const dmCheckRes = mkRes();
  await handleAgentApi(dmCheckReq, dmCheckRes.res, new URL("http://localhost/agent-api/message/check"), "GET");
  await dmCheckRes.done();
  const dmCheckBody = dmCheckRes.body();
  const checkedMessages = Array.isArray((dmCheckBody as any).messages) ? (dmCheckBody as any).messages : [];
  const texts = checkedMessages.map((m: any) => String(m.text || ""));
  check("message check exposes thread:shortid instead of actor-relative dm target", texts.some((txt: string) => txt.includes(`[target=thread:${dmTask!.id.slice(0, 8)}`)));
  check("task assignment remains required in message check", checkedMessages.some((m: any) => m.responseDirective === "required" && m.responseReason === "explicit_task_assignment"));
  check("rendered task assignment carries its directive", texts.some((txt: string) => txt.includes("directive=required")));

  console.log("\n[6] task-scoped grants follow release, reassignment, and terminal lifecycle");
  await db.insert(schema.agentHarnessState).values([
    { agentId: assigneeId, mode: "v2" },
    { agentId: replacementId, mode: "v2" },
  ]).onConflictDoUpdate({ target: schema.agentHarnessState.agentId, set: { mode: "v2" } });
  const privateThreadId = privTask!.threadId!;
  const currentPrivateTask = db.select().from(schema.messages).where(eq(schema.messages.id, privTask!.id)).get()!;
  const released = await unclaimTask(spaceId, privTask!.id, { type: "human", id: ownerId }, currentPrivateTask.taskRevision);
  check("release removes the old external assignee grant", !db.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, privateThreadId),
    eq(schema.channelAgentMembers.agentId, assigneeId),
  )).get());
  check("release leaves no actionable delivery for the old assignee", !db.select().from(schema.agentDeliveryItems).where(and(
    eq(schema.agentDeliveryItems.targetSurfaceId, privateThreadId),
    eq(schema.agentDeliveryItems.agentId, assigneeId),
  )).all().some((item) => item.disposition === "pending" || item.disposition === "bound"));
  const reassignedToOld = await assignTask(spaceId, privTask!.id, assigneeId, { type: "human", id: ownerId }, released!.taskRevision);
  const reassignedToNew = await assignTask(spaceId, privTask!.id, replacementId, { type: "human", id: ownerId }, reassignedToOld!.taskRevision);
  check("reassign removes the prior external assignee grant", !db.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, privateThreadId),
    eq(schema.channelAgentMembers.agentId, assigneeId),
  )).get());
  check("reassign grants only the replacement task scope", db.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, privateThreadId),
    eq(schema.channelAgentMembers.agentId, replacementId),
  )).get()?.accessKind === "task_scoped");
  await setTaskStatus(spaceId, privTask!.id, "closed", { type: "human", id: ownerId }, {
    from: "in_progress",
    expectedRevision: reassignedToNew!.taskRevision,
  });
  check("terminal status removes every task-scoped grant", !db.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, privateThreadId),
    eq(schema.channelAgentMembers.accessKind, "task_scoped"),
  )).get());
  check("terminal audit cannot recreate an actionable task delivery", !db.select().from(schema.agentDeliveryItems).where(
    eq(schema.agentDeliveryItems.targetSurfaceId, privateThreadId),
  ).all().some((item) => item.disposition === "pending" || item.disposition === "bound"));
}

main()
  .then(cleanup)
  .then(() => { console.log(`\n${failures === 0 ? "ALL PASS ✅" : `${failures} CHECK(S) FAILED ❌`}`); process.exit(failures === 0 ? 0 : 1); })
  .catch(async (e) => { console.error("ERROR:", e); try { await cleanup(); } catch { /* */ } process.exit(1); });
