import { z } from "zod";
import { CanvasValidationError } from "./canvasCore.js";
import type { CanvasAccessGrantRow } from "./canvasAccessGrant.js";

const Id = z.string().trim().min(1);
const CustomId = Id.max(200).refine((value) => value !== "ROOT", { message: "id cannot be ROOT" });
const IdempotencyKey = z.string().trim().min(1).max(200);
const CanvasLocator = {
  canvasId: Id.optional(),
  snapshotId: Id.optional(),
};
const WriteLocator = {
  ...CanvasLocator,
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: IdempotencyKey,
};

const ShapeType = z.enum([
  "rect", "ellipse", "circle", "line", "arrow", "triangle", "polygon", "star", "path", "pen", "pencil",
]);

export const CanvasSceneSummaryCommandSchema = z.object({
  ...CanvasLocator,
  idempotencyKey: IdempotencyKey,
}).strict();

export const CanvasCreateFrameCommandSchema = z.object({
  ...WriteLocator,
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  name: z.string().trim().min(1).max(200).optional(),
  id: CustomId.optional(),
}).strict();

export const CanvasCreateTextCommandSchema = z.object({
  ...WriteLocator,
  text: z.string().min(1).max(20_000),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive().optional(),
  height: z.number().finite().positive().optional(),
  parentId: Id.optional(),
  frameId: Id.optional(),
  fontSize: z.number().finite().positive().optional(),
  fill: z.string().trim().min(1).max(200).optional(),
  fontWeight: z.union([z.string().trim().min(1).max(40), z.number().finite()]).optional(),
  fontFamily: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  id: CustomId.optional(),
}).strict();

export const CanvasCreateShapeCommandSchema = z.object({
  ...WriteLocator,
  shapeType: ShapeType.optional(),
  type: ShapeType.optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  parentId: Id.optional(),
  frameId: Id.optional(),
  fill: z.string().trim().min(1).max(200).optional(),
  stroke: z.string().trim().min(1).max(200).optional(),
  borderWidth: z.number().finite().nonnegative().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  id: CustomId.optional(),
}).strict();

/** AssetId-only. url / dataUrl / genPrompt are rejected as unknown fields by `.strict()`. */
export const CanvasCreateImageCommandSchema = z.object({
  ...WriteLocator,
  assetId: Id,
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  parentId: Id.optional(),
  frameId: Id.optional(),
  name: z.string().trim().min(1).max(200).optional(),
  id: CustomId.optional(),
}).strict();

export const CanvasUpdateNodeCommandSchema = z.object({
  ...WriteLocator,
  nodeId: Id,
  id: Id.optional(), // ToolOp alias; schema still requires nodeId
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().finite().positive().optional(),
  height: z.number().finite().positive().optional(),
  text: z.string().max(20_000).optional(),
  fill: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  opacity: z.number().finite().optional(),
  rotation: z.number().finite().optional(),
  shapeType: ShapeType.optional(),
  patch: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const CanvasDeleteNodesCommandSchema = z.object({
  ...WriteLocator,
  ids: z.array(Id).min(1).max(200),
  nodeIds: z.array(Id).min(1).max(200).optional(), // ToolOp alias; schema still requires ids
  confirmDestructive: z.boolean().optional(),
}).strict();

export type CanvasSceneSummaryCommand = z.infer<typeof CanvasSceneSummaryCommandSchema>;
export type CanvasCreateFrameCommand = z.infer<typeof CanvasCreateFrameCommandSchema>;
export type CanvasCreateTextCommand = z.infer<typeof CanvasCreateTextCommandSchema>;
export type CanvasCreateShapeCommand = z.infer<typeof CanvasCreateShapeCommandSchema>;
export type CanvasCreateImageCommand = z.infer<typeof CanvasCreateImageCommandSchema>;
export type CanvasUpdateNodeCommand = z.infer<typeof CanvasUpdateNodeCommandSchema>;
export type CanvasDeleteNodesCommand = z.infer<typeof CanvasDeleteNodesCommandSchema>;

export type CanvasTypedMutationCommand =
  | CanvasCreateFrameCommand
  | CanvasCreateTextCommand
  | CanvasCreateShapeCommand
  | CanvasCreateImageCommand
  | CanvasUpdateNodeCommand
  | CanvasDeleteNodesCommand;

export const CANVAS_MUTATION_TOOL_NAMES = [
  "canvas.elements_apply",
  "canvas.create_frame",
  "canvas.create_text",
  "canvas.create_shape",
  "canvas.create_image",
  "canvas.update_node",
  "canvas.delete_nodes",
] as const;
export type CanvasMutationToolName = (typeof CANVAS_MUTATION_TOOL_NAMES)[number];

export function isCanvasMutationToolName(name: string): name is CanvasMutationToolName {
  return (CANVAS_MUTATION_TOOL_NAMES as readonly string[]).includes(name);
}

/** Later slice: durable media generation job. This turn does not accept URL/data URL/genPrompt. */
export const CANVAS_MEDIA_GENERATE_SEAM = {
  status: "deferred" as const,
  acceptedInput: "assetId",
  rejectedInput: ["url", "dataUrl", "src", "genPrompt"] as const,
  nextTool: "canvas.asset_import then canvas.create_image",
};

export const CANVAS_TYPED_TOOL_DESCRIPTIONS = {
  "canvas.scene_summary": "Read a grant-scoped, model-friendly Canvas summary (canvasId, snapshotId, revision, selected Frames, element abstracts, allowedCreateParents). Call this before creating or editing. Do not inspect project source to learn Canvas.",
  "canvas.create_frame": "Create a Frame/artboard on the authorized Canvas. Prefer a new Frame for a fixed-size poster instead of a full-bleed background rect. Coordinates are Canvas-space. Custom id cannot be ROOT and cannot collide with an existing element or Frame.",
  "canvas.create_text": "Create a text node. Prefer frameId from the selected Frame in canvas.scene_summary; node parentId is ROOT or a group (Frame ids passed as parentId are remapped). Do not invent Canvas APIs from source code.",
  "canvas.create_shape": "Create a shape node (rect/ellipse/circle/…). Prefer frameId from the selected Frame; node parentId is ROOT or a group. Prefer update_node to morph an existing shape; never delete+recreate the same object.",
  "canvas.create_image": "Create an image node from an existing Canvas assetId that already belongs to this Canvas. Missing or cross-canvas assets are rejected. Remote URLs, data URLs, and genPrompt are rejected. Import a turn-bound local attachment with canvas.asset_import first. Image generation jobs are not available in this turn.",
  "canvas.update_node": "Patch an existing authorized node by nodeId. Keep the same id; do not delete+create to change type or style.",
  "canvas.delete_nodes": "Delete authorized nodes. Destructive: confirmDestructive must be true, and the user must have asked to delete.",
} as const;

export type CanvasTypedToolName = keyof typeof CANVAS_TYPED_TOOL_DESCRIPTIONS;

export const CANVAS_AGENT_GATEWAY_PATHS = {
  "canvas.scene_summary": "/agent-gateway/canvas/scene_summary",
  "canvas.create_frame": "/agent-gateway/canvas/create_frame",
  "canvas.create_text": "/agent-gateway/canvas/create_text",
  "canvas.create_shape": "/agent-gateway/canvas/create_shape",
  "canvas.create_image": "/agent-gateway/canvas/create_image",
  "canvas.update_node": "/agent-gateway/canvas/update_node",
  "canvas.delete_nodes": "/agent-gateway/canvas/delete_nodes",
} as const;

function compactAttrs(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) attrs[key] = value;
  }
  return Object.keys(attrs).length ? attrs : undefined;
}

export function defaultCreateParentId(grant: CanvasAccessGrantRow): string | undefined {
  const parents = grant.objectScope.createParents;
  if (!parents.length) return undefined;
  const groups = grant.objectScope.elementIds.filter((id) => parents.includes(id));
  if (groups.length === 1) return groups[0];
  if (parents.includes("ROOT")) return "ROOT";
  return parents.find((id) => id !== "ROOT" && !grant.objectScope.frameIds.includes(id)) ?? "ROOT";
}

export function defaultCreateFrameId(grant: CanvasAccessGrantRow): string | undefined {
  return grant.objectScope.frameIds.length === 1 ? grant.objectScope.frameIds[0] : undefined;
}

export function typedCanvasCommandToToolOp(
  toolName: Exclude<CanvasTypedToolName, "canvas.scene_summary">,
  command: CanvasTypedMutationCommand,
  grant: CanvasAccessGrantRow,
): Record<string, unknown> {
  const createNode = toolName === "canvas.create_text"
    || toolName === "canvas.create_shape"
    || toolName === "canvas.create_image";
  let parentId: string | undefined;
  let frameId: string | undefined;
  if (createNode) {
    const input = command as CanvasCreateTextCommand | CanvasCreateShapeCommand | CanvasCreateImageCommand;
    parentId = input.parentId ?? defaultCreateParentId(grant);
    frameId = input.frameId ?? defaultCreateFrameId(grant);
    if (parentId && grant.objectScope.frameIds.includes(parentId)) {
      frameId = frameId ?? parentId;
      parentId = "ROOT";
    }
  }
  if (toolName === "canvas.create_frame") {
    const input = command as CanvasCreateFrameCommand;
    return { op: "create_frame", id: input.id, x: input.x, y: input.y, width: input.width, height: input.height, name: input.name };
  }
  if (toolName === "canvas.create_text") {
    const input = command as CanvasCreateTextCommand;
    return {
      op: "create_text",
      id: input.id,
      parentId,
      frameId,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      text: input.text,
      attrs: compactAttrs({
        fontSize: input.fontSize,
        fill: input.fill,
        fontWeight: input.fontWeight,
        fontFamily: input.fontFamily,
        name: input.name,
      }),
    };
  }
  if (toolName === "canvas.create_shape") {
    const input = command as CanvasCreateShapeCommand;
    return {
      op: "create_shape",
      id: input.id,
      parentId,
      frameId,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      attrs: compactAttrs({
        shapeType: input.shapeType ?? input.type ?? "rect",
        fill: input.fill,
        stroke: input.stroke,
        borderWidth: input.borderWidth,
        name: input.name,
      }),
    };
  }
  if (toolName === "canvas.create_image") {
    const input = command as CanvasCreateImageCommand;
    return {
      op: "create_image",
      id: input.id,
      parentId,
      frameId,
      assetId: input.assetId,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      attrs: compactAttrs({ name: input.name }),
    };
  }
  if (toolName === "canvas.update_node") {
    const input = command as CanvasUpdateNodeCommand;
    const nodeId = input.nodeId ?? input.id;
    if (!nodeId) throw new CanvasValidationError("update_node requires nodeId");
    const patch = { ...(input.patch ?? {}) };
    if (input.text !== undefined) patch.text = input.text;
    if (input.fill !== undefined) patch.fill = input.fill;
    if (input.name !== undefined) patch.name = input.name;
    if (input.hidden !== undefined) patch.hidden = input.hidden;
    if (input.locked !== undefined) patch.locked = input.locked;
    if (input.opacity !== undefined) patch.opacity = input.opacity;
    if (input.rotation !== undefined) patch.rotation = input.rotation;
    if (input.shapeType !== undefined) patch.shapeType = input.shapeType;
    for (const forbidden of ["src", "url", "href", "dataUrl", "genPrompt"]) {
      if (forbidden in patch) {
        throw new CanvasValidationError(`update_node cannot set ${forbidden}`);
      }
    }
    return {
      op: "update_node",
      nodeId,
      id: nodeId,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      patch,
    };
  }
  const input = command as CanvasDeleteNodesCommand;
  const ids = input.ids ?? input.nodeIds;
  if (!ids?.length) throw new CanvasValidationError("delete_nodes requires ids");
  return {
    op: "delete_nodes",
    ids,
  };
}

