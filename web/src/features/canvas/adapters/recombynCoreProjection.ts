import type { Store } from "@reduxjs/toolkit";

export interface CanvasCoreSnapshot {
  id: string;
  title: string;
  document: unknown;
  revisions: { revision: number; document: number };
  sequence: number;
}

export interface CanvasDocumentPatch {
  op: "set" | "remove";
  path: string[];
  value?: unknown;
}

export interface CanvasCoreProjectionPort {
  apply(input: {
    operationId: string;
    expectedRevision: number;
    operation: { type: "document.patch"; patches: CanvasDocumentPatch[] } | { type: "metadata.rename"; title: string };
  }): Promise<CanvasCoreSnapshot>;
  reload(): Promise<CanvasCoreSnapshot>;
  history(kind: "undo" | "redo", operationId: string, expectedRevision: number): Promise<CanvasCoreSnapshot>;
  project(snapshot: CanvasCoreSnapshot): void;
  reportError(error: unknown): void;
}

export interface RecombynCoreProjectionConnection {
  disconnect(): void;
  flush(): void;
  history(kind: "undo" | "redo"): Promise<void>;
  rename(title: string): Promise<void>;
  replaceFromCore(snapshot: CanvasCoreSnapshot): void;
  currentRevision(): number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const same = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => same(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && same(left[key], right[key]));
};

/** Produces node-granular operations for Recombyn scenes; Core remains the only canonical owner. */
export function diffRecombynDocuments(before: unknown, after: unknown): CanvasDocumentPatch[] {
  if (!isRecord(after)) return [];
  if (!isRecord(before)) {
    return Object.entries(after).map(([key, value]) => ({ op: "set", path: [key], value }));
  }
  const patches: CanvasDocumentPatch[] = [];
  const walk = (left: unknown, right: unknown, path: string[]) => {
    if (same(left, right)) return;
    if (isRecord(left) && isRecord(right)) {
      for (const field of new Set([...Object.keys(left), ...Object.keys(right)])) {
        if (!(field in right)) patches.push({ op: "remove", path: [...path, field] });
        else if (!(field in left)) patches.push({ op: "set", path: [...path, field], value: right[field] });
        else walk(left[field], right[field], [...path, field]);
      }
    } else {
      patches.push({ op: "set", path, value: right });
    }
  };
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    // Recombyn's Page state is renderer-only. Kith persists one hidden ROOT and
    // never exposes Page identity through Core, REST, URLs, or Workspace tabs.
    if (key === "pages" || key === "activePageId") continue;
    const previous = before[key];
    const next = after[key];
    if (key === "deltaSetLike" && isRecord(previous) && isRecord(next)) {
      const nodeIds = new Set([...Object.keys(previous), ...Object.keys(next)]);
      for (const nodeId of nodeIds) {
        if (!(nodeId in next)) patches.push({ op: "remove", path: [key, nodeId] });
        else if (!(nodeId in previous)) {
          patches.push({ op: "set", path: [key, nodeId], value: next[nodeId] });
        } else if (!same(previous[nodeId], next[nodeId])) {
          walk(previous[nodeId], next[nodeId], [key, nodeId]);
        }
      }
      continue;
    }
    if (key === "frames" && Array.isArray(previous) && Array.isArray(next)) {
      const previousIds = previous.map((frame) => isRecord(frame) && typeof frame.id === "string" ? frame.id : null);
      const nextIds = next.map((frame) => isRecord(frame) && typeof frame.id === "string" ? frame.id : null);
      if (previousIds.every((id): id is string => id !== null)
        && nextIds.every((id): id is string => id !== null)
        && new Set(previousIds).size === previousIds.length
        && same(previousIds, nextIds)) {
        for (let index = 0; index < previous.length; index += 1) {
          walk(previous[index], next[index], ["frames", `frame:${previousIds[index]}`]);
        }
        continue;
      }
    }
    if (!(key in after)) patches.push({ op: "remove", path: [key] });
    else if (!(key in before) || !same(previous, next)) patches.push({ op: "set", path: [key], value: next });
  }
  return patches;
}

export function connectRecombynCoreProjection(
  store: Store,
  initial: CanvasCoreSnapshot,
  port: CanvasCoreProjectionPort,
  options: { settleDelayMs?: number; interactionActive?: () => boolean } = {},
): RecombynCoreProjectionConnection {
  let projected = structuredClone(initial.document);
  let revision = initial.revisions.revision;
  let queuedRevision = revision;
  let generation = 0;
  let closed = false;
  let suppressProjection = false;
  let queue = Promise.resolve();
  let canonical = { ...initial, document: structuredClone(initial.document) };
  let pendingMutations = 0;
  let recoveriesInFlight = 0;
  let detached = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let scheduledDocument: unknown | null = null;
  let scheduledBaseDocument: unknown | null = null;
  let queuedDocument = structuredClone(initial.document);
  const report = (error: unknown) => {
    try { port.reportError(error); } catch { /* diagnostics must not poison the mutation queue */ }
  };
  const projectSnapshot = (snapshot: CanvasCoreSnapshot, preserveQueuedRevision = false, updateRenderer = true) => {
    canonical = { ...snapshot, document: structuredClone(snapshot.document) };
    revision = snapshot.revisions.revision;
    queuedRevision = preserveQueuedRevision ? Math.max(queuedRevision, revision) : revision;
    queuedDocument = structuredClone(snapshot.document);
    if (!updateRenderer || detached) return;
    projected = structuredClone(snapshot.document);
    suppressProjection = true;
    try { port.project(snapshot); } finally { suppressProjection = false; }
  };
  const recover = async (error: unknown, failedGeneration: number) => {
    if (closed || failedGeneration !== generation) return;
    const recoveryGeneration = ++generation;
    queuedRevision = revision;
    report(error);
    recoveriesInFlight += 1;
    try {
      const snapshot = await port.reload();
      if (closed || recoveryGeneration !== generation) return;
      projectSnapshot(snapshot);
    } catch (reloadError) {
      if (closed || recoveryGeneration !== generation) return;
      report(reloadError);
      projectSnapshot(canonical);
    } finally {
      recoveriesInFlight -= 1;
    }
  };
  const enqueueDocument = (base: unknown, next: unknown) => {
    const patches = diffRecombynDocuments(base, next);
    queuedDocument = structuredClone(next);
    if (patches.length === 0) {
      pendingMutations -= 1;
      return;
    }
    const baseRevision = queuedRevision;
    const operationGeneration = generation;
    queuedRevision += 1;
    queue = queue.then(async () => {
      try {
        if (operationGeneration !== generation) return;
        const snapshot = await port.apply({
          operationId: crypto.randomUUID(),
          expectedRevision: baseRevision,
          operation: { type: "document.patch", patches },
        });
        if (closed || operationGeneration !== generation) return;
        projectSnapshot(snapshot, true, pendingMutations === 1);
      } catch (error) {
        await recover(error, operationGeneration);
      } finally {
        pendingMutations -= 1;
      }
    }).catch(report);
  };
  const flushScheduled = () => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
    const next = scheduledDocument;
    const base = scheduledBaseDocument;
    scheduledDocument = null;
    scheduledBaseDocument = null;
    if (next !== null && base !== null) enqueueDocument(base, next);
  };
  const unsubscribe = store.subscribe(() => {
    if (closed || suppressProjection) return;
    const next = (store.getState() as { editor?: { document?: unknown } }).editor?.document;
    if (next === undefined || same(projected, next)) return;
    if (scheduledDocument === null) {
      pendingMutations += 1;
      scheduledBaseDocument = structuredClone(projected);
    }
    projected = structuredClone(next);
    scheduledDocument = structuredClone(next);
    if (settleTimer !== null) clearTimeout(settleTimer);
    if (options.interactionActive?.()) return;
    settleTimer = setTimeout(flushScheduled, options.settleDelayMs ?? 0);
  });
  return {
    flush: flushScheduled,
    disconnect() {
      detached = true;
      unsubscribe();
      flushScheduled();
      void queue.finally(() => { closed = true; });
    },
    async history(kind) {
      flushScheduled();
      const operationGeneration = generation;
      const baseRevision = queuedRevision;
      queuedRevision += 1;
      pendingMutations += 1;
      queue = queue.then(async () => {
        try {
          if (closed || operationGeneration !== generation) return;
          const snapshot = await port.history(kind, crypto.randomUUID(), baseRevision);
          if (closed || operationGeneration !== generation) return;
          projectSnapshot(snapshot, true);
        } catch (error) {
          await recover(error, operationGeneration);
        } finally {
          pendingMutations -= 1;
        }
      }).catch(report);
      await queue;
    },
    async rename(title) {
      flushScheduled();
      const operationGeneration = generation;
      const baseRevision = queuedRevision;
      queuedRevision += 1;
      pendingMutations += 1;
      queue = queue.then(async () => {
        try {
          if (closed || operationGeneration !== generation) return;
          const snapshot = await port.apply({
            operationId: crypto.randomUUID(),
            expectedRevision: baseRevision,
            operation: { type: "metadata.rename", title },
          });
          if (closed || operationGeneration !== generation) return;
          projectSnapshot(snapshot, true, pendingMutations === 1);
        } catch (error) {
          await recover(error, operationGeneration);
        } finally {
          pendingMutations -= 1;
        }
      }).catch(report);
      await queue;
    },
    replaceFromCore(snapshot) {
      if (pendingMutations > 0 && recoveriesInFlight === 0) {
        if (snapshot.sequence >= canonical.sequence) {
          canonical = { ...snapshot, document: structuredClone(snapshot.document) };
        }
        return;
      }
      generation += 1;
      projectSnapshot(snapshot);
    },
    currentRevision() { return revision; },
  };
}
