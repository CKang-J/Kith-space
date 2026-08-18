import { randomUUID } from "node:crypto";
import { sanitizeInlineSvgMarkup } from "./canvasAssetStore.js";
import { CanvasValidationError } from "./canvasCore.js";
import type { CanvasJson, CanvasOperation, CanvasPatch } from "./canvasTypes.js";

const DURABLE_OPS = new Set([
  "update_node", "create_shape", "create_text", "create_image", "create_svg",
  "create_lottie", "create_icon", "create_frame", "update_frame", "delete_frame",
  "delete_nodes", "align_nodes", "distribute_nodes", "reorder_nodes", "group_nodes",
  "ungroup_nodes", "duplicate_nodes", "flip_nodes", "boolean_op", "set_canvas_background",
]);
const DEFERRED_OPS = new Set(["image_process", "outline_text"]);
const EPHEMERAL_OPS = new Set(["set_viewport"]);
const SIDE_EFFECT_OPS = new Set(["export_canvas"]);
const MEDIA_CREATE = new Set(["create_image", "create_lottie", "create_icon"]);

export type CanvasViewportSuggestion = { x: number; y: number; zoom: number };

export type MappedCanvasToolOps = {
  operation: CanvasOperation | null;
  createdElementIds: string[];
  createdFrameIds: string[];
  deletedElementIds: string[];
  deletedFrameIds: string[];
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
    throw new CanvasValidationError(`${label} requires a non-empty id list`);
  }
  return raw as string[];
}

function opName(raw: Record<string, unknown>): string {
  const name = typeof raw.op === "string" ? raw.op : typeof raw.name === "string" ? raw.name : "";
  if (!name) throw new CanvasValidationError("Canvas ToolOp requires op");
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

function mapOne(document: CanvasJson, raw: Record<string, unknown>): {
  patches: CanvasPatch[];
  createdElementIds: string[];
  createdFrameIds: string[];
  deletedElementIds: string[];
  deletedFrameIds: string[];
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
    backgroundWrite: false,
  };

  if (op === "update_node") {
    const nodeId = typeof raw.nodeId === "string" ? raw.nodeId : typeof raw.id === "string" ? raw.id : "";
    if (!nodeId || !nodes[nodeId]) throw new CanvasValidationError("update_node target does not exist");
    const patch = asRecord(raw.patch) ?? asRecord(raw.attrs) ?? {};
    const next = { ...nodes[nodeId]! };
    for (const [key, value] of Object.entries(patch)) {
      if (key === "id" || key === "children" || key === "__kithEntityRevision") continue;
      if (key === "src" || key === "url" || key === "href") {
        throw new CanvasValidationError("update_node cannot set remote media URLs");
      }
      next[key] = value as CanvasJson;
    }
    if (typeof raw.x === "number") next.x = raw.x;
    if (typeof raw.y === "number") next.y = raw.y;
    if (typeof raw.width === "number") next.width = raw.width;
    if (typeof raw.height === "number") next.height = raw.height;
    return { ...empty, patches: [setNode(nodeId, next)] };
  }

  if (op === "create_shape" || op === "create_text" || MEDIA_CREATE.has(op) || op === "create_svg") {
    if (MEDIA_CREATE.has(op)) {
      if (raw.url || raw.genPrompt || raw.removeBg || raw.dataUrl) {
        throw new CanvasValidationError(`${op} only accepts an existing assetId`);
      }
      if (typeof raw.assetId !== "string" || !raw.assetId) {
        throw new CanvasValidationError(`${op} requires assetId`);
      }
    }
    const id = typeof raw.id === "string" && raw.id ? raw.id : randomUUID();
    if (id === "ROOT" || nodes[id]) throw new CanvasValidationError("create ToolOp id collides");
    const parentId = typeof raw.parentId === "string" && raw.parentId ? raw.parentId : "ROOT";
    if (!nodes[parentId]) throw new CanvasValidationError("create ToolOp parent does not exist");
    const key = op === "create_text" ? "text" : op === "create_svg" ? "svg" : op === "create_image" ? "image" : op === "create_lottie" ? "lottie" : op === "create_icon" ? "icon" : "shape";
    const node: Record<string, CanvasJson> = {
      id,
      key,
      parentId,
      x: numberOf(raw.x, 0),
      y: numberOf(raw.y, 0),
      width: numberOf(raw.width, 100),
      height: numberOf(raw.height, 100),
      attrs: (asRecord(raw.attrs) ?? {}) as CanvasJson,
      children: [],
    };
    if (typeof raw.frameId === "string") node.frameId = raw.frameId;
    if (typeof raw.text === "string") node.text = raw.text;
    if (typeof raw.assetId === "string") node.assetId = raw.assetId;
    if (op === "create_svg") {
      const markup = typeof raw.svg === "string" ? raw.svg : typeof raw.markup === "string" ? raw.markup : "";
      if (!markup) throw new CanvasValidationError("create_svg requires sanitized svg markup");
      node.svg = sanitizeInlineSvgMarkup(markup);
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
    const id = typeof raw.id === "string" && raw.id ? raw.id : randomUUID();
    if (frames.some((frame) => frame.id === id)) throw new CanvasValidationError("create_frame id collides");
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
    if (!current) throw new CanvasValidationError("update_frame target does not exist");
    const next = { ...current };
    if (typeof raw.name === "string") next.name = raw.name;
    if (typeof raw.x === "number") next.x = raw.x;
    if (typeof raw.y === "number") next.y = raw.y;
    if (typeof raw.width === "number") next.width = raw.width;
    if (typeof raw.height === "number") next.height = raw.height;
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
    if (!frames.some((frame) => frame.id === frameId)) throw new CanvasValidationError("delete_frame target does not exist");
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
      if (!node) throw new CanvasValidationError(`${op} target ${id} does not exist`);
      return { id, node };
    });
    const xs = targets.map(({ node }) => numberOf(node.x, 0));
    const ys = targets.map(({ node }) => numberOf(node.y, 0));
    const widths = targets.map(({ node }) => numberOf(node.width, 0));
    const heights = targets.map(({ node }) => numberOf(node.height, 0));
    const patches: CanvasPatch[] = [];
    if (op === "align_nodes") {
      const axis = raw.axis === "y" || raw.align === "top" || raw.align === "bottom" || raw.align === "middle" ? "y" : "x";
      const align = typeof raw.align === "string" ? raw.align : "start";
      let origin = axis === "x" ? Math.min(...xs) : Math.min(...ys);
      if (align === "end" || align === "right" || align === "bottom") {
        origin = axis === "x" ? Math.max(...xs.map((x, index) => x + widths[index]!)) - widths[0]! : Math.max(...ys.map((y, index) => y + heights[index]!)) - heights[0]!;
      }
      if (align === "center" || align === "middle") {
        const min = axis === "x" ? Math.min(...xs) : Math.min(...ys);
        const max = axis === "x" ? Math.max(...xs.map((x, index) => x + widths[index]!)) : Math.max(...ys.map((y, index) => y + heights[index]!));
        origin = (min + max) / 2;
      }
      for (const { id, node } of targets) {
        const next = { ...node };
        if (axis === "x") next.x = align === "center" ? origin - numberOf(node.width, 0) / 2 : origin;
        else next.y = align === "middle" ? origin - numberOf(node.height, 0) / 2 : origin;
        patches.push(setNode(id, next));
      }
    } else if (op === "distribute_nodes") {
      if (targets.length < 3) throw new CanvasValidationError("distribute_nodes requires at least 3 nodes");
      const axis = raw.axis === "y" ? "y" : "x";
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
      for (const { id, node } of targets) {
        const next = { ...node };
        const scaleX = raw.axis === "y" ? 1 : -1;
        const scaleY = raw.axis === "x" ? 1 : -1;
        next.scaleX = numberOf(node.scaleX, 1) * (raw.axis === "y" ? 1 : scaleX);
        next.scaleY = numberOf(node.scaleY, 1) * (raw.axis === "x" ? 1 : scaleY);
        patches.push(setNode(id, next));
      }
    }
    return { ...empty, patches };
  }

  if (op === "reorder_nodes") {
    const ids = requireIds(raw.ids ?? raw.nodeIds ?? raw.order, "reorder_nodes");
    const nextStack = [...ids, ...stack.filter((item) => !ids.includes(item) && !ids.includes(item.replace(/^frame:/, "")))];
    return { ...empty, patches: [setStack(nextStack)] };
  }

  if (op === "group_nodes") {
    const ids = requireIds(raw.ids ?? raw.nodeIds, "group_nodes");
    const groupId = typeof raw.groupId === "string" && raw.groupId ? raw.groupId : randomUUID();
    if (nodes[groupId]) throw new CanvasValidationError("group_nodes id collides");
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
      if (!current) throw new CanvasValidationError(`group_nodes target ${id} does not exist`);
      patches.push(setNode(id, { ...current, parentId: groupId }));
    }
    patches.push(setStack([...stack.filter((item) => !ids.includes(item)), groupId]));
    return { ...empty, patches, createdElementIds: [groupId] };
  }

  if (op === "ungroup_nodes") {
    const groupId = typeof raw.groupId === "string" ? raw.groupId : typeof raw.id === "string" ? raw.id : "";
    const group = nodes[groupId];
    if (!group || group.key !== "group") throw new CanvasValidationError("ungroup_nodes target is not a group");
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
      if (!current) throw new CanvasValidationError(`duplicate_nodes target ${id} does not exist`);
      const copyId = randomUUID();
      const parentId = typeof current.parentId === "string" ? current.parentId : "ROOT";
      const copy = cloneNode(current);
      copy.id = copyId;
      copy.x = numberOf(current.x, 0) + 16;
      copy.y = numberOf(current.y, 0) + 16;
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
    if (ids.length < 2) throw new CanvasValidationError("boolean_op requires at least two operands");
    const operands = ids.map((id) => {
      const node = nodes[id];
      if (!node) throw new CanvasValidationError(`boolean_op operand ${id} does not exist`);
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
      booleanOp: typeof raw.operation === "string" ? raw.operation : "union",
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
    return {
      ...empty,
      patches: [{ op: "set", path: ["background"], value: (raw.value ?? raw.background ?? null) as CanvasJson }],
      backgroundWrite: true,
    };
  }

  throw new CanvasValidationError(`unsupported Canvas ToolOp ${op}`);
}

export function mapCanvasToolOps(document: CanvasJson, operations: unknown[]): MappedCanvasToolOps {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new CanvasValidationError("canvas.elements_apply requires a non-empty operations list");
  }
  let current = document;
  const patches: CanvasPatch[] = [];
  const createdElementIds: string[] = [];
  const createdFrameIds: string[] = [];
  const deletedElementIds: string[] = [];
  const deletedFrameIds: string[] = [];
  let viewport: CanvasViewportSuggestion | null = null;
  let backgroundWrite = false;
  for (const item of operations) {
    const raw = asRecord(item);
    if (!raw) throw new CanvasValidationError("Canvas ToolOp must be an object");
    const name = opName(raw);
    if (DEFERRED_OPS.has(name)) {
      throw new CanvasValidationError(`${name} is deferred to a durable job and cannot join a scene batch`);
    }
    if (SIDE_EFFECT_OPS.has(name)) {
      throw new CanvasValidationError("export_canvas is a Canvas export side effect; use canvas.export");
    }
    if (EPHEMERAL_OPS.has(name)) {
      viewport = {
        x: numberOf(raw.x, 0),
        y: numberOf(raw.y, 0),
        zoom: numberOf(raw.zoom, 1),
      };
      continue;
    }
    if (!DURABLE_OPS.has(name)) throw new CanvasValidationError(`unknown Canvas ToolOp ${name}`);
    const mapped = mapOne(current, raw);
    patches.push(...mapped.patches);
    createdElementIds.push(...mapped.createdElementIds);
    createdFrameIds.push(...mapped.createdFrameIds);
    deletedElementIds.push(...mapped.deletedElementIds);
    deletedFrameIds.push(...mapped.deletedFrameIds);
    backgroundWrite = backgroundWrite || mapped.backgroundWrite;
    current = applyPatches(current, mapped.patches);
  }
  return {
    operation: patches.length ? { type: "document.patch", patches } : null,
    createdElementIds,
    createdFrameIds,
    deletedElementIds,
    deletedFrameIds,
    viewport,
    backgroundWrite,
  };
}
