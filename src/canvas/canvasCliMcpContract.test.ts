import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BrokerGatewayClient } from "../capabilities/gatewayClient.js";
import {
  CanvasAssetImportCommandSchema,
  CanvasContextBundleCreateCommandSchema,
} from "../capabilities/gatewayContracts.js";

test("CLI/MCP canvas context_bundle_create and asset_import share Gateway contracts and routes", async () => {
  const parsedBundle = CanvasContextBundleCreateCommandSchema.parse({
    snapshotId: "snap-1",
    canvasId: "canvas-1",
    idempotencyKey: "bundle:1",
  });
  assert.equal(parsedBundle.snapshotId, "snap-1");
  const parsedImport = CanvasAssetImportCommandSchema.parse({
    attachmentId: "att-1",
    snapshotId: "snap-1",
    idempotencyKey: "import:1",
  });
  assert.equal(parsedImport.attachmentId, "att-1");
  assert.throws(() => CanvasAssetImportCommandSchema.parse({
    attachmentId: "att-1",
    hostPath: "/tmp/x.png",
    idempotencyKey: "import:bad",
  }));

  const root = await mkdtemp(path.join(tmpdir(), "kith-canvas-cli-mcp-"));
  const activationFile = path.join(root, "activation.json");
  await writeFile(activationFile, JSON.stringify({ activationId: "activation-1", workerGeneration: 7 }));
  const seen: string[] = [];
  const expectedBundle = { bundle: { snapshot: { snapshotId: "snap-1" } } };
  const expectedImport = { assetId: "asset-1", canvasId: "canvas-1" };
  const server = http.createServer(async (req, res) => {
    assert.equal(req.headers["x-kith-session-handle"], "session-handle");
    assert.equal(req.headers["x-kith-activation-id"], "activation-1");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/agent-gateway/canvas/context_bundle_create") {
      assert.equal(body.snapshotId, "snap-1");
      res.end(JSON.stringify(expectedBundle));
      return;
    }
    if (req.url === "/agent-gateway/canvas/asset_import") {
      assert.equal(body.attachmentId, "att-1");
      res.end(JSON.stringify(expectedImport));
      return;
    }
    res.end(JSON.stringify({ ok: false }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const environment = { endpoint, sessionHandle: "session-handle", activationFile };
  const directBundle = await new BrokerGatewayClient(environment).request(
    "POST",
    "/agent-gateway/canvas/context_bundle_create",
    { snapshotId: "snap-1", idempotencyKey: "bundle:direct" },
  );
  const directImport = await new BrokerGatewayClient(environment).request(
    "POST",
    "/agent-gateway/canvas/asset_import",
    { attachmentId: "att-1", idempotencyKey: "import:direct" },
  );

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
  const client = new Client({ name: "kith-canvas-contract-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));
    assert.ok(names.has("canvas.context_bundle_create"));
    assert.ok(names.has("canvas.asset_import"));
    assert.ok(names.has("canvas.snapshot_get"));
    assert.ok(names.has("canvas.elements_apply"));
    assert.ok(names.has("canvas.scene_summary"));
    assert.ok(names.has("canvas.skill_list"));
    assert.ok(names.has("canvas.skill_get"));
    assert.ok(names.has("canvas.create_text"));
    assert.ok(names.has("canvas.create_shape"));
    assert.ok(names.has("canvas.create_image"));
    assert.ok(names.has("canvas.create_frame"));
    assert.ok(names.has("canvas.update_node"));
    assert.ok(names.has("canvas.delete_nodes"));
    assert.ok(names.has("canvas.update_frame"));
    assert.ok(names.has("canvas.align_nodes"));
    assert.ok(names.has("canvas.distribute_nodes"));
    assert.ok(names.has("canvas.reorder_nodes"));
    assert.ok(names.has("canvas.group_nodes"));
    assert.ok(names.has("canvas.ungroup_nodes"));
    assert.ok(names.has("canvas.duplicate_nodes"));
    assert.ok(names.has("canvas.flip_nodes"));
    assert.ok(names.has("canvas.boolean_op"));
    assert.ok(names.has("canvas.set_canvas_background"));

    const mcpBundle = await client.callTool({
      name: "canvas.context_bundle_create",
      arguments: { snapshotId: "snap-1", idempotencyKey: "bundle:mcp" },
    });
    const bundleText = (mcpBundle.content as Array<{ type: string; text?: string }>).find((item) => item.type === "text")?.text;
    assert.deepEqual(JSON.parse(bundleText ?? "null"), directBundle);

    const mcpImport = await client.callTool({
      name: "canvas.asset_import",
      arguments: { attachmentId: "att-1", idempotencyKey: "import:mcp" },
    });
    const importText = (mcpImport.content as Array<{ type: string; text?: string }>).find((item) => item.type === "text")?.text;
    assert.deepEqual(JSON.parse(importText ?? "null"), directImport);
    assert.deepEqual(directImport, expectedImport);
    assert.ok(seen.filter((entry) => entry.includes("context_bundle_create")).length >= 2);
    assert.ok(seen.filter((entry) => entry.includes("asset_import")).length >= 2);
  } finally {
    await client.close().catch(() => {});
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI canvas subcommands expose context-bundle-create and asset-import", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(path.resolve("src/cli/index.ts"), "utf8");
  const canonical = source.replace(/\r\n/g, "\n");
  assert.match(canonical, /canvas\.command\("context-bundle-create"\)/);
  assert.match(canonical, /\/agent-gateway\/canvas\/context_bundle_create/);
  assert.match(canonical, /canvas\.command\("asset-import"\)/);
  assert.match(canonical, /\/agent-gateway\/canvas\/asset_import/);
  assert.match(canonical, /attachment-id/);
  assert.match(canonical, /canvas\.command\("scene-summary"\)/);
  assert.match(canonical, /\/agent-gateway\/canvas\/scene_summary/);
  assert.match(canonical, /canvas\.command\("skill-list"\)/);
  assert.match(canonical, /\/agent-gateway\/canvas\/skill_list/);
  assert.match(canonical, /canvas\.command\("skill-get"\)/);
  assert.match(canonical, /\/agent-gateway\/canvas\/skill_get/);
  assert.match(canonical, /canvas\.command\("create-text"\)/);
  assert.match(canonical, /\/agent-gateway\/canvas\/create_text/);
  assert.match(canonical, /--font-weight/);
  assert.match(canonical, /--font-family/);
  assert.match(canonical, /canvas\.command\("create-shape"\)/);
  assert.match(canonical, /--stroke/);
  assert.match(canonical, /--border-width/);
  assert.match(canonical, /canvas\.command\("create-image"\)/);
  assert.match(canonical, /canvas\.command\("update-node"\)/);
  assert.match(canonical, /\/agent-gateway\/canvas\/update_node/);
  assert.match(canonical, /--fill/);
  assert.match(canonical, /--opacity/);
  assert.match(canonical, /--shape-type/);
  assert.match(canonical, /canvas\.command\("update-frame"\)/);
  assert.match(canonical, /\/agent-gateway\/canvas\/update_frame/);
  assert.match(canonical, /canvas\.command\("align-nodes"\)/);
  assert.match(canonical, /canvas\.command\("boolean-op"\)/);
  assert.match(canonical, /\/agent-gateway\/canvas\/set_canvas_background/);
});
