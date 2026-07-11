import assert from "node:assert/strict";
import path from "node:path";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { closeAllDatabases, dbForSpace, schema } from "../src/db/index.ts";
import { ensurePersonalApp } from "../src/db/personalApp.ts";
import { createMessage } from "../src/server/core.ts";
import { handleApi } from "../src/server/routes-api/index.ts";
import { createLocalSpace } from "../src/spaces/spaceService.ts";

type ResponseCapture = { status: number; body: any };

function requestBody(body?: unknown): any {
  const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as any;
  request.headers = {};
  request.socket = { remoteAddress: "127.0.0.1" };
  return request;
}

async function api(spaceId: string, method: string, pathname: string, body?: unknown): Promise<ResponseCapture> {
  const capture: ResponseCapture = { status: 0, body: undefined };
  const req = requestBody(body);
  req.headers = {
    "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
    "content-type": "application/json",
    "x-space-id": spaceId,
  };
  const res = {
    writeHead(status: number) { capture.status = status; },
    end(payload?: string) { capture.body = payload ? JSON.parse(payload) : undefined; },
  } as any;
  await handleApi(req, res, new URL(`http://localhost${pathname}`), method);
  return capture;
}

const root = process.env.KITH_SPACE_HOME;
assert.ok(root, "KITH_SPACE_HOME is required");

try {
  const { human, home } = await ensurePersonalApp({ name: "Ada", homeRootPath: path.join(root, "home") });
  const db = dbForSpace(home.id);

  const [agent] = await db.insert(schema.agents).values({
    spaceId: home.id,
    name: "researcher",
    displayName: "Researcher",
    runtime: "codex",
    creatorId: human.id,
  }).returning();
  const [privateChannel] = await db.insert(schema.channels).values({
    spaceId: home.id,
    name: "private-lab",
    type: "private",
  }).returning();
  const [privateMessage] = await db.insert(schema.messages).values({
    spaceId: home.id,
    channelId: privateChannel!.id,
    seq: 1,
    senderType: "agent",
    senderId: agent!.id,
    senderName: agent!.displayName,
    content: "private result",
  }).returning();

  const channels = await api(home.id, "GET", "/api/channels");
  assert.equal(channels.status, 200);
  assert.ok(channels.body.some((channel: any) => channel.id === privateChannel!.id));

  const message = await api(home.id, "GET", `/api/messages/${privateMessage!.id}`);
  assert.equal(message.status, 200);
  assert.equal(message.body.message.id, privateMessage!.id);

  const members = await api(home.id, "GET", `/api/channels/${privateChannel!.id}/members`);
  assert.equal(members.status, 200);
  assert.deepEqual(members.body, { agents: [] });

  const mentionedHuman = await createMessage({
    spaceId: home.id,
    channelId: privateChannel!.id,
    senderType: "agent",
    senderId: agent!.id,
    senderName: agent!.displayName,
    content: "@you please review",
  });
  const mentioned = await api(home.id, "GET", `/api/messages/${mentionedHuman.id}`);
  assert.deepEqual(mentioned.body.message.mentions, [{ type: "human", id: human.id, name: "you" }]);

  const addHuman = await api(home.id, "POST", `/api/channels/${privateChannel!.id}/members`, { userId: human.id });
  assert.equal(addHuman.status, 400);
  const createWithHumans = await api(home.id, "POST", "/api/channels", { name: "invalid-humans", userIds: [human.id] });
  assert.equal(createWithHumans.status, 400);
  const createWithLegacyType = await api(home.id, "POST", "/api/channels", { name: "legacy-type", type: "private" });
  assert.equal(createWithLegacyType.status, 400);

  const humanDm = await api(home.id, "POST", "/api/channels/dm", { userId: "another-human" });
  assert.equal(humanDm.status, 400);
  const agentDm = await api(home.id, "POST", "/api/channels/dm", { agentId: agent!.id });
  assert.equal(agentDm.status, 200);
  const sameAgentDm = await api(home.id, "POST", "/api/channels/dm", { agentId: agent!.id });
  assert.equal(sameAgentDm.status, 200);
  assert.equal(sameAgentDm.body.id, agentDm.body.id);

  assert.equal((await api(home.id, "POST", `/api/channels/${privateChannel!.id}/join`)).status, 404);
  assert.equal((await api(home.id, "POST", `/api/channels/${privateChannel!.id}/leave`)).status, 404);

  const read = await api(home.id, "POST", `/api/channels/${privateChannel!.id}/read`);
  assert.equal(read.status, 200);
  const humanState = (await db.select().from(schema.humanChannelStates).where(
    eq(schema.humanChannelStates.channelId, privateChannel!.id),
  ))[0];
  assert.equal(humanState?.lastReadSeq, mentionedHuman.seq);

  const other = await createLocalSpace({ name: "Other", rootPath: path.join(root, "other") });
  const otherDb = dbForSpace(other.id);
  const [otherChannel] = await otherDb.insert(schema.channels).values({ spaceId: other.id, name: "other", type: "channel" }).returning();
  const [otherMessage] = await otherDb.insert(schema.messages).values({
    spaceId: other.id,
    channelId: otherChannel!.id,
    seq: 1,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "other space",
  }).returning();
  assert.equal((await api(home.id, "GET", `/api/messages/${otherMessage!.id}`)).status, 404);
} finally {
  closeAllDatabases();
}
