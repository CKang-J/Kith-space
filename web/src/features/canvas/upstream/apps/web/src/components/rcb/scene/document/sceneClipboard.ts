/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/document/sceneClipboard.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { nanoid } from '@reduxjs/toolkit';
import { z } from 'zod';
import type { ArtboardFrame } from '@recombyn-native/components/rcb/frames/types';
import {
  addNodeToDocument,
  cloneSceneValue,
  getActivePage,
  listSceneNodes,
  normalizeDocument,
  reconcileStackOrder,
  stackFrameKey,
} from './sceneDocument';
import {
  SceneNodeSchema,
  type SceneDocument,
} from '@recombyn-native/components/rcb/sceneNode';

/** Copy / cut / paste / artboard selection expansion. */

export function nodeIdsInsideFrames(
  doc: SceneDocument | null | undefined,
  frameIds: string[]
): string[] {
  if (!doc || !frameIds?.length) return [];
  const wanted = new Set(frameIds.filter(Boolean).map(String));
  if (!wanted.size) return [];
  const frames = (Array.isArray(doc.frames) ? doc.frames : []).filter(
    (f) => f?.id && wanted.has(String(f.id))
  );
  if (!frames.length) return [];
  const out: string[] = [];
  for (const { id, node } of listSceneNodes(doc)) {
    if (!node) continue;
    const left = Number(node.x) || 0;
    const top = Number(node.y) || 0;
    const w = Math.max(1, Number(node.width) || 1);
    const h = Math.max(1, Number(node.height) || 1);
    const cx = left + w / 2;
    const cy = top + h / 2;
    const inside = frames.some((f) => {
      const fx = Number(f.x) || 0;
      const fy = Number(f.y) || 0;
      const fw = Math.max(1, Number(f.width) || 1);
      const fh = Math.max(1, Number(f.height) || 1);
      return cx >= fx && cx <= fx + fw && cy >= fy && cy <= fy + fh;
    });
    if (inside) out.push(id);
  }
  return out;
}

/**
 * Nodes to operate on for a canvas selection: explicit node ids plus content
 * inside selected artboards (same expansion delete / copy already use).
 */
export function resolveSelectionNodeIds(
  doc: SceneDocument,
  nodeIds: string[],
  frameIds: string[] = []
): string[] {
  const inside = nodeIdsInsideFrames(doc, frameIds);
  return [...new Set([...(nodeIds || []).filter(Boolean), ...inside])];
}

/** Artboard slice in clipboard — required geometry; extras passthrough. */
export const SceneClipboardFrameSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    backgroundColor: z.string().optional(),
  })
  .passthrough();

export const SceneClipboardPayloadSchema = z
  .object({
    nodes: z.array(
      z.object({
        id: z.string().min(1),
        node: SceneNodeSchema,
      })
    ),
    frames: z
      .array(
        z.object({
          id: z.string().min(1),
          frame: SceneClipboardFrameSchema,
        })
      )
      .optional(),
  })
  .refine((p) => (p.nodes?.length || 0) > 0 || (p.frames?.length || 0) > 0, {
    message: 'Clipboard must include nodes or frames',
  });

export type SceneClipboardPayload = z.infer<typeof SceneClipboardPayloadSchema>;

export type ValidateSceneClipboardResult =
  | { valid: true; data: SceneClipboardPayload }
  | { valid: false; error: string };

/** Runtime-check copy/paste payload (internal memory or pasted JSON). */
export function validateSceneClipboard(data: unknown): ValidateSceneClipboardResult {
  try {
    const result = SceneClipboardPayloadSchema.safeParse(data);
    if (result.success) return { valid: true, data: result.data };
    const errorMessages = result.error.issues.map((err) => {
      const path = err.path.join('.');
      return path ? `${path}: ${err.message}` : err.message;
    });
    return {
      valid: false,
      error: `Clipboard validation failed: ${errorMessages.join('; ')}`,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown clipboard validation error',
    };
  }
}

/** Parse text as scene clipboard JSON (OS paste of exported clip). */
export function parseAndValidateSceneClipboardJson(
  rawText: string
): ValidateSceneClipboardResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { valid: false, error: 'Invalid clipboard JSON' };
  }
  return validateSceneClipboard(parsed);
}

/** Axis-aligned bounds of clipboard nodes + frames (document coords). */
export function clipboardNodesBounds(clipboard: SceneClipboardPayload | null | undefined) {
  if (!clipboard) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  (clipboard.nodes || []).forEach(({ node }) => {
    const x = Number(node.x) || 0;
    const y = Number(node.y) || 0;
    const w = Math.max(0, Number(node.width) || 0);
    const h = Math.max(0, Number(node.height) || 0);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
    any = true;
  });
  (clipboard.frames || []).forEach(({ frame }) => {
    const x = Number(frame.x) || 0;
    const y = Number(frame.y) || 0;
    const w = Math.max(0, Number(frame.width) || 0);
    const h = Math.max(0, Number(frame.height) || 0);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
    any = true;
  });
  if (!any || !Number.isFinite(minX)) return null;
  return {
    left: minX,
    top: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

/** Deep-clone selected nodes for copy / cut (preserves page z-order). */
export function snapshotNodesForClipboard(
  doc: SceneDocument,
  nodeIds: string[]
): SceneClipboardPayload | null {
  if (!doc) return null;
  const wanted = new Set((nodeIds || []).filter(Boolean));
  if (!wanted.size) return null;
  const page = getActivePage(doc);
  const ordered = (page?.children || []).filter((id: string) => wanted.has(id));
  const ids = ordered.length ? ordered : [...wanted];
  const nodes: SceneClipboardPayload['nodes'] = [];
  ids.forEach((id) => {
    const raw = doc.deltaSetLike?.[id];
    if (!raw) return;
    nodes.push({ id, node: cloneSceneValue(raw) });
  });
  return nodes.length ? { nodes } : null;
}

/** Deep-clone selected artboards for copy / cut / duplicate. */
export function snapshotFramesForClipboard(
  doc: SceneDocument,
  frameIds: string[]
): NonNullable<SceneClipboardPayload['frames']> {
  const wanted = new Set((frameIds || []).filter(Boolean).map(String));
  if (!wanted.size || !doc) return [];
  const frames = Array.isArray(doc.frames) ? doc.frames : [];
  const out: NonNullable<SceneClipboardPayload['frames']> = [];
  frames.forEach((f) => {
    if (!f?.id || !wanted.has(String(f.id))) return;
    out.push({ id: String(f.id), frame: cloneSceneValue(f) });
  });
  return out;
}

/**
 * Paste clipboard nodes + artboards with new ids.
 * - Default: nudge by offset (keyboard paste).
 * - `anchor`: place union top-left at that scene point (context-menu paste).
 */
export function pasteClipboardIntoDocument(
  doc: SceneDocument,
  clipboard: SceneClipboardPayload | null | undefined,
  opts?: { offsetX?: number; offsetY?: number; anchor?: { x: number; y: number } }
): { document: SceneDocument; ids: string[]; frameIds: string[] } {
  const checked = validateSceneClipboard(clipboard);
  if (!checked.valid) {
    return { document: doc, ids: [], frameIds: [] };
  }
  const clip = checked.data;
  const hasNodes = Boolean(clip.nodes?.length);
  const hasFrames = Boolean(clip.frames?.length);
  if (!doc || (!hasNodes && !hasFrames)) {
    return { document: doc, ids: [], frameIds: [] };
  }
  let next = normalizeDocument(doc);
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  const frameIdMap = new Map<string, string>();
  (clip.nodes || []).forEach(({ id }) => idMap.set(id, nanoid(10)));
  (clip.frames || []).forEach(({ id }) => frameIdMap.set(id, nanoid(10)));

  let ox = opts?.offsetX ?? 24;
  let oy = opts?.offsetY ?? 24;
  if (opts?.anchor) {
    const bounds = clipboardNodesBounds(clip);
    if (bounds) {
      ox = opts.anchor.x - bounds.left;
      oy = opts.anchor.y - bounds.top;
    }
  }

  const newIds: string[] = [];
  (clip.nodes || []).forEach(({ id, node: raw }) => {
    const node = cloneSceneValue(raw);
    const newId = idMap.get(id)!;
    node.id = newId;
    node.x = (Number(node.x) || 0) + ox;
    node.y = (Number(node.y) || 0) + oy;
    const gid = String(node.attrs?.groupId || '').trim();
    if (gid) {
      if (!groupMap.has(gid)) groupMap.set(gid, nanoid(8));
      node.attrs = { ...(node.attrs || {}), groupId: groupMap.get(gid) };
    }
    next = addNodeToDocument(next, newId, node);
    newIds.push(newId);
  });

  const newFrameIds: string[] = [];
  if (clip.frames?.length) {
    const frames = Array.isArray(next.frames) ? [...next.frames] : [];
    const order = Array.isArray(next.stackOrder) ? [...next.stackOrder] : [];
    clip.frames.forEach(({ id, frame: raw }) => {
      const frame = cloneSceneValue(raw);
      const newId = frameIdMap.get(id)!;
      frame.id = newId;
      frame.x = (Number(frame.x) || 0) + ox;
      frame.y = (Number(frame.y) || 0) + oy;
      // Drop transient chrome that should not clone with the artboard.
      delete frame.processStatus;
      delete frame.processLabel;
      delete frame.processKind;
      frames.push(frame as ArtboardFrame);
      newFrameIds.push(newId);
      order.push(stackFrameKey(newId));
    });
    next = {
      ...next,
      frames,
      stackOrder: order,
      activeFrameId: newFrameIds[0] || next.activeFrameId || null,
    };
  }

  reconcileStackOrder(next);
  return { document: next, ids: newIds, frameIds: newFrameIds };
}
