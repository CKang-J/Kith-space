import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { and, eq } from "drizzle-orm";
import { canAgentReadChannel, convertMessageToTask, createMessage, getOrCreateThread, setTaskStatus } from "../src/server/core.ts";
import { handleChannels } from "../src/server/routes-api/channels.ts";
import { handleMessages } from "../src/server/routes-api/messages.ts";
import { handleTasks } from "../src/server/routes-api/tasks.ts";
import { canHumanReadChannel } from "../src/server/channelAccess.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

const fixture = integrationDatabase("channel-lifecycle");
const { db, schema, spaceId, human, all } = fixture;
const suffix = Date.now();
let failures = 0;

const check = (label: string, condition: boolean) => {
  console.log(`  ${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) failures++;
};

function req(method: string, body: object = {}): IncomingMessage {
  const stream = Readable.from(method === "GET" ? [] : [JSON.stringify(body)]) as unknown as IncomingMessage;
  (stream as any).method = method;
  (stream as any).headers = {};
  return stream;
}

function response(): { res: ServerResponse; status: () => number; body: () => any } {
  let status = 0;
  let raw = "";
  const res = {
    writeHead(code: number) { status = code; },
    end(payload?: string) { raw = payload ?? ""; },
  } as unknown as ServerResponse;
  return {
    res,
    status: () => status,
    body: () => { try { return JSON.parse(raw); } catch { return {}; } },
  };
}

async function callWith(
  handler: typeof handleChannels,
  method: string,
  path: string,
  body: object = {},
) {
  const out = response();
  const url = new URL(path, "http://localhost");
  await handler({
    req: req(method, body),
    res: out.res,
    url,
    method,
    p: url.pathname,
    humanId: human.id,
    spaceId,
  });
  return { status: out.status(), body: out.body() };
}

const call = (method: string, path: string, body: object = {}) => callWith(handleChannels, method, path, body);

async function main() {
  console.log("\n[1] #all is protected by every lifecycle mutation");
  const archiveAll = await call("POST", `/api/channels/${all.id}/archive`);
  check("archive rejects required #all with a stable code", archiveAll.status === 409 && archiveAll.body.code === "required_channel");
  const deleteAll = await call("DELETE", `/api/channels/${all.id}`);
  check("delete rejects required #all with a stable code", deleteAll.status === 409 && deleteAll.body.code === "required_channel");
  const renameAll = await call("PATCH", `/api/channels/${all.id}`, { name: "renamed" });
  check("renaming required #all is rejected", renameAll.status === 409 && renameAll.body.code === "required_channel");
  const describeAll = await call("PATCH", `/api/channels/${all.id}`, { description: "Updated description" });
  check("description-only updates remain allowed", describeAll.status === 200);

  const [active, archived] = await db.insert(schema.channels).values([
    { spaceId, name: `active-${suffix}`, type: "channel" },
    { spaceId, name: `archived-${suffix}`, type: "channel", archivedAt: new Date() },
  ]).returning();

  console.log("\n[2] archived channel listing is isolated");
  const archivedOnly = await call("GET", "/api/channels?archived=only");
  check("archived=only returns the archived channel", archivedOnly.body.some((channel: any) => channel.id === archived!.id));
  check("archived=only excludes active channels", !archivedOnly.body.some((channel: any) => channel.id === active!.id || channel.id === all.id));

  console.log("\n[3] channel notification preference persists and validates");
  const initialNotification = await call("GET", `/api/channels/${active!.id}/notification`);
  check("notification defaults to all", initialNotification.status === 200 && initialNotification.body.notificationLevel === "all");
  const updatedNotification = await call("PATCH", `/api/channels/${active!.id}/notification`, { notificationLevel: "mentions" });
  check("notification can be changed", updatedNotification.status === 200 && updatedNotification.body.notificationLevel === "mentions");
  const persistedNotification = await call("GET", `/api/channels/${active!.id}/notification`);
  check("notification change persists", persistedNotification.body.notificationLevel === "mentions");
  const invalidNotification = await call("PATCH", `/api/channels/${active!.id}/notification`, { notificationLevel: "sometimes" });
  check("invalid notification level is rejected", invalidNotification.status === 400);

  console.log("\n[4] archived parent channels make Human and agent content writes read-only");
  const parent = await createMessage({
    spaceId,
    channelId: active!.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "topic parent",
  });
  const thread = await getOrCreateThread(spaceId, parent.id, { type: "human", id: human.id });
  const threadMention = await createMessage({
    spaceId,
    channelId: thread.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "lifecycle mention",
  });
  await db.insert(schema.messageMentions).values({
    messageId: threadMention.id,
    mentionType: "human",
    mentionId: human.id,
    mentionName: human.name,
  });
  const threadTask = await createMessage({
    spaceId,
    channelId: thread.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "thread lifecycle task",
    asTask: true,
  });
  const existingTask = await createMessage({
    spaceId,
    channelId: active!.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "existing task",
    asTask: true,
  });
  await db.update(schema.channels).set({ archivedAt: new Date() }).where(eq(schema.channels.id, active!.id));
  for (const [label, channelId, asTask] of [
    ["base message", active!.id, false],
    ["topic reply", thread.id, false],
    ["system message", active!.id, false],
    ["channel task", active!.id, true],
  ] as const) {
    let code = "";
    try {
      await createMessage({
        spaceId,
        channelId,
        senderType: label === "topic reply" ? "agent" : label === "system message" ? "system" : "human",
        senderId: label === "topic reply" || label === "system message" ? null : human.id,
        senderName: label === "topic reply" ? "Agent" : label === "system message" ? "System" : human.name,
        content: label,
        asTask,
      });
    } catch (error) {
      code = String((error as { code?: unknown }).code ?? "");
    }
    check(`${label} is rejected as archived`, code === "channel_archived");
  }
  for (const [label, mutation] of [
    ["convert message", () => convertMessageToTask(spaceId, parent.id, { type: "human", id: human.id })],
    ["update task", () => setTaskStatus(spaceId, existingTask.id, "in_progress", { type: "human", id: human.id })],
  ] as const) {
    let code = "";
    try { await mutation(); } catch (error) { code = String((error as { code?: unknown }).code ?? ""); }
    check(`${label} is rejected as archived`, code === "channel_archived");
  }

  console.log("\n[5] archived parents disappear from inbox, unread, and followed topics");
  await db.insert(schema.humanChannelStates).values({
    channelId: thread.id,
    threadFollowedAt: new Date(),
    lastReadSeq: 0,
  }).onConflictDoUpdate({
    target: schema.humanChannelStates.channelId,
    set: { threadFollowedAt: new Date(), lastReadSeq: 0 },
  });
  const unread = await call("GET", "/api/channels/unread");
  check("archived parent contributes no unread", unread.body[active!.id] === undefined);
  const inbox = await call("GET", "/api/channels/inbox");
  check("archived parent contributes no inbox item", !inbox.body.items.some((item: any) => item.channelId === active!.id || item.channelId === thread.id));
  const followed = await call("GET", "/api/channels/threads/followed");
  check("archived parent contributes no followed topic", !followed.body.threads.some((item: any) => item.threadChannelId === thread.id));
  const archivedMentions = await callWith(handleMessages, "GET", "/api/mentions");
  check("archived parent contributes no topic mentions", !archivedMentions.body.items.some((item: any) => item.messageId === threadMention.id));
  const archivedTasks = await callWith(handleTasks, "GET", "/api/tasks/space");
  check("archived parent contributes no topic tasks", !archivedTasks.body.tasks.some((task: any) => task.id === threadTask.id));

  console.log("\n[6] archived history stays readable, while deleted parents hide their topics");
  const [reader] = await db.insert(schema.agents).values({
    spaceId,
    name: `reader-${suffix}`,
    displayName: "Lifecycle Reader",
  }).returning();
  await db.insert(schema.channelAgentMembers).values({ channelId: thread.id, agentId: reader!.id });
  check("Human can read archived channel history", await canHumanReadChannel(spaceId, active!.id));
  check("Human can read topics under an archived channel", await canHumanReadChannel(spaceId, thread.id));
  check("member agent can read topics under an archived channel", await canAgentReadChannel(spaceId, thread.id, reader!.id));
  await db.update(schema.channels).set({ deletedAt: new Date() }).where(eq(schema.channels.id, active!.id));
  check("Human cannot read deleted channel history", !(await canHumanReadChannel(spaceId, active!.id)));
  check("Human cannot read topics under a deleted channel", !(await canHumanReadChannel(spaceId, thread.id)));
  check("member agent cannot read topics under a deleted channel", !(await canAgentReadChannel(spaceId, thread.id, reader!.id)));
  const deletedMentions = await callWith(handleMessages, "GET", "/api/mentions");
  check("deleted parent contributes no topic mentions", !deletedMentions.body.items.some((item: any) => item.messageId === threadMention.id));
  const deletedTasks = await callWith(handleTasks, "GET", "/api/tasks/space");
  check("deleted parent contributes no topic tasks", !deletedTasks.body.tasks.some((task: any) => task.id === threadTask.id));

  const required = await db.select().from(schema.channels).where(and(
    eq(schema.channels.spaceId, spaceId),
    eq(schema.channels.id, all.id),
  ));
  check("required #all remains active", required[0]?.archivedAt == null && required[0]?.deletedAt == null);
}

main()
  .catch((error) => {
    console.error("ERROR", error);
    failures++;
  })
  .finally(() => {
    console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
    process.exit(failures ? 1 : 0);
  });
