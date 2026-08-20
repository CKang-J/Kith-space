/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/LottieGeneratorNode/LottieGeneratorOverlay.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useMemo, type ReactNode, memo } from 'react';
import { useSelector } from 'react-redux';
import {
  isLottieGeneratorNode
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import LottieGeneratorCard from '@recombyn-native/components/editor/nodes/LottieGeneratorNode/LottieGeneratorCard';
import { EMPTY_ID_LIST } from '@recombyn-native/store/modules/editor';
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';

export type LottieGenGeomOverride = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * World-layer Lottie Generator composers (same lattice as video/image generators).
 * SVG keeps the hit target; the title row comes from the shared selection label.
 * `geometryOverrides` matches finished Lottie/video so the plate stays glued to chrome
 * while Redux is still on the pre-gesture document.
 */
function LottieGeneratorOverlay({
  document,
  hidden,
  readOnly,
  geometryOverrides = null,
}: {
  document: SceneDocument;
  /** Hide while move / resize / rotate is in progress. */
  hidden?: boolean;
  readOnly?: boolean;
  geometryOverrides?: Record<string, LottieGenGeomOverride> | null;
}): ReactNode {
  const selectedNodeIds: string[] = useSelector(
    (state: any) => (state.editor.selectedNodeIds as string[]) ?? EMPTY_ID_LIST
  );
  const ids = useMemo(() => {
    const children: string[] = document?.deltaSetLike?.ROOT?.children || [];
    return children.filter((id) => isLottieGeneratorNode(document?.deltaSetLike?.[id]));
  }, [document]);

  if (!ids.length) return null;

  return (
    <div
      className={hidden ? 'pointer-events-none invisible' : undefined}
      aria-hidden={hidden || undefined}
    >
      {ids.map((nodeId) => {
        const node = document?.deltaSetLike?.[nodeId];
        if (!node) return null;
        const { left, top } = nodeLeftTop(document, node);
        const ov = geometryOverrides?.[nodeId];
        const width = Math.max(1, ov ? ov.width : Number(node.width) || 1);
        const height = Math.max(1, ov ? ov.height : Number(node.height) || 1);
        return (
          <LottieGeneratorCard
            key={nodeId}
            nodeId={nodeId}
            sceneBox={{
              x: ov ? ov.left : left,
              y: ov ? ov.top : top,
              width,
              height,
            }}
            showComposer={!hidden && selectedNodeIds.length === 1 && selectedNodeIds[0] === nodeId}
            disabled={readOnly}
          />
        );
      })}
    </div>
  );
}

export default memo(LottieGeneratorOverlay);
