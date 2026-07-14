import "../src/env.ts";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { integrationDatabase } from "./helpers/workspace.ts";
import { addChannelMembers, agentConfig, createMessage } from "../src/server/core.ts";
import { handleAgentApi } from "../src/server/routes-agent.ts";

function response(): { res: ServerResponse; capture: () => { status: number; body: any } } {
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
  return { res, capture: () => ({ status, body: raw ? JSON.parse(raw) : undefined }) };
}

const { db, schema, spaceId, human } = integrationDatabase("agent-response-message-check");
const [channel] = await db.insert(schema.channels).values({ spaceId, name: "message-check", type: "channel" }).returning();
const [responder, peer] = await db.insert(schema.agents).values([
  { spaceId, name: "responder", displayName: "Responder", defaultResponseMode: "mention_only" },
  { spaceId, name: "peer", displayName: "Peer" },
]).returning();
assert.ok(channel && responder && peer);
await addChannelMembers(spaceId, channel.id, [{ type: "agent", id: responder.id }]);

await createMessage({
  spaceId,
  channelId: channel.id,
  senderType: "human",
  senderId: human.id,
  senderName: human.name,
  content: "ambient context",
});
await createMessage({
  spaceId,
  channelId: channel.id,
  senderType: "human",
  senderId: human.id,
  senderName: human.name,
  content: "@responder required request",
});
await createMessage({
  spaceId,
  channelId: channel.id,
  senderType: "agent",
  senderId: peer.id,
  senderName: peer.name,
  content: "agent ambient context",
});

const config = await agentConfig(spaceId, responder.id);
assert.ok(config?.agentToken);
const req = Object.assign(Readable.from([] as Buffer[]), {
  method: "GET",
  url: "/agent-api/message/check",
  headers: {
    authorization: `Bearer ${config.agentToken}`,
    "x-agent-id": responder.id,
  },
}) as unknown as IncomingMessage;
const output = response();
await handleAgentApi(req, output.res, new URL("http://localhost/agent-api/message/check"), "GET");
const result = output.capture();
assert.equal(result.status, 200);
assert.deepEqual(result.body.messages.map((message: any) => ({
  content: message.content,
  responseDirective: message.responseDirective,
  responseReason: message.responseReason,
})), [
  { content: "ambient context", responseDirective: "observe", responseReason: "response_mode_observe" },
  { content: "@responder required request", responseDirective: "required", responseReason: "explicit_mention" },
  { content: "agent ambient context", responseDirective: "observe", responseReason: "agent_ambient_suppressed" },
]);
for (const message of result.body.messages) {
  assert.match(message.text, new RegExp(`directive=${message.responseDirective}`));
}
