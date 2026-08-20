type SceneRecord = Record<string, unknown>;

export type CanvasPreviewItem = {
  id: string;
  kind: "frame" | "ellipse" | "path" | "text" | "media" | "shape";
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  path?: string;
  src?: string;
  text?: string;
};

export type CanvasPreviewScene = {
  viewBox: string;
  items: CanvasPreviewItem[];
};

const number = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const record = (value: unknown): SceneRecord => value && typeof value === "object" && !Array.isArray(value)
  ? value as SceneRecord
  : {};

const safePaint = (value: unknown, fallback: string) => {
  const paint = String(value || "").trim();
  return /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%+-]+\)|hsla?\([\d\s.,%+-]+\)|transparent|none|white|black)$/i.test(paint)
    ? paint
    : fallback;
};

const safeLocalImageSrc = (value: unknown) => {
  const src = typeof value === "string" ? value.trim() : "";
  return /^\/api\/canvas-assets\/[^/?#]+\/[^/?#]+\/[^/?#]+$/.test(src) ? src : undefined;
};

export function canvasPreviewScene(document: unknown): CanvasPreviewScene {
  const scene = record(document);
  const items: CanvasPreviewItem[] = [];
  const frames = Array.isArray(scene.frames) ? scene.frames : [];
  for (const [index, value] of frames.entries()) {
    const frame = record(value);
    items.push({
      id: String(frame.id ?? `frame-${index}`),
      kind: "frame",
      x: number(frame.x),
      y: number(frame.y),
      width: Math.max(1, number(frame.width, 1)),
      height: Math.max(1, number(frame.height, 1)),
      fill: safePaint(frame.backgroundColor, "#ffffff"),
      stroke: "#a1a1aa",
    });
  }

  const nodes = record(scene.deltaSetLike);
  for (const [id, value] of Object.entries(nodes)) {
    if (id === "ROOT") continue;
    const node = record(value);
    const attrs = record(node.attrs);
    const key = String(node.key || "shape");
    const shapeType = String(attrs.shapeType || "");
    const kind: CanvasPreviewItem["kind"] = key === "text"
      ? "text"
      : key === "path"
        ? "path"
        : key === "image" || key === "video" || key === "audio"
          ? "media"
          : shapeType === "ellipse" || shapeType === "circle"
            ? "ellipse"
            : "shape";
    items.push({
      id,
      kind,
      x: number(node.x),
      y: number(node.y),
      width: Math.max(1, number(node.width, 1)),
      height: Math.max(1, number(node.height, 1)),
      fill: safePaint(attrs["fill-color"], kind === "media" ? "#e4e4e7" : "transparent"),
      stroke: safePaint(attrs["border-color"] || attrs.stroke, "#52525b"),
      path: kind === "path" && typeof attrs.path === "string" ? attrs.path.slice(0, 20_000) : undefined,
      src: key === "image" ? safeLocalImageSrc(attrs.src) : undefined,
      text: kind === "text" ? String(attrs.text || attrs.content || node.text || "").slice(0, 48) : undefined,
    });
  }

  const visible = items.length ? items : [{
    id: "empty",
    kind: "frame" as const,
    x: 0,
    y: 0,
    width: Math.max(1, number(scene.width, 1600)),
    height: Math.max(1, number(scene.height, 900)),
    fill: "#ffffff",
    stroke: "#d4d4d8",
  }];
  const left = Math.min(...visible.map((item) => item.x));
  const top = Math.min(...visible.map((item) => item.y));
  const right = Math.max(...visible.map((item) => item.x + item.width));
  const bottom = Math.max(...visible.map((item) => item.y + item.height));
  const padding = Math.max(24, Math.max(right - left, bottom - top) * 0.06);
  return {
    viewBox: `${left - padding} ${top - padding} ${Math.max(1, right - left) + padding * 2} ${Math.max(1, bottom - top) + padding * 2}`,
    items,
  };
}

export function formatCanvasUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新时间未知";
  return `更新于 ${new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date)}`;
}
