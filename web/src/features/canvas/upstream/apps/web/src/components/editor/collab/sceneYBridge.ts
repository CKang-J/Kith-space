/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/collab/sceneYBridge.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Bidirectional bridge: sceneDocument ↔ Y.Doc.
 * Local writes use origin `local`; remote observes skip echoing back into Y.
 * Local→Y and remote→Redux prefer granular diffs (only changed nodes/frames/meta).
 */

import * as Y from 'yjs';
import { coerceSceneDocumentInput } from '@recombyn-native/components/rcb/sceneNode';
import {
  normalizeDocument
} from '@recombyn-native/components/rcb/scene/document/sceneDocument';

export const Y_ORIGIN_LOCAL = 'local';
export const Y_ORIGIN_REMOTE = 'remote';
export const Y_ORIGIN_SEED = 'seed';
/** Claim empty-room seed leadership (not undoable, not scene content). */
export const Y_ORIGIN_SEED_CLAIM = 'seed-claim';

const META_KEYS = [
  'x',
  'y',
  'width',
  'height',
  'backgroundColor',
  'backgroundFillType',
  'backgroundOpacity',
  'name',
  'activeFrameId',
  'activePageId',
] as const;

/** Meta keys that require a heavier canvas remount when changed remotely. */
const META_RELOAD_KEYS = new Set([
  'width',
  'height',
  'backgroundColor',
  'backgroundFillType',
  'backgroundOpacity',
]);

export type CollabSceneDiff = {
  /** `full` → replace document + bump sceneReloadToken; `patch` → COW + documentPatchToken. */
  mode: 'full' | 'patch';
  upsertNodes: Record<string, any>;
  removeNodeIds: string[];
  upsertFrames: Record<string, any>;
  removeFrameIds: string[];
  meta: Partial<Record<(typeof META_KEYS)[number], unknown>> | null;
  pageChildren: string[] | null;
  stackOrder: string[] | null;
  /** Present when mode === 'full'. */
  scene?: any;
};

export function yMetaMap(doc: Y.Doc) {
  return doc.getMap<unknown>('meta');
}

export function yFramesMap(doc: Y.Doc) {
  return doc.getMap<Record<string, unknown>>('frames');
}

export function yNodesMap(doc: Y.Doc) {
  return doc.getMap<Record<string, unknown>>('nodes');
}

export function yPageChildren(doc: Y.Doc) {
  return doc.getArray<string>('pageChildren');
}

export function yStackOrder(doc: Y.Doc) {
  return doc.getArray<string>('stackOrder');
}

/** Out-of-band bootstrap flags (not part of sceneDocument export). */
export function yBootMap(doc: Y.Doc) {
  return doc.getMap<unknown>('boot');
}

/**
 * Try to become the empty-room seeder. Concurrent claims converge via Y.Map LWW;
 * returns true only if this clientId won.
 */
export function tryClaimRoomSeed(doc: Y.Doc, clientId: number): boolean {
  const boot = yBootMap(doc);
  doc.transact(() => {
    if (boot.get('seedOwner') != null) return;
    boot.set('seedOwner', clientId);
  }, Y_ORIGIN_SEED_CLAIM);
  return Number(boot.get('seedOwner')) === Number(clientId);
}

function cloneJson<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function jsonEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function sameStringList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function readPageChildren(scene: any): string[] {
  const delta = scene?.deltaSetLike && typeof scene.deltaSetLike === 'object' ? scene.deltaSetLike : {};
  const fromPage =
    (Array.isArray(scene?.pages?.[0]?.children) && scene.pages[0].children) ||
    (Array.isArray(delta.ROOT?.children) && delta.ROOT.children) ||
    [];
  return fromPage.filter(Boolean).map(String);
}

function readStackOrder(scene: any): string[] {
  return (Array.isArray(scene?.stackOrder) ? scene.stackOrder : []).filter(Boolean).map(String);
}

function replaceYArray(arr: Y.Array<string>, next: string[]) {
  if (sameStringList(arr.toArray().map(String), next)) return;
  if (arr.length) arr.delete(0, arr.length);
  if (next.length) arr.push(next);
}

/** True when the Y.Doc has no seeded scene content yet. */
export function isYDocEmpty(doc: Y.Doc): boolean {
  return yNodesMap(doc).size === 0 && yFramesMap(doc).size === 0;
}

/** Replace Y.Doc contents from a scene document (room seed / full resync). */
export function seedYDocFromScene(doc: Y.Doc, scene: unknown) {
  const normalized = normalizeDocument(coerceSceneDocumentInput(scene));
  const meta = yMetaMap(doc);
  const frames = yFramesMap(doc);
  const nodes = yNodesMap(doc);
  const pageChildren = yPageChildren(doc);
  const stackOrder = yStackOrder(doc);

  doc.transact(() => {
    for (const key of [...meta.keys()]) meta.delete(key);
    for (const key of [...frames.keys()]) frames.delete(key);
    for (const key of [...nodes.keys()]) nodes.delete(key);
    if (pageChildren.length) pageChildren.delete(0, pageChildren.length);
    if (stackOrder.length) stackOrder.delete(0, stackOrder.length);

    for (const key of META_KEYS) {
      if (normalized[key] !== undefined) meta.set(key, cloneJson(normalized[key]));
    }

    const frameList = Array.isArray(normalized.frames) ? normalized.frames : [];
    for (const frame of frameList) {
      if (!frame?.id) continue;
      frames.set(String(frame.id), cloneJson(frame));
    }

    const delta =
      normalized.deltaSetLike && typeof normalized.deltaSetLike === 'object'
        ? normalized.deltaSetLike
        : {};
    for (const [id, node] of Object.entries(delta)) {
      if (id === 'ROOT' || !node || typeof node !== 'object') continue;
      nodes.set(String(id), cloneJson(node as Record<string, unknown>));
    }

    const childIds = readPageChildren(normalized);
    if (childIds.length) pageChildren.push(childIds);

    const order = readStackOrder(normalized);
    if (order.length) stackOrder.push(order);
  }, Y_ORIGIN_SEED);
}

/** Export a plain sceneDocument from the Y.Doc (for Redux / PUT). */
export function sceneFromYDoc(doc: Y.Doc): any {
  const meta = yMetaMap(doc);
  const frames = yFramesMap(doc);
  const nodes = yNodesMap(doc);
  const pageChildren = yPageChildren(doc);
  const stackOrder = yStackOrder(doc);

  const deltaSetLike: Record<string, any> = {
    ROOT: { children: pageChildren.toArray().map(String) },
  };
  nodes.forEach((node, id) => {
    deltaSetLike[String(id)] = cloneJson(node);
  });

  const frameList: any[] = [];
  frames.forEach((frame) => {
    frameList.push(cloneJson(frame));
  });

  const pageId = String(meta.get('activePageId') || 'page');
  const scene = {
    x: Number(meta.get('x')) || 0,
    y: Number(meta.get('y')) || 0,
    width: Number(meta.get('width')) || 794,
    height: Number(meta.get('height')) || 1123,
    backgroundColor: meta.get('backgroundColor') ?? '',
    backgroundFillType: meta.get('backgroundFillType'),
    backgroundOpacity: meta.get('backgroundOpacity'),
    name: meta.get('name'),
    activeFrameId: meta.get('activeFrameId') ?? null,
    activePageId: pageId,
    frames: frameList,
    pages: [{ id: pageId, children: pageChildren.toArray().map(String) }],
    deltaSetLike,
    stackOrder: stackOrder.toArray().map(String),
  };
  return normalizeDocument(coerceSceneDocumentInput(scene));
}

/**
 * Push local scene into Y, writing only keys that differ from the live Y.Doc.
 */
export function applyLocalSceneToY(doc: Y.Doc, scene: unknown) {
  const normalized = normalizeDocument(scene);
  const meta = yMetaMap(doc);
  const frames = yFramesMap(doc);
  const nodes = yNodesMap(doc);
  const pageChildren = yPageChildren(doc);
  const stackOrder = yStackOrder(doc);

  doc.transact(() => {
    for (const key of META_KEYS) {
      if (normalized[key] === undefined) continue;
      const next = cloneJson(normalized[key]);
      if (!jsonEq(meta.get(key), next)) meta.set(key, next);
    }

    const nextFrameIds = new Set<string>();
    for (const frame of Array.isArray(normalized.frames) ? normalized.frames : []) {
      if (!frame?.id) continue;
      const id = String(frame.id);
      nextFrameIds.add(id);
      const next = cloneJson(frame);
      if (!jsonEq(frames.get(id), next)) frames.set(id, next);
    }
    for (const id of [...frames.keys()]) {
      if (!nextFrameIds.has(id)) frames.delete(id);
    }

    const delta =
      normalized.deltaSetLike && typeof normalized.deltaSetLike === 'object'
        ? normalized.deltaSetLike
        : {};
    const nextNodeIds = new Set<string>();
    for (const [id, node] of Object.entries(delta)) {
      if (id === 'ROOT' || !node || typeof node !== 'object') continue;
      const nid = String(id);
      nextNodeIds.add(nid);
      const next = cloneJson(node as Record<string, unknown>);
      if (!jsonEq(nodes.get(nid), next)) nodes.set(nid, next);
    }
    for (const id of [...nodes.keys()]) {
      if (!nextNodeIds.has(id)) nodes.delete(id);
    }

    replaceYArray(pageChildren, readPageChildren(normalized));
    replaceYArray(stackOrder, readStackOrder(normalized));
  }, Y_ORIGIN_LOCAL);
}

/**
 * Diff two scene documents into a collab apply plan.
 * Node/frame property edits → `patch`; canvas meta remount keys → `full`.
 */
export function diffScenesForCollab(prev: unknown, next: unknown): CollabSceneDiff {
  const prevDoc = normalizeDocument(prev);
  const nextDoc = normalizeDocument(next);

  const upsertNodes: Record<string, any> = {};
  const removeNodeIds: string[] = [];
  const prevDelta =
    prevDoc.deltaSetLike && typeof prevDoc.deltaSetLike === 'object' ? prevDoc.deltaSetLike : {};
  const nextDelta =
    nextDoc.deltaSetLike && typeof nextDoc.deltaSetLike === 'object' ? nextDoc.deltaSetLike : {};

  const prevNodeIds = new Set(
    Object.keys(prevDelta).filter((id) => id !== 'ROOT' && prevDelta[id] && typeof prevDelta[id] === 'object')
  );
  const nextNodeIds = new Set(
    Object.keys(nextDelta).filter((id) => id !== 'ROOT' && nextDelta[id] && typeof nextDelta[id] === 'object')
  );

  for (const id of nextNodeIds) {
    if (!jsonEq(prevDelta[id], nextDelta[id])) upsertNodes[id] = cloneJson(nextDelta[id]);
  }
  for (const id of prevNodeIds) {
    if (!nextNodeIds.has(id)) removeNodeIds.push(id);
  }

  const upsertFrames: Record<string, any> = {};
  const removeFrameIds: string[] = [];
  const prevFrames = new Map<string, any>();
  for (const frame of Array.isArray(prevDoc.frames) ? prevDoc.frames : []) {
    if (frame?.id) prevFrames.set(String(frame.id), frame);
  }
  const nextFrames = new Map<string, any>();
  for (const frame of Array.isArray(nextDoc.frames) ? nextDoc.frames : []) {
    if (frame?.id) nextFrames.set(String(frame.id), frame);
  }
  for (const [id, frame] of nextFrames) {
    if (!jsonEq(prevFrames.get(id), frame)) upsertFrames[id] = cloneJson(frame);
  }
  for (const id of prevFrames.keys()) {
    if (!nextFrames.has(id)) removeFrameIds.push(id);
  }

  const meta: CollabSceneDiff['meta'] = {};
  let metaChanged = false;
  let needsReload = false;
  for (const key of META_KEYS) {
    if (jsonEq(prevDoc[key], nextDoc[key])) continue;
    meta![key] = cloneJson(nextDoc[key]);
    metaChanged = true;
    if (META_RELOAD_KEYS.has(key)) needsReload = true;
  }

  const prevChildren = readPageChildren(prevDoc);
  const nextChildren = readPageChildren(nextDoc);
  const pageChildren = sameStringList(prevChildren, nextChildren) ? null : nextChildren;

  const prevOrder = readStackOrder(prevDoc);
  const nextOrder = readStackOrder(nextDoc);
  const stackOrder = sameStringList(prevOrder, nextOrder) ? null : nextOrder;

  const empty =
    !metaChanged &&
    !Object.keys(upsertNodes).length &&
    !removeNodeIds.length &&
    !Object.keys(upsertFrames).length &&
    !removeFrameIds.length &&
    pageChildren == null &&
    stackOrder == null;

  if (empty) {
    return {
      mode: 'patch',
      upsertNodes: {},
      removeNodeIds: [],
      upsertFrames: {},
      removeFrameIds: [],
      meta: null,
      pageChildren: null,
      stackOrder: null,
    };
  }

  if (needsReload) {
    return {
      mode: 'full',
      upsertNodes,
      removeNodeIds,
      upsertFrames,
      removeFrameIds,
      meta: metaChanged ? meta : null,
      pageChildren,
      stackOrder,
      scene: nextDoc,
    };
  }

  return {
    mode: 'patch',
    upsertNodes,
    removeNodeIds,
    upsertFrames,
    removeFrameIds,
    meta: metaChanged ? meta : null,
    pageChildren,
    stackOrder,
  };
}
