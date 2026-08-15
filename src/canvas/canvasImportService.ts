import { randomUUID } from "node:crypto";
import type { CanvasJson } from "./canvasTypes.js";
import { CanvasAssetValidationError } from "./canvasAssetErrors.js";

const MAX_SCENE_BYTES = 16 * 1024 * 1024;
const MAX_SCENE_VALUES = 200_000;
const IMPORT_DOCUMENT_FIELDS = new Set([
  "width", "height", "x", "y", "backgroundColor", "backgroundFillType", "backgroundGradient",
  "backgroundOpacity", "backgroundImageSrc", "backgroundImageFit", "backgroundImageRotate",
  "backgroundImageAdjust", "activeFrameId", "stackOrder",
]);
const ALLOWED_ROOT_KEYS = new Set([
  ...IMPORT_DOCUMENT_FIELDS, "deltaSetLike", "activePageId", "frames", "pages",
]);
const ALLOWED_NODE_KEYS = new Set(["shape", "text", "image", "video", "audio", "path", "group"]);
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const URL_KEYS = new Set(["src", "url", "href", "poster", "thumbnail", "backgroundImageSrc"]);
const RESERVED_STATE_KEYS = new Set([
  "revision", "revisions", "lifecycle", "deletedAt", "sequence", "operation", "operations",
  "operationId", "mutation", "mutations", "mutationId", "realtimeSequence", "metadataRevision",
  "documentRevision", "elementRevision", "frameRevision", "structureRevision", "createdAt", "updatedAt",
  "spaceId", "canvasId",
]);
const IMPORT_ROOT_NODE_FIELDS = new Set(["id", "key", "x", "y", "z", "width", "height", "attrs", "children", "name"]);
const IMPORT_NODE_FIELDS = new Set([...IMPORT_ROOT_NODE_FIELDS, "parentId", "frameId"]);
const IMPORT_FRAME_FIELDS = new Set([
  "id", "name", "x", "y", "width", "height", "backgroundColor", "fill", "layoutMode", "locked",
  "hidden", "lockAspect", "clipContent", "aspectOriginalWidth", "aspectOriginalHeight", "processStatus",
  "processLabel", "processKind",
]);
function stripReservedState(value: CanvasJson): CanvasJson {
  if (Array.isArray(value)) return value.map(stripReservedState);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !RESERVED_STATE_KEYS.has(key))
    .map(([key, child]) => [key, stripReservedState(child)])) as CanvasJson;
}

function pickImportFields(source: Record<string, CanvasJson>, allowed: Set<string>): Record<string, CanvasJson> {
  return Object.fromEntries(Object.entries(source)
    .filter(([key]) => allowed.has(key) && !RESERVED_STATE_KEYS.has(key))
    .map(([key, value]) => [key, stripReservedState(value)]));
}

export function sanitizeCanvasSceneJson(input: string | unknown, options: {
  spaceId?: string;
  assetExists?(canvasId: string, assetId: string): boolean;
} = {}): CanvasJson {
  const encoded = typeof input === "string" ? input : JSON.stringify(input);
  if (!encoded || Buffer.byteLength(encoded) > MAX_SCENE_BYTES) throw new CanvasAssetValidationError("Canvas JSON exceeds the 16 MiB limit");
  let scene: unknown;
  try { scene = typeof input === "string" ? JSON.parse(input) : structuredClone(input); }
  catch { throw new CanvasAssetValidationError("Canvas JSON is malformed"); }
  if (!scene || typeof scene !== "object" || Array.isArray(scene)) throw new CanvasAssetValidationError("Canvas JSON root must be an object");
  for (const key of Object.keys(scene)) if (!ALLOWED_ROOT_KEYS.has(key)) throw new CanvasAssetValidationError(`Canvas JSON root key is not allowed: ${key}`);
  const root = scene as Record<string, unknown>;
  for (const dimension of ["width", "height"] as const) {
    if (typeof root[dimension] !== "number" || !Number.isFinite(root[dimension]) || root[dimension] <= 0 || root[dimension] > 10_000_000) {
      throw new CanvasAssetValidationError(`Canvas JSON ${dimension} is invalid`);
    }
  }
  if (!root.deltaSetLike || typeof root.deltaSetLike !== "object" || Array.isArray(root.deltaSetLike)) {
    throw new CanvasAssetValidationError("Canvas JSON requires deltaSetLike");
  }
  if (!Array.isArray(root.frames)) throw new CanvasAssetValidationError("Canvas JSON requires frames");
  const nodes = root.deltaSetLike as Record<string, unknown>;
  if (!nodes.ROOT || Object.keys(nodes).length > 20_001) throw new CanvasAssetValidationError("Canvas JSON node count is invalid");
  for (const [id, value] of Object.entries(nodes)) {
    if (id === "ROOT") continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new CanvasAssetValidationError(`Canvas node is invalid: ${id}`);
    const node = value as Record<string, unknown>;
    if (node.id !== id || typeof node.key !== "string" || !ALLOWED_NODE_KEYS.has(node.key)) {
      throw new CanvasAssetValidationError(`Canvas node type is not allowed: ${id}`);
    }
  }
  const sceneRoot = nodes.ROOT as Record<string, unknown>;
  if (!Array.isArray(sceneRoot.children) || !sceneRoot.children.every((id) => typeof id === "string")) {
    throw new CanvasAssetValidationError("Canvas ROOT children are invalid");
  }
  const visited = new Set<string>();
  const visitNode = (id: string, parentId: string, ancestors: Set<string>): void => {
    if (ancestors.has(id)) throw new CanvasAssetValidationError("Canvas node hierarchy contains a cycle");
    if (visited.has(id)) throw new CanvasAssetValidationError("Canvas node has multiple parents");
    const value = nodes[id];
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new CanvasAssetValidationError(`Canvas node reference is missing: ${id}`);
    const node = value as Record<string, unknown>;
    if (node.parentId !== undefined && node.parentId !== null && node.parentId !== parentId) {
      throw new CanvasAssetValidationError(`Canvas node parent is inconsistent: ${id}`);
    }
    if (node.children !== undefined && (!Array.isArray(node.children) || !node.children.every((child) => typeof child === "string"))) {
      throw new CanvasAssetValidationError(`Canvas node children are invalid: ${id}`);
    }
    visited.add(id);
    const nextAncestors = new Set(ancestors).add(id);
    for (const child of (node.children as string[] | undefined) ?? []) visitNode(child, id, nextAncestors);
  };
  for (const id of sceneRoot.children as string[]) visitNode(id, "ROOT", new Set());
  if (visited.size !== Object.keys(nodes).length - 1) throw new CanvasAssetValidationError("Canvas JSON contains orphan nodes");
  const frameIds = new Set<string>();
  for (const value of root.frames) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new CanvasAssetValidationError("Canvas Frame is invalid");
    const frame = value as Record<string, unknown>;
    if (typeof frame.id !== "string" || !frame.id || frameIds.has(frame.id)) throw new CanvasAssetValidationError("Canvas Frame id is invalid or duplicated");
    for (const field of ["x", "y", "width", "height"] as const) {
      if (typeof frame[field] !== "number" || !Number.isFinite(frame[field]) || Math.abs(frame[field]) > 10_000_000
        || ((field === "width" || field === "height") && frame[field] <= 0)) {
        throw new CanvasAssetValidationError(`Canvas Frame ${field} is invalid`);
      }
    }
    frameIds.add(frame.id);
  }
  for (const [id, value] of Object.entries(nodes)) {
    if (id === "ROOT") continue;
    const frameId = (value as Record<string, unknown>).frameId;
    if (frameId !== undefined && frameId !== null && (typeof frameId !== "string" || !frameIds.has(frameId))) {
      throw new CanvasAssetValidationError(`Canvas node Frame reference is missing: ${id}`);
    }
  }
  if (root.activeFrameId !== undefined && root.activeFrameId !== null
    && (typeof root.activeFrameId !== "string" || !frameIds.has(root.activeFrameId))) {
    throw new CanvasAssetValidationError("Canvas active Frame does not exist");
  }
  const pageIds = new Set<string>();
  if (root.pages !== undefined) {
    if (!Array.isArray(root.pages)) throw new CanvasAssetValidationError("Canvas pages are invalid");
    for (const value of root.pages) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new CanvasAssetValidationError("Canvas page is invalid");
      const page = value as Record<string, unknown>;
      if (typeof page.id !== "string" || !page.id || pageIds.has(page.id)
        || !Array.isArray(page.children) || !page.children.every((id) => typeof id === "string" && (sceneRoot.children as string[]).includes(id))) {
        throw new CanvasAssetValidationError("Canvas page references are invalid");
      }
      pageIds.add(page.id);
    }
  }
  if (root.activePageId !== undefined && root.activePageId !== null
    && (typeof root.activePageId !== "string" || !pageIds.has(root.activePageId))) {
    throw new CanvasAssetValidationError("Canvas active page does not exist");
  }
  if (root.stackOrder !== undefined) {
    if (!Array.isArray(root.stackOrder)) throw new CanvasAssetValidationError("Canvas stack order is invalid");
    const stackEntries = new Set<string>();
    for (const entry of root.stackOrder) {
      const valid = typeof entry === "string" && (entry.startsWith("node:")
        ? Object.prototype.hasOwnProperty.call(nodes, entry.slice(5)) && entry.slice(5) !== "ROOT"
        : entry.startsWith("frame:")
          ? frameIds.has(entry.slice(6))
          : Object.prototype.hasOwnProperty.call(nodes, entry) && entry !== "ROOT");
      if (!valid || stackEntries.has(entry as string)) throw new CanvasAssetValidationError("Canvas stack order contains an invalid reference");
      stackEntries.add(entry as string);
    }
  }
  let inspected = 0;
  const inspect = (value: unknown, key = "", depth = 0): void => {
    if (++inspected > MAX_SCENE_VALUES || depth > 48) throw new CanvasAssetValidationError("Canvas JSON is too complex");
    if (typeof value === "string" && URL_KEYS.has(key)) {
      const url = value.trim();
      const localAssetPrefix = options.spaceId ? `/api/canvas-assets/${encodeURIComponent(options.spaceId)}/` : null;
      if (/^(?:javascript|data|blob|https?):/i.test(url)
        || (url && (!localAssetPrefix || !url.startsWith(localAssetPrefix)))) {
        throw new CanvasAssetValidationError("Canvas JSON contains an untrusted media URL");
      }
      if (url) {
        const match = /^\/api\/canvas-assets\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url);
        if (!match || !options.assetExists) throw new CanvasAssetValidationError("Canvas JSON contains an invalid asset reference");
        let canvasId: string;
        let assetId: string;
        try { canvasId = decodeURIComponent(match[2]!); assetId = decodeURIComponent(match[3]!); }
        catch { throw new CanvasAssetValidationError("Canvas JSON contains an invalid asset reference"); }
        if (!options.assetExists(canvasId, assetId)) throw new CanvasAssetValidationError("Canvas JSON asset does not exist");
      }
    }
    if (!value || typeof value !== "object") return;
    for (const [childKey, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(childKey)) throw new CanvasAssetValidationError("Canvas JSON contains an unsafe key");
      inspect(child, childKey, depth + 1);
    }
  };
  inspect(scene);
  return scene as CanvasJson;
}

/** Converts an external Recombyn scene into Kith's single hidden-root document.
 * Every externally supplied entity id is replaced so imports cannot alias an
 * existing Canvas resource. Assets require an explicit copy/rebind workflow. */
export function normalizeCanvasSceneImport(input: string | unknown, options: {
  spaceId?: string;
  assetExists?(canvasId: string, assetId: string): boolean;
} = {}): CanvasJson {
  let source: unknown = input;
  if (typeof input === "string") {
    try { source = JSON.parse(input); } catch { /* sanitizer returns the stable malformed error */ }
  }
  if (source && typeof source === "object" && !Array.isArray(source) && "format" in source) {
    const envelope = source as Record<string, unknown>;
    if (envelope.format !== "kith-canvas-scene" || envelope.version !== 1 || !("scene" in envelope)) {
      throw new CanvasAssetValidationError("Canvas export format or version is unsupported");
    }
    source = envelope.scene;
  } else {
    throw new CanvasAssetValidationError("Canvas import requires a versioned kith-canvas-scene envelope");
  }
  const sanitized = sanitizeCanvasSceneJson(source, options) as Record<string, CanvasJson>;
  const encoded = JSON.stringify(sanitized);
  if (/\/api\/canvas-assets\//.test(encoded)) {
    throw new CanvasAssetValidationError("Canvas import assets must be rebound to the new Canvas");
  }
  const sourceNodes = sanitized.deltaSetLike as Record<string, CanvasJson>;
  const nodeIds = Object.keys(sourceNodes).filter((id) => id !== "ROOT");
  const nodeMap = new Map(nodeIds.map((id) => [id, randomUUID()]));
  const sourceFrames = sanitized.frames as CanvasJson[];
  const frameMap = new Map(sourceFrames.map((value) => {
    const frame = value as Record<string, CanvasJson>;
    return [frame.id as string, randomUUID()] as const;
  }));
  const mapNode = (id: string) => nodeMap.get(id) ?? id;
  const mapParent = (value: CanvasJson | undefined) => typeof value === "string" ? mapNode(value) : value;
  const nodes: Record<string, CanvasJson> = {};
  const sourceRoot = sourceNodes.ROOT as Record<string, CanvasJson>;
  nodes.ROOT = {
    ...pickImportFields(sourceRoot, IMPORT_ROOT_NODE_FIELDS),
    id: "ROOT",
    children: (sourceRoot.children as CanvasJson[]).map((id) => mapNode(id as string)),
  };
  for (const oldId of nodeIds) {
    const nextId = mapNode(oldId);
    const node = sourceNodes[oldId] as Record<string, CanvasJson>;
    nodes[nextId] = {
      ...pickImportFields(node, IMPORT_NODE_FIELDS),
      id: nextId,
      ...(node.parentId !== undefined ? { parentId: mapParent(node.parentId) } : {}),
      ...(Array.isArray(node.children) ? { children: node.children.map((id) => mapNode(id as string)) } : {}),
      ...(typeof node.frameId === "string" ? { frameId: frameMap.get(node.frameId) } : {}),
    };
  }
  const frames = sourceFrames.map((value) => {
    const frame = value as Record<string, CanvasJson>;
    return { ...pickImportFields(frame, IMPORT_FRAME_FIELDS), id: frameMap.get(frame.id as string)! };
  });
  const normalized: Record<string, CanvasJson> = {
    ...pickImportFields(sanitized, IMPORT_DOCUMENT_FIELDS),
    deltaSetLike: nodes,
    frames,
  };
  delete normalized.pages;
  delete normalized.activePageId;
  if (typeof normalized.activeFrameId === "string") normalized.activeFrameId = frameMap.get(normalized.activeFrameId) ?? null;
  if (Array.isArray(normalized.stackOrder)) {
    normalized.stackOrder = normalized.stackOrder.map((entry) => {
      if (typeof entry !== "string") return entry;
      if (entry.startsWith("node:")) return `node:${mapNode(entry.slice(5))}`;
      if (entry.startsWith("frame:")) return `frame:${frameMap.get(entry.slice(6))!}`;
      return mapNode(entry);
    });
  }
  return normalized;
}
