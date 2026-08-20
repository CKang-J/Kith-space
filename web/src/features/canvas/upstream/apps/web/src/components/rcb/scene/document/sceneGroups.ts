/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/document/sceneGroups.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { nanoid } from '@reduxjs/toolkit';
import { listSceneNodes, normalizeDocument } from './sceneDocument';
import { isNodeLocked } from './nodeCapabilities';
import type { SceneDocument, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

/** Logical multi-object groups via attrs.groupId. */

export function readNodeGroupId(node: SceneNodeInput): string | null {
  const id = String(node?.attrs?.groupId || '').trim();
  return id || null;
}

/** All node ids that share the same groupId. */
export function listGroupMemberIds(
  doc: SceneDocument | null | undefined,
  groupId: string
): string[] {
  if (!doc || !groupId) return [];
  return listSceneNodes(doc)
    .filter(({ node }) => readNodeGroupId(node) === groupId)
    .map(({ id }) => id);
}

/**
 * Expand a selection so that picking any member selects the whole group.
 * Locked layers are never auto-included: expand only from unlocked seeds, and
 * never pull locked siblings into the selection.
 */
export function expandSelectionWithGroups(
  doc: SceneDocument | null | undefined,
  nodeIds: string[]
): string[] {
  if (!doc || !nodeIds?.length) return nodeIds || [];
  const explicit = new Set(nodeIds.filter(Boolean));
  const out = new Set<string>();
  for (const id of explicit) {
    out.add(id);
    const seed = doc.deltaSetLike?.[id];
    // Locked hit stays itself — do not drag the rest of the group into selection.
    if (isNodeLocked(seed)) continue;
    const gid = readNodeGroupId(seed);
    if (!gid) continue;
    for (const mid of listGroupMemberIds(doc, gid)) {
      if (isNodeLocked(doc.deltaSetLike?.[mid])) continue;
      out.add(mid);
    }
  }
  return [...out];
}

/**
 * If every selected id shares one groupId and the selection is exactly that group,
 * return the groupId; otherwise null.
 */
export function selectionSharedGroupId(
  doc: SceneDocument | null | undefined,
  nodeIds: string[]
): string | null {
  if (!doc || !nodeIds || nodeIds.length < 2) return null;
  const unlocked = unlockedGroupableIds(doc, nodeIds);
  if (unlocked.length < 2) return null;
  const first = readNodeGroupId(doc.deltaSetLike?.[unlocked[0]]);
  if (!first) return null;
  if (!unlocked.every((id) => readNodeGroupId(doc.deltaSetLike?.[id]) === first)) {
    return null;
  }
  const members = listGroupMemberIds(doc, first).filter(
    (id) => !isNodeLocked(doc.deltaSetLike?.[id])
  );
  if (members.length !== unlocked.length) return null;
  const set = new Set(unlocked);
  if (!members.every((id) => set.has(id))) return null;
  return first;
}

/** Unlocked ids only — locked layers are never grouped / ungrouped. */
export function unlockedGroupableIds(
  doc: SceneDocument | null | undefined,
  nodeIds: string[]
): string[] {
  return [...new Set((nodeIds || []).filter(Boolean))].filter(
    (id) => doc?.deltaSetLike?.[id] && !isNodeLocked(doc.deltaSetLike[id])
  );
}

/** Assign a shared groupId to the given nodes (skips locked). */
export function groupNodesInDocument(doc: SceneDocument, nodeIds: string[]) {
  const ids = unlockedGroupableIds(doc, nodeIds);
  if (ids.length < 2) return doc;
  const next = normalizeDocument(doc);
  const groupId = nanoid(8);
  ids.forEach((id) => {
    const node = next.deltaSetLike?.[id];
    if (!node) return;
    next.deltaSetLike[id] = {
      ...node,
      attrs: { ...(node.attrs || {}), groupId },
    };
  });
  return next;
}

/** Clear groupId from the given nodes (and unlocked siblings in that group). */
export function ungroupNodesInDocument(doc: SceneDocument, nodeIds: string[]) {
  const ids = unlockedGroupableIds(doc, nodeIds);
  if (!ids.length) return doc;
  const next = normalizeDocument(doc);
  const groupIds = new Set<string>();
  ids.forEach((id) => {
    const gid = readNodeGroupId(next.deltaSetLike?.[id]);
    if (gid) groupIds.add(gid);
  });
  if (!groupIds.size) return doc;
  listSceneNodes(next).forEach(({ id, node }) => {
    const gid = readNodeGroupId(node);
    if (!gid || !groupIds.has(gid)) return;
    if (isNodeLocked(node)) return;
    const attrs = { ...(node.attrs || {}) };
    delete attrs.groupId;
    next.deltaSetLike[id] = { ...node, attrs };
  });
  return next;
}
