/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/core/spatialIndex.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';
/**
 * Uniform-grid spatial index for scene AABBs (culling + hit candidate filter).
 * Dependency-free for the rcb core.
 */

import { nodeLeftTop } from '../scene/paint/sceneToSvg';

export type RcbSpatialItem = {
  id: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function cellKey(cx: number, cy: number) {
  return `${cx},${cy}`;
}

export class RcbSpatialIndex {
  private readonly cellSize: number;
  private readonly cells = new Map<string, RcbSpatialItem[]>();
  private readonly byId = new Map<string, RcbSpatialItem>();

  constructor(cellSize = 256) {
    this.cellSize = Math.max(32, cellSize);
  }

  get size() {
    return this.byId.size;
  }

  has(id: string) {
    return this.byId.has(id);
  }

  /** Indexed ids (unordered). Prefer for membership sync — not a cull hot path. */
  ids(): IterableIterator<string> {
    return this.byId.keys();
  }

  clear() {
    this.cells.clear();
    this.byId.clear();
  }

  upsert(item: RcbSpatialItem) {
    if (this.byId.has(item.id)) this.remove(item.id);
    this.byId.set(item.id, item);
    for (const key of this.keysFor(item)) {
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(item);
      else this.cells.set(key, [item]);
    }
  }

  remove(id: string) {
    const prev = this.byId.get(id);
    if (!prev) return;
    this.byId.delete(id);
    for (const key of this.keysFor(prev)) {
      const bucket = this.cells.get(key);
      if (!bucket) continue;
      const next = bucket.filter((x) => x.id !== id);
      if (next.length) this.cells.set(key, next);
      else this.cells.delete(key);
    }
  }

  /** All items whose AABB intersects the query rect. */
  search(minX: number, minY: number, maxX: number, maxY: number): RcbSpatialItem[] {
    const out: RcbSpatialItem[] = [];
    const seen = new Set<string>();
    const x0 = Math.floor(minX / this.cellSize);
    const y0 = Math.floor(minY / this.cellSize);
    const x1 = Math.floor(maxX / this.cellSize);
    const y1 = Math.floor(maxY / this.cellSize);
    for (let cy = y0; cy <= y1; cy += 1) {
      for (let cx = x0; cx <= x1; cx += 1) {
        const bucket = this.cells.get(cellKey(cx, cy));
        if (!bucket) continue;
        for (const item of bucket) {
          if (seen.has(item.id)) continue;
          if (
            item.maxX < minX ||
            item.minX > maxX ||
            item.maxY < minY ||
            item.minY > maxY
          ) {
            continue;
          }
          seen.add(item.id);
          out.push(item);
        }
      }
    }
    return out;
  }

  searchPoint(x: number, y: number, pad = 0): RcbSpatialItem[] {
    return this.search(x - pad, y - pad, x + pad, y + pad);
  }

  private keysFor(item: RcbSpatialItem): string[] {
    const x0 = Math.floor(item.minX / this.cellSize);
    const y0 = Math.floor(item.minY / this.cellSize);
    const x1 = Math.floor(item.maxX / this.cellSize);
    const y1 = Math.floor(item.maxY / this.cellSize);
    const keys: string[] = [];
    for (let cy = y0; cy <= y1; cy += 1) {
      for (let cx = x0; cx <= x1; cx += 1) {
        keys.push(cellKey(cx, cy));
      }
    }
    return keys;
  }
}

export function boxesIntersect(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number }
) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

/** Bottom→top rank from ROOT/page children (O(N) once per id-list change). */
export function buildIdRankMap(ids: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 1) m.set(ids[i], i);
  return m;
}

/**
 * Order candidate ids by document rank without scanning the full id list.
 * ascending = bottom→top (paint / cull); descending = top→bottom (hit-test).
 */
export function sortIdsByRank(
  ids: Iterable<string>,
  rank: Map<string, number>,
  opts?: { ascending?: boolean }
): string[] {
  const ascending = opts?.ascending !== false;
  const out = Array.from(ids);
  out.sort((a, b) => {
    const ra = rank.get(a) ?? -1;
    const rb = rank.get(b) ?? -1;
    return ascending ? ra - rb : rb - ra;
  });
  return out;
}

/** Axis AABB in scene space (rotation-expanded). Optional pad for stroke / hit slack. */
export function nodeSceneAabb(
  document: SceneDocument,
  nodeId: string,
  pad = 0
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const node = document?.deltaSetLike?.[nodeId];
  if (!node) return null;
  const { left: x0, top: y0 } = nodeLeftTop(document, node);
  const w = Math.max(1, Number(node.width) || 1);
  const h = Math.max(1, Number(node.height) || 1);
  const angle = Number(node.attrs?.angle) || 0;
  let minX = x0;
  let minY = y0;
  let maxX = x0 + w;
  let maxY = y0 + h;
  if (Math.abs(angle) > 0.5) {
    const rad = (Math.abs(angle) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const bw = w * cos + h * sin;
    const bh = w * sin + h * cos;
    const cx = x0 + w / 2;
    const cy = y0 + h / 2;
    minX = cx - bw / 2;
    minY = cy - bh / 2;
    maxX = cx + bw / 2;
    maxY = cy + bh / 2;
  }
  const stroke = Math.max(
    0,
    Number(node.attrs?.borderWidth ?? node.attrs?.['border-width'] ?? node.attrs?.strokeWidth ?? 0) ||
      0
  );
  const expand = pad + stroke;
  return {
    minX: minX - expand,
    minY: minY - expand,
    maxX: maxX + expand,
    maxY: maxY + expand,
  };
}

/** Prefer spatial candidates once the scene reaches this many root ids. */
export const SCENE_SPATIAL_LARGE_THRESHOLD = 48;

export type SceneSpatialSyncInput = {
  document: SceneDocument;
  /** Prefer the live ROOT/page children array (identity used for membership). */
  childrenIds: readonly string[];
  reloadToken: number | string;
  patchedNodeIds?: readonly string[];
  /** Extra AABB pad in scene units (stroke handled inside nodeSceneAabb). */
  aabbPad?: number;
};

/**
 * Owns spatial index + id rank for cull / hit / marquee.
 * Full rebuild on reloadToken; membership only when children identity changes;
 * geometry refresh via patchedNodeIds — never O(N) AABB rebuild on size drift.
 */
export class SceneSpatialRuntime {
  readonly index: RcbSpatialIndex;
  private reloadToken: number | string | null = null;
  private childrenRef: readonly string[] | null = null;
  private rank = new Map<string, number>();

  constructor(cellSize = 256) {
    this.index = new RcbSpatialIndex(cellSize);
  }

  get size() {
    return this.index.size;
  }

  get idRank(): ReadonlyMap<string, number> {
    return this.rank;
  }

  clear() {
    this.index.clear();
    this.reloadToken = null;
    this.childrenRef = null;
    this.rank = new Map();
  }

  sync(input: SceneSpatialSyncInput): RcbSpatialIndex {
    const doc = input.document;
    if (!doc) {
      this.clear();
      return this.index;
    }
    const childrenSrc = input.childrenIds;
    const pad = input.aabbPad ?? 32;
    const patched = input.patchedNodeIds || [];

    const tokenChanged = this.reloadToken !== input.reloadToken;
    const childrenChanged = this.childrenRef !== childrenSrc;
    if (tokenChanged || childrenChanged || this.index.size === 0) {
      this.rank = buildIdRankMap(childrenSrc);
      this.childrenRef = childrenSrc;
    }

    if (tokenChanged || this.index.size === 0) {
      this.index.clear();
      for (const id of childrenSrc) {
        const box = nodeSceneAabb(doc, id, pad);
        if (!box) continue;
        this.index.upsert({ id, ...box });
      }
      this.reloadToken = input.reloadToken;
      return this.index;
    }

    if (childrenChanged) {
      const idSet = new Set(childrenSrc);
      for (const id of [...this.index.ids()]) {
        if (!idSet.has(id)) this.index.remove(id);
      }
      for (const id of childrenSrc) {
        if (this.index.has(id)) continue;
        const box = nodeSceneAabb(doc, id, pad);
        if (box) this.index.upsert({ id, ...box });
      }
    }

    for (const raw of patched) {
      const id = String(raw);
      if (!doc.deltaSetLike?.[id]) {
        this.index.remove(id);
        continue;
      }
      const box = nodeSceneAabb(doc, id, pad);
      if (!box) this.index.remove(id);
      else this.index.upsert({ id, ...box });
    }
    return this.index;
  }

  /** Bottom→top ids intersecting rect (rank-sorted hits only). */
  queryIdsInRect(
    box: { left: number; top: number; width: number; height: number },
    opts?: { ascending?: boolean }
  ): string[] {
    const hits = this.index.search(
      box.left,
      box.top,
      box.left + box.width,
      box.top + box.height
    );
    if (!hits.length) return [];
    return sortIdsByRank(
      hits.map((h) => h.id),
      this.rank,
      { ascending: opts?.ascending !== false }
    );
  }

  /**
   * Top→bottom hit-test order. Large warm scenes: spatial pad only (no full-list filter).
   * Cold index falls back to reversing allIds; warm empty pad → [].
   */
  hitCandidateIds(opts: {
    x: number;
    y: number;
    pad: number;
    allIds: readonly string[];
    largeThreshold?: number;
  }): string[] {
    const threshold = opts.largeThreshold ?? SCENE_SPATIAL_LARGE_THRESHOLD;
    const { allIds, x, y, pad } = opts;
    if (allIds.length < threshold) {
      return [...allIds].reverse();
    }
    const nearby = this.index.searchPoint(x, y, pad);
    if (nearby.length) {
      return sortIdsByRank(
        nearby.map((n) => n.id),
        this.rank,
        { ascending: false }
      );
    }
    if (this.index.size === 0) return [...allIds].reverse();
    return [];
  }
}
