/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643
 *   apps/web/src/components/editor/panels/agent/runDesignAgent.ts
 *   apps/web/src/components/editor/panels/agent/designTools.ts
 * Change: retain only the pure scene-context helpers used by the native generator composer.
 * Apache-2.0 and upstream NOTICE apply.
 */
import type { SceneDocument, SceneNodeInput } from "@recombyn-native/components/rcb/sceneNode";
import { maxRadius, radiiFromAttrs } from "@recombyn-native/components/rcb/scene/document/sceneRadii";
import { parseNodeText, parseNodeTextStyle } from "@recombyn-native/components/rcb/scene/document/sceneText";
import { nodeLeftTop } from "@recombyn-native/components/rcb/scene/paint/sceneToSvg";

export type SceneNodeInventoryItem = {
  id: string;
  type: string;
  frameId?: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  width: number;
  height: number;
  fill?: string;
  fillType?: string;
  stroke?: string;
  borderWidth?: number;
  strokeAlign?: string;
  opacity?: number;
  rotation?: number;
  path?: string;
  closed?: boolean;
  text?: string;
  fontSize?: number;
  fontWeight?: string;
  fontFamily?: string;
  textAlign?: string;
  lineHeight?: number;
  cornerRadius?: number;
  radiusTL?: number;
  radiusTR?: number;
  radiusBR?: number;
  radiusBL?: number;
};

function nodeIdsInsideFrame(
  document: SceneDocument,
  frameId: string | null | undefined,
): string[] {
  if (!document || !frameId) return [];
  const frame = (Array.isArray(document.frames) ? document.frames : []).find(
    (candidate) => String(candidate?.id || "") === String(frameId),
  );
  if (!frame) return [];
  const rootChildren: string[] = document.deltaSetLike?.ROOT?.children || [];
  const result: string[] = [];
  for (const id of rootChildren) {
    const node = document.deltaSetLike?.[id];
    if (!node || !id) continue;
    const { left, top } = nodeLeftTop(document, node);
    const nodeWidth = Math.max(1, Number(node.width) || 1);
    const nodeHeight = Math.max(1, Number(node.height) || 1);
    const frameX = Number(frame.x) || 0;
    const frameY = Number(frame.y) || 0;
    const frameWidth = Math.max(1, Number(frame.width) || 1);
    const frameHeight = Math.max(1, Number(frame.height) || 1);
    const overlapWidth = Math.max(
      0,
      Math.min(left + nodeWidth, frameX + frameWidth) - Math.max(left, frameX),
    );
    const overlapHeight = Math.max(
      0,
      Math.min(top + nodeHeight, frameY + frameHeight) - Math.max(top, frameY),
    );
    if (overlapWidth * overlapHeight >= nodeWidth * nodeHeight * 0.35) result.push(id);
  }
  return result;
}

export function frameIdContainingNode(
  document: SceneDocument,
  nodeId: string | null | undefined,
): string | null {
  if (!document || !nodeId) return null;
  const node = document.deltaSetLike?.[nodeId];
  if (!node) return null;
  const frames = Array.isArray(document.frames) ? document.frames : [];
  if (!frames.length) return null;
  const { left, top } = nodeLeftTop(document, node);
  const nodeWidth = Math.max(1, Number(node.width) || 1);
  const nodeHeight = Math.max(1, Number(node.height) || 1);
  let bestId: string | null = null;
  let bestArea = 0;
  for (const frame of frames) {
    if (!frame?.id) continue;
    const frameX = Number(frame.x) || 0;
    const frameY = Number(frame.y) || 0;
    const frameWidth = Math.max(1, Number(frame.width) || 1);
    const frameHeight = Math.max(1, Number(frame.height) || 1);
    const overlapWidth = Math.max(
      0,
      Math.min(left + nodeWidth, frameX + frameWidth) - Math.max(left, frameX),
    );
    const overlapHeight = Math.max(
      0,
      Math.min(top + nodeHeight, frameY + frameHeight) - Math.max(top, frameY),
    );
    const area = overlapWidth * overlapHeight;
    if (area > bestArea) {
      bestArea = area;
      bestId = String(frame.id);
    }
  }
  return bestId && bestArea >= nodeWidth * nodeHeight * 0.35 ? bestId : null;
}

function nodeFillForInventory(node: SceneNodeInput): string {
  const attrs = node?.attrs || {};
  const candidates = [
    attrs["fill-color"],
    attrs.fill,
    attrs.color,
    attrs["font-color"],
    attrs.fontColor,
    attrs.textColor,
  ];
  for (const candidate of candidates) {
    const value = candidate != null ? String(candidate).trim() : "";
    if (value && value !== "none" && value !== "transparent" && typeof candidate !== "object") {
      return value;
    }
  }
  const gradient = attrs.fill;
  if (gradient && typeof gradient === "object") {
    const record = gradient as Record<string, unknown>;
    const from = String(record.from || record.color || record.start || "").trim();
    if (from && from !== "none" && from !== "transparent") return from;
  }
  return "";
}

function sceneNodeOpacityPercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  if (value > 1) return Math.min(100, value);
  return Math.round(value * 100);
}

function nodeToInventoryItem(
  document: SceneDocument,
  id: string,
  node: SceneNodeInput,
  originX = 0,
  originY = 0,
  frameId?: string | null,
): SceneNodeInventoryItem {
  const { left, top } = nodeLeftTop(document, node);
  const attrs = node.attrs || {};
  const key = String(node.key || "").toLowerCase();
  const shapeType = String(attrs.shapeType || key || "shape").toLowerCase();
  const fill = nodeFillForInventory(node);
  const stroke = String(attrs["border-color"] ?? attrs.stroke ?? "").trim();
  const borderRaw = Number(attrs["border-width"] ?? attrs.strokeWidth);
  const strokeAlignRaw = String(attrs.strokeAlign || attrs["stroke-align"] || "center")
    .trim()
    .toLowerCase();
  const strokeAlign = ["inside", "outside", "center"].includes(strokeAlignRaw)
    ? strokeAlignRaw
    : "center";
  const opacityRaw = Number(attrs.opacity);
  const angleRaw = Number(attrs.angle ?? attrs.rotation);
  const path = String(attrs.path || attrs.d || "").trim();
  const width = Math.max(1, Math.round(Number(node.width) || 1));
  const height = Math.max(1, Math.round(Number(node.height) || 1));
  const item: SceneNodeInventoryItem = {
    id: String(id),
    type: key === "text" ? "text" : shapeType || key || "shape",
    ...(frameId ? { frameId: String(frameId) } : {}),
    x: Math.round(left - originX),
    y: Math.round(top - originY),
    w: width,
    h: height,
    width,
    height,
    fill: fill || undefined,
    fillType: String(attrs["fill-type"] || "solid").trim() || "solid",
    stroke: stroke && stroke !== "transparent" && stroke !== "none" ? stroke : undefined,
    borderWidth: Number.isFinite(borderRaw) && borderRaw >= 0 ? borderRaw : 0,
    strokeAlign,
    opacity: sceneNodeOpacityPercent(opacityRaw),
    rotation: Number.isFinite(angleRaw) ? Math.round(angleRaw * 100) / 100 : 0,
  };
  const name = attrs.name != null ? String(attrs.name).trim() : "";
  if (name) item.name = name;
  if (path) item.path = path.length > 480 ? `${path.slice(0, 480)}…(/*${path.length} chars*/)` : path;
  if (attrs.closed != null) item.closed = attrs.closed === true || attrs.closed === "true";
  if (key === "text") {
    const style = parseNodeTextStyle(attrs);
    item.text = parseNodeText(attrs).trim().slice(0, 500);
    const fontSize = Number(style?.fontSize) || Number(attrs.fontSize ?? attrs["font-size"]);
    const lineHeight = Number(style?.lineHeight);
    if (Number.isFinite(fontSize) && fontSize > 0) item.fontSize = Math.round(fontSize);
    if (Number.isFinite(lineHeight) && lineHeight > 0) item.lineHeight = Math.round(lineHeight * 100) / 100;
    if (style?.fontWeight) item.fontWeight = String(style.fontWeight);
    if (style?.fontFamily) item.fontFamily = String(style.fontFamily);
    if (style?.textAlign) item.textAlign = String(style.textAlign);
  } else {
    const radii = radiiFromAttrs(attrs);
    item.cornerRadius = Math.round(maxRadius(radii));
    item.radiusTL = Math.round(radii.tl);
    item.radiusTR = Math.round(radii.tr);
    item.radiusBR = Math.round(radii.br);
    item.radiusBL = Math.round(radii.bl);
  }
  return item;
}

export function buildSceneNodesForIds(
  document: SceneDocument,
  nodeIds: string[],
): SceneNodeInventoryItem[] {
  if (!document || !nodeIds.length) return [];
  return nodeIds.flatMap((id) => {
    const node = document.deltaSetLike?.[id];
    return node && id ? [nodeToInventoryItem(document, id, node)] : [];
  });
}

export function buildSceneNodesForEdit(
  document: SceneDocument,
  frameId: string | null | undefined,
  forceIds?: string[] | null,
): SceneNodeInventoryItem[] {
  if (!document || !frameId) return [];
  const frame = (Array.isArray(document.frames) ? document.frames : []).find(
    (candidate) => candidate?.id === frameId,
  );
  if (!frame) return [];
  const forced = new Set(
    (forceIds || []).filter((id) => id && document.deltaSetLike?.[id]).map(String),
  );
  const ids = new Set(nodeIdsInsideFrame(document, frameId));
  for (const id of forced) ids.add(id);
  const items = [...ids].flatMap((id) => {
    const node = document.deltaSetLike?.[id];
    return node
      ? [nodeToInventoryItem(document, id, node, Number(frame.x) || 0, Number(frame.y) || 0, frameId)]
      : [];
  });
  const pinned = items.filter((item) => forced.has(item.id));
  const rest = items
    .filter((item) => !forced.has(item.id))
    .sort((left, right) => right.w * right.h - left.w * left.h);
  return [...pinned, ...rest.slice(0, Math.max(0, 60 - pinned.length))];
}
