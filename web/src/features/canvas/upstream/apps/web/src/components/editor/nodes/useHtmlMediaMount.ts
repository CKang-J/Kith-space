/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/useHtmlMediaMount.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Resolve the foreignObject HTML mount painted into a scene node’s SVG layer.
 * Lottie / video / audio portal here so CSS z-index is not a parallel stack.
 */
import { useMemo, useSyncExternalStore } from 'react';
import {
  getShapeHostEpoch,
  subscribeShapeHosts,
} from '@recombyn-native/components/rcb/shapes/shapeHostRegistry';
import { findHtmlMediaMount } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';

export function useHtmlMediaMount(nodeId: string): HTMLElement | null {
  const epoch = useSyncExternalStore(subscribeShapeHosts, getShapeHostEpoch, () => 0);
  return useMemo(() => findHtmlMediaMount(nodeId), [nodeId, epoch]);
}
