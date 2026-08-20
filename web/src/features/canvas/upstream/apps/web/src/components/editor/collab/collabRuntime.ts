/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/collab/collabRuntime.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Process-wide collab flag + Y.UndoManager bridge.
 * Cloud sync pauses while active; SvgCanvas routes Ctrl+Z/Y here.
 */

import type * as Y from 'yjs';

let active = false;
/** True when Y room is seeded and this client may debounce-PUT the project doc. */
let cloudPersistOwned = false;
let viewOnly = false;
let undoManager: Y.UndoManager | null = null;
let undoEpoch = 0;
const undoListeners = new Set<() => void>();
let viewEpoch = 0;
const viewListeners = new Set<() => void>();

function bumpViewListeners() {
  viewEpoch += 1;
  viewListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

function bumpUndoListeners() {
  undoEpoch += 1;
  undoListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

export function setCollabActive(next: boolean) {
  active = Boolean(next);
  if (!active) {
    cloudPersistOwned = false;
    bindCollabUndoManager(null);
    setCollabViewOnly(false);
  }
}

export function isCollabActive() {
  return active;
}

/**
 * When true, CollabRoomProvider owns cloud document writes — useProjectCloudSync
 * must not also PATCH/PUT the scene (cover-only is still ok).
 * False while connecting / seed pending / view-only / connect failed.
 */
export function setCollabCloudPersistOwned(next: boolean) {
  cloudPersistOwned = Boolean(next) && active;
}

export function isCollabCloudPersistOwned() {
  return Boolean(active && cloudPersistOwned);
}

export function setCollabViewOnly(next: boolean) {
  const v = Boolean(next);
  if (viewOnly === v) return;
  viewOnly = v;
  bumpViewListeners();
}

export function isCollabViewOnly() {
  return Boolean(active && viewOnly);
}

export function getCollabViewEpoch() {
  return viewEpoch;
}

export function subscribeCollabView(listener: () => void) {
  viewListeners.add(listener);
  return () => {
    viewListeners.delete(listener);
  };
}

export function bindCollabUndoManager(next: Y.UndoManager | null) {
  if (undoManager === next) return;
  if (undoManager) {
    try {
      undoManager.off('stack-item-added', bumpUndoListeners);
      undoManager.off('stack-item-updated', bumpUndoListeners);
      undoManager.off('stack-item-popped', bumpUndoListeners);
      undoManager.off('stack-cleared', bumpUndoListeners);
    } catch {
      /* ignore */
    }
  }
  undoManager = next;
  if (undoManager) {
    undoManager.on('stack-item-added', bumpUndoListeners);
    undoManager.on('stack-item-updated', bumpUndoListeners);
    undoManager.on('stack-item-popped', bumpUndoListeners);
    undoManager.on('stack-cleared', bumpUndoListeners);
  }
  bumpUndoListeners();
}

export function clearCollabUndoStack() {
  try {
    undoManager?.clear();
  } catch {
    /* ignore */
  }
  bumpUndoListeners();
}

/** @returns true when collab handled the gesture (caller should skip Redux history). */
export function collabUndo(): boolean {
  if (!active || viewOnly || !undoManager) return false;
  if (!undoManager.canUndo()) return false;
  undoManager.undo();
  return true;
}

/** @returns true when collab handled the gesture. */
export function collabRedo(): boolean {
  if (!active || viewOnly || !undoManager) return false;
  if (!undoManager.canRedo()) return false;
  undoManager.redo();
  return true;
}

export function canCollabUndo() {
  return Boolean(active && !viewOnly && undoManager?.canUndo());
}

export function canCollabRedo() {
  return Boolean(active && !viewOnly && undoManager?.canRedo());
}

export function getCollabUndoEpoch() {
  return undoEpoch;
}

export function subscribeCollabUndo(listener: () => void) {
  undoListeners.add(listener);
  return () => {
    undoListeners.delete(listener);
  };
}
