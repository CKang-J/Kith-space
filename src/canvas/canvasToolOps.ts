import { randomUUID } from "node:crypto";
import { sanitizeInlineSvgMarkup } from "./canvasAssetStore.js";
import { CanvasValidationError } from "./canvasCore.js";
import { canvasFrameLocalToCanvas, findCanvasFrame } from "./canvasFrameMembership.js";
import type { CanvasJson, CanvasOperation, CanvasPatch } from "./canvasTypes.js";

// 默认文本样式
const DEFAULT_TEXT_STYLE = {
  fontSize: 16,
  fill: "#000000",
  fontWeight: "400",
  fontFamily: "Inter",
  fontStyle: "normal",
  textAlign: "left",
  lineHeight: 1.2,
  letterSpacing: 0,
  textDecoration: "none",
};

// 构建前端需要的 text attrs 结构
function buildTextAttrs(text: string, style: Partial<typeof DEFAULT_TEXT_STYLE> = {}): Record<string, unknown> {
  const merged = { ...DEFAULT_TEXT_STYLE, ...style };
  const chars = String(text || "")
    .split("")
    .map((char) => ({
      char,
      config: {
        SIZE: merged.fontSize,
        COLOR: merged.fill,
        WEIGHT: merged.fontWeight,
        FAMILY: merged.fontFamily,
        STYLE: merged.fontStyle,
        ALIGN: merged.textAlign,
        LINE_HEIGHT: merged.lineHeight,
        LETTER_SPACING: merged.letterSpacing,
        DECORATION: merged.textDecoration,
      },
    }));

  return {
    DATA: JSON.stringify([{ chars, config: {} }]),
    ORIGIN_DATA: JSON.stringify([
      {
        children: [
          {
            text,
            bold: merged.fontWeight === "bold" || Number(merged.fontWeight) >= 600,
          },
        ],
      },
    ]),
    markdown: text,
  };
}

const DURABLE_OPS = new Set([
  "update_node", "create_shape", "create_text", "create_image", "create_svg",
  "create_lottie", "create_icon", "create_video", "create_audio", "create_frame", "update_frame", "delete_frame",
  "delete_nodes", "align_nodes", "distribute_nodes", "reorder_nodes", "group_nodes",
  "ungroup_nodes", "duplicate_nodes", "flip_nodes", "boolean_op", "set_canvas_background",
]);
const DEFERRED_OPS = new Set(["image_process", "outline_text"]);
const EPHEMERAL_OPS = new Set(["set_viewport"]);
const SIDE_EFFECT_OPS = new Set(["export_canvas"]);
const MEDIA_CREATE = new Set(["create_image", "create_lottie", "create_icon", "create_video", "create_audio"]);
const CSS_GRADIENT_RE = /^(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/i;
const ALLOWED_FILL_TYPES = new Set(["solid", "linear", "radial", "angular", "diffuse", "image"]);
const GRADIENT_FILL_TYPES = new Set(["linear", "radial", "angular", "diffuse"]);
const FILL_COLOR_KEYS = ["fill", "fillColor", "backgroundColor", "color"] as const;
const STROKE_COLOR_KEYS = ["stroke", "border-color", "borderColor"] as const;
const SOLID_COLOR_RE = /^(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\(\s*(?:\d{1,3}%?\s*,\s*){2}\d{1,3}%?(?:\s*,\s*(?:0|1|0?\.\d+|1(?:\.0)?|\d{1,3}%))?\s*\)|transparent)$/i;
const INVALID_FILL_FIX = "use fill=#RRGGBB or rgba(...), never CSS linear-gradient()/radial-gradient()";
const INVALID_STROKE_FIX = "use stroke=#RRGGBB or rgba(...), never CSS linear-gradient()/radial-gradient()";
const MISSING_GRADIENT_END_FIX = "gradient requires both fill (start color) and fillEnd (end color)";

export function formatCanvasOpError(code: string, fix = "", detail = ""): string {
  const parts = [`code=${(code || "invalid_op").trim() || "invalid_op"}`];
  if (fix.trim()) parts.push(`fix=${fix.trim()}`);
  if (detail.trim()) parts.push(`detail=${detail.trim()}`);
  return parts.join("; ");
}

export function parseCanvasOpError(message: string): { code: string; fix?: string; detail?: string } | null {
  const match = /(?:^|; )code=([^;]+)(?:; |$)/.exec(message);
  if (!match) return null;
  const fix = /(?:^|; )fix=([^;]+)/.exec(message)?.[1]?.trim();
  const detail = /(?:^|; )detail=([^;]+)/.exec(message)?.[1]?.trim();
  return { code: match[1]!.trim(), ...(fix ? { fix } : {}), ...(detail ? { detail } : {}) };
}

export class CanvasToolError extends CanvasValidationError {
  readonly code: string;
  readonly fix: string;
  readonly detail: string;

  constructor(code: string, fix: string, detail = "") {
    const normalizedCode = (code || "invalid_op").trim() || "invalid_op";
    super(formatCanvasOpError(normalizedCode, fix, detail));
    this.name = "CanvasToolError";
    this.code = normalizedCode;
    this.fix = fix.trim();
    this.detail = detail.trim();
  }
}

export function isCanvasToolError(error: unknown): error is CanvasToolError {
  return error instanceof CanvasToolError;
}

function opError(code: string, fix: string, detail = ""): CanvasToolError {
  return new CanvasToolError(code, fix, detail);
}

function looksLikeCssGradient(raw: unknown): boolean {
  return CSS_GRADIENT_RE.test(String(raw ?? "").trim());
}

function isSolidPaintColor(raw: unknown): boolean {
  return SOLID_COLOR_RE.test(String(raw ?? "").trim());
}

function colorDetail(key: string, value: unknown): string {
  return `${key}=${String(value).slice(0, 96)}`;
}

function assertSolidPaint(code: "invalid_fill" | "invalid_stroke", key: string, value: unknown, fix: string): void {
  if (value == null) return;
  if (looksLikeCssGradient(value) || !isSolidPaintColor(value)) {
    throw opError(code, fix, colorDetail(key, value));
  }
}

function paintSource(raw: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...raw,
    ...extra,
    fill: extra.fill ?? raw.fill ?? extra["fill-color"] ?? raw["fill-color"],
    fillType: extra.fillType ?? raw.fillType,
    fillEnd: extra.fillEnd ?? raw.fillEnd,
    stroke: extra.stroke ?? raw.stroke ?? extra["border-color"] ?? raw["border-color"],
    backgroundColor: extra.backgroundColor ?? raw.backgroundColor,
    color: extra.color ?? raw.color,
  };
}

function assertFillArgs(_op: string, source: Record<string, unknown>): void {
  for (const key of FILL_COLOR_KEYS) {
    if (!(key in source) || source[key] == null) continue;
    assertSolidPaint("invalid_fill", key, source[key], INVALID_FILL_FIX);
  }
  for (const key of STROKE_COLOR_KEYS) {
    if (!(key in source) || source[key] == null) continue;
    assertSolidPaint("invalid_stroke", key, source[key], INVALID_STROKE_FIX);
  }
  const fillType = source.fillType;
  const normalized = fillType != null && String(fillType).trim() ? String(fillType).trim().toLowerCase() : "";
  if (normalized && !ALLOWED_FILL_TYPES.has(normalized)) {
    throw opError(
      "invalid_fill",
      "fillType must be solid|linear|radial|angular|diffuse|image",
      `fillType=${normalized}`,
    );
  }
  if (GRADIENT_FILL_TYPES.has(normalized)) {
    const fillEnd = source.fillEnd;
    if (fillEnd == null || String(fillEnd).trim() === "") {
      throw opError("missing_gradient_end", MISSING_GRADIENT_END_FIX, `fillType=${normalized}`);
    }
    assertSolidPaint("invalid_fill", "fillEnd", fillEnd, INVALID_FILL_FIX);
  }
}

function requireParams(raw: Record<string, unknown>, keys: string[]): void {
  const missing = keys.filter((key) => {
    const value = raw[key];
    if (value == null || value === "") return true;
    if (typeof value === "number") return !Number.isFinite(value);
    return false;
  });
  if (missing.length) {
    throw opError(
      "missing_required_param",
      `pass required parameter(s): ${missing.join(", ")}`,
      `missing=${missing.join(",")}`,
    );
  }
}

export type CanvasViewportSuggestion = { x: number; y: number; zoom: number };

export type CanvasToolOpsContext = {
  spaceId: string;
  canvasId: string;
};

/** Durable resolver URL that Image/Video nodes render via attrs.src. */
export function durableCanvasAssetSrc(spaceId: string, canvasId: string, assetId: string): string {
  return `/api/canvas-assets/${encodeURIComponent(spaceId)}/${encodeURIComponent(canvasId)}/${encodeURIComponent(assetId)}`;
}

function bindCreatedMediaAttrs(
  op: string,
  attrs: Record<string, CanvasJson>,
  assetId: string,
  context?: CanvasToolOpsContext,
): void {
  if (!context) return;
  const src = durableCanvasAssetSrc(context.spaceId, context.canvasId, assetId);
  if (typeof attrs.src !== "string" || !String(attrs.src).trim()) attrs.src = src;
  if (typeof attrs.uploadKey !== "string" || !String(attrs.uploadKey).trim()) attrs.uploadKey = assetId;
  if (typeof attrs.assetId !== "string" || !String(attrs.assetId).trim()) attrs.assetId = assetId;
  if (typeof attrs.assetKind !== "string") {
    attrs.assetKind = op === "create_icon" ? "icon"
      : op === "create_video" ? "video"
        : op === "create_lottie" ? "lottie"
          : op === "create_audio" ? "audio"
            : "image";
  }
  if ((op === "create_image" || op === "create_icon") && typeof attrs.mode !== "string") attrs.mode = "FIT";
  if (op === "create_audio" && attrs.audioSpeed == null) attrs.audioSpeed = 1;
}

export type MappedCanvasToolOps = {
  operation: CanvasOperation | null;
  createdElementIds: string[];
  createdFrameIds: string[];
  deletedElementIds: string[];
  deletedFrameIds: string[];
  reorderedElementIds: string[];
  reorderedFrameIds: string[];
  viewport: CanvasViewportSuggestion | null;
  backgroundWrite: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asNodeMap(document: CanvasJson): Record<string, Record<string, CanvasJson>> {
  const root = asRecord(document) ?? {};
  const delta = asRecord(root.deltaSetLike) ?? {};
  const nodes: Record<string, Record<string, CanvasJson>> = {};
  for (const [id, value] of Object.entries(delta)) {
    const record = asRecord(value);
    if (record) nodes[id] = record as Record<string, CanvasJson>;
  }
  return nodes;
}

function framesOf(document: CanvasJson): Array<Record<string, CanvasJson>> {
  const root = asRecord(document) ?? {};
  return Array.isArray(root.frames)
    ? root.frames.flatMap((frame) => {
      const record = asRecord(frame);
      return record ? [record as Record<string, CanvasJson>] : [];
    })
    : [];
}

function stackOf(document: CanvasJson): string[] {
  const root = asRecord(document) ?? {};
  return Array.isArray(root.stackOrder) ? root.stackOrder.filter((item): item is string => typeof item === "string") : [];
}

function childrenOf(node: Record<string, CanvasJson> | undefined): string[] {
  return Array.isArray(node?.children) ? node.children.filter((item): item is string => typeof item === "string") : [];
}

function numberOf(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function requireIds(raw: unknown, label: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((item) => typeof item !== "string" || !item)) {
    throw opError(
      `${label}_missing_ids`,
      `pass a non-empty ${label} nodeIds/ids string array`,
      `${label} requires a non-empty id list`,
    );
  }
  return raw as string[];
}

function opName(raw: Record<string, unknown>): string {
  const name = typeof raw.op === "string" ? raw.op : typeof raw.name === "string" ? raw.name : "";
  if (!name) throw opError("missing_op", "each ToolOp must include op", "Canvas ToolOp requires op");
  return name;
}

function cloneNode(node: Record<string, CanvasJson>): Record<string, CanvasJson> {
  return JSON.parse(JSON.stringify(node)) as Record<string, CanvasJson>;
}

function applyPatches(document: CanvasJson, patches: CanvasPatch[]): CanvasJson {
  const next = JSON.parse(JSON.stringify(document)) as Record<string, CanvasJson>;
  for (const patch of patches) {
    let parent: unknown = next;
    for (const segment of patch.path.slice(0, -1)) {
      if (segment.startsWith("frame:") && Array.isArray(parent)) {
        const id = segment.slice(6);
        parent = parent.find((item) => asRecord(item)?.id === id);
      } else if (parent && typeof parent === "object" && !Array.isArray(parent)) {
        parent = (parent as Record<string, unknown>)[segment];
      }
    }
    const leaf = patch.path.at(-1)!;
    if (patch.op === "remove") {
      if (Array.isArray(parent) && leaf.startsWith("frame:")) {
        const id = leaf.slice(6);
        const index = parent.findIndex((item) => asRecord(item)?.id === id);
        if (index >= 0) parent.splice(index, 1);
      } else if (parent && typeof parent === "object" && !Array.isArray(parent)) {
        delete (parent as Record<string, unknown>)[leaf];
      }
    } else if (parent && typeof parent === "object" && !Array.isArray(parent)) {
      (parent as Record<string, unknown>)[leaf] = patch.value;
    } else if (Array.isArray(parent) && leaf.startsWith("frame:")) {
      const id = leaf.slice(6);
      const index = parent.findIndex((item) => asRecord(item)?.id === id);
      if (index >= 0) parent[index] = patch.value as CanvasJson;
    }
  }
  return next;
}

function setNode(id: string, node: Record<string, CanvasJson>): CanvasPatch {
  return { op: "set", path: ["deltaSetLike", id], value: node };
}

function setChildren(parentId: string, children: string[]): CanvasPatch {
  return { op: "set", path: ["deltaSetLike", parentId, "children"], value: children };
}

function setStack(stack: string[]): CanvasPatch {
  return { op: "set", path: ["stackOrder"], value: stack };
}

function removeNode(id: string): CanvasPatch {
  return { op: "remove", path: ["deltaSetLike", id] };
}

function collectDescendants(nodes: Record<string, Record<string, CanvasJson>>, ids: string[]): string[] {
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || id === "ROOT") return;
    seen.add(id);
    for (const child of childrenOf(nodes[id])) visit(child);
  };
  for (const id of ids) visit(id);
  return [...seen];
}

function creatableIdCollides(
  id: string,
  nodes: Record<string, Record<string, CanvasJson>>,
  frames: Array<Record<string, CanvasJson>>,
): boolean {
  return id === "ROOT" || Boolean(nodes[id]) || frames.some((frame) => frame.id === id);
}

function mapOne(document: CanvasJson, raw: Record<string, unknown>, context?: CanvasToolOpsContext): {
  patches: CanvasPatch[];
  createdElementIds: string[];
  createdFrameIds: string[];
  deletedElementIds: string[];
  deletedFrameIds: string[];
  reorderedElementIds: string[];
  reorderedFrameIds: string[];
  backgroundWrite: boolean;
} {
  const op = opName(raw);
  const nodes = asNodeMap(document);
  const frames = framesOf(document);
  const stack = stackOf(document);
  const empty = {
    patches: [] as CanvasPatch[],
    createdElementIds: [] as string[],
    createdFrameIds: [] as string[],
    deletedElementIds: [] as string[],
    deletedFrameIds: [] as string[],
    reorderedElementIds: [] as string[],
    reorderedFrameIds: [] as string[],
    backgroundWrite: false,
  };

  if (op === "update_node") {
    const nodeId = typeof raw.nodeId === "string" ? raw.nodeId : typeof raw.id === "string" ? raw.id : "";
    if (!nodeId || !nodes[nodeId]) {
      throw opError("update_node_missing_target", "pass nodeId of an existing authorized node from scene_summary", "update_node target does not exist");
    }
    const patch = asRecord(raw.patch) ?? asRecord(raw.attrs) ?? {};
    assertFillArgs(op, paintSource(raw, patch));

    // Normalize fill parameter: frontend expects attrs['fill-color'], not attrs.fill
    if (typeof patch.fill === "string" && !patch["fill-color"]) {
      patch["fill-color"] = patch.fill;
    }
    if (typeof raw.fill === "string" && !patch["fill-color"]) {
      patch["fill-color"] = raw.fill;
    }

    const next = { ...nodes[nodeId]! };
    const attrs = asRecord(next.attrs) ?? {};

    // Apply patch to attrs
    for (const [key, value] of Object.entries(patch)) {
      if (key === "id" || key === "children" || key === "__kithEntityRevision") continue;
      if (key === "src" || key === "url" || key === "href") {
        throw opError("update_node_remote_url", "update_node cannot set remote media URLs; use canvas.asset_import + canvas.create_image", `key=${key}`);
      }
      attrs[key] = value as CanvasJson;
    }

    // Also handle top-level raw parameters (x, y, width, height, fill, etc.)
    // Frame-local x/y: 0,0 is the Frame's top-left. Recombyn stores canvas-absolute coords.
    const targetFrameId = typeof raw.frameId === "string" ? raw.frameId : (typeof next.frameId === "string" ? next.frameId : undefined);
    const targetFrame = findCanvasFrame(frames, targetFrameId);
    if (typeof raw.x === "number") next.x = canvasFrameLocalToCanvas(targetFrame, raw.x, 0).x;
    if (typeof raw.y === "number") next.y = canvasFrameLocalToCanvas(targetFrame, 0, raw.y).y;
    if (typeof raw.width === "number") next.width = raw.width;
    if (typeof raw.height === "number") next.height = raw.height;
    if (typeof raw.fill === "string") {
      attrs["fill-color"] = raw.fill;
      next.fill = raw.fill;
    }

    // Handle cornerRadius: frontend expects radiusTL/TR/BR/BL
    const cornerRadius = typeof raw.cornerRadius === "number" ? raw.cornerRadius : typeof patch.cornerRadius === "number" ? Number(patch.cornerRadius) : undefined;
    if (cornerRadius !== undefined) {
      attrs.radiusTL = cornerRadius;
      attrs.radiusTR = cornerRadius;
      attrs.radiusBR = cornerRadius;
      attrs.radiusBL = cornerRadius;
      delete attrs.cornerRadius; // Remove the non-standard field
    }

    // Handle stroke: frontend expects border-color and border-width
    if (typeof raw.stroke === "string") {
      attrs.stroke = raw.stroke;
      attrs["border-color"] = raw.stroke;
    }
    if (typeof raw.borderWidth === "number") {
      attrs["border-width"] = raw.borderWidth;
    }
    if (typeof raw.strokeWidth === "number") {
      attrs["border-width"] = raw.strokeWidth;
    }

    // Handle text updates: the editor renders text from attrs.DATA per-char config, so rebuild
    // DATA/ORIGIN_DATA whenever the text or any text style key is touched. Typed tools pass these
    // via patch; elements_apply may pass them top-level — both are merged here.
    if (next.key === "text") {
      const pickString = (key: string, fallback: string): string => {
        const value = key in patch ? patch[key] : raw[key];
        if (typeof value === "string" && value) return value;
        if (typeof value === "number" && Number.isFinite(value)) return String(value);
        return fallback;
      };
      const pickNumber = (key: string, fallback: number): number => {
        const value = key in patch ? patch[key] : raw[key];
        return typeof value === "number" && Number.isFinite(value) ? value : fallback;
      };
      const textStyleKeys = ["text", "fontSize", "fontWeight", "fontFamily", "fill", "textAlign", "lineHeight", "letterSpacing", "fontStyle", "textDecoration"];
      const textStyleRequested = textStyleKeys.some((key) => key in patch || key in raw);
      if (textStyleRequested) {
        const text = pickString("text", typeof next.text === "string" && next.text
          ? next.text
          : typeof attrs.text === "string" && attrs.text ? attrs.text : "");
        const textStyle = {
          fontSize: pickNumber("fontSize", typeof attrs.fontSize === "number" ? Number(attrs.fontSize) : DEFAULT_TEXT_STYLE.fontSize),
          fill: String(attrs["fill-color"] || next.fill || DEFAULT_TEXT_STYLE.fill),
          fontWeight: pickString("fontWeight", String(attrs.fontWeight ?? DEFAULT_TEXT_STYLE.fontWeight)),
          fontFamily: pickString("fontFamily", String(attrs.fontFamily ?? DEFAULT_TEXT_STYLE.fontFamily)),
          fontStyle: pickString("fontStyle", String(attrs.fontStyle ?? DEFAULT_TEXT_STYLE.fontStyle)),
          textAlign: pickString("textAlign", String(attrs.textAlign ?? DEFAULT_TEXT_STYLE.textAlign)),
          lineHeight: pickNumber("lineHeight", typeof attrs.lineHeight === "number" ? Number(attrs.lineHeight) : DEFAULT_TEXT_STYLE.lineHeight),
          letterSpacing: pickNumber("letterSpacing", typeof attrs.letterSpacing === "number" ? Number(attrs.letterSpacing) : DEFAULT_TEXT_STYLE.letterSpacing),
          textDecoration: pickString("textDecoration", String(attrs.textDecoration ?? DEFAULT_TEXT_STYLE.textDecoration)),
        };
        Object.assign(attrs, buildTextAttrs(text, textStyle));
        if (typeof patch.text === "string") next.text = patch.text;
      }
      if (typeof raw.text === "string") next.text = raw.text;
    }

    // Keep flat style attrs visible for the editor and scene facts (patch keys were already applied).
    if (next.key === "text") {
      if (typeof raw.fontSize === "number") attrs.fontSize = raw.fontSize;
      if (typeof raw.fontWeight === "string" || typeof raw.fontWeight === "number") attrs.fontWeight = raw.fontWeight;
      if (typeof raw.fontFamily === "string") attrs.fontFamily = raw.fontFamily;
      if (typeof raw.fontStyle === "string") attrs.fontStyle = raw.fontStyle;
      if (typeof raw.textAlign === "string") attrs.textAlign = raw.textAlign;
      if (typeof raw.lineHeight === "number") attrs.lineHeight = raw.lineHeight;
      if (typeof raw.letterSpacing === "number") attrs.letterSpacing = raw.letterSpacing;
      if (typeof raw.textDecoration === "string") attrs.textDecoration = raw.textDecoration;
    }

    // Handle rotation: frontend uses 'angle' field in attrs
    if (typeof raw.rotation === "number") {
      attrs.angle = raw.rotation;
    }
    if (typeof raw.angle === "number") {
      attrs.angle = raw.angle;
    }

    // Handle opacity: node-level field (0-1 range)
    if (typeof raw.opacity === "number") {
      next.opacity = Math.max(0, Math.min(1, raw.opacity));
    }

    // Handle blendMode
    if (typeof raw.blendMode === "string") {
      next.blendMode = raw.blendMode;
    }

    // Handle flipX/flipY
    if (typeof raw.flipX === "boolean") {
      next.flipX = raw.flipX;
    }
    if (typeof raw.flipY === "boolean") {
      next.flipY = raw.flipY;
    }

    // Handle locked/hidden
    if (typeof raw.locked === "boolean") {
      next.locked = raw.locked;
    }
    if (typeof raw.hidden === "boolean") {
      next.hidden = raw.hidden;
    }

    // Handle name
    if (typeof raw.name === "string") {
      next.name = raw.name;
    }

    next.attrs = attrs as CanvasJson;

    return { ...empty, patches: [setNode(nodeId, next)] };
  }

  if (op === "create_shape" || op === "create_text" || MEDIA_CREATE.has(op) || op === "create_svg") {
    if (MEDIA_CREATE.has(op)) {
      if (raw.url || raw.genPrompt || raw.removeBg || raw.dataUrl) {
        throw opError(`${op}_asset_only`, `${op} only accepts an existing assetId`, "url/genPrompt/dataUrl are rejected");
      }
      if (typeof raw.assetId !== "string" || !raw.assetId) {
        throw opError(`${op}_missing_assetId`, "pass assetId from canvas.asset_import", `${op} requires assetId`);
      }
    }
    if (op === "create_text") requireParams(raw, ["text", "x", "y"]);
    else if (op === "create_shape") requireParams(raw, ["x", "y", "width", "height"]);
    else if (MEDIA_CREATE.has(op)) requireParams(raw, ["x", "y", "width", "height"]);
    const attrs = asRecord(raw.attrs) ?? {};
    assertFillArgs(op, paintSource(raw, attrs));

    // Normalize fill parameter: frontend expects attrs['fill-color'], not attrs.fill
    if (typeof attrs.fill === "string" && !attrs["fill-color"]) {
      attrs["fill-color"] = attrs.fill;
    }
    // Normalize fill from raw.fill if not in attrs
    if (typeof raw.fill === "string" && !attrs["fill-color"]) {
      attrs["fill-color"] = raw.fill;
    }

    // Normalize stroke: frontend expects attrs['border-color'] and attrs['border-width']
    if (typeof raw.stroke === "string") {
      attrs["border-color"] = raw.stroke;
      attrs.stroke = raw.stroke;
    }
    if (typeof attrs.stroke === "string" && !attrs["border-color"]) {
      attrs["border-color"] = attrs.stroke;
    }
    if (typeof raw.borderWidth === "number") {
      attrs["border-width"] = raw.borderWidth;
    }
    if (typeof attrs.borderWidth === "number" && !attrs["border-width"]) {
      attrs["border-width"] = attrs.borderWidth;
    }
    if (typeof raw.strokeWidth === "number") {
      attrs["border-width"] = raw.strokeWidth;
    }

    // Handle cornerRadius: frontend expects radiusTL/TR/BR/BL
    const cornerRadius = typeof raw.cornerRadius === "number" ? raw.cornerRadius : typeof attrs.cornerRadius === "number" ? Number(attrs.cornerRadius) : undefined;
    if (cornerRadius !== undefined) {
      attrs.radiusTL = cornerRadius;
      attrs.radiusTR = cornerRadius;
      attrs.radiusBR = cornerRadius;
      attrs.radiusBL = cornerRadius;
      delete attrs.cornerRadius; // Remove the non-standard field
    }

    // Handle text node: frontend expects DATA and ORIGIN_DATA
    if (op === "create_text" && typeof raw.text === "string") {
      const textStyle = {
        fontSize: typeof raw.fontSize === "number" ? raw.fontSize : typeof attrs.fontSize === "number" ? Number(attrs.fontSize) : 16,
        fill: String(attrs["fill-color"] || raw.fill || "#000000"),
        fontWeight: String(raw.fontWeight || attrs.fontWeight || "400"),
        fontFamily: String(raw.fontFamily || attrs.fontFamily || "Inter"),
      };
      const textAttrs = buildTextAttrs(raw.text, textStyle);
      Object.assign(attrs, textAttrs);
    }

    const id = typeof raw.id === "string" && raw.id ? raw.id : randomUUID();
    if (creatableIdCollides(id, nodes, frames)) {
      throw opError("create_id_collides", "choose a unique id that is not ROOT and does not match an existing node or frame", "create ToolOp id collides");
    }
    const parentId = typeof raw.parentId === "string" && raw.parentId ? raw.parentId : "ROOT";
    if (!nodes[parentId]) {
      throw opError("create_parent_missing", "parentId must be ROOT or an existing group from scene_summary", "create ToolOp parent does not exist");
    }
    const key = op === "create_text" ? "text" : op === "create_svg" ? "svg" : op === "create_image" ? "image" : op === "create_lottie" ? "lottie" : op === "create_icon" ? "icon" : op === "create_video" ? "video" : op === "create_audio" ? "audio" : "shape";
    const createFrameId = typeof raw.frameId === "string" ? raw.frameId : undefined;
    const createFrame = findCanvasFrame(frames, createFrameId);
    const canvasPoint = canvasFrameLocalToCanvas(createFrame, numberOf(raw.x, 0), numberOf(raw.y, 0));
    const node: Record<string, CanvasJson> = {
      id,
      key,
      parentId,
      x: canvasPoint.x,
      y: canvasPoint.y,
      width: numberOf(raw.width, 100),
      height: numberOf(raw.height, 100),
      attrs: attrs as CanvasJson,
      children: [],
    };
    if (typeof attrs.fill === "string" || typeof attrs["fill-color"] === "string") {
      node.fill = String(attrs["fill-color"] ?? attrs.fill);
    }
    if (typeof attrs.shapeType === "string") node.shapeType = attrs.shapeType;
    if (typeof attrs.fillType === "string") node.fillType = attrs.fillType;
    if (typeof raw.frameId === "string") node.frameId = raw.frameId;
    if (typeof raw.text === "string") node.text = raw.text;
    if (typeof raw.assetId === "string") {
      node.assetId = raw.assetId;
      bindCreatedMediaAttrs(op, attrs as Record<string, CanvasJson>, raw.assetId, context);
    }

    // Handle rotation: frontend uses 'angle' field
    if (typeof raw.rotation === "number") {
      attrs.angle = raw.rotation;
    }
    if (typeof raw.angle === "number") {
      attrs.angle = raw.angle;
    }

    // Handle opacity: node-level field (0-1 range)
    if (typeof raw.opacity === "number") {
      node.opacity = Math.max(0, Math.min(1, raw.opacity));
    }

    // Handle blendMode
    if (typeof raw.blendMode === "string") {
      node.blendMode = raw.blendMode;
    }

    // Handle flipX/flipY
    if (typeof raw.flipX === "boolean") {
      node.flipX = raw.flipX;
    }
    if (typeof raw.flipY === "boolean") {
      node.flipY = raw.flipY;
    }

    // Handle locked/hidden
    if (typeof raw.locked === "boolean") {
      node.locked = raw.locked;
    }
    if (typeof raw.hidden === "boolean") {
      node.hidden = raw.hidden;
    }
    if (op === "create_svg") {
      const markup = typeof raw.svg === "string" ? raw.svg : typeof raw.markup === "string" ? raw.markup : "";
      if (!markup) throw opError("create_svg_missing_markup", "pass sanitized svg markup with a viewBox", "create_svg requires sanitized svg markup");
      try {
        node.svg = sanitizeInlineSvgMarkup(markup);
      } catch {
        // 复用 canvasAssetStore 的 fail-closed 消毒器；把拒绝转成 CanvasToolError，
        // 让 LAST_CANVAS_ERROR 能给出可读的 code/fix 而不是裸 500。
        throw opError(
          "create_svg_invalid_markup",
          "svg was rejected by the host sanitizer — remove script/foreignObject/iframe/meta/style tags, on* event attributes, javascript: URLs, and any non-#id href/url() reference",
          "sanitizer rejected svg markup",
        );
      }
    }
    return {
      ...empty,
      patches: [
        setNode(id, node),
        setChildren(parentId, [...childrenOf(nodes[parentId]), id]),
        setStack([...stack, id]),
      ],
      createdElementIds: [id],
    };
  }

  if (op === "create_frame") {
    requireParams(raw, ["x", "y", "width", "height"]);
    const id = typeof raw.id === "string" && raw.id ? raw.id : randomUUID();
    if (creatableIdCollides(id, nodes, frames)) {
      throw opError("create_frame_id_collides", "choose a unique frame id that is not ROOT and does not match an existing node or frame", "create_frame id collides");
    }
    const frame = {
      id,
      name: typeof raw.name === "string" && raw.name ? raw.name : "Frame",
      x: numberOf(raw.x, 0),
      y: numberOf(raw.y, 0),
      width: numberOf(raw.width, 400),
      height: numberOf(raw.height, 300),
    };
    return {
      ...empty,
      patches: [
        { op: "set", path: ["frames"], value: [...frames, frame] },
        setStack([...stack, `frame:${id}`]),
      ],
      createdFrameIds: [id],
    };
  }

  if (op === "update_frame") {
    const frameId = typeof raw.frameId === "string" ? raw.frameId : typeof raw.id === "string" ? raw.id : "";
    const current = frames.find((frame) => frame.id === frameId);
    if (!current) throw opError("update_frame_missing_target", "pass frameId from SCENE_FRAMES / FOCUS_FRAME_ID", "update_frame target does not exist");
    assertFillArgs(op, paintSource(raw));
    const next = { ...current };
    if (typeof raw.name === "string") next.name = raw.name;
    if (typeof raw.x === "number") next.x = raw.x;
    if (typeof raw.y === "number") next.y = raw.y;
    if (typeof raw.width === "number") next.width = raw.width;
    if (typeof raw.height === "number") next.height = raw.height;
    if (typeof raw.backgroundColor === "string") next.backgroundColor = raw.backgroundColor;
    if (typeof raw.locked === "boolean") next.locked = raw.locked;
    const patch = asRecord(raw.patch) ?? {};
    for (const [key, value] of Object.entries(patch)) {
      if (key !== "id") next[key] = value as CanvasJson;
    }
    return { ...empty, patches: [{ op: "set", path: ["frames", `frame:${frameId}`], value: next }] };
  }

  if (op === "delete_nodes") {
    const ids = requireIds(raw.ids ?? raw.nodeIds, "delete_nodes");
    const removed = collectDescendants(nodes, ids);
    const patches: CanvasPatch[] = [];
    const parents = new Map<string, string[]>();
    for (const id of removed) {
      const parentId = typeof nodes[id]?.parentId === "string" ? String(nodes[id]!.parentId) : "ROOT";
      if (!parents.has(parentId)) parents.set(parentId, childrenOf(nodes[parentId]).filter((child) => !removed.includes(child)));
    }
    for (const [parentId, children] of parents) patches.push(setChildren(parentId, children));
    for (const id of removed) patches.push(removeNode(id));
    patches.push(setStack(stack.filter((item) => {
      const id = item.startsWith("frame:") ? item.slice(6) : item.startsWith("node:") ? item.slice(5) : item;
      return !removed.includes(id);
    })));
    return { ...empty, patches, deletedElementIds: removed };
  }

  if (op === "delete_frame") {
    const frameId = typeof raw.frameId === "string" ? raw.frameId : typeof raw.id === "string" ? raw.id : "";
    if (!frames.some((frame) => frame.id === frameId)) {
      throw opError("delete_frame_missing_target", "pass frameId from SCENE_FRAMES", "delete_frame target does not exist");
    }
    return {
      ...empty,
      patches: [
        { op: "remove", path: ["frames", `frame:${frameId}`] },
        setStack(stack.filter((item) => item !== `frame:${frameId}`)),
      ],
      deletedFrameIds: [frameId],
    };
  }

  if (op === "align_nodes" || op === "distribute_nodes" || op === "flip_nodes") {
    const ids = requireIds(raw.ids ?? raw.nodeIds, op);
    const targets = ids.map((id) => {
      const node = nodes[id];
      if (!node) throw opError(`${op}_missing_target`, `pass existing nodeIds from scene_summary`, `${op} target ${id} does not exist`);
      return { id, node };
    });
    const xs = targets.map(({ node }) => numberOf(node.x, 0));
    const ys = targets.map(({ node }) => numberOf(node.y, 0));
    const widths = targets.map(({ node }) => numberOf(node.width, 0));
    const heights = targets.map(({ node }) => numberOf(node.height, 0));
    const patches: CanvasPatch[] = [];
    if (op === "align_nodes") {
      const mode = typeof raw.mode === "string" ? raw.mode : "";
      const axis = mode === "top" || mode === "middle" || mode === "bottom" || raw.axis === "y" || raw.align === "top" || raw.align === "bottom" || raw.align === "middle" ? "y" : "x";
      const align = mode === "left" ? "start"
        : mode === "right" || mode === "bottom" ? "end"
        : mode === "centerX" || mode === "middle" ? (mode === "middle" ? "middle" : "center")
        : typeof raw.align === "string" ? raw.align : "start";
      let origin = axis === "x" ? Math.min(...xs) : Math.min(...ys);
      if (align === "end" || align === "right" || align === "bottom") {
        origin = axis === "x" ? Math.max(...xs.map((x, index) => x + widths[index]!)) - widths[0]! : Math.max(...ys.map((y, index) => y + heights[index]!)) - heights[0]!;
      }
      if (align === "center" || align === "middle" || mode === "centerX") {
        const min = axis === "x" ? Math.min(...xs) : Math.min(...ys);
        const max = axis === "x" ? Math.max(...xs.map((x, index) => x + widths[index]!)) : Math.max(...ys.map((y, index) => y + heights[index]!));
        origin = (min + max) / 2;
      }
      for (const { id, node } of targets) {
        const next = { ...node };
        if (axis === "x") next.x = align === "center" || mode === "centerX" ? origin - numberOf(node.width, 0) / 2 : origin;
        else next.y = align === "middle" ? origin - numberOf(node.height, 0) / 2 : origin;
        patches.push(setNode(id, next));
      }
    } else if (op === "distribute_nodes") {
      if (targets.length < 3) {
        throw opError("distribute_nodes_too_few", "distribute_nodes requires at least 3 nodes", `count=${targets.length}`);
      }
      const axis = raw.axis === "y" || raw.axis === "v" ? "y" : "x";
      const ordered = [...targets].sort((left, right) => numberOf(axis === "x" ? left.node.x : left.node.y, 0) - numberOf(axis === "x" ? right.node.x : right.node.y, 0));
      const start = numberOf(axis === "x" ? ordered[0]!.node.x : ordered[0]!.node.y, 0);
      const end = numberOf(axis === "x" ? ordered.at(-1)!.node.x : ordered.at(-1)!.node.y, 0);
      const step = (end - start) / (ordered.length - 1);
      ordered.forEach((item, index) => {
        const next = { ...item.node };
        if (axis === "x") next.x = start + step * index;
        else next.y = start + step * index;
        patches.push(setNode(item.id, next));
      });
    } else {
      const explicitX = raw.flipX === true;
      const explicitY = raw.flipY === true;
      const flipX = explicitX || (!explicitY && raw.axis !== "y");
      const flipY = explicitY || (!explicitX && raw.axis !== "x");
      if (!flipX && !flipY) {
        throw opError("flip_nodes_missing_axis", "pass flipX=true and/or flipY=true", "flip_nodes requires flipX or flipY");
      }
      for (const { id, node } of targets) {
        const next = { ...node };
        if (flipX) {
          next.flipX = !Boolean(node.flipX);
          next.scaleX = numberOf(node.scaleX, 1) * -1;
        }
        if (flipY) {
          next.flipY = !Boolean(node.flipY);
          next.scaleY = numberOf(node.scaleY, 1) * -1;
        }
        patches.push(setNode(id, next));
      }
    }
    return { ...empty, patches };
  }

  if (op === "reorder_nodes") {
    const ids = requireIds(raw.ids ?? raw.nodeIds ?? raw.order, "reorder_nodes");
    const frameIdSet = new Set(frames.flatMap((frame) => typeof frame.id === "string" ? [frame.id] : []));
    const reorderedElementIds: string[] = [];
    const reorderedFrameIds: string[] = [];
    const stackKey = (id: string) => {
      const bare = id.startsWith("frame:") ? id.slice(6) : id.startsWith("node:") ? id.slice(5) : id;
      return frameIdSet.has(bare) || id.startsWith("frame:") ? `frame:${bare}` : bare;
    };
    const matchesId = (item: string, id: string) => {
      const bare = id.startsWith("frame:") ? id.slice(6) : id.startsWith("node:") ? id.slice(5) : id;
      return item === id || item === bare || item === `frame:${bare}` || item === `node:${bare}`;
    };
    for (const id of ids) {
      const bare = id.startsWith("frame:") ? id.slice(6) : id.startsWith("node:") ? id.slice(5) : id;
      if (id.startsWith("frame:") || frameIdSet.has(bare)) reorderedFrameIds.push(bare);
      else reorderedElementIds.push(bare);
    }
    const action = typeof raw.action === "string" ? raw.action : "";
    let nextStack: string[];
    if (action === "front" || action === "back" || action === "forward" || action === "backward") {
      nextStack = [...stack];
      const moving = ids.map(stackKey);
      if (action === "front") {
        nextStack = [...nextStack.filter((item) => !ids.some((id) => matchesId(item, id))), ...moving];
      } else if (action === "back") {
        nextStack = [...moving, ...nextStack.filter((item) => !ids.some((id) => matchesId(item, id)))];
      } else {
        const step = action === "forward" ? 1 : -1;
        const indexes = moving.map((key) => nextStack.findIndex((item) => matchesId(item, key))).filter((index) => index >= 0);
        const ordered = action === "forward" ? [...indexes].sort((a, b) => b - a) : [...indexes].sort((a, b) => a - b);
        for (const index of ordered) {
          const nextIndex = index + step;
          if (nextIndex < 0 || nextIndex >= nextStack.length) continue;
          const [item] = nextStack.splice(index, 1);
          nextStack.splice(nextIndex, 0, item!);
        }
      }
    } else {
      nextStack = [...ids, ...stack.filter((item) => !ids.includes(item) && !ids.includes(item.replace(/^frame:/, "")) && !ids.includes(item.replace(/^node:/, "")))];
    }
    return {
      ...empty,
      patches: [setStack(nextStack)],
      reorderedElementIds,
      reorderedFrameIds,
    };
  }

  if (op === "group_nodes") {
    const ids = requireIds(raw.ids ?? raw.nodeIds, "group_nodes");
    const groupId = typeof raw.groupId === "string" && raw.groupId ? raw.groupId : randomUUID();
    if (nodes[groupId]) throw opError("group_nodes_id_collides", "omit id or choose a unique group id", "group_nodes id collides");
    const parentId = typeof nodes[ids[0]!]?.parentId === "string" ? String(nodes[ids[0]!]!.parentId) : "ROOT";
    const group: Record<string, CanvasJson> = {
      id: groupId, key: "group", parentId, children: ids,
      x: Math.min(...ids.map((id) => numberOf(nodes[id]?.x, 0))),
      y: Math.min(...ids.map((id) => numberOf(nodes[id]?.y, 0))),
      width: 100, height: 100, attrs: {},
    };
    const patches: CanvasPatch[] = [
      setNode(groupId, group),
      setChildren(parentId, [...childrenOf(nodes[parentId]).filter((child) => !ids.includes(child)), groupId]),
    ];
    for (const id of ids) {
      const current = nodes[id];
      if (!current) throw opError("group_nodes_missing_target", "pass existing nodeIds from scene_summary", `group_nodes target ${id} does not exist`);
      patches.push(setNode(id, { ...current, parentId: groupId }));
    }
    patches.push(setStack([...stack.filter((item) => !ids.includes(item)), groupId]));
    return { ...empty, patches, createdElementIds: [groupId] };
  }

  if (op === "ungroup_nodes") {
    const groupIds = Array.isArray(raw.nodeIds) || Array.isArray(raw.ids)
      ? requireIds(raw.nodeIds ?? raw.ids, "ungroup_nodes")
      : [typeof raw.groupId === "string" ? raw.groupId : typeof raw.id === "string" ? raw.id : ""];
    const groupId = groupIds[0] ?? "";
    const group = nodes[groupId];
    if (!group || group.key !== "group") {
      throw opError("ungroup_nodes_not_group", "pass group ids from scene_summary", "ungroup_nodes target is not a group");
    }
    const parentId = typeof group.parentId === "string" ? group.parentId : "ROOT";
    const kids = childrenOf(group);
    const patches: CanvasPatch[] = [
      setChildren(parentId, [...childrenOf(nodes[parentId]).filter((child) => child !== groupId), ...kids]),
    ];
    for (const id of kids) {
      const current = nodes[id];
      if (current) patches.push(setNode(id, { ...current, parentId }));
    }
    patches.push(removeNode(groupId));
    patches.push(setStack([...stack.filter((item) => item !== groupId), ...kids]));
    return { ...empty, patches, deletedElementIds: [groupId] };
  }

  if (op === "duplicate_nodes") {
    const ids = requireIds(raw.ids ?? raw.nodeIds, "duplicate_nodes");
    const patches: CanvasPatch[] = [];
    const createdElementIds: string[] = [];
    const parentChildren = new Map<string, string[]>();
    for (const id of ids) {
      const current = nodes[id];
      if (!current) throw opError("duplicate_nodes_missing_target", "pass existing nodeIds from scene_summary", `duplicate_nodes target ${id} does not exist`);
      const copyId = randomUUID();
      const parentId = typeof current.parentId === "string" ? current.parentId : "ROOT";
      const copy = cloneNode(current);
      copy.id = copyId;
      copy.x = numberOf(current.x, 0) + numberOf(raw.offsetX, 16);
      copy.y = numberOf(current.y, 0) + numberOf(raw.offsetY, 16);
      copy.children = [];
      patches.push(setNode(copyId, copy));
      if (!parentChildren.has(parentId)) parentChildren.set(parentId, [...childrenOf(nodes[parentId])]);
      parentChildren.get(parentId)!.push(copyId);
      createdElementIds.push(copyId);
    }
    for (const [parentId, children] of parentChildren) patches.push(setChildren(parentId, children));
    patches.push(setStack([...stack, ...createdElementIds]));
    return { ...empty, patches, createdElementIds };
  }

  if (op === "boolean_op") {
    const ids = requireIds(raw.ids ?? raw.nodeIds, "boolean_op");
    if (ids.length < 2) throw opError("boolean_op_too_few", "boolean_op requires at least two operands", `count=${ids.length}`);
    const operands = ids.map((id) => {
      const node = nodes[id];
      if (!node) throw opError("boolean_op_missing_operand", "pass existing shape nodeIds from scene_summary", `boolean_op operand ${id} does not exist`);
      return { id, node };
    });
    const resultId = typeof raw.resultId === "string" && raw.resultId ? raw.resultId : randomUUID();
    const parentId = typeof operands[0]!.node.parentId === "string" ? String(operands[0]!.node.parentId) : "ROOT";
    const xs = operands.map(({ node }) => numberOf(node.x, 0));
    const ys = operands.map(({ node }) => numberOf(node.y, 0));
    const result: Record<string, CanvasJson> = {
      id: resultId,
      key: "path",
      parentId,
      booleanOp: typeof raw.mode === "string" ? raw.mode : typeof raw.operation === "string" ? raw.operation : "union",
      operandIds: ids,
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...operands.map(({ node }, index) => xs[index]! + numberOf(node.width, 0))) - Math.min(...xs),
      height: Math.max(...operands.map(({ node }, index) => ys[index]! + numberOf(node.height, 0))) - Math.min(...ys),
      d: operands.map(({ node }) => typeof node.d === "string" ? node.d : "").filter(Boolean).join(" "),
      children: [],
      attrs: {},
    };
    const removed = collectDescendants(nodes, ids);
    const patches: CanvasPatch[] = [
      setNode(resultId, result),
      setChildren(parentId, [...childrenOf(nodes[parentId]).filter((child) => !removed.includes(child)), resultId]),
    ];
    for (const id of removed) patches.push(removeNode(id));
    patches.push(setStack([...stack.filter((item) => !removed.includes(item)), resultId]));
    return { ...empty, patches, createdElementIds: [resultId], deletedElementIds: removed };
  }

  if (op === "set_canvas_background") {
    const color = raw.color ?? raw.fill ?? raw.backgroundColor ?? raw.value ?? raw.background ?? null;
    assertFillArgs(op, paintSource(raw));
    const value = asRecord(raw.value)
      ?? (color != null || raw.fillType != null
        ? {
          color,
          fill: raw.fill ?? color,
          ...(typeof raw.fillType === "string" ? { fillType: raw.fillType } : {}),
          ...(raw.fillEnd != null ? { fillEnd: raw.fillEnd } : {}),
          ...(raw.gradientAngle != null ? { gradientAngle: raw.gradientAngle } : {}),
          ...(raw.opacity != null ? { opacity: raw.opacity } : {}),
        }
        : color);
    return {
      ...empty,
      patches: [{ op: "set", path: ["background"], value: value as CanvasJson }],
      backgroundWrite: true,
    };
  }

  throw opError("unsupported_op", "use a durable Canvas ToolOp from the typed tool list", `unsupported Canvas ToolOp ${op}`);
}

export function mapCanvasToolOps(
  document: CanvasJson,
  operations: unknown[],
  context?: CanvasToolOpsContext,
): MappedCanvasToolOps {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw opError("apply_empty", "pass a non-empty operations list", "canvas.elements_apply requires a non-empty operations list");
  }
  let current = document;
  const patches: CanvasPatch[] = [];
  const createdElementIds: string[] = [];
  const createdFrameIds: string[] = [];
  const deletedElementIds: string[] = [];
  const deletedFrameIds: string[] = [];
  const reorderedElementIds: string[] = [];
  const reorderedFrameIds: string[] = [];
  let viewport: CanvasViewportSuggestion | null = null;
  let backgroundWrite = false;
  for (const item of operations) {
    const raw = asRecord(item);
    if (!raw) throw opError("op_not_object", "each ToolOp must be an object", "Canvas ToolOp must be an object");
    const name = opName(raw);
    if (DEFERRED_OPS.has(name)) {
      throw opError(`${name}_deferred`, `${name} is deferred to a durable job and cannot join a scene batch`, name);
    }
    if (SIDE_EFFECT_OPS.has(name)) {
      throw opError("export_side_effect", "export_canvas is a Canvas export side effect; use canvas.export", name);
    }
    if (EPHEMERAL_OPS.has(name)) {
      viewport = {
        x: numberOf(raw.x, 0),
        y: numberOf(raw.y, 0),
        zoom: numberOf(raw.zoom, 1),
      };
      continue;
    }
    if (!DURABLE_OPS.has(name)) throw opError("unknown_op", "use a durable Canvas ToolOp from the typed tool list", `unknown Canvas ToolOp ${name}`);
    const mapped = mapOne(current, raw, context);
    patches.push(...mapped.patches);
    createdElementIds.push(...mapped.createdElementIds);
    createdFrameIds.push(...mapped.createdFrameIds);
    deletedElementIds.push(...mapped.deletedElementIds);
    deletedFrameIds.push(...mapped.deletedFrameIds);
    reorderedElementIds.push(...mapped.reorderedElementIds);
    reorderedFrameIds.push(...mapped.reorderedFrameIds);
    backgroundWrite = backgroundWrite || mapped.backgroundWrite;
    current = applyPatches(current, mapped.patches);
  }
  return {
    operation: patches.length ? { type: "document.patch", patches } : null,
    createdElementIds,
    createdFrameIds,
    deletedElementIds,
    deletedFrameIds,
    reorderedElementIds,
    reorderedFrameIds,
    viewport,
    backgroundWrite,
  };
}
