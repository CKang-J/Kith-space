import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { closeAllDatabases, dbForSpace, schema } from "../src/db/index.ts";
import { ensurePersonalApp } from "../src/db/personalApp.ts";
import { agentConfig } from "../src/server/core.ts";
import { handleAgentApi } from "../src/server/routes-agent.ts";
import { handleApi } from "../src/server/routes-api/index.ts";
import { createLocalSpace } from "../src/spaces/spaceService.ts";

type ResponseCapture = { status: number; body: any };

function request(method: string, pathname: string, headers: Record<string, string>, body?: unknown): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const input = Readable.from(raw ? [Buffer.from(raw)] : []);
  return Object.assign(input, { method, url: pathname, headers, socket: { remoteAddress: "127.0.0.1" } }) as unknown as IncomingMessage;
}

function response(): {
  res: ServerResponse;
  done: Promise<void>;
  capture: () => ResponseCapture;
} {
  let status = 0;
  let raw = "";
  const emitter = new EventEmitter();
  const done = new Promise<void>((resolve) => emitter.once("finish", resolve));
  const res = Object.assign(emitter, {
    statusCode: 0,
    headersSent: false,
    setHeader() {},
    writeHead(code: number) {
      status = code;
      this.statusCode = code;
    },
    end(payload?: string | Buffer) {
      raw = payload ? String(payload) : "";
      emitter.emit("finish");
    },
  }) as unknown as ServerResponse;
  return {
    res,
    done,
    capture: () => ({ status, body: raw ? JSON.parse(raw) : undefined }),
  };
}

async function humanApi(
  spaceId: string,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<ResponseCapture> {
  const output = response();
  const req = request(method, pathname, {
    "x-kith-desktop-token": process.env.KITH_SPACE_DESKTOP_TOKEN!,
    "content-type": "application/json",
    "x-space-id": spaceId,
  }, body);
  await handleApi(req, output.res, new URL(`http://localhost${pathname}`), method);
  await output.done;
  return output.capture();
}

async function agentApi(
  token: string,
  agentId: string,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<ResponseCapture> {
  const output = response();
  const req = request(method, pathname, {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-agent-id": agentId,
  }, body);
  await handleAgentApi(req, output.res, new URL(`http://localhost${pathname}`), method);
  await output.done;
  return output.capture();
}

const root = process.env.KITH_SPACE_HOME;
assert.ok(root, "KITH_SPACE_HOME is required");

try {
  const { human, home } = await ensurePersonalApp({
    name: "Ada",
    homeRootPath: path.join(root, "home"),
  });
  const db = dbForSpace(home.id);

  const agents = await db.insert(schema.agents).values([
    {
      spaceId: home.id,
      name: "alpha",
      displayName: "Alpha",
      runtime: "codex",
      creatorId: human.id,
    },
    {
      spaceId: home.id,
      name: "beta",
      displayName: "Beta",
      runtime: "codex",
      creatorId: human.id,
    },
    {
      spaceId: home.id,
      name: "gamma",
      displayName: "Gamma",
      runtime: "codex",
      creatorId: human.id,
    },
  ]).returning();
  const [alpha, beta, gamma] = agents;
  assert.ok(alpha && beta && gamma);

  const channels = await db.insert(schema.channels).values([
    { spaceId: home.id, name: "scope-public", type: "channel" },
    { spaceId: home.id, name: "scope-private", type: "private" },
    {
      spaceId: home.id,
      name: `dm:${[alpha.id, beta.id].sort().join(":")}`,
      type: "dm",
    },
  ]).returning();
  const [regular, privateChannel, agentDm] = channels;
  assert.ok(regular && privateChannel && agentDm);

  await db.insert(schema.channelAgentMembers).values([
    { channelId: privateChannel.id, agentId: alpha.id },
    { channelId: agentDm.id, agentId: alpha.id },
    { channelId: agentDm.id, agentId: beta.id },
  ]);
  const messages = await db.insert(schema.messages).values([
    {
      spaceId: home.id,
      channelId: regular.id,
      seq: 1,
      senderType: "agent",
      senderId: alpha.id,
      senderName: alpha.name,
      content: "regular message",
    },
    {
      spaceId: home.id,
      channelId: privateChannel.id,
      seq: 2,
      senderType: "agent",
      senderId: alpha.id,
      senderName: alpha.name,
      content: "private message",
    },
    {
      spaceId: home.id,
      channelId: agentDm.id,
      seq: 3,
      senderType: "agent",
      senderId: alpha.id,
      senderName: alpha.name,
      content: "agent dm message",
    },
  ]).returning();
  const [, , agentDmMessage] = messages;
  assert.ok(agentDmMessage);

  for (const channel of [regular, privateChannel, agentDm]) {
    const result = await humanApi(home.id, "GET", `/api/messages/channel/${channel.id}`);
    assert.equal(result.status, 200, `Human should read ${channel.type} channels across the Space`);
  }

  const initialMembers = await humanApi(
    home.id,
    "GET",
    `/api/channels/${privateChannel.id}/members`,
  );
  assert.equal(initialMembers.status, 200);
  assert.deepEqual(Object.keys(initialMembers.body), ["agents"]);
  assert.deepEqual(initialMembers.body.agents.map((agent: any) => agent.id), [alpha.id]);

  const betaConfig = await agentConfig(home.id, beta.id);
  const gammaConfig = await agentConfig(home.id, gamma.id);
  assert.ok(betaConfig?.agentToken);
  assert.ok(gammaConfig?.agentToken);

  const retiredInitialHumans = await agentApi(
    betaConfig.agentToken,
    beta.id,
    "POST",
    "/agent-api/action/prepare",
    {
      target: `#${regular.name}`,
      action: {
        type: "channel:create",
        name: "invalid-human-membership",
        initialHumans: [human.id],
        initialAgents: [alpha.id],
      },
    },
  );
  assert.equal(retiredInitialHumans.status, 400);
  assert.equal(retiredInitialHumans.body.code, "BAD_ACTION");

  const info = await agentApi(betaConfig.agentToken, beta.id, "GET", "/agent-api/space/info");
  assert.equal(info.status, 200);
  assert.equal("humans" in info.body, false);
  assert.deepEqual(info.body.human, {
    name: "you",
    displayName: human.name,
    description: human.description,
  });

  const privateTarget = encodeURIComponent(`#${privateChannel.name}`);
  const privateBeforeJoin = await agentApi(
    betaConfig.agentToken,
    beta.id,
    "GET",
    `/agent-api/message/read?channel=${privateTarget}`,
  );
  assert.equal(privateBeforeJoin.status, 404);

  const addBeta = await humanApi(
    home.id,
    "POST",
    `/api/channels/${privateChannel.id}/members`,
    { agentId: beta.id },
  );
  assert.equal(addBeta.status, 200);
  const privateAfterJoin = await agentApi(
    betaConfig.agentToken,
    beta.id,
    "GET",
    `/agent-api/message/read?channel=${privateTarget}`,
  );
  assert.equal(privateAfterJoin.status, 200);
  assert.ok(JSON.stringify(privateAfterJoin.body).includes("private message"));

  const dmBeforeJoin = await agentApi(
    gammaConfig.agentToken,
    gamma.id,
    "GET",
    `/agent-api/message/resolve?id=${agentDmMessage.id}`,
  );
  assert.equal(dmBeforeJoin.status, 404);

  const addGamma = await humanApi(
    home.id,
    "POST",
    `/api/channels/${agentDm.id}/members`,
    { agentId: gamma.id },
  );
  assert.equal(addGamma.status, 200);
  const dmAfterJoin = await agentApi(
    gammaConfig.agentToken,
    gamma.id,
    "GET",
    `/agent-api/message/resolve?id=${agentDmMessage.id}`,
  );
  assert.equal(dmAfterJoin.status, 200);
  assert.ok(JSON.stringify(dmAfterJoin.body).includes("agent dm message"));

  const privateMembers = await humanApi(
    home.id,
    "GET",
    `/api/channels/${privateChannel.id}/members`,
  );
  assert.deepEqual(
    privateMembers.body.agents.map((agent: any) => agent.id).sort(),
    [alpha.id, beta.id].sort(),
  );
  assert.equal("humans" in privateMembers.body, false);

  const leaveRootId = randomUUID();
  const leaveThreadId = randomUUID();
  await db.insert(schema.messages).values({
    id: leaveRootId, spaceId: home.id, channelId: privateChannel.id, seq: 4,
    senderType: "human", senderId: human.id, senderName: human.name, content: "leave root", threadId: leaveThreadId,
  });
  await db.insert(schema.channels).values({
    id: leaveThreadId, spaceId: home.id, name: "leave-thread", type: "thread", parentMessageId: leaveRootId,
  });
  await db.insert(schema.channelAgentMembers).values({ channelId: leaveThreadId, agentId: beta.id });
  const leaveSessionId = randomUUID();
  await db.insert(schema.runtimeSessions).values({
    id: leaveSessionId, spaceId: home.id, agentId: beta.id, surfaceKind: "thread", surfaceId: leaveThreadId,
    sessionGeneration: 1, runtime: "codex", runtimeConfigFingerprint: "leave", adapterVersion: "test",
    workspaceRootFingerprint: "root", status: "running",
  });
  const leaveTurnId = randomUUID();
  await db.insert(schema.agentTurns).values({
    id: leaveTurnId, runtimeSessionId: leaveSessionId, sessionGeneration: 1, spaceId: home.id, agentId: beta.id,
    effectiveDirective: "required", status: "running",
  });
  const leaveAttemptId = randomUUID();
  await db.insert(schema.agentTurnAttempts).values({
    id: leaveAttemptId, turnId: leaveTurnId, attemptNo: 1, status: "running", workerGeneration: 1,
    leaseOwner: "test", leaseExpiresAt: new Date(Date.now() + 60_000),
  });
  await db.insert(schema.turnCapabilityActivations).values({
    id: randomUUID(), turnId: leaveTurnId, attemptId: leaveAttemptId, sessionGeneration: 1, workerGeneration: 1,
    claimsDigest: "leave", status: "active", expiresAt: new Date(Date.now() + 60_000),
  });
  const leave = await agentApi(betaConfig.agentToken, beta.id, "POST", "/agent-api/channel/leave", { target: `#${privateChannel.name}` });
  assert.equal(leave.status, 200);
  assert.equal(db.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, privateChannel.id),
    eq(schema.channelAgentMembers.agentId, beta.id),
  )).get(), undefined);
  assert.equal(db.select().from(schema.channelAgentMembers).where(and(
    eq(schema.channelAgentMembers.channelId, leaveThreadId),
    eq(schema.channelAgentMembers.agentId, beta.id),
  )).get(), undefined);
  assert.equal(db.select().from(schema.runtimeSessions).where(eq(schema.runtimeSessions.id, leaveSessionId)).get()?.status, "disabled");
  assert.equal(db.select().from(schema.agentTurnAttempts).where(eq(schema.agentTurnAttempts.id, leaveAttemptId)).get()?.errorCode, "parent_access_revoked");

  const otherRoot = path.join(root, "other");
  mkdirSync(otherRoot, { recursive: true });
  const other = await createLocalSpace({ name: "Other", rootPath: otherRoot });
  const otherDb = dbForSpace(other.id);
  const [otherChannel] = await otherDb.insert(schema.channels).values({
    spaceId: other.id,
    name: "other-private",
    type: "private",
  }).returning();
  const [otherMessage] = await otherDb.insert(schema.messages).values({
    spaceId: other.id,
    channelId: otherChannel!.id,
    seq: 1,
    senderType: "human",
    senderId: human.id,
    senderName: human.name,
    content: "cross-space secret",
  }).returning();
  const crossSpaceResolve = await agentApi(
    betaConfig.agentToken,
    beta.id,
    "GET",
    `/agent-api/message/resolve?id=${otherMessage!.id}`,
  );
  assert.equal(crossSpaceResolve.status, 404);
  assert.equal(JSON.stringify(crossSpaceResolve.body).includes("cross-space secret"), false);
} finally {
  closeAllDatabases();
}
