import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BrokerGatewayClient } from "../../capabilities/gatewayClient.js";

test("kith-core MCP and CLI client return the same Core domain result", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kith-mcp-contract-"));
  const activationFile = path.join(root, "activation.json");
  await writeFile(activationFile, JSON.stringify({ activationId: "activation-1", workerGeneration: 7 }));
  const expected = { turnId: "turn-1", capabilityMode: "mcp_with_cli_fallback", inputs: [{ id: "input-1" }] };
  const server = http.createServer((req, res) => {
    assert.equal(req.headers["x-kith-session-handle"], "session-handle");
    assert.equal(req.headers["x-kith-activation-id"], "activation-1");
    assert.equal(req.headers["x-kith-worker-generation"], "7");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(expected));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const environment = { endpoint, sessionHandle: "session-handle", activationFile };
  const direct = await new BrokerGatewayClient(environment).request("GET", "/agent-gateway/turn/context?refresh=false");

  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  Object.assign(env, {
    KITH_SPACE_BROKER_ENDPOINT: endpoint,
    KITH_SPACE_BROKER_HANDLE: "session-handle",
    KITH_SPACE_ACTIVATION_FILE: activationFile,
  });
  const transport = new StdioClientTransport({
    command: path.resolve("node_modules/.bin/tsx"),
    args: [path.resolve("src/server/mcp/stdio.ts")],
    cwd: process.cwd(),
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "kith-contract-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "session.context_check"));
    assert.ok(tools.tools.some((tool) => tool.name === "turn.reply"));
    assert.ok(tools.tools.some((tool) => tool.name === "session.checklist_complete"));
    assert.ok(tools.tools.some((tool) => tool.name === "memory.recall"));
    assert.ok(tools.tools.some((tool) => tool.name === "memory.get"));
    const called = await client.callTool({ name: "session.context_check", arguments: { refresh: false } });
    const text = (called.content as Array<{ type: string; text?: string }>).find((item) => item.type === "text")?.text;
    assert.deepEqual(JSON.parse(text ?? "null"), direct);
  } finally {
    await client.close().catch(() => {});
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
