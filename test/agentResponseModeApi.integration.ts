import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { ChannelLifecycleError } from "../src/channels/channelLifecycle.ts";
import { closeAllDatabases, schema } from "../src/db/index.ts";
import { handleApi } from "../src/server/routes-api/index.ts";
import { integrationDatabase } from "./helpers/workspace.ts";

type ResponseCapture = { status: number; body: any };

function request(spaceId: string, method: string, pathname: string, body?: unknown, authenticated = true): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const stream = Readable.from(raw ? [Buffer.from(raw)] : []);
  return Object.assign(stream, {
    method,
    url: pathname,
    headers: {
      ...(authenticated ? { "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN! } : {}),
      "content-type": "application/json",
      "x-space-id": spaceId,
    },
    socket: { remoteAddress: "127.0.0.1" },
  }) as unknown as IncomingMessage;
}

function response(): { res: ServerResponse; capture: () => ResponseCapture } {
  let status = 0;
  let raw = "";
  const emitter = new EventEmitter();
  const res = Object.assign(emitter, {
    statusCode: 0,
    headersSent: false,
    setHeader() {},
    writeHead(code: number) { status = code; this.statusCode = code; },
    end(payload?: string | Buffer) { raw = payload ? String(payload) : ""; emitter.emit("finish"); },
  }) as unknown as ServerResponse;
  return {
    res,
    capture: () => ({ status, body: raw ? JSON.parse(raw) : undefined }),
  };
}

async function api(
  spaceId: string,
  method: string,
  pathname: string,
  body?: unknown,
  authenticated = true,
): Promise<ResponseCapture> {
  const output = response();
  await handleApi(
    request(spaceId, method, pathname, body, authenticated),
    output.res,
    new URL(`http://localhost${pathname}`),
    method,
  );
  return output.capture();
}

const { db, spaceId, human } = integrationDatabase("agent-response-mode-api");

try {
  const [agent, nonMember] = await db.insert(schema.agents).values([
    { spaceId, name: "api-responder", displayName: "API Responder", creatorId: human.id },
    { spaceId, name: "api-outsider", displayName: "API Outsider", creatorId: human.id },
  ]).returning();
  assert.ok(agent && nonMember);
  const [channel, dm] = await db.insert(schema.channels).values([
    { spaceId, name: "api-response", type: "channel" },
    { spaceId, name: `dm:${agent.id}`, type: "dm" },
  ]).returning();
  assert.ok(channel && dm);
  const [parent] = await db.insert(schema.messages).values({
    spaceId,
    channelId: channel.id,
    seq: 1,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "thread root",
  }).returning();
  assert.ok(parent);
  const [thread] = await db.insert(schema.channels).values({
    spaceId,
    name: `thread:${parent.id}`,
    type: "thread",
    parentMessageId: parent.id,
  }).returning();
  assert.ok(thread);
  await db.insert(schema.channelAgentMembers).values([
    { channelId: channel.id, agentId: agent.id },
    { channelId: dm.id, agentId: agent.id },
    { channelId: thread.id, agentId: agent.id },
  ]);

  const unauthorized = await api(spaceId, "GET", `/api/agents/${agent.id}`, undefined, false);
  assert.equal(unauthorized.status, 401);

  const initial = await api(spaceId, "GET", `/api/agents/${agent.id}`);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.defaultResponseMode, "active");

  const invalidDefault = await api(spaceId, "PATCH", `/api/agents/${agent.id}`, {
    defaultResponseMode: "sometimes",
  });
  assert.equal(invalidDefault.status, 400);
  assert.equal(invalidDefault.body.code, "invalid_response_mode");

  const updatedDefault = await api(spaceId, "PATCH", `/api/agents/${agent.id}`, {
    defaultResponseMode: "mention_only",
  });
  assert.equal(updatedDefault.status, 200);
  assert.equal(updatedDefault.body.defaultResponseMode, "mention_only");

  const members = await api(spaceId, "GET", `/api/channels/${channel.id}/members`);
  assert.equal(members.status, 200);
  assert.deepEqual(members.body.agents[0], {
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    status: agent.status,
    activity: agent.activity,
    avatarUrl: agent.avatarUrl,
    defaultResponseMode: "mention_only",
    responseModeOverride: null,
    effectiveResponseMode: "mention_only",
    responseModeSource: "agent_default",
  });

  const invalidOverride = await api(spaceId, "PATCH", `/api/channels/${channel.id}/members/${agent.id}`, {
    responseModeOverride: "sometimes",
  });
  assert.equal(invalidOverride.status, 400);
  assert.equal(invalidOverride.body.code, "invalid_response_mode");

  const overridden = await api(spaceId, "PATCH", `/api/channels/${channel.id}/members/${agent.id}`, {
    responseModeOverride: "silent",
  });
  assert.equal(overridden.status, 200);
  assert.equal(overridden.body.responseModeOverride, "silent");
  assert.equal(overridden.body.effectiveResponseMode, "silent");
  assert.equal(overridden.body.responseModeSource, "channel_override");

  const reset = await api(spaceId, "PATCH", `/api/channels/${channel.id}/members/${agent.id}`, {
    responseModeOverride: null,
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.responseModeOverride, null);
  assert.equal(reset.body.effectiveResponseMode, "mention_only");

  const missingMember = await api(spaceId, "PATCH", `/api/channels/${channel.id}/members/${nonMember.id}`, {
    responseModeOverride: "active",
  });
  assert.equal(missingMember.status, 404);
  assert.equal(missingMember.body.code, "channel_member_not_found");

  for (const notApplicable of [dm, thread]) {
    const result = await api(spaceId, "PATCH", `/api/channels/${notApplicable.id}/members/${agent.id}`, {
      responseModeOverride: "active",
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "response_mode_not_applicable");
  }

  const messageCountBefore = (await db.select().from(schema.messages)).length;
  const invalidTask = await api(spaceId, "POST", "/api/messages", {
    channelId: channel.id,
    content: "@api-responder and @api-outsider do this",
    asTask: true,
  });
  assert.equal(invalidTask.status, 400);
  assert.equal(invalidTask.body.code, "INVALID_ARGUMENT");
  assert.equal((await db.select().from(schema.messages)).length, messageCountBefore);
  assert.equal((await db.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, channel.id),
    eq(schema.channelAgentMembers.agentId, nonMember.id),
  ))).length, 0, "rejected task must not auto-join an extra assignee");

  await db.update(schema.channels).set({ archivedAt: new Date() }).where(eq(schema.channels.id, channel.id));
  await assert.rejects(
    api(spaceId, "PATCH", `/api/channels/${channel.id}/members/${agent.id}`, {
      responseModeOverride: "active",
    }),
    (error: unknown) => error instanceof ChannelLifecycleError
      && error.statusCode === 409
      && error.code === "channel_archived",
  );
} finally {
  closeAllDatabases();
}
