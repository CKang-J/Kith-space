import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readdir } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { integrationDatabase } from "./helpers/workspace.ts";
import { closeAllDatabases } from "../src/db/index.ts";
import { spaceUploadsDir } from "../src/paths.ts";
import { addChannelMembers, agentConfig, createMessage } from "../src/server/core.ts";
import { handleAgentApi } from "../src/server/routes-agent.ts";
import { saveObject } from "../src/server/storage.ts";

type Capture = { status: number; body: any };

function response(): { res: ServerResponse; done: Promise<void>; capture(): Capture } {
  let status = 0;
  let raw = "";
  const emitter = new EventEmitter();
  const done = new Promise<void>((resolve) => emitter.once("finish", resolve));
  const res = Object.assign(emitter, {
    statusCode: 0,
    headersSent: false,
    setHeader() {},
    writeHead(code: number) { status = code; this.statusCode = code; },
    end(payload?: string | Buffer) { raw = payload ? String(payload) : ""; emitter.emit("finish"); },
  }) as unknown as ServerResponse;
  return { res, done, capture: () => ({ status, body: raw ? JSON.parse(raw) : undefined }) };
}

function request(method: string, pathname: string, headers: Record<string, string>, body?: Buffer | unknown): IncomingMessage {
  const raw = Buffer.isBuffer(body) ? body : body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  return Object.assign(Readable.from(raw.length ? [raw] : []), {
    method,
    url: pathname,
    headers,
    socket: { remoteAddress: "127.0.0.1" },
  }) as unknown as IncomingMessage;
}

async function agentApi(options: {
  token?: string;
  agentId?: string;
  method: string;
  pathname: string;
  body?: unknown;
}): Promise<Capture> {
  const output = response();
  const req = request(options.method, options.pathname, {
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    ...(options.agentId ? { "x-agent-id": options.agentId } : {}),
    "content-type": "application/json",
  }, options.body);
  await handleAgentApi(req, output.res, new URL(`http://localhost${options.pathname}`), options.method);
  await output.done;
  return output.capture();
}

async function uploadExpectingFailure(options: {
  token: string;
  agentId: string;
  target: string;
}): Promise<void> {
  const boundary = "----kith-space-p-a9-upload";
  const body = Buffer.from([
    `--${boundary}\r\nContent-Disposition: form-data; name="channel"\r\n\r\n${options.target}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="rollback.txt"\r\nContent-Type: text/plain\r\n\r\nrollback probe\r\n`,
    `--${boundary}--\r\n`,
  ].join(""));
  const output = response();
  const req = request("POST", "/agent-api/attachment/upload", {
    authorization: `Bearer ${options.token}`,
    "x-agent-id": options.agentId,
    "content-type": `multipart/form-data; boundary=${boundary}`,
    "content-length": String(body.length),
  }, body);
  await assert.rejects(() => handleAgentApi(
    req,
    output.res,
    new URL("http://localhost/agent-api/attachment/upload"),
    "POST",
  ), (error: any) => error?.code === "channel_archived");
}

const fixture = integrationDatabase("p-a9-agent-http-characterization");
const { db, schema, spaceId, rootPath, human } = fixture;

try {
  const [alpha, outsider, limited] = await db.insert(schema.agents).values([
    { spaceId, name: "alpha", displayName: "Alpha", runtime: "claude" },
    { spaceId, name: "outsider", displayName: "Outsider", runtime: "claude" },
    {
      spaceId,
      name: "limited",
      displayName: "Limited",
      runtime: "claude",
      scopes: { granted: [], mode: "custom", revision: 1, updatedAt: new Date().toISOString() },
    },
  ]).returning();
  assert.ok(alpha && outsider && limited);
  const alphaAuth = await agentConfig(spaceId, alpha.id);
  const outsiderAuth = await agentConfig(spaceId, outsider.id);
  const limitedAuth = await agentConfig(spaceId, limited.id);
  assert.ok(alphaAuth?.agentToken && outsiderAuth?.agentToken && limitedAuth?.agentToken);

  const unauthorized = await agentApi({ method: "GET", pathname: "/agent-api/space/info" });
  assert.equal(unauthorized.status, 401);
  const denied = await agentApi({
    token: limitedAuth.agentToken,
    agentId: limited.id,
    method: "GET",
    pathname: "/agent-api/space/info",
  });
  assert.deepEqual({ status: denied.status, code: denied.body.code, scope: denied.body.scope }, {
    status: 403,
    code: "SCOPE_DENIED",
    scope: "space:read",
  });

  const [channel, privateChannel, archivedChannel] = await db.insert(schema.channels).values([
    { spaceId, name: "p-a9-agent-http", type: "channel" },
    { spaceId, name: "p-a9-private", type: "private" },
    { spaceId, name: "p-a9-archived", type: "channel", archivedAt: new Date() },
  ]).returning();
  assert.ok(channel && privateChannel && archivedChannel);
  await addChannelMembers(spaceId, channel.id, [{ type: "agent", id: alpha.id }]);
  await addChannelMembers(spaceId, privateChannel.id, [{ type: "agent", id: alpha.id }]);
  await addChannelMembers(spaceId, archivedChannel.id, [{ type: "agent", id: alpha.id }]);

  const searchable = await createMessage({
    spaceId,
    channelId: channel.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "searchable freshness baseline",
  });
  const held = await agentApi({
    token: alphaAuth.agentToken,
    agentId: alpha.id,
    method: "POST",
    pathname: "/agent-api/message/send",
    body: { target: `#${channel.name}`, content: "draft response" },
  });
  assert.deepEqual({ status: held.status, held: held.body.held, draft: held.body.draft, newerCount: held.body.newerCount }, {
    status: 200,
    held: true,
    draft: true,
    newerCount: 1,
  });
  const sentDraft = await agentApi({
    token: alphaAuth.agentToken,
    agentId: alpha.id,
    method: "POST",
    pathname: "/agent-api/message/send",
    body: { target: `#${channel.name}`, sendDraft: true },
  });
  assert.equal(sentDraft.status, 200);
  assert.equal(sentDraft.body.ok, true);

  const checkedMessage = await createMessage({
    spaceId,
    channelId: channel.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "check watermark",
  });
  const checked = await agentApi({
    token: alphaAuth.agentToken,
    agentId: alpha.id,
    method: "GET",
    pathname: "/agent-api/message/check",
  });
  assert.equal(checked.status, 200);
  assert.equal(checked.body.messages.some((message: any) => message.id === checkedMessage.id), true);
  const watermark = await db.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, channel.id),
    eq(schema.channelAgentMembers.agentId, alpha.id),
  )).get();
  assert.equal(watermark?.lastReadSeq, checkedMessage.seq);

  const action = await agentApi({
    token: alphaAuth.agentToken,
    agentId: alpha.id,
    method: "POST",
    pathname: "/agent-api/action/prepare",
    body: {
      target: `#${channel.name}`,
      action: { type: "channel:create", name: "#normalized", visibility: "unexpected", initialAgents: [outsider.id] },
    },
  });
  assert.deepEqual(action.body.action, {
    type: "channel:create",
    name: "normalized",
    description: null,
    visibility: "public",
    initialAgents: [outsider.id],
  });

  const reacted = await agentApi({
    token: alphaAuth.agentToken,
    agentId: alpha.id,
    method: "POST",
    pathname: "/agent-api/message/react",
    body: { messageId: searchable.id.slice(0, 8), emoji: "👍" },
  });
  assert.equal(reacted.status, 200);
  assert.equal(reacted.body.reactions[0]?.emoji, "👍");

  const [privateParent] = await db.insert(schema.messages).values({
    spaceId,
    channelId: privateChannel.id,
    seq: checkedMessage.seq + 100,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "private thread parent",
  }).returning();
  assert.ok(privateParent);
  const forbiddenThread = await agentApi({
    token: outsiderAuth.agentToken,
    agentId: outsider.id,
    method: "GET",
    pathname: `/agent-api/thread/read?parent=${privateParent.id.slice(0, 8)}`,
  });
  assert.deepEqual({ status: forbiddenThread.status, error: forbiddenThread.body.error }, {
    status: 404,
    error: "parent message not found",
  });

  const search = await agentApi({
    token: alphaAuth.agentToken,
    agentId: alpha.id,
    method: "GET",
    pathname: "/agent-api/search?q=searchable",
  });
  assert.equal(search.status, 200);
  assert.equal(search.body.results.some((message: any) => message.id === searchable.id), true);
  const outsiderSearch = await agentApi({
    token: outsiderAuth.agentToken,
    agentId: outsider.id,
    method: "GET",
    pathname: "/agent-api/search?q=private",
  });
  assert.deepEqual(outsiderSearch.body.results, []);

  const task = await createMessage({
    spaceId,
    channelId: channel.id,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "claim with CAS",
    asTask: true,
  });
  const claimed = await agentApi({
    token: alphaAuth.agentToken,
    agentId: alpha.id,
    method: "POST",
    pathname: "/agent-api/task/claim",
    body: { messageId: task.id, expectedRevision: task.taskRevision },
  });
  assert.equal(claimed.status, 200);
  const staleUpdate = await agentApi({
    token: alphaAuth.agentToken,
    agentId: alpha.id,
    method: "POST",
    pathname: "/agent-api/task/update",
    body: { messageId: task.id, status: "done", expectedRevision: task.taskRevision },
  });
  assert.deepEqual({ status: staleUpdate.status, code: staleUpdate.body.code, revision: staleUpdate.body.current?.revision }, {
    status: 409,
    code: "CONFLICT",
    revision: claimed.body.revision,
  });

  const saved = await saveObject(spaceId, "private.txt", Readable.from([Buffer.from("private attachment")])) ;
  const [attachment] = await db.insert(schema.attachments).values({
    spaceId,
    channelId: privateChannel.id,
    messageId: privateParent.id,
    uploaderType: "human",
    uploaderId: human.id,
    filename: "private.txt",
    mimeType: "text/plain",
    sizeBytes: saved.size,
    storageKey: saved.key,
  }).returning();
  assert.ok(attachment);
  const visibleAttachment = await agentApi({
    token: alphaAuth.agentToken,
    agentId: alpha.id,
    method: "GET",
    pathname: `/agent-api/attachment/view?id=${attachment.id.slice(0, 8)}`,
  });
  assert.equal(visibleAttachment.body.text, "private attachment");
  const hiddenAttachment = await agentApi({
    token: outsiderAuth.agentToken,
    agentId: outsider.id,
    method: "GET",
    pathname: `/agent-api/attachment/view?id=${attachment.id}`,
  });
  assert.equal(hiddenAttachment.status, 404);

  await uploadExpectingFailure({
    token: alphaAuth.agentToken,
    agentId: alpha.id,
    target: `#${archivedChannel.name}`,
  });
  const storedAfterRollback = await readdir(spaceUploadsDir(rootPath));
  assert.deepEqual(storedAfterRollback, [saved.key], "failed upload must remove only its newly stored object");

  const scheduled = await agentApi({
    token: alphaAuth.agentToken,
    agentId: alpha.id,
    method: "POST",
    pathname: "/agent-api/reminder/schedule",
    body: { content: "follow up", in: 60, anchor: searchable.id.slice(0, 8) },
  });
  assert.equal(scheduled.status, 200);
  const reminder = await db.select().from(schema.reminders).where(eq(schema.reminders.id, scheduled.body.id)).get();
  assert.equal(reminder?.anchorMessageId, searchable.id);
  const invalidSearch = await agentApi({
    token: alphaAuth.agentToken,
    agentId: alpha.id,
    method: "GET",
    pathname: "/agent-api/search",
  });
  assert.deepEqual({ status: invalidSearch.status, error: invalidSearch.body.error }, { status: 400, error: "q required" });
} finally {
  closeAllDatabases();
}
