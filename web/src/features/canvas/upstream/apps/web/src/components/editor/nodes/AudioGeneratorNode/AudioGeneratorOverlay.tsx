/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/AudioGeneratorNode/AudioGeneratorOverlay.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useMemo, type ReactNode, memo } from 'react';
import { useSelector } from 'react-redux';
import {
  isAudioGeneratorNode
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import AudioGeneratorCard from '@recombyn-native/components/editor/nodes/AudioGeneratorNode/AudioGeneratorCard';
import { EMPTY_ID_LIST } from '@recombyn-native/store/modules/editor';
import type { SceneDocument } from '@recombyn-native/components/rcb/sceneNode';

/**
 * World-layer Audio Generator composers (same lattice as video / Lottie generators).
 */
function AudioGeneratorOverlay({
  document,
  hidden,
  readOnly,
}: {
  document: SceneDocument;
  /** Hide while move / resize / rotate is in progress. */
  hidden?: boolean;
  readOnly?: boolean;
}): ReactNode {
  const selectedNodeIds: string[] = useSelector(
    (state: any) => (state.editor.selectedNodeIds as string[]) ?? EMPTY_ID_LIST
  );
  const ids = useMemo(() => {
    const children: string[] = document?.deltaSetLike?.ROOT?.children || [];
    return children.filter((id) => isAudioGeneratorNode(document?.deltaSetLike?.[id]));
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
        const width = Math.max(1, Number(node.width) || 1);
        const height = Math.max(1, Number(node.height) || 1);
        return (
          <AudioGeneratorCard
            key={nodeId}
            nodeId={nodeId}
            sceneBox={{ x: left, y: top, width, height }}
            showComposer={
              !hidden && selectedNodeIds.length === 1 && selectedNodeIds[0] === nodeId
            }
            disabled={readOnly}
          />
        );
      })}
    </div>
  );
}

export default memo(AudioGeneratorOverlay);
