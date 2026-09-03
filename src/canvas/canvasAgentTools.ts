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

export const CanvasSkillListCommandSchema = z.object({
  ...CanvasLocator,
  idempotencyKey: IdempotencyKey,
}).strict();

export const CanvasSkillGetCommandSchema = z.object({
  ...CanvasLocator,
  skillKey: z.string().trim().min(1).max(80),
  idempotencyKey: IdempotencyKey,
}).strict();

export const CanvasDesignReviewCommandSchema = z.object({}).strict();

export const CanvasGenerationStatusCommandSchema = z.object({
  jobId: Id,
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

/** AssetId XOR genPrompt. url / dataUrl / src remain unknown fields rejected by `.strict()`. */
export const CanvasCreateImageCommandSchema = z.object({
  ...WriteLocator,
  assetId: Id.optional(),
  genPrompt: z.string().min(10).max(2000).optional(),
  letteringText: z.string().max(200).optional(),
  removeBg: z.boolean().optional(),
  cutoutMode: z.enum(["product", "hair"]).optional(),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional(),
  stylePreset: z.string().max(100).optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  parentId: Id.optional(),
  frameId: Id.optional(),
  name: NameString.optional(),
  id: CustomId.optional(),
}).strict();

/** Raw inline SVG markup. The host re-runs the fail-closed sanitizer (canvasAssetStore) on apply. */
export const CanvasCreateSvgCommandSchema = z.object({
  ...WriteLocator,
  svg: z.string().min(1).max(100_000),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  fill: ColorString.optional(),
  parentId: Id.optional(),
  frameId: Id.optional(),
  name: NameString.optional(),
  id: CustomId.optional(),
}).strict();

/** create_icon 与 create_svg 共用同一 create_svg ToolOp（raw svg string），仅描述侧重图标语义。 */
export const CanvasCreateIconCommandSchema = CanvasCreateSvgCommandSchema;

export const CanvasDeleteFrameCommandSchema = z.object({
  ...WriteLocator,
  frameId: Id,
  id: Id.optional(), // ToolOp alias; schema still requires frameId
  confirmDestructive: z.boolean().optional(),
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
  textAlign: z.enum(["left", "center", "right"]).optional(),
  lineHeight: z.number().finite().positive().optional(),
  letterSpacing: z.number().finite().optional(),
  fontStyle: z.enum(["normal", "italic"]).optional(),
  textDecoration: z.enum(["none", "underline", "line-through", "overline"]).optional(),
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
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
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
  resultId: CustomId.optional(),
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

export const CanvasVideoGenerateCommandSchema = z.object({
  ...WriteLocator,
  genPrompt: z.string().min(10).max(2000),
  referenceImageAssetId: Id.optional(),
  duration: z.number().int().min(2).max(12).optional(),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  parentId: Id.optional(),
  frameId: Id.optional(),
  name: NameString.optional(),
  id: CustomId.optional(),
}).strict();

export type CanvasSceneSummaryCommand = z.infer<typeof CanvasSceneSummaryCommandSchema>;
export type CanvasSkillListCommand = z.infer<typeof CanvasSkillListCommandSchema>;
export type CanvasSkillGetCommand = z.infer<typeof CanvasSkillGetCommandSchema>;
export type CanvasDesignReviewCommand = z.infer<typeof CanvasDesignReviewCommandSchema>;
export type CanvasGenerationStatusCommand = z.infer<typeof CanvasGenerationStatusCommandSchema>;
export type CanvasCreateFrameCommand = z.infer<typeof CanvasCreateFrameCommandSchema>;
export type CanvasCreateTextCommand = z.infer<typeof CanvasCreateTextCommandSchema>;
export type CanvasCreateShapeCommand = z.infer<typeof CanvasCreateShapeCommandSchema>;
export type CanvasCreateImageCommand = z.infer<typeof CanvasCreateImageCommandSchema>;
export type CanvasCreateSvgCommand = z.infer<typeof CanvasCreateSvgCommandSchema>;
export type CanvasCreateIconCommand = z.infer<typeof CanvasCreateIconCommandSchema>;
export type CanvasDeleteFrameCommand = z.infer<typeof CanvasDeleteFrameCommandSchema>;
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
export type CanvasVideoGenerateCommand = z.infer<typeof CanvasVideoGenerateCommandSchema>;

export type CanvasTypedMutationCommand =
  | CanvasCreateFrameCommand
  | CanvasCreateTextCommand
  | CanvasCreateShapeCommand
  | CanvasCreateImageCommand
  | CanvasCreateSvgCommand
  | CanvasCreateIconCommand
  | CanvasUpdateNodeCommand
  | CanvasDeleteNodesCommand
  | CanvasDeleteFrameCommand
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
  "canvas.create_svg",
  "canvas.create_icon",
  "canvas.update_node",
  "canvas.delete_nodes",
  "canvas.delete_frame",
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

/** Durable media generation is accepted on create_image(genPrompt) and canvas.video_generate. Remote URL/data URL remain rejected. */
export const CANVAS_MEDIA_GENERATE_SEAM = {
  status: "accepted" as const,
  acceptedInput: ["assetId", "genPrompt"] as const,
  rejectedInput: ["url", "dataUrl", "src"] as const,
  nextTool: "canvas.create_image(assetId|genPrompt) or canvas.video_generate",
};

export const CANVAS_TYPED_TOOL_DESCRIPTIONS = {
  "canvas.scene_summary": "Read a grant-scoped, model-friendly Canvas summary. Returns JSON plus contextText with CANVAS_SCENE / SCENE_FRAMES / SCENE_NODES / SCENE_FACTS (computed layout facts for design_review self-scoring: hero_coverage, whitespace, h1_h2_ratio, out_of_frame/canvas, overlap, anti_slop) / FOCUS_FRAME_ID / GRANT / AVAILABLE_FONTS. Call this before creating or editing. Do not inspect project source to learn Canvas. 画布摘要/先读再改",
  "canvas.skill_list": "List Canvas design skills (foundation + domains). Returns catalog with skillKey, category, whenToUse, priority. Load one primary surface skill before a new poster/landing/banner. Read-only. 设计技能目录",
  "canvas.skill_get": "Load the full Markdown playbook for one skillKey from skill_list (e.g. poster_craft, design_brief, anti_ai_slop). Read-only. 加载设计技能全文",
  "canvas.design_review": "Run the in-turn design review dossier over the authorized Canvas grant (no args). Returns one integrated contextText: the grant-scoped scene summary (CANVAS_SCENE / SCENE_FRAMES / SCENE_NODES / SCENE_FACTS / GRANT / AVAILABLE_FONTS) plus DESIGN_REVIEW_RUBRIC (dimension caps: composition 20, hierarchy 20, typography 15, color 15, consistency 15, content 10, originality 5 — sum 100) plus SCORING_CONTRACT (0-100 self-score; <70 rework / 70-89 fix majors / >=90 pass; must_fix blocks settle). Call it after the last mutation and before turn.reply: score every dimension within its cap using SCENE_FACTS, fix every must_fix, then settle. Read-only; it does not score for you. 评审档案/自评打分/settle 门禁",
  "canvas.generation_status": "Poll one queued generation job. Args: jobId (required, from canvas.create_image(genPrompt) or canvas.video_generate). Returns status (pending|processing|completed|failed|cancelled), kind (image|video|audio), provider, resultNodeId when completed, error when failed, elapsedMs. A job is only visible to the agent whose turn created it. Poll this instead of blind-waiting; after status=completed confirm the node with canvas.scene_summary. Do not claim the image/video exists before completed. 生成任务状态/轮询/异步job",
  "canvas.create_frame": "Create a frame/artboard. Args: x,y,width,height,name?. Fixed-size poster/mobile/H5/banner: MUST create_frame first at the deliverable size — never replace the artboard with a full-bleed create_shape bg rect. Exception only if the user explicitly refuses a frame (不要画板/自由画布/不要 create_frame). Multi-screen or multi-poster: one create_frame per board (name it), then that board's content, then the next create_frame — do not merge into one tall frame. Custom id cannot be ROOT and cannot collide with an existing element or Frame. 画框/画板/先建 frame",
  "canvas.create_text": "Add a text node. Args: text, x, y, width?, height?, fontSize?, fill?, fontWeight?, fontFamily?, rotation?, opacity?, blendMode?, name?. fontFamily only from Available fonts, and only when that face is ~≥90% similar to the needed look. Hero/main titles below that bar → prefer create_image+letteringText instead of forcing a near calligraphy font. Do not invent font names. Do not map 书法感→Zhi Mang Xing by default. Prefer frameId from the selected Frame in canvas.scene_summary; node parentId is ROOT or a group (Frame ids passed as parentId are remapped). 文字/标题/不要编字体",
  "canvas.create_shape": "Add a shape. Args: shapeType|type = rect|ellipse|circle|line|arrow|triangle|polygon|star|path|pen|pencil (+ path for pen/pencil/path; sides for polygon/star), x,y,width,height, fill, stroke, borderWidth. " +
    "**Icon construction**: Prefer simple primitives (circle/rect/polygon) + boolean_op for complex icons. " +
    "Example: moon = circle + circle → boolean_op subtract; magnifier = circle + rect → boolean_op union. " +
    "Prefer primitives + canvas.boolean_op for complex single-path marks. If you truly need raw SVG beyond primitives, use canvas.create_svg or canvas.create_icon (sanitized inline markup, viewBox required). " +
    "**Never use emoji (🏠🔍❤️) in create_text as icons**. " +
    "strokeAlign=center|inside|outside (default center — ink + selection indicator sit on stroke mid-band; outside/inside shift the band). Fills: solid → fill=#RRGGBB|rgba(…); gradient → fillType=linear|radial|angular|diffuse + fill + fillEnd + gradientAngle? (example vignette: fillType=linear fill=rgba(0,0,0,0) fillEnd=rgba(0,0,0,0.35) gradientAngle=90). NEVER put CSS linear-gradient()/radial-gradient()/conic-gradient() in fill — rejected by host. Diffuse may pass meshSize/meshPoints. Optional: strokeStyle, strokeLinecap, strokeLinejoin, strokeOpacity, cornerRadius, rotation, blendMode, opacity, flipX, flipY. Pen=pen+path (icons: closed path for filled silhouettes). Brush/板绘=pencil tip-stamp: path (M/L only)+pathPressure (csv 0.05-1, same length as points)+brushStyle tip id (solid|pencil-hb|soft|fountain|calligraphy|brushpen|marker|highlighter|chalk|charcoal|bristle|airbrush|watercolor|needle|bold)+optional brushHardness 0-100 (soft→hard tip, default ~80)+optional pressureEnabled true|false (default true when pathPressure set); stroke-only. Line/arrow are open center strokes (full arrow path includes head). For Q-illustration / pencil sketch do NOT collage with circles — use multiple pencil strokes with pressure. Prefer frameId from the selected Frame; never delete+recreate the same object to restyle it. 形状/填充/描边/渐变/禁止 CSS gradient",
  "canvas.create_svg": "Add a raw SVG node (inline markup). " +
    "Args: svg (required raw SVG string), x, y, width, height, fill?, frameId?, parentId?, name?. " +
    "svg = full <svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\">…</svg> (a viewBox is required so the node scales into x/y/width/height). " +
    "path d: use spaced commands Mm Ll Hh Vv Cc Ss Qq Tt Aa Zz + numbers; never glue arc params (bad: a22001…). " +
    "Host sanitizer REJECTS active/external content: script/foreignObject/iframe/object/embed/link/meta/style tags, on* event attributes, javascript: URLs, and any href/url() reference that is not a local #id fragment — malformed markup is rejected, not escaped. " +
    "For constructed icons with cutouts prefer create_shape + boolean_op / pen over one giant path. " +
    "内联 SVG/矢量标记/禁止 script 与外链",
  "canvas.create_icon": "Add a compact SVG icon mark (same sanitized svg input as canvas.create_svg). " +
    "REQUIRED: non-empty svg string with <svg viewBox=\"0 0 24 24\"> and at least one <path d=\"…\"> (or simple shapes). Prefer viewBox 0 0 24 24; valid path d only. " +
    "NEVER use emoji/text as the mark — that is create_text, not create_icon. Empty svg and active/external content (script, on* handlers, external refs) are rejected by the same sanitizer as create_svg. " +
    "For icons that need cutouts/combines, prefer create_shape + boolean_op or pen instead of one giant path. " +
    "图标/矢量标记",
  "canvas.create_image": "Create an image node. " +
    "Args: assetId (existing Canvas asset) OR genPrompt (AI image generation, queued job). " +
    "When using genPrompt: " +
    "- Atmosphere/backgrounds: describe SCENE ONLY, no baked titles/dates/logos; put copy in create_text layers. " +
    "- Hero lettering: use genPrompt + letteringText for calligraphy/decorative titles beyond Available fonts. " +
    "- Products/portraits: describe subject, lighting, materials; use removeBg=true for cutouts. " +
    "Optional: letteringText (visible text in the image), removeBg=true (auto-cutout), " +
    "cutoutMode=product|hair, aspectRatio (1:1|16:9|9:16|4:3|3:4), stylePreset. " +
    "Generation is async: tool returns jobId, image appears when ready (10-60s). " +
    "Remote URLs and data URLs are still rejected. Missing or cross-canvas assetId is rejected. " +
    "图片/assetId 或 genPrompt 生成/可选抠图和风格",
  "canvas.update_node": "Patch an existing node by nodeId|id (keeps z-order). Geometry: x,y,width,height. Morph shape: shapeType|type=rect|ellipse|circle|triangle|polygon|star|line|arrow|… (rect→circle = update_node shapeType=circle on same id — NEVER delete+create_shape). Style: fill (solid hex/rgba only — NEVER CSS linear-gradient()/radial-gradient()), fillType=solid|linear|radial|angular|diffuse|image?, fillEnd?, gradientAngle?, stroke,borderWidth,strokeAlign=center|inside|outside (default center; selection chrome sits on mid of stroke band), strokeStyle, strokeLinecap, strokeLinejoin, strokeOpacity, opacity,cornerRadius,rotation,blendMode,name, flipX/flipY. Text styles (text nodes): text, fontSize, fontWeight, fontFamily, textAlign=left|center|right, lineHeight (multiplier, e.g. 1.2), letterSpacing (px, may be negative), fontStyle=normal|italic, textDecoration=none|underline|line-through|overline. Gradients: fillType=linear|radial|angular|diffuse + fill + fillEnd (+ gradientAngle?). Pencil tip edits: brushStyle (tip id), brushHardness 0-100, pathPressure csv, pressureEnabled. Visibility/edit: hidden, locked (boolean). Keep the same id; do not delete+create to change type or style. 改节点/改填充/改字号/禁止删除重建",
  "canvas.delete_nodes": "Remove nodes by id. Args: ids|nodeIds (string[]). Only when user asked to delete. Destructive: confirmDestructive must be true. Never put ids in the chat reply. 删除节点/需确认",
  "canvas.delete_frame": "Delete a Frame by frameId|id (from SCENE_FRAMES). Destructive: confirmDestructive must be true. Only when the user asked to delete the artboard — never delete the FOCUS frame to fake a clear (use update_frame for background/name changes). Never put ids in the chat reply. 删除画框/需确认",
  "canvas.update_frame": "Update frame position/size/name/background/lock. Args: frameId|id (must match FOCUS_FRAME_ID when set), x?, y? (move the artboard), width?, height?, name?, backgroundColor?, locked? (boolean — prevent moving/resizing the artboard). When FOCUS_FRAME_ID is present, always use that id — never retarget by name. 改画框/移动画板/改画板背景",
  "canvas.align_nodes": "Align 2+ nodes to a shared edge or center line. Args: nodeIds (2+ from SCENE_NODES), mode=left|centerX|right|top|middle|bottom (FE reads mode; centerX not center). left/right align x edges to the leftmost/rightmost node, top/bottom align y edges, centerX aligns horizontal centers, middle aligns vertical centers. Do not invent align=center or axis=x/y — only mode is accepted. 对齐",
  "canvas.distribute_nodes": "Distribute 3+ nodes evenly. Args: nodeIds (3+ from SCENE_NODES), axis=h|v (h=horizontal, v=vertical). The first and last nodes in that axis stay put; nodes between them move to equal steps. Do not pass x/y. 分布/均分",
  "canvas.reorder_nodes": "Z-order (stack). Args: nodeIds (from SCENE_NODES), action?=front|back|forward|backward. With action: move the listed nodes to front / to back / one step forward / one step backward. Without action: nodeIds is the complete new front-to-back order — the listed nodes go on top in that order and every unlisted node drops below them. Do not pass order/bring_to_front fields. 图层顺序/置顶置底",
  "canvas.group_nodes": "Group nodes under a new group node. Args: nodeIds (2+ from SCENE_NODES), id? (unique group id). Children keep their canvas positions; the group is a container with no own fill. Frames cannot be grouped — frame ids belong to the frame tools. 成组",
  "canvas.ungroup_nodes": "Ungroup. Args: nodeIds (group node ids from SCENE_NODES). Dissolves the group and reparents children to the group's parent — the group node is replaced, so confirmDestructive must be true. 解组",
  "canvas.duplicate_nodes": "Duplicate nodes. Args: nodeIds, offsetX? (default 16), offsetY? (default 16) — each copy is shifted by the offset from its original. Copies get new ids and keep all style/attrs. 复制节点",
  "canvas.flip_nodes": "Flip nodes in place around their center. Args: nodeIds, flipX?=true and/or flipY?=true (at least one). Repeated flips toggle back. Do not pass axis. 翻转",
  "canvas.boolean_op": "Boolean operations on 2+ shapes — PRIMARY tool for constructing complex icons with cutouts/combines. " +
    "Prefer this over create_svg when the icon can be built from primitives. " +
    "Examples: " +
    "moon = large circle subtract small circle (mode=subtract); " +
    "magnifier = circle union rect handle (mode=union); " +
    "ring = outer circle subtract inner circle (mode=subtract); " +
    "heart = two circles + triangle boolean union. " +
    "Args: nodeIds (2+ from SCENE), mode=union|subtract|intersect|exclude, resultId? (custom id for the combined result node), confirmDestructive=true. " +
    "Operands are replaced by the single result node. 布尔运算/挖空/合并/构建复杂图标",
  "canvas.set_canvas_background": "Set infinite-canvas stage background (not artboard fill). Args: color|fill|backgroundColor (solid hex/rgba — never CSS gradient()), fillType?=solid|linear|radial|angular|diffuse|image, fillEnd?, gradientAngle?, opacity?. Do not use a full-bleed rect as the canvas stage background. 画布背景/不是画板填充",
  "canvas.video_generate": "Generate a short video (2-12s) and place it as a video node. " +
    "Args: genPrompt (scene description), optional referenceImageAssetId (image-to-video from an existing Canvas asset), " +
    "duration (seconds, default 5, 2-12), aspectRatio (1:1|16:9|9:16|4:3|3:4), x/y/width/height/frameId (placement). " +
    "Prompts should describe motion/camera: 'camera slowly pans right across neon cityscape' / " +
    "'product rotates 360 degrees on white surface'. " +
    "Generation is async: returns jobId, video appears when ready (60-300s). " +
    "视频生成/基于图片或纯提示词/异步任务",
} as const;

export type CanvasTypedToolName = keyof typeof CANVAS_TYPED_TOOL_DESCRIPTIONS;

export const CANVAS_TYPED_READ_TOOL_NAMES = [
  "canvas.scene_summary",
  "canvas.skill_list",
  "canvas.skill_get",
  "canvas.design_review",
  "canvas.generation_status",
] as const;
export type CanvasTypedReadToolName = (typeof CANVAS_TYPED_READ_TOOL_NAMES)[number];
export const CANVAS_GENERATION_TOOL_NAMES = [
  "canvas.video_generate",
] as const;
export type CanvasGenerationToolName = (typeof CANVAS_GENERATION_TOOL_NAMES)[number];
export type CanvasTypedMutationToolName = Exclude<
  CanvasTypedToolName,
  CanvasTypedReadToolName | CanvasGenerationToolName
>;

export const CANVAS_AGENT_GATEWAY_PATHS = {
  "canvas.scene_summary": "/agent-gateway/canvas/scene_summary",
  "canvas.skill_list": "/agent-gateway/canvas/skill_list",
  "canvas.skill_get": "/agent-gateway/canvas/skill_get",
  "canvas.design_review": "/agent-gateway/canvas/design_review",
  "canvas.generation_status": "/agent-gateway/canvas/generation_status",
  "canvas.create_frame": "/agent-gateway/canvas/create_frame",
  "canvas.create_text": "/agent-gateway/canvas/create_text",
  "canvas.create_shape": "/agent-gateway/canvas/create_shape",
  "canvas.create_image": "/agent-gateway/canvas/create_image",
  "canvas.create_svg": "/agent-gateway/canvas/create_svg",
  "canvas.create_icon": "/agent-gateway/canvas/create_icon",
  "canvas.update_node": "/agent-gateway/canvas/update_node",
  "canvas.delete_nodes": "/agent-gateway/canvas/delete_nodes",
  "canvas.delete_frame": "/agent-gateway/canvas/delete_frame",
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
  "canvas.video_generate": "/agent-gateway/canvas/video_generate",
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
  if (grant.objectScope.frameIds.length > 0) return "ROOT";
  if (parents.includes("ROOT")) return "ROOT";
  return parents.find((id) => id !== "ROOT" && !grant.objectScope.frameIds.includes(id)) ?? "ROOT";
}

export function defaultCreateFrameId(grant: CanvasAccessGrantRow): string | undefined {
  if (grant.objectScope.emptySelection) return undefined;
  return grant.objectScope.frameIds.length === 1 ? grant.objectScope.frameIds[0] : undefined;
}

export function resolveCreatePlacement(
  grant: CanvasAccessGrantRow,
  input: { parentId?: string; frameId?: string },
): { parentId: string | undefined; frameId: string | undefined } {
  let parentId = input.parentId ?? defaultCreateParentId(grant);
  let frameId = input.frameId ?? defaultCreateFrameId(grant);
  if (parentId && grant.objectScope.frameIds.includes(parentId)) {
    frameId = frameId ?? parentId;
    parentId = "ROOT";
  }
  return { parentId, frameId };
}

export function assertCreateImageSource(command: CanvasCreateImageCommand): "asset" | "generate" {
  const hasAsset = Boolean(command.assetId);
  const hasPrompt = Boolean(command.genPrompt);
  if (hasAsset === hasPrompt) {
    throw new CanvasValidationError("create_image requires exactly one of assetId or genPrompt");
  }
  return hasPrompt ? "generate" : "asset";
}

export function typedCanvasCommandToToolOp(
  toolName: CanvasTypedMutationToolName,
  command: CanvasTypedMutationCommand,
  grant: CanvasAccessGrantRow,
): Record<string, unknown> {
  const createNode = toolName === "canvas.create_text"
    || toolName === "canvas.create_shape"
    || toolName === "canvas.create_image"
    || toolName === "canvas.create_svg"
    || toolName === "canvas.create_icon";
  let parentId: string | undefined;
  let frameId: string | undefined;
  if (createNode) {
    const input = command as CanvasCreateTextCommand | CanvasCreateShapeCommand | CanvasCreateImageCommand | CanvasCreateSvgCommand | CanvasCreateIconCommand;
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
    if (!input.assetId) {
      throw new CanvasValidationError("create_image mutation path requires assetId");
    }
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
  if (toolName === "canvas.create_svg" || toolName === "canvas.create_icon") {
    const input = command as CanvasCreateSvgCommand;
    return {
      op: "create_svg",
      id: input.id,
      parentId,
      frameId,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      svg: input.svg,
      attrs: compactAttrs({ fill: input.fill, name: input.name }),
    };
  }
  if (toolName === "canvas.delete_frame") {
    const input = command as CanvasDeleteFrameCommand;
    const frameId = input.frameId ?? input.id;
    if (!frameId) throw new CanvasValidationError("delete_frame requires frameId");
    return {
      op: "delete_frame",
      frameId,
      id: frameId,
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
    assign("textAlign", input.textAlign);
    assign("lineHeight", input.lineHeight);
    assign("letterSpacing", input.letterSpacing);
    assign("fontStyle", input.fontStyle);
    assign("textDecoration", input.textDecoration);
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
      x: input.x,
      y: input.y,
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
      resultId: input.resultId,
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
