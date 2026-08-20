/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/canvas/attachPick.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  canAttachNodeToChat
} from '@recombyn-native/components/rcb/scene/document/mediaLifecycle';
import {
  expandSelectionWithGroups,
  readNodeGroupId
} from '@recombyn-native/components/rcb/scene/document/sceneGroups';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';

/** Near-full-bleed rect covering an artboard — treat click as frame select. */
export function frameForFullBleedPlate(doc: SceneDocument, nodeId: string): { id: string } | null {
  const node = doc?.deltaSetLike?.[nodeId];
  if (!node || node.key !== 'shape') return null;
  const shapeType = String(node.attrs?.shapeType || 'rect');
  if (shapeType !== 'rect') return null;
  const frames = Array.isArray(doc?.frames) ? doc.frames : [];
  if (!frames.length) return null;
  const { left, top } = nodeLeftTop(doc, node);
  const w = Math.max(1, Number(node.width) || 1);
  const h = Math.max(1, Number(node.height) || 1);
  const area = w * h;
  for (const f of frames) {
    if (!f?.id) continue;
    const fx = Number(f.x) || 0;
    const fy = Number(f.y) || 0;
    const fw = Math.max(1, Number(f.width) || 1);
    const fh = Math.max(1, Number(f.height) || 1);
    const frameArea = fw * fh;
    const ow = Math.max(0, Math.min(left + w, fx + fw) - Math.max(left, fx));
    const oh = Math.max(0, Math.min(top + h, fy + fh) - Math.max(top, fy));
    const overlap = ow * oh;
    if (overlap >= frameArea * 0.9 && area >= frameArea * 0.85) {
      return { id: String(f.id) };
    }
  }
  return null;
}

/** Drop generator plates + process-shimmer (+ videos when images-only) from attach targets. */
export function filterChatAttachNodeIds(
  doc: SceneDocument,
  ids: string[],
  opts?: { imagesOnly?: boolean }
): string[] {
  const delta = doc?.deltaSetLike || {};
  return ids.filter((id) => canAttachNodeToChat(delta[id], opts));
}

/** Prefer live selection; fall back to the node under the context menu. */
export function ctxMenuSeedNodeIds(selectedIds: string[], menuNodeId?: string | null): string[] {
  if (selectedIds.length) return selectedIds;
  if (menuNodeId) return [menuNodeId];
  return [];
}

/** Prefer live artboard selection; fall back to the frame under the context menu. */
export function ctxMenuSeedFrameIds(selectedFrameIds: string[], menuFrameId?: string | null): string[] {
  if (selectedFrameIds.length) return selectedFrameIds;
  if (menuFrameId) return [menuFrameId];
  return [];
}

export type AttachPickOpts = { imagesOnly?: boolean };

/** Resolve a pick click into an attach payload, or null if empty / only blocked nodes. */
export function resolveAttachPickPayload(
  doc: SceneDocument,
  nodeIds: string[],
  frameId?: string | null,
  opts?: AttachPickOpts
): { payload: string | string[]; blockedOnly: boolean } | null {
  const raw = (nodeIds || []).filter(Boolean);
  // Ungrouped media: attach that file alone. Grouped members expand to the whole 编组
  // so the composer can attach one composite (not peel siblings into separate thumbs).
  if (raw.length === 1) {
    const hitId = raw[0]!;
    const hit = doc?.deltaSetLike?.[hitId];
    if (!readNodeGroupId(hit)) {
      const src = String(hit?.attrs?.src || '').trim();
      const mediaKey = hit?.key === 'video' || hit?.key === 'image';
      if (
        mediaKey &&
        src &&
        canAttachNodeToChat(hit, opts) &&
        !(opts?.imagesOnly && hit?.key === 'video')
      ) {
        return { payload: hitId, blockedOnly: false };
      }
    }
  }
  const seed = expandSelectionWithGroups(doc, raw);
  const attachable = filterChatAttachNodeIds(doc, seed, opts);
  if (attachable.length) {
    return {
      payload: attachable.length === 1 ? attachable[0]! : attachable,
      blockedOnly: false,
    };
  }
  if (seed.length) return { payload: '', blockedOnly: true };
  const fid = String(frameId || '').trim();
  if (fid) return { payload: `frame:${fid}`, blockedOnly: false };
  return null;
}

export function attachPickFilterOpts(
  pick: null | { target: string; accept?: 'image' | 'media' }
): AttachPickOpts | undefined {
  return pick?.accept === 'image' ? { imagesOnly: true } : undefined;
}
