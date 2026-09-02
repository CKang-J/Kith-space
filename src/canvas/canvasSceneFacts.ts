import type { CanvasJson } from "./canvasTypes.js";
import { canvasNodeBelongsToFrame } from "./canvasFrameMembership.js";

// 口径对齐 reference/recombyn .../nodes/observe.py 的确定性事实：
// _OVERLAP_MIN_AREA=64, _PLATE_AREA_RATIO=0.85, _TYPE_HIERARCHY_MIN_RATIO=1.25。
const OVERLAP_MIN_AREA = 64;
const PLATE_AREA_RATIO = 0.85;
const TYPE_HIERARCHY_MIN_RATIO = 1.25;
const MAX_OUT_OF_BOUNDS_IDS = 6;
const MAX_OVERLAP_PAIRS = 10;
const MAX_ANTI_SLOP_IDS = 8;
const GRADIENT_FILL_TYPES = new Set(["linear", "radial", "angular", "diffuse"]);
const EMOJI_RE = /\p{Extended_Pictographic}/u;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export type CanvasSceneFactsScope = {
  elementIds: readonly string[];
  frameIds: readonly string[];
  emptySelection: boolean;
};

type FactBox = { x: number; y: number; width: number; height: number };

type FactFrame = { id: string; x: number | null; y: number | null; width: number | null; height: number | null; box: FactBox | null };

type FactNode = {
  id: string;
  key: string | null;
  parentId: string | null;
  frameId: string | null;
  box: FactBox | null;
  text: string | null;
  fontSize: number | null;
  fillType: string | null;
  fill: string | null;
  fillEnd: string | null;
  opacity: number | null;
  cornerRadius: number | null;
};

export type CanvasSceneFacts = {
  viewport: { kind: "frame" | "canvas"; id: string | null; width: number; height: number } | null;
  heroCoverage: number | null;
  heroNodeId: string | null;
  whitespaceRatio: number | null;
  h1Size: number | null;
  h2Size: number | null;
  h1H2Ratio: number | null;
  hierarchyWeak: boolean | null;
  /** 越界节点：fully outside → over=0；部分越出 → over=越出像素数。 */
  outOfFrame: Array<{ id: string; over: number }>;
  outOfCanvas: string[];
  overlapPairs: Array<{ a: string; b: string; area: number }>;
  antiSlop: {
    gradientFillCount: number;
    purpleBlueGradient: boolean;
    emojiNodeIds: string[];
    translucentWhiteNodeIds: string[];
    excessiveRoundingNodeIds: string[];
  };
};

function boxOf(source: { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null | undefined): FactBox | null {
  const x = numberOf(source?.x);
  const y = numberOf(source?.y);
  const width = numberOf(source?.width);
  const height = numberOf(source?.height);
  if (x == null || y == null || width == null || height == null) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function extractFrames(raw: unknown): FactFrame[] {
  return Array.isArray(raw) ? raw.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string") return [];
    return [{
      id: record.id,
      x: numberOf(record.x),
      y: numberOf(record.y),
      width: numberOf(record.width),
      height: numberOf(record.height),
      box: boxOf(record),
    }];
  }) : [];
}

function extractNode(id: string, node: Record<string, unknown>): FactNode | null {
  const attrs = asRecord(node.attrs) ?? {};
  const radii = ["radiusTL", "radiusTR", "radiusBR", "radiusBL", "radius", "cornerRadius"]
    .flatMap((key) => numberOf(attrs[key]) == null ? [] : [numberOf(attrs[key])!]);
  return {
    id,
    key: stringOf(node.key),
    parentId: stringOf(node.parentId),
    frameId: stringOf(node.frameId),
    box: boxOf(node),
    text: stringOf(node.text) ?? stringOf(attrs.text),
    fontSize: numberOf(node.fontSize) ?? numberOf(attrs.fontSize),
    fillType: stringOf(node.fillType) ?? stringOf(attrs.fillType),
    fill: stringOf(attrs["fill-color"]) ?? stringOf(attrs.fill) ?? stringOf(node.fill),
    fillEnd: stringOf(node.fillEnd) ?? stringOf(attrs.fillEnd),
    opacity: numberOf(node.opacity),
    cornerRadius: radii.length ? Math.max(...radii) : null,
  };
}

function isTextNode(node: FactNode): boolean {
  return node.key === "text" || node.text != null || node.fontSize != null;
}

function intersectArea(a: FactBox, b: FactBox): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function rgbHue(red: number, green: number, blue: number): number {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

/** 仅解析 #RGB/#RRGGBB 与 rgb()/rgba()，其余返回 null（不硬判）。 */
function hueOf(color: string | null): number | null {
  if (!color) return null;
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color);
  if (hex) {
    const value = hex[1]!;
    const expanded = value.length === 3 ? [...value].map((char) => char + char).join("") : value;
    return rgbHue(parseInt(expanded.slice(0, 2), 16), parseInt(expanded.slice(2, 4), 16), parseInt(expanded.slice(4, 6), 16));
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(color);
  if (rgb) return rgbHue(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  return null;
}

/** 白色系（r/g/b≥240）的 alpha 通道；纯白 hex 返回 1，非白色或不可解析返回 null。 */
function whiteAlphaOf(color: string | null): number | null {
  if (!color) return null;
  const hexWhite = /^(?:#(?:fff|ffffff|fff(?:ffff)?)|white)$/i.test(color);
  if (hexWhite) return 1;
  const rgba = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(color);
  if (!rgba) return null;
  const red = Number(rgba[1]);
  const green = Number(rgba[2]);
  const blue = Number(rgba[3]);
  if (red < 240 || green < 240 || blue < 240) return null;
  return rgba[4] == null ? 1 : Number(rgba[4]);
}

/**
 * 服务端零 LLM 成本的确定性场景事实（对齐原项目 observe 层 deterministic_lane_seed）。
 * 输入 CanvasJson 文档 + 可选 grant 范围（未给范围时统计整张画布），只做几何/样式判定，不产生审美结论。
 */
export function computeCanvasSceneFacts(
  document: CanvasJson,
  options?: { scope?: CanvasSceneFactsScope | null; focusFrameId?: string | null },
): CanvasSceneFacts {
  const root = asRecord(document) ?? {};
  const canvasWidth = numberOf(root.width);
  const canvasHeight = numberOf(root.height);
  const frames = extractFrames(root.frames);
  const frameById = new Map(frames.map((frame) => [frame.id, frame]));
  const scope = options?.scope ?? null;
  const scopedElementIds = scope && !scope.emptySelection ? new Set(scope.elementIds) : null;
  const scopedFrames = scope && !scope.emptySelection ? scope.frameIds : [];

  const rawNodes = asRecord(root.deltaSetLike) ?? {};
  const nodes: FactNode[] = [];
  for (const [id, raw] of Object.entries(rawNodes)) {
    if (id === "ROOT") continue;
    const record = asRecord(raw);
    if (!record) continue;
    if (scopedElementIds && !scopedElementIds.has(id)) {
      const inScopedFrame = scopedFrames.some((frameId) => {
        const frame = frameById.get(frameId);
        return frame && canvasNodeBelongsToFrame(record, frame, frameId);
      });
      if (!inScopedFrame) continue;
    }
    const node = extractNode(id, record);
    if (node) nodes.push(node);
  }

  // 可视区：focus frame → 节点归属最多的 frame → 第一个 frame → 画布尺寸。
  const focusFrameId = stringOf(options?.focusFrameId);
  let focusFrame = focusFrameId ? frameById.get(focusFrameId) ?? null : null;
  if (!focusFrame) {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      if (node.frameId) counts.set(node.frameId, (counts.get(node.frameId) ?? 0) + 1);
    }
    let best: FactFrame | null = null;
    let bestCount = 0;
    for (const frame of frames) {
      const count = counts.get(frame.id) ?? 0;
      if (count > bestCount) {
        best = frame;
        bestCount = count;
      }
    }
    focusFrame = best ?? frames[0] ?? null;
  }
  const frameBox = focusFrame?.box ?? null;
  const viewport = frameBox
    ? { kind: "frame" as const, id: focusFrame!.id, width: frameBox.width, height: frameBox.height }
    : canvasWidth != null && canvasHeight != null
      ? { kind: "canvas" as const, id: null, width: canvasWidth, height: canvasHeight }
      : null;
  const viewportArea = viewport ? viewport.width * viewport.height : 0;

  // 覆盖 ≥85% 可视区的是底版（plate），不计入 hero/留白/重叠（与 reference content 过滤一致）。
  const content = nodes.filter((node) => {
    if (!node.box) return false;
    if (viewportArea <= 0) return true;
    return node.box.width * node.box.height < PLATE_AREA_RATIO * viewportArea;
  });

  let heroNode: FactNode | null = null;
  let heroArea = 0;
  let occupied = 0;
  for (const node of content) {
    const area = node.box!.width * node.box!.height;
    occupied += area;
    if (!isTextNode(node) && area > heroArea) {
      heroNode = node;
      heroArea = area;
    }
  }

  const textSizes = [...new Set(content.filter(isTextNode).flatMap((node) => {
    return node.fontSize != null && node.fontSize > 0 ? [Math.round(node.fontSize * 10) / 10] : [];
  }))].sort((a, b) => b - a);
  const h1Size = textSizes[0] ?? null;
  const h2Size = textSizes[1] ?? null;
  const h1H2Ratio = h1Size != null && h2Size != null ? round(h1Size / h2Size, 2) : null;

  const outOfFrame: Array<{ id: string; over: number }> = [];
  const outOfCanvas: string[] = [];
  for (const node of nodes) {
    const nodeBox = node.box;
    if (!nodeBox) continue;
    if (node.frameId) {
      const frameBox = frameById.get(node.frameId)?.box ?? null;
      if (frameBox) {
        const { x, y, width, height } = nodeBox;
        if (x + width < frameBox.x || y + height < frameBox.y || x > frameBox.x + frameBox.width || y > frameBox.y + frameBox.height) {
          outOfFrame.push({ id: node.id, over: 0 });
        } else {
          const over = Math.max(
            frameBox.x - x,
            frameBox.y - y,
            x + width - (frameBox.x + frameBox.width),
            y + height - (frameBox.y + frameBox.height),
          );
          if (over > 1) outOfFrame.push({ id: node.id, over: Math.round(over) });
        }
      }
    }
    if (canvasWidth != null && canvasHeight != null) {
      const { x, y, width, height } = nodeBox;
      if (x + width < 0 || y + height < 0 || x > canvasWidth || y > canvasHeight) {
        outOfCanvas.push(node.id);
      }
    }
  }

  const parentById = new Map(nodes.map((node) => [node.id, node.parentId]));
  const isAncestor = (ancestor: string, descendant: string): boolean => {
    let current = parentById.get(descendant) ?? null;
    while (current && current !== "ROOT") {
      if (current === ancestor) return true;
      current = parentById.get(current) ?? null;
    }
    return false;
  };
  const boxes = content.flatMap((node) => node.box ? [{ node, box: node.box }] : []);
  const pairs: Array<{ a: string; b: string; area: number }> = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const first = boxes[i]!;
      const second = boxes[j]!;
      if (isAncestor(first.node.id, second.node.id) || isAncestor(second.node.id, first.node.id)) continue;
      const area = intersectArea(first.box, second.box);
      if (area >= OVERLAP_MIN_AREA) pairs.push({ a: first.node.id, b: second.node.id, area: Math.round(area) });
    }
  }
  pairs.sort((left, right) => right.area - left.area);

  const gradientNodes = nodes.filter((node) => node.fillType != null && GRADIENT_FILL_TYPES.has(node.fillType.toLowerCase()));
  const purpleBlueGradient = gradientNodes.some((node) => {
    const start = hueOf(node.fill);
    const end = hueOf(node.fillEnd);
    // 蓝-紫带（200°–300°）两端都命中才算紫色系渐变。
    return start != null && end != null && start >= 200 && start <= 300 && end >= 200 && end <= 300;
  });
  const translucentWhiteNodeIds = nodes.flatMap((node) => {
    if (isTextNode(node)) return [];
    const alpha = whiteAlphaOf(node.fill);
    if (alpha == null) return [];
    const effective = alpha * (node.opacity ?? 1);
    return effective > 0.05 && effective < 0.85 ? [node.id] : [];
  });

  return {
    viewport,
    heroCoverage: heroNode && viewportArea > 0 ? round(heroArea / viewportArea, 4) : null,
    heroNodeId: heroNode?.id ?? null,
    whitespaceRatio: viewportArea > 0 ? round(Math.max(0, 1 - Math.min(1, occupied / viewportArea)), 4) : null,
    h1Size,
    h2Size,
    h1H2Ratio,
    hierarchyWeak: h1H2Ratio != null ? h1H2Ratio < TYPE_HIERARCHY_MIN_RATIO : null,
    outOfFrame: outOfFrame.slice(0, MAX_OUT_OF_BOUNDS_IDS),
    outOfCanvas: outOfCanvas.slice(0, MAX_OUT_OF_BOUNDS_IDS),
    overlapPairs: pairs.slice(0, MAX_OVERLAP_PAIRS),
    antiSlop: {
      gradientFillCount: gradientNodes.length,
      purpleBlueGradient,
      emojiNodeIds: nodes.filter((node) => node.text != null && EMOJI_RE.test(node.text)).map((node) => node.id).slice(0, MAX_ANTI_SLOP_IDS),
      translucentWhiteNodeIds: translucentWhiteNodeIds.slice(0, MAX_ANTI_SLOP_IDS),
      excessiveRoundingNodeIds: nodes.flatMap((node) => {
        if (node.cornerRadius == null || !node.box) return [];
        return node.cornerRadius > node.box.width / 4 ? [node.id] : [];
      }).slice(0, MAX_ANTI_SLOP_IDS),
    },
  };
}

function listOrNone(ids: string[]): string {
  return ids.length ? ids.join(", ") : "(none)";
}

/** SCENE_FACTS 分区正文（不含分区头），每行一条 `key: value` 简洁事实。 */
export function formatCanvasSceneFacts(facts: CanvasSceneFacts): string {
  const where = facts.viewport ? ` of ${facts.viewport.kind === "frame" ? facts.viewport.id : "canvas"}` : "";
  const hero = facts.heroCoverage == null
    ? "n/a (no frame or unknown canvas size)"
    : `${(facts.heroCoverage * 100).toFixed(1)}%${where} (composition skill target 60-85%)`;
  const whitespace = facts.whitespaceRatio == null ? "n/a" : `${(facts.whitespaceRatio * 100).toFixed(1)}%${where}`;
  const h1h2 = facts.h1H2Ratio == null
    ? facts.h1Size == null ? "n/a (no text nodes)" : `n/a (only one distinct text size: ${facts.h1Size})`
    : `${facts.h1H2Ratio.toFixed(2)} (h1=${facts.h1Size} h2=${facts.h2Size})${facts.hierarchyWeak ? " [weak, <1.25]" : ""}`;
  const outOfFrame = listOrNone(facts.outOfFrame.map((item) => item.over > 0 ? `${item.id}(+${item.over}px)` : item.id));
  const overlap = listOrNone(facts.overlapPairs.map((pair) => `${pair.a}∩${pair.b}(${pair.area}px²)`));
  const antiSlop = [
    `gradient_fill_count=${facts.antiSlop.gradientFillCount}`,
    `purple_blue_gradient=${facts.antiSlop.purpleBlueGradient}`,
    `emoji=${listOrNone(facts.antiSlop.emojiNodeIds)}`,
    `translucent_white=${listOrNone(facts.antiSlop.translucentWhiteNodeIds)}`,
    `excessive_rounding=${listOrNone(facts.antiSlop.excessiveRoundingNodeIds)}`,
  ].join(", ");
  return [
    "Computed facts for design_review self-scoring — informational, not error alerts. 计算事实/自评引用/非报错",
    `hero_coverage: ${hero}`,
    `whitespace: ${whitespace}`,
    `h1_h2_ratio: ${h1h2}`,
    `out_of_frame: ${outOfFrame}`,
    `out_of_canvas: ${listOrNone(facts.outOfCanvas)}`,
    `overlap: ${overlap}`,
    `anti_slop: ${antiSlop}`,
  ].join("\n");
}
