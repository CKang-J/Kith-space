#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BrokerGatewayClient, GatewayClientError } from "../../capabilities/gatewayClient.js";
import {
  CanvasCreateFrameCommandSchema,
  CanvasCreateImageCommandSchema,
  CanvasCreateShapeCommandSchema,
  CanvasCreateTextCommandSchema,
  CanvasDeleteNodesCommandSchema,
  CanvasSceneSummaryCommandSchema,
  CanvasUpdateNodeCommandSchema,
  CANVAS_AGENT_GATEWAY_PATHS,
  CANVAS_TYPED_TOOL_DESCRIPTIONS,
} from "../../canvas/canvasAgentTools.js";

const client = BrokerGatewayClient.fromEnv(process.env, "mcp");
const server = new McpServer({ name: "kith-core", version: "0.1.0" });

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function registerSchema(
  name: string,
  description: string,
  schema: z.ZodObject<z.ZodRawShape>,
  method: "GET" | "POST",
  path: string,
): void {
  server.registerTool(name, { description, inputSchema: schema }, async (input) => {
    try {
      const value = await client.request(method, path, method === "POST" ? input : undefined);
      return result(value);
    } catch (error) {
      const code = error instanceof GatewayClientError ? error.code : "gateway_failed";
      const message = error instanceof Error ? error.message : String(error);
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ code, error: message }) }] };
    }
  });
}

function register(
  name: string,
  description: string,
  inputSchema: Record<string, z.ZodTypeAny>,
  method: "GET" | "POST",
  path: string | ((input: Record<string, unknown>) => string),
  transform?: (input: Record<string, unknown>) => Record<string, unknown>,
): void {
  server.registerTool(name, { description, inputSchema: z.object(inputSchema).strict() }, async (input) => {
    try {
      const target = typeof path === "function" ? path(input as Record<string, unknown>) : path;
      const command = transform ? transform(input as Record<string, unknown>) : input;
      const value = await client.request(method, target, method === "POST" ? command : undefined);
      return result(value);
    } catch (error) {
      const code = error instanceof GatewayClientError ? error.code : "gateway_failed";
      const message = error instanceof Error ? error.message : String(error);
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ code, error: message }) }] };
    }
  });
}

register("session.context_check", "Read only the authoritative active-turn inputs; optionally refresh later surface refs.", {
  refresh: z.boolean().default(false),
}, "GET", (input) => `/agent-gateway/turn/context?refresh=${input.refresh === true ? "true" : "false"}`);
register("turn.reply", "Commit a server-targeted Chat reply and settle the listed input obligations.", {
  schemaVersion: z.literal(1), body: z.string(), attachmentIds: z.array(z.string().min(1)).max(20).default([]),
  sourceRefs: z.array(z.object({
    sourceKind: z.string().min(1), sourceId: z.string().min(1), sourceRevision: z.number().int().nonnegative().nullable(),
    projection: z.enum(["canonical", "internal_summary", "shareable_summary", "ref_only"]),
  }).strict()).max(20).default([]),
  outputRefs: z.array(z.object({
    kind: z.literal("canvas_mutation"),
    artifactId: z.string().min(1),
  }).strict()).max(20).default([]),
  disclosureGrantId: z.string().min(1).optional(),
  handledInputIds: z.array(z.string().min(1)).min(1).max(50), operationKey: z.string().min(1).max(128),
}, "POST", "/agent-gateway/turn/reply");
register("turn.cede", "Cede optional inputs with an explicit reason.", {
  schemaVersion: z.literal(1), inputIds: z.array(z.string().min(1)).min(1).max(50),
  reason: z.string().min(1).max(1_000), operationKey: z.string().min(1).max(128),
}, "POST", "/agent-gateway/turn/cede");
register("turn.progress", "Record bounded progress for the active turn.", {
  text: z.string().min(1).max(2_000), idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/turn/progress");
register("turn.get", "Inspect the active turn, attempts, context, operations, usage, and outcome.", {}, "GET", "/agent-gateway/turn/get");
register("session.checklist_list", "List the current surface session checklist.", {}, "GET", "/agent-gateway/session/checklist");
register("session.checklist_upsert", "Create or CAS-update a current surface session checklist item.", {
  id: z.string().min(1).optional(), text: z.string().min(1).max(1_000),
  status: z.enum(["pending", "in_progress", "done", "cancelled"]).default("pending"),
  order: z.number().int().min(0).max(10_000), expectedRevision: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/session/checklist/upsert");
register("session.checklist_complete", "CAS-complete a current surface session checklist item.", {
  id: z.string().min(1), text: z.string().min(1).max(1_000), order: z.number().int().min(0).max(10_000),
  expectedRevision: z.number().int().positive(), idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/session/checklist/upsert", (input) => ({ ...input, status: "done" }));
register("session.checklist_clear", "Clear checklist items in the current surface session.", {
  includeCompleted: z.boolean().default(true), idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/session/checklist/clear");
register("session.schedule_wakeup", "Schedule a one-shot wake of this surface session in 60–3600 seconds.", {
  delaySeconds: z.number().int().min(60).max(3_600), reason: z.string().min(1).max(500), idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/session/wakeup");
register("conversation.read", "Read an ACL-checked conversation and audit the later query.", {
  channelId: z.string().min(1), limit: z.number().int().min(1).max(100).default(50), afterSeq: z.number().int().nonnegative().optional(),
}, "POST", "/agent-gateway/conversation/read");
register("conversation.search", "Search ACL-checked current Agent conversations and audit returned sources.", {
  query: z.string().min(1).max(500), limit: z.number().int().min(1).max(50).default(20),
}, "POST", "/agent-gateway/conversation/search");
register("memory.recall", "Recall disclosure-projected episodic memory for the active output surface.", {
  query: z.string().min(1).max(500), includeContinuity: z.boolean().default(true),
}, "POST", "/agent-gateway/memory/recall");
register("memory.get", "Get one accessible episodic-memory revision by opaque id.", {
  memoryId: z.string().min(1).max(128),
}, "POST", "/agent-gateway/memory/get");
register("task.list", "List tasks in one currently accessible channel.", {
  channel: z.string().min(1),
}, "POST", "/agent-gateway/task/list");
register("task.get", "Read one currently accessible task and its linked reports/deliveries.", {
  taskId: z.string().min(6),
}, "POST", "/agent-gateway/task/get");
register("task.create", "Create one idempotent task in an accessible channel.", {
  channel: z.string().min(1), title: z.string().min(1).max(20_000),
  executionMode: z.enum(["autopilot", "plan-first"]).default("autopilot"),
  parentTaskId: z.string().min(6).optional(), idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/task/create");
register("task.claim", "Idempotently claim an accessible task for the current Agent.", {
  taskId: z.string().min(6), expectedRevision: z.number().int().positive().optional(), idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/task/claim");
register("task.update", "CAS-update an accessible task status.", {
  taskId: z.string().min(6), status: z.enum(["todo", "in_progress", "in_review", "done", "closed"]),
  from: z.enum(["todo", "in_progress", "in_review", "done", "closed"]).optional(),
  expectedRevision: z.number().int().positive().optional(), idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/task/update");
register("task.assign", "CAS-handoff an accessible task to another Agent.", {
  taskId: z.string().min(6), to: z.string().min(1), expectedRevision: z.number().int().positive().optional(), idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/task/assign");
register("task.unclaim", "CAS-release the current Agent's task claim.", {
  taskId: z.string().min(6), expectedRevision: z.number().int().positive().optional(), idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/task/unclaim");
register("task.report", "Post one idempotent structured report to the task thread.", {
  taskId: z.string().min(6), kind: z.enum(["progress", "blocker", "question", "result"]),
  content: z.string().min(1).max(20_000), idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/task/report");
register("task.deliver", "Publish an idempotent delivery summary and move the task to in_review.", {
  taskId: z.string().min(6), expectedRevision: z.number().int().positive(), summary: z.string().min(1).max(20_000),
  childTaskIds: z.array(z.string().min(6)).max(100).default([]), idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/task/deliver");
register("capability.describe", "Describe the active kith-core capability mode and scopes.", {}, "GET", "/agent-gateway/capability/describe");
register("canvas.snapshot_get", "Read the authorized immutable Canvas Selection Snapshot for this turn.", {
  snapshotId: z.string().min(1), canvasId: z.string().min(1).optional(), idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/canvas/snapshot_get");
register("canvas.elements_get", "Read live authorized Canvas elements/Frames within the current grant.", {
  canvasId: z.string().min(1).optional(), snapshotId: z.string().min(1).optional(),
  elementIds: z.array(z.string().min(1)).max(200).optional(), frameIds: z.array(z.string().min(1)).max(200).optional(),
  idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/canvas/elements_get");
register("canvas.elements_apply", "Map Recombyn ToolOps onto Canvas Core under the current grant and CAS revision.", {
  canvasId: z.string().min(1).optional(), snapshotId: z.string().min(1).optional(),
  expectedRevision: z.number().int().nonnegative(),
  operations: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
  confirmDestructive: z.boolean().optional(), idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/canvas/elements_apply");
register("canvas.export", "Export the authorized immutable Selection Snapshot as a Canvas side effect.", {
  snapshotId: z.string().min(1), canvasId: z.string().min(1).optional(), idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/canvas/export");
register("canvas.context_bundle_create", "Create a bounded Canvas context bundle from the authorized snapshot.", {
  snapshotId: z.string().min(1), canvasId: z.string().min(1).optional(), idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/canvas/context_bundle_create");
register("canvas.asset_import", "Import a turn-bound local attachment into the authorized Canvas asset store.", {
  canvasId: z.string().min(1).optional(), snapshotId: z.string().min(1).optional(),
  attachmentId: z.string().min(1).optional(), assetId: z.string().min(1).optional(),
  url: z.string().optional(), dataUrl: z.string().optional(),
  idempotencyKey: z.string().min(1),
}, "POST", "/agent-gateway/canvas/asset_import");
registerSchema("canvas.scene_summary", CANVAS_TYPED_TOOL_DESCRIPTIONS["canvas.scene_summary"], CanvasSceneSummaryCommandSchema, "POST", CANVAS_AGENT_GATEWAY_PATHS["canvas.scene_summary"]);
registerSchema("canvas.create_frame", CANVAS_TYPED_TOOL_DESCRIPTIONS["canvas.create_frame"], CanvasCreateFrameCommandSchema, "POST", CANVAS_AGENT_GATEWAY_PATHS["canvas.create_frame"]);
registerSchema("canvas.create_text", CANVAS_TYPED_TOOL_DESCRIPTIONS["canvas.create_text"], CanvasCreateTextCommandSchema, "POST", CANVAS_AGENT_GATEWAY_PATHS["canvas.create_text"]);
registerSchema("canvas.create_shape", CANVAS_TYPED_TOOL_DESCRIPTIONS["canvas.create_shape"], CanvasCreateShapeCommandSchema, "POST", CANVAS_AGENT_GATEWAY_PATHS["canvas.create_shape"]);
registerSchema("canvas.create_image", CANVAS_TYPED_TOOL_DESCRIPTIONS["canvas.create_image"], CanvasCreateImageCommandSchema, "POST", CANVAS_AGENT_GATEWAY_PATHS["canvas.create_image"]);
registerSchema("canvas.update_node", CANVAS_TYPED_TOOL_DESCRIPTIONS["canvas.update_node"], CanvasUpdateNodeCommandSchema, "POST", CANVAS_AGENT_GATEWAY_PATHS["canvas.update_node"]);
registerSchema("canvas.delete_nodes", CANVAS_TYPED_TOOL_DESCRIPTIONS["canvas.delete_nodes"], CanvasDeleteNodesCommandSchema, "POST", CANVAS_AGENT_GATEWAY_PATHS["canvas.delete_nodes"]);

await server.connect(new StdioServerTransport());
