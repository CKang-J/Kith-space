/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/store/modules/editorHistory.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Editor undo/redo history stack (snap + node-patch COW entries).
 */
import {
  flattenDeltaSetLike,
  patchDeltaSetLike,
  removeNodesFromDocument,
} from '@recombyn-native/components/rcb/scene/document/sceneDocument';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

/** Soft cap — prefer bytes over entry count for heavy path docs. */
export const HISTORY_MAX_ENTRIES = 50;
export const HISTORY_MAX_BYTES = 64 * 1024 * 1024;

/** Full-doc snapshot (structural ops) or before-nodes for patch undo. */
export type HistorySnap = { kind: 'snap'; doc: SceneDocument };
export type HistoryNodes = { kind: 'nodes'; before: Record<string, SceneNode> };
export type HistoryEntry = HistorySnap | HistoryNodes;

/** Minimal state shape history helpers mutate. */
export type EditorHistoryHost = {
  document: SceneDocument | null;
  historyPast: HistoryEntry[];
  historyFuture: HistoryEntry[];
};

export function isHistoryEntry(x: unknown): x is HistoryEntry {
  if (!x || typeof x !== 'object') return false;
  const kind = (x as HistoryEntry).kind;
  return kind === 'snap' || kind === 'nodes';
}

/** Accept legacy raw-document entries still sitting in session state. */
export function asHistoryEntry(x: unknown): HistoryEntry {
  if (isHistoryEntry(x)) return x;
  return { kind: 'snap', doc: x as SceneDocument };
}

export function cloneNodeForHistory(node: SceneNodeInput): SceneNode {
  if (!node || typeof node !== 'object') {
    return node as SceneNode;
  }
  const attrs = node.attrs;
  return {
    ...(node as SceneNode),
    attrs: attrs && typeof attrs === 'object' ? { ...attrs } : (attrs as SceneNode['attrs']),
    children: Array.isArray(node.children) ? [...node.children] : ((node.children as string[]) || []),
  };
}

/** Rough node payload; `seenPaths` dedupes shared path strings across the stack. */
export function estimateNodeBytes(
  node: SceneNodeInput | null | undefined,
  seenPaths?: Set<string>
): number {
  if (!node) return 0;
  const attrs = node.attrs;
  if (!attrs) return 128;
  const path = attrs.path != null ? String(attrs.path) : '';
  const d = attrs.d != null ? String(attrs.d) : '';
  let n = 192;
  if (path) {
    if (!seenPaths) n += path.length;
    else if (!seenPaths.has(path)) {
      seenPaths.add(path);
      n += path.length;
    }
  }
  if (d && d !== path) {
    if (!seenPaths) n += d.length;
    else if (!seenPaths.has(d)) {
      seenPaths.add(d);
      n += d.length;
    }
  }
  return n;
}

export function estimateDocumentBytes(
  doc: SceneDocument | null | undefined,
  seenPaths?: Set<string>
): number {
  if (!doc?.deltaSetLike) return 0;
  let n = 0;
  for (const id of Object.keys(doc.deltaSetLike)) {
    n += estimateNodeBytes(doc.deltaSetLike[id], seenPaths);
  }
  return n;
}

export function estimateHistoryEntryBytes(entry: unknown, seenPaths?: Set<string>): number {
  const e = asHistoryEntry(entry);
  if (e.kind === 'nodes') {
    let n = 64;
    for (const id of Object.keys(e.before)) {
      n += estimateNodeBytes(e.before[id], seenPaths);
    }
    return n;
  }
  return estimateDocumentBytes(e.doc, seenPaths);
}

/**
 * History snapshot with structural sharing of immutable path strings.
 * Avoids JSON.parse(JSON.stringify) which dominated edit cost at 5k–10k nodes.
 */
export function cloneDocumentForHistory(
  doc: SceneDocument | null | undefined
): SceneDocument | null {
  if (!doc) return null;
  const delta = flattenDeltaSetLike(doc.deltaSetLike || {});
  const nextDelta: Record<string, SceneNode> = {};
  for (const key of Object.keys(delta)) {
    const node = delta[key];
    if (!node || typeof node !== 'object') continue;
    nextDelta[key] = cloneNodeForHistory(node as SceneNode);
  }
  return {
    ...doc,
    frames: Array.isArray(doc.frames)
      ? doc.frames.map((f) => (f && typeof f === 'object' ? { ...f } : f))
      : doc.frames,
    pages: Array.isArray(doc.pages)
      ? doc.pages.map((p) =>
          p && typeof p === 'object'
            ? {
                ...p,
                children: Array.isArray(p.children) ? [...p.children] : p.children,
              }
            : p
        )
      : doc.pages,
    stackOrder: Array.isArray(doc.stackOrder) ? [...doc.stackOrder] : doc.stackOrder,
    deltaSetLike: nextDelta,
  };
}

export function cloneDocument(doc: SceneDocument | null | undefined): SceneDocument | null {
  return cloneDocumentForHistory(doc);
}

export function trimHistoryPast(state: EditorHistoryHost) {
  while (state.historyPast.length > HISTORY_MAX_ENTRIES) state.historyPast.shift();
  const seen = new Set<string>();
  let bytes = 0;
  for (let i = state.historyPast.length - 1; i >= 0; i -= 1) {
    bytes += estimateHistoryEntryBytes(state.historyPast[i], seen);
    if (bytes > HISTORY_MAX_BYTES && i > 0) {
      state.historyPast.splice(0, i);
      break;
    }
  }
}

export function pushHistory(state: EditorHistoryHost) {
  if (!state.document) return;
  const snap = cloneDocument(state.document);
  if (!snap) return;
  state.historyPast.push({ kind: 'snap', doc: snap } satisfies HistorySnap);
  trimHistoryPast(state);
  state.historyFuture = [];
}

/** Patch undo: store only touched nodes (share path strings with live doc). */
export function pushNodePatchHistory(state: EditorHistoryHost, nodeIds: string[]) {
  if (!state.document) return;
  const before: Record<string, SceneNode> = {};
  for (const raw of nodeIds) {
    const id = String(raw || '');
    if (!id) continue;
    const node = state.document.deltaSetLike?.[id];
    if (!node) continue;
    before[id] = cloneNodeForHistory(node);
  }
  if (!Object.keys(before).length) {
    pushHistory(state);
    return;
  }
  state.historyPast.push({ kind: 'nodes', before } satisfies HistoryNodes);
  trimHistoryPast(state);
  state.historyFuture = [];
}

export function restoreNodesIntoDocument(
  doc: SceneDocument,
  nodes: Record<string, SceneNode>
): SceneDocument {
  if (!doc?.deltaSetLike || !nodes) return doc;
  return {
    ...doc,
    deltaSetLike: patchDeltaSetLike(doc.deltaSetLike, nodes),
  };
}

/** Strip nodes from every history entry so Undo cannot revive them. */
export function scrubNodeIdsFromHistory(state: EditorHistoryHost, ids: string[]) {
  if (!ids.length) return;
  const idSet = new Set(ids.map(String));
  const scrub = (raw: HistoryEntry): HistoryEntry => {
    const entry = asHistoryEntry(raw);
    if (entry.kind === 'nodes') {
      let changed = false;
      const before: Record<string, SceneNode> = { ...entry.before };
      for (const id of idSet) {
        if (id in before) {
          delete before[id];
          changed = true;
        }
      }
      return changed ? { kind: 'nodes' as const, before } : entry;
    }
    const doc = entry.doc;
    if (!doc?.deltaSetLike) return entry;
    const hit = ids.some((id) => Boolean(doc.deltaSetLike[id]));
    if (!hit) return entry;
    return {
      kind: 'snap' as const,
      doc: removeNodesFromDocument(doc, [...idSet]) as SceneDocument,
    };
  };
  state.historyPast = state.historyPast.map(scrub);
  state.historyFuture = state.historyFuture.map(scrub);
}
