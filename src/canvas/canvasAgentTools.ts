import { z } from "zod";
import { CanvasValidationError } from "./canvasCore.js";
import type { CanvasAccessGrantRow } from "./canvasAccessGrant.js";

const Id = z.string().trim().min(1);
const CustomId = Id.max(200).refine((value) => value !== "ROOT", { message: "id cannot be ROOT" });
const IdempotencyKey = z.string().trim().min(1).max(200);
const ColorString = z.string().trim().min(1).max(200);
const NameString = z.string().trim().min(1).max(200);
const BlendMode = z.string().trim().min(1).max(40);
const NodeIds = z.array(Id).min(1).max(200);
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
const FillType = z.enum(["solid", "linear", "radial", "angular", "diffuse", "image"]);
const StrokeAlign = z.enum(["center", "inside", "outside"]);
const StrokeStyle = z.enum(["solid", "dashed", "dotted"]);
const StrokeLinecap = z.enum(["butt", "round", "square"]);
const StrokeLinejoin = z.enum(["miter", "round", "bevel"]);
const BrushStyle = z.enum([
  "solid", "pencil-hb", "soft", "fountain", "calligraphy", "brushpen", "marker",
  "highlighter", "chalk", "charcoal", "bristle", "airbrush", "watercolor", "needle", "bold",
]);
const AlignMode = z.enum(["left", "centerX", "right", "top", "middle", "bottom"]);
const DistributeAxis = z.enum(["h", "v"]);
const ReorderAction = z.enum(["front", "back", "forward", "backward"]);
const BooleanMode = z.enum(["union", "subtract", "intersect", "exclude"]);

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
  name: NameString.optional(),
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
  fill: ColorString.optional(),
  fontWeight: z.union([z.string().trim().min(1).max(40), z.number().finite()]).optional(),
  fontFamily: z.string().trim().min(1).max(120).optional(),
  name: NameString.optional(),
  id: CustomId.optional(),
  rotation: z.number().finite().optional(),
  opacity: z.number().finite().optional(),
  blendMode: BlendMode.optional(),
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
  fill: ColorString.optional(),
  fillType: FillType.optional(),
  fillEnd: ColorString.optional(),
  gradientAngle: z.number().finite().optional(),
  stroke: ColorString.optional(),
  borderWidth: z.number().finite().nonnegative().optional(),
  strokeAlign: StrokeAlign.optional(),
  strokeStyle: StrokeStyle.optional(),
  strokeLinecap: StrokeLinecap.optional(),
  strokeLinejoin: StrokeLinejoin.optional(),
  strokeOpacity: z.number().finite().min(0).max(100).optional(),
  cornerRadius: z.number().finite().nonnegative().optional(),
  rotation: z.number().finite().optional(),
  blendMode: BlendMode.optional(),
  opacity: z.number().finite().optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  path: z.string().trim().min(1).max(50_000).optional(),
  closed: z.boolean().optional(),
  sides: z.number().int().min(3).max(64).optional(),
  brushStyle: BrushStyle.optional(),
  brushHardness: z.number().finite().min(0).max(100).optional(),
  pathPressure: z.string().trim().min(1).max(20_000).optional(),
  pressureEnabled: z.boolean().optional(),
  name: NameString.optional(),
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
  name: NameString.optional(),
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
  fill: ColorString.optional(),
  fillType: FillType.optional(),
  fillEnd: ColorString.optional(),
  gradientAngle: z.number().finite().optional(),
  stroke: ColorString.optional(),
  strokeAlign: StrokeAlign.optional(),
  strokeStyle: StrokeStyle.optional(),
  strokeLinecap: StrokeLinecap.optional(),
  strokeLinejoin: StrokeLinejoin.optional(),
  strokeOpacity: z.number().finite().min(0).max(100).optional(),
  borderWidth: z.number().finite().nonnegative().optional(),
  cornerRadius: z.number().finite().nonnegative().optional(),
  rotation: z.number().finite().optional(),
  blendMode: BlendMode.optional(),
  opacity: z.number().finite().optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  fontSize: z.number().finite().positive().optional(),
  fontWeight: z.union([z.string().trim().min(1).max(40), z.number().finite()]).optional(),
  fontFamily: z.string().trim().min(1).max(120).optional(),
  name: NameString.optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  shapeType: ShapeType.optional(),
  patch: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const CanvasDeleteNodesCommandSchema = z.object({
  ...WriteLocator,
  ids: z.array(Id).min(1).max(200),
  nodeIds: NodeIds.optional(), // ToolOp alias; schema still requires ids
  confirmDestructive: z.boolean().optional(),
}).strict();

export const CanvasUpdateFrameCommandSchema = z.object({
  ...WriteLocator,
  frameId: Id,
  id: Id.optional(),
  width: z.number().finite().positive().optional(),
  height: z.number().finite().positive().optional(),
  name: NameString.optional(),
  backgroundColor: ColorString.optional(),
  locked: z.boolean().optional(),
}).strict();

export const CanvasAlignNodesCommandSchema = z.object({
  ...WriteLocator,
  nodeIds: NodeIds,
  mode: AlignMode,
}).strict();

export const CanvasDistributeNodesCommandSchema = z.object({
  ...WriteLocator,
  nodeIds: z.array(Id).min(3).max(200),
  axis: DistributeAxis,
}).strict();

export const CanvasReorderNodesCommandSchema = z.object({
  ...WriteLocator,
  nodeIds: NodeIds,
  action: ReorderAction,
}).strict();

export const CanvasGroupNodesCommandSchema = z.object({
  ...WriteLocator,
  nodeIds: z.array(Id).min(2).max(200),
  id: CustomId.optional(),
}).strict();

export const CanvasUngroupNodesCommandSchema = z.object({
  ...WriteLocator,
  nodeIds: NodeIds,
  confirmDestructive: z.boolean().optional(),
}).strict();

export const CanvasDuplicateNodesCommandSchema = z.object({
  ...WriteLocator,
  nodeIds: NodeIds,
  offsetX: z.number().finite().optional(),
  offsetY: z.number().finite().optional(),
}).strict();

export const CanvasFlipNodesCommandSchema = z.object({
  ...WriteLocator,
  nodeIds: NodeIds,
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
}).strict();

export const CanvasBooleanOpCommandSchema = z.object({
  ...WriteLocator,
  nodeIds: z.array(Id).min(2).max(200),
  mode: BooleanMode,
  confirmDestructive: z.boolean().optional(),
}).strict();

export const CanvasSetCanvasBackgroundCommandSchema = z.object({
  ...WriteLocator,
  color: ColorString.optional(),
  fill: ColorString.optional(),
  backgroundColor: ColorString.optional(),
  fillType: FillType.optional(),
  fillEnd: ColorString.optional(),
  gradientAngle: z.number().finite().optional(),
  opacity: z.number().finite().optional(),
}).strict();

export type CanvasSceneSummaryCommand = z.infer<typeof CanvasSceneSummaryCommandSchema>;
export type CanvasCreateFrameCommand = z.infer<typeof CanvasCreateFrameCommandSchema>;
export type CanvasCreateTextCommand = z.infer<typeof CanvasCreateTextCommandSchema>;
export type CanvasCreateShapeCommand = z.infer<typeof CanvasCreateShapeCommandSchema>;
export type CanvasCreateImageCommand = z.infer<typeof CanvasCreateImageCommandSchema>;
export type CanvasUpdateNodeCommand = z.infer<typeof CanvasUpdateNodeCommandSchema>;
export type CanvasDeleteNodesCommand = z.infer<typeof CanvasDeleteNodesCommandSchema>;
export type CanvasUpdateFrameCommand = z.infer<typeof CanvasUpdateFrameCommandSchema>;
export type CanvasAlignNodesCommand = z.infer<typeof CanvasAlignNodesCommandSchema>;
export type CanvasDistributeNodesCommand = z.infer<typeof CanvasDistributeNodesCommandSchema>;
export type CanvasReorderNodesCommand = z.infer<typeof CanvasReorderNodesCommandSchema>;
export type CanvasGroupNodesCommand = z.infer<typeof CanvasGroupNodesCommandSchema>;
export type CanvasUngroupNodesCommand = z.infer<typeof CanvasUngroupNodesCommandSchema>;
export type CanvasDuplicateNodesCommand = z.infer<typeof CanvasDuplicateNodesCommandSchema>;
export type CanvasFlipNodesCommand = z.infer<typeof CanvasFlipNodesCommandSchema>;
export type CanvasBooleanOpCommand = z.infer<typeof CanvasBooleanOpCommandSchema>;
export type CanvasSetCanvasBackgroundCommand = z.infer<typeof CanvasSetCanvasBackgroundCommandSchema>;

export type CanvasTypedMutationCommand =
  | CanvasCreateFrameCommand
  | CanvasCreateTextCommand
  | CanvasCreateShapeCommand
  | CanvasCreateImageCommand
  | CanvasUpdateNodeCommand
  | CanvasDeleteNodesCommand
  | CanvasUpdateFrameCommand
  | CanvasAlignNodesCommand
  | CanvasDistributeNodesCommand
  | CanvasReorderNodesCommand
  | CanvasGroupNodesCommand
  | CanvasUngroupNodesCommand
  | CanvasDuplicateNodesCommand
  | CanvasFlipNodesCommand
  | CanvasBooleanOpCommand
  | CanvasSetCanvasBackgroundCommand;

export const CANVAS_MUTATION_TOOL_NAMES = [
  "canvas.elements_apply",
  "canvas.create_frame",
  "canvas.create_text",
  "canvas.create_shape",
  "canvas.create_image",
  "canvas.update_node",
  "canvas.delete_nodes",
  "canvas.update_frame",
  "canvas.align_nodes",
  "canvas.distribute_nodes",
  "canvas.reorder_nodes",
  "canvas.group_nodes",
  "canvas.ungroup_nodes",
  "canvas.duplicate_nodes",
  "canvas.flip_nodes",
  "canvas.boolean_op",
  "canvas.set_canvas_background",
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
  "canvas.scene_summary": "Read a grant-scoped, model-friendly Canvas summary. Returns JSON plus contextText with CANVAS_SCENE / SCENE_FRAMES / SCENE_NODES / FOCUS_FRAME_ID / GRANT / AVAILABLE_FONTS. Call this before creating or editing. Do not inspect project source to learn Canvas. 画布摘要/先读再改",
  "canvas.create_frame": "Create a frame/artboard. Args: x,y,width,height,name?. Fixed-size poster/mobile/H5/banner: MUST create_frame first at the deliverable size — never replace the artboard with a full-bleed create_shape bg rect. Exception only if the user explicitly refuses a frame (不要画板/自由画布/不要 create_frame). Multi-screen or multi-poster: one create_frame per board (name it), then that board's content, then the next create_frame — do not merge into one tall frame. Custom id cannot be ROOT and cannot collide with an existing element or Frame. 画框/画板/先建 frame",
  "canvas.create_text": "Add a text node. Args: text, x, y, width?, height?, fontSize?, fill?, fontWeight?, fontFamily?, rotation?, opacity?, blendMode?, name?. fontFamily only from Available fonts, and only when that face is ~≥90% similar to the needed look. Hero/main titles below that bar → prefer create_image+letteringText instead of forcing a near calligraphy font. Do not invent font names. Do not map 书法感→Zhi Mang Xing by default. Prefer frameId from the selected Frame in canvas.scene_summary; node parentId is ROOT or a group (Frame ids passed as parentId are remapped). 文字/标题/不要编字体",
  "canvas.create_shape": "Add a shape. Args: shapeType|type = rect|ellipse|circle|line|arrow|triangle|polygon|star|path|pen|pencil (+ path for pen/pencil/path; sides for polygon/star), x,y,width,height, fill, stroke, borderWidth, strokeAlign=center|inside|outside (default center — ink + selection indicator sit on stroke mid-band; outside/inside shift the band). Fills: solid → fill=#RRGGBB|rgba(…); gradient → fillType=linear|radial|angular|diffuse + fill + fillEnd + gradientAngle? (example vignette: fillType=linear fill=rgba(0,0,0,0) fillEnd=rgba(0,0,0,0.35) gradientAngle=90). NEVER put CSS linear-gradient()/radial-gradient()/conic-gradient() in fill — rejected by host. Diffuse may pass meshSize/meshPoints. Optional: strokeStyle, strokeLinecap, strokeLinejoin, strokeOpacity, cornerRadius, rotation, blendMode, opacity, flipX, flipY. Pen=pen+path (icons: closed path for filled silhouettes). Brush/板绘=pencil tip-stamp: path (M/L only)+pathPressure (csv 0.05-1, same length as points)+brushStyle tip id (solid|pencil-hb|soft|fountain|calligraphy|brushpen|marker|highlighter|chalk|charcoal|bristle|airbrush|watercolor|needle|bold)+optional brushHardness 0-100 (soft→hard tip, default ~80)+optional pressureEnabled true|false (default true when pathPressure set); stroke-only. Line/arrow are open center strokes (full arrow path includes head). Icons: prefer primitives + boolean_op (cutouts/combines); create_svg/create_icon only for simple single-path marks. For Q-illustration / pencil sketch do NOT collage with circles — use multiple pencil strokes with pressure. Prefer frameId from the selected Frame; never delete+recreate the same object to restyle it. 形状/填充/描边/渐变/禁止 CSS gradient",
  "canvas.create_image": "Create an image node from an existing Canvas assetId that already belongs to this Canvas. Missing or cross-canvas assets are rejected. Remote URLs, data URLs, and genPrompt are rejected — do not pass src|url|attachmentIndex|genPrompt. Import a turn-bound local attachment with canvas.asset_import first. Image generation jobs are not available in this turn. Optional letteringText/removeBg/cutoutMode from Recombyn are not accepted here. Atmosphere/poster heroes: keep titles/dates/logos in create_text, not baked into the image. 图片/只用 assetId/禁止 URL 与 genPrompt",
  "canvas.update_node": "Patch an existing node by nodeId|id (keeps z-order). Geometry: x,y,width,height. Morph shape: shapeType|type=rect|ellipse|circle|triangle|polygon|star|line|arrow|… (rect→circle = update_node shapeType=circle on same id — NEVER delete+create_shape). Style: fill (solid hex/rgba only — NEVER CSS linear-gradient()/radial-gradient()), fillType=solid|linear|radial|angular|diffuse|image?, fillEnd?, gradientAngle?, stroke,borderWidth,strokeAlign=center|inside|outside (default center; selection chrome sits on mid of stroke band), strokeStyle, strokeLinecap, strokeLinejoin, strokeOpacity, opacity,cornerRadius,rotation,blendMode,name, flipX/flipY, fontSize, fontWeight, fontFamily, text styles…. Gradients: fillType=linear|radial|angular|diffuse + fill + fillEnd (+ gradientAngle?). Pencil tip edits: brushStyle (tip id), brushHardness 0-100, pathPressure csv, pressureEnabled. Visibility/edit: hidden, locked (boolean). Keep the same id; do not delete+create to change type or style. 改节点/改填充/改字号/禁止删除重建",
  "canvas.delete_nodes": "Remove nodes by id. Args: ids|nodeIds (string[]). Only when user asked to delete. Destructive: confirmDestructive must be true. Never put ids in the chat reply. 删除节点/需确认",
  "canvas.update_frame": "Update frame size/name/background/lock. Args: frameId|id (must match FOCUS_FRAME_ID when set), width?, height?, name?, backgroundColor?, locked? (boolean — prevent moving/resizing the artboard). When FOCUS_FRAME_ID is present, always use that id — never retarget by name. 改画框/改画板背景",
  "canvas.align_nodes": "Align 2+ nodes. Args: nodeIds, mode=left|centerX|right|top|middle|bottom (FE reads mode; centerX not center). Do not invent align=center or axis=x/y. 对齐",
  "canvas.distribute_nodes": "Distribute 3+ nodes. Args: nodeIds, axis=h|v (h=horizontal, v=vertical). Do not pass x/y. 分布/均分",
  "canvas.reorder_nodes": "Z-order. Args: nodeIds, action=front|back|forward|backward. Do not pass order/bring_to_front. 图层顺序/置顶置底",
  "canvas.group_nodes": "Group nodes. Args: nodeIds (2+). 成组",
  "canvas.ungroup_nodes": "Ungroup. Args: nodeIds (group ids). Replaces the group node — confirmDestructive must be true. 解组",
  "canvas.duplicate_nodes": "Duplicate nodes. Args: nodeIds, offsetX?, offsetY?. 复制节点",
  "canvas.flip_nodes": "Flip nodes. Args: nodeIds, flipX?=true and/or flipY?=true. Do not pass axis. 翻转",
  "canvas.boolean_op": "Boolean on shapes — primary tool for constructed icons (cutouts/combines). Args: nodeIds (2+ from SCENE), mode=union|subtract|intersect|exclude. Examples: moon=large circle subtract small; magnifier=circle union handle rect; ring=outer circle subtract inner. Prefer this over dumping create_svg when the mark can be built from primitives/pen. Operands are replaced — confirmDestructive must be true. 布尔运算/挖空/合并",
  "canvas.set_canvas_background": "Set infinite-canvas stage background (not artboard fill). Args: color|fill|backgroundColor (solid hex/rgba — never CSS gradient()), fillType?=solid|linear|radial|angular|diffuse|image, fillEnd?, gradientAngle?, opacity?. Do not use a full-bleed rect as the canvas stage background. 画布背景/不是画板填充",
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
  "canvas.update_frame": "/agent-gateway/canvas/update_frame",
  "canvas.align_nodes": "/agent-gateway/canvas/align_nodes",
  "canvas.distribute_nodes": "/agent-gateway/canvas/distribute_nodes",
  "canvas.reorder_nodes": "/agent-gateway/canvas/reorder_nodes",
  "canvas.group_nodes": "/agent-gateway/canvas/group_nodes",
  "canvas.ungroup_nodes": "/agent-gateway/canvas/ungroup_nodes",
  "canvas.duplicate_nodes": "/agent-gateway/canvas/duplicate_nodes",
  "canvas.flip_nodes": "/agent-gateway/canvas/flip_nodes",
  "canvas.boolean_op": "/agent-gateway/canvas/boolean_op",
  "canvas.set_canvas_background": "/agent-gateway/canvas/set_canvas_background",
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
        rotation: input.rotation,
        opacity: input.opacity,
        blendMode: input.blendMode,
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
        fillType: input.fillType,
        fillEnd: input.fillEnd,
        gradientAngle: input.gradientAngle,
        stroke: input.stroke,
        borderWidth: input.borderWidth,
        strokeAlign: input.strokeAlign,
        strokeStyle: input.strokeStyle,
        strokeLinecap: input.strokeLinecap,
        strokeLinejoin: input.strokeLinejoin,
        strokeOpacity: input.strokeOpacity,
        cornerRadius: input.cornerRadius,
        rotation: input.rotation,
        blendMode: input.blendMode,
        opacity: input.opacity,
        flipX: input.flipX,
        flipY: input.flipY,
        path: input.path,
        closed: input.closed,
        sides: input.sides,
        brushStyle: input.brushStyle,
        brushHardness: input.brushHardness,
        pathPressure: input.pathPressure,
        pressureEnabled: input.pressureEnabled,
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
    const assign = (key: string, value: unknown) => {
      if (value !== undefined) patch[key] = value;
    };
    assign("text", input.text);
    assign("fill", input.fill);
    assign("fillType", input.fillType);
    assign("fillEnd", input.fillEnd);
    assign("gradientAngle", input.gradientAngle);
    assign("stroke", input.stroke);
    assign("strokeAlign", input.strokeAlign);
    assign("strokeStyle", input.strokeStyle);
    assign("strokeLinecap", input.strokeLinecap);
    assign("strokeLinejoin", input.strokeLinejoin);
    assign("strokeOpacity", input.strokeOpacity);
    assign("borderWidth", input.borderWidth);
    assign("cornerRadius", input.cornerRadius);
    assign("name", input.name);
    assign("hidden", input.hidden);
    assign("locked", input.locked);
    assign("opacity", input.opacity);
    assign("rotation", input.rotation);
    assign("blendMode", input.blendMode);
    assign("flipX", input.flipX);
    assign("flipY", input.flipY);
    assign("fontSize", input.fontSize);
    assign("fontWeight", input.fontWeight);
    assign("fontFamily", input.fontFamily);
    assign("shapeType", input.shapeType);
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
  if (toolName === "canvas.delete_nodes") {
    const input = command as CanvasDeleteNodesCommand;
    const ids = input.ids ?? input.nodeIds;
    if (!ids?.length) throw new CanvasValidationError("delete_nodes requires ids");
    return {
      op: "delete_nodes",
      ids,
    };
  }
  if (toolName === "canvas.update_frame") {
    const input = command as CanvasUpdateFrameCommand;
    return {
      op: "update_frame",
      frameId: input.frameId,
      id: input.frameId ?? input.id,
      width: input.width,
      height: input.height,
      name: input.name,
      backgroundColor: input.backgroundColor,
      locked: input.locked,
    };
  }
  if (toolName === "canvas.align_nodes") {
    const input = command as CanvasAlignNodesCommand;
    return {
      op: "align_nodes",
      nodeIds: input.nodeIds,
      ids: input.nodeIds,
      mode: input.mode,
    };
  }
  if (toolName === "canvas.distribute_nodes") {
    const input = command as CanvasDistributeNodesCommand;
    return {
      op: "distribute_nodes",
      nodeIds: input.nodeIds,
      ids: input.nodeIds,
      axis: input.axis,
    };
  }
  if (toolName === "canvas.reorder_nodes") {
    const input = command as CanvasReorderNodesCommand;
    return {
      op: "reorder_nodes",
      nodeIds: input.nodeIds,
      ids: input.nodeIds,
      action: input.action,
    };
  }
  if (toolName === "canvas.group_nodes") {
    const input = command as CanvasGroupNodesCommand;
    return {
      op: "group_nodes",
      nodeIds: input.nodeIds,
      ids: input.nodeIds,
      groupId: input.id,
    };
  }
  if (toolName === "canvas.ungroup_nodes") {
    const input = command as CanvasUngroupNodesCommand;
    return {
      op: "ungroup_nodes",
      nodeIds: input.nodeIds,
      ids: input.nodeIds,
      groupId: input.nodeIds[0],
    };
  }
  if (toolName === "canvas.duplicate_nodes") {
    const input = command as CanvasDuplicateNodesCommand;
    return {
      op: "duplicate_nodes",
      nodeIds: input.nodeIds,
      ids: input.nodeIds,
      offsetX: input.offsetX,
      offsetY: input.offsetY,
    };
  }
  if (toolName === "canvas.flip_nodes") {
    const input = command as CanvasFlipNodesCommand;
    return {
      op: "flip_nodes",
      nodeIds: input.nodeIds,
      ids: input.nodeIds,
      flipX: input.flipX,
      flipY: input.flipY,
    };
  }
  if (toolName === "canvas.boolean_op") {
    const input = command as CanvasBooleanOpCommand;
    return {
      op: "boolean_op",
      nodeIds: input.nodeIds,
      ids: input.nodeIds,
      mode: input.mode,
      operation: input.mode,
    };
  }
  if (toolName === "canvas.set_canvas_background") {
    const input = command as CanvasSetCanvasBackgroundCommand;
    const color = input.color ?? input.fill ?? input.backgroundColor ?? null;
    return {
      op: "set_canvas_background",
      color: input.color,
      fill: input.fill,
      backgroundColor: input.backgroundColor,
      fillType: input.fillType,
      fillEnd: input.fillEnd,
      gradientAngle: input.gradientAngle,
      opacity: input.opacity,
      value: compactAttrs({
        color,
        fill: input.fill ?? color,
        fillType: input.fillType,
        fillEnd: input.fillEnd,
        gradientAngle: input.gradientAngle,
        opacity: input.opacity,
      }) ?? color,
    };
  }
  throw new CanvasValidationError(`unsupported typed Canvas tool ${toolName}`);
}
