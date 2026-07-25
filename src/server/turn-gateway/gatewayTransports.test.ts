import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BrokerGatewayClient } from "../../capabilities/gatewayClient.js";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../../db/index.js";
import { kithSpaceHome } from "../../paths.js";
import { turnCapabilityService } from "../harnessComposition.js";
import { handleTurnGateway } from "./routes.js";
import "../core.js";

const runFile = promisify(execFile);
const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));

function toolJson(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  const text = (result.content as Array<{ type: string; text?: string }>).find((item) => item.type === "text")?.text;
  return JSON.parse(text ?? "null") as Record<string, unknown>;
}

test("real Gateway gives MCP, CLI client and CLI parser the same scoped domain result", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kith-gateway-transports-"));
  const spaceId = randomUUID();
  const agentId = randomUUID();
  const channelId = randomUUID();
  const sessionId = randomUUID();
  const turnId = randomUUID();
  const attemptId = randomUUID();
  registerSpace({ id: spaceId, name: "Gateway transports", slug: `gateway-transports-${spaceId}`, rootPath: path.join(kithSpaceHome(), "gateway-transports", spaceId) });
  const db = dbForSpace(spaceId);
  let server: http.Server | null = null;
  let client: Client | null = null;
  try {
    db.insert(schema.agents).values({ id: agentId, spaceId, name: "gateway-agent", displayName: "Gateway Agent", status: "active" }).run();
    db.insert(schema.agentHarnessState).values({ agentId, mode: "v2" }).run();
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "gateway", type: "channel" }).run();
    db.insert(schema.channelAgentMembers).values({ channelId, agentId, lastReadSeq: 0 }).run();
    db.insert(schema.runtimeSessions).values({
      id: sessionId, spaceId, agentId, surfaceKind: "channel", surfaceId: channelId, sessionGeneration: 1,
      runtime: "claude", runtimeConfigFingerprint: "config", adapterVersion: "v2-bridge-2",
      workspaceRootFingerprint: "root", status: "running",
    }).run();
    db.insert(schema.agentTurns).values({
      id: turnId, runtimeSessionId: sessionId, sessionGeneration: 1, spaceId, agentId,
      status: "running", effectiveDirective: "required",
      contextEnvelope: {
        schemaVersion: 1,
        turnId,
        session: { spaceId, agentId, surfaceKind: "channel", surfaceId: channelId },
        responseDirective: "required",
        deliveryItemIds: [],
        seenWatermarks: [{ channelId, throughSeq: 1 }],
        continuityMode: "cold",
        currentBatch: [],
        recentSurface: [],
        objectSnapshots: [],
        recalledMemories: [],
        fileMemoryRefs: [],
        capabilityActivationId: "fixture",
        budget: { available: 8_000, used: 0, estimator: "fixture" },
        omissions: [],
        assembledAt: Date.now(),
      },
    }).run();
    db.insert(schema.agentTurnAttempts).values({
      id: attemptId, turnId, attemptNo: 1, status: "claimed", workerGeneration: 7,
      leaseOwner: "transport-test", leaseExpiresAt: new Date(Date.now() + 60_000),
    }).run();
    const message = db.insert(schema.messages).values({
      seq: 1, spaceId, channelId, senderType: "human", senderId: "human", senderName: "Human",
      content: "transport contract input", searchText: "transport contract input",
    }).returning().get();
    const delivery = db.insert(schema.agentDeliveryItems).values({
      spaceId, agentId, messageId: message.id, sourceChannelId: channelId, sourceSeq: 1,
      cursorOwnerChannelId: channelId, targetSurfaceKind: "channel", targetSurfaceId: channelId,
      targetRuntimeSessionId: sessionId, directive: "required", reason: "transport_test", policySnapshot: {},
      disposition: "bound", turnId,
    }).returning().get();
    const envelope = db.select({ value: schema.agentTurns.contextEnvelope }).from(schema.agentTurns).where(eq(schema.agentTurns.id, turnId)).get()!.value!;
    db.update(schema.agentTurns).set({
      contextEnvelope: {
        ...envelope,
        deliveryItemIds: [delivery.id],
        currentBatch: [{
          sourceKind: "message", sourceId: message.id, sourceRevision: 1, snapshotId: null,
          contentHmac: "fixture", visibility: "public", disclosureProjection: "canonical", injectionMode: "content",
          estimatedTokens: 1, reason: "delivery",
        }],
      },
    }).where(eq(schema.agentTurns.id, turnId)).run();
    const capability = turnCapabilityService(spaceId);
    const prepared = capability.prepare(attemptId);
    capability.activate(prepared);
    db.update(schema.agentTurnAttempts).set({ status: "running" }).run();

    server = http.createServer(async (req, res) => {
      const handled = await handleTurnGateway(req, res, new URL(req.url ?? "/", "http://127.0.0.1"), req.method ?? "GET");
      if (!handled) { res.writeHead(404); res.end(); }
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const endpoint = `http://127.0.0.1:${address.port}`;
    const activationFile = path.join(root, "activation.json");
    await writeFile(activationFile, JSON.stringify({ activationId: prepared.claims.activationId, workerGeneration: 7 }));
    const environment = { endpoint, sessionHandle: prepared.sessionHandle, activationFile };
    const directClient = new BrokerGatewayClient(environment);
    const direct = await directClient.request<Record<string, unknown>>("GET", "/agent-gateway/turn/context?refresh=false");
    assert.equal(direct.capabilityMode, "cli_fallback");

    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    Object.assign(env, {
      KITH_SPACE_BROKER_ENDPOINT: endpoint,
      KITH_SPACE_BROKER_HANDLE: prepared.sessionHandle,
      KITH_SPACE_ACTIVATION_FILE: activationFile,
    });
    const transport = new StdioClientTransport({
      command: process.execPath, args: [tsxCli, path.resolve("src/server/mcp/stdio.ts")],
      cwd: process.cwd(), env, stderr: "pipe",
    });
    client = new Client({ name: "gateway-domain-contract", version: "1" });
    await client.connect(transport);
    const mcp = toolJson(await client.callTool({ name: "session.context_check", arguments: { refresh: false } }));
    assert.equal(mcp.capabilityMode, "mcp");
    assert.deepEqual({ ...mcp, capabilityMode: undefined }, { ...direct, capabilityMode: undefined });

    const command = { text: "one shared item", status: "in_progress", order: 1, idempotencyKey: "transport:checklist" };
    const cliWrite = await directClient.request<Record<string, unknown>>("POST", "/agent-gateway/session/checklist/upsert", command);
    const mcpWrite = toolJson(await client.callTool({ name: "session.checklist_upsert", arguments: command }));
    assert.deepEqual(mcpWrite, cliWrite);
    assert.equal(db.select().from(schema.sessionChecklistItems).all().length, 1);

    const parsed = await runFile(process.execPath, [tsxCli, path.resolve("src/cli/index.ts"), "turn", "context"], {
      cwd: process.cwd(), env, timeout: 10_000,
    });
    assert.match(parsed.stdout, new RegExp(`Turn ${turnId}`));
    assert.match(parsed.stdout, /transport contract input/);
    assert.match(parsed.stdout, /Capability mode: cli_fallback/);

    const createCommand = {
      channel: channelId, title: "transport task", executionMode: "autopilot", idempotencyKey: "transport:task:create",
    };
    const cliTask = await directClient.request<Record<string, unknown>>("POST", "/agent-gateway/task/create", createCommand);
    const mcpTask = toolJson(await client.callTool({ name: "task.create", arguments: createCommand }));
    assert.deepEqual(mcpTask, cliTask);
    const claimed = await runFile(process.execPath, [
      tsxCli, path.resolve("src/cli/index.ts"), "task", "claim", "--message-id", String(cliTask.taskId), "--revision", "1",
    ], { cwd: process.cwd(), env, timeout: 10_000 });
    assert.match(claimed.stdout, /Claimed #1 rev=2/);
    const task = await directClient.request<{ task?: { taskStatus?: string } }>("POST", "/agent-gateway/task/get", { taskId: cliTask.taskId });
    assert.equal(task.task?.taskStatus, "in_progress");

    const upload = new FormData();
    upload.append("files", new Blob([new TextEncoder().encode("artifact")], { type: "text/plain" }), "artifact.txt");
    const uploaded = await directClient.upload<{ attachments: Array<{ id: string }> }>("/agent-gateway/turn/attachment/upload", upload);
    assert.equal(uploaded.attachments.length, 1);
    const replyCommand = {
      schemaVersion: 1, body: "  normalized transport reply  ", attachmentIds: [uploaded.attachments[0]!.id],
      handledInputIds: [delivery.id], operationKey: "transport:reply",
    };
    const cliReply = await directClient.request<Record<string, unknown>>("POST", "/agent-gateway/turn/reply", replyCommand);
    const mcpReply = toolJson(await client.callTool({ name: "turn.reply", arguments: replyCommand }));
    assert.deepEqual(mcpReply, cliReply);
    assert.equal(db.select().from(schema.messages).where(eq(schema.messages.id, String(cliReply.messageId))).get()?.content, "normalized transport reply");
    assert.equal(db.select().from(schema.attachments).where(eq(schema.attachments.id, uploaded.attachments[0]!.id)).get()?.messageId, cliReply.messageId);
  } finally {
    await client?.close().catch(() => {});
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    closeSpaceDb(spaceId);
    unregisterSpace(spaceId);
    await rm(root, { recursive: true, force: true });
  }
});
