/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ImageNode/ImageProcessOverlay.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useMemo, type CSSProperties, type ReactNode, memo } from 'react';
import { useRcbCamera, rcbCameraCssZoom } from '@recombyn-native/components/rcb';
import { radiiFromAttrs } from '@recombyn-native/components/rcb/scene/document/sceneRadii';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

const PILL_BOTTOM_PAD_PX = 14;

function readNodeAngle(node: SceneNodeInput) {
  const n = Number(node?.attrs?.angle);
  return Number.isFinite(n) ? n : 0;
}

function useProcessWorldBox(document: SceneDocument, node: SceneNodeInput) {
  const camera = useRcbCamera();
  const { left, top } = nodeLeftTop(document, node);
  const width = Math.max(1, Number(node.width) || 1);
  const height = Math.max(1, Number(node.height) || 1);
  const z = rcbCameraCssZoom(camera);
  const inv = 1 / z;
  const radii = radiiFromAttrs(node.attrs || {});
  const angle = readNodeAngle(node);
  return {
    left,
    top,
    width,
    height,
    z,
    inv,
    angle,
    // Radii stay in scene units (shell is under camera scale).
    borderRadius: `${radii.tl}px ${radii.tr}px ${radii.br}px ${radii.bl}px`,
  };
}

/** Shimmer plate + status pill on the world layer (same lattice as the control box). */
function ProcessNodeChrome({
  nodeId,
  node,
  document,
}: {
  nodeId: string;
  node: SceneNodeInput;
  document: SceneDocument;
}): ReactNode {
  const { left, top, width, height, inv, borderRadius, angle } = useProcessWorldBox(
    document,
    node
  );
  const label = String(node.attrs?.processLabel || '处理中');

  const frameStyle = useMemo((): CSSProperties => {
    const style: CSSProperties = {
      position: 'absolute',
      left,
      top,
      width,
      height,
    };
    if (Math.abs(angle) > 0.001) {
      style.transform = `rotate(${angle}deg)`;
      style.transformOrigin = 'center center';
    }
    return style;
  }, [left, top, width, height, angle]);

  const shimmerStyle = useMemo(
    (): CSSProperties => ({
      position: 'absolute',
      inset: 0,
      borderRadius,
    }),
    [borderRadius]
  );

  // Counter-scale the pill so typography stays screen-constant under camera zoom.
  const pillStyle = useMemo(
    (): CSSProperties => ({
      position: 'absolute',
      left: '50%',
      top: height - PILL_BOTTOM_PAD_PX * inv,
      transform: `translate(-50%, -100%) scale(${inv})`,
      transformOrigin: 'center bottom',
    }),
    [height, inv]
  );

  return (
    <div
      data-scene-node-id={nodeId}
      className="pointer-events-none absolute z-[1]"
      style={frameStyle}
    >
      <div
        data-image-process-shimmer
        className="rcb-image-process-shimmer absolute inset-0 overflow-hidden"
        style={shimmerStyle}
        aria-hidden
      />
      <div
        data-image-process-label
        className="absolute z-[1] whitespace-nowrap rounded-full bg-[rgba(55,55,55,0.72)] px-2.5 py-1 text-[11px] font-medium leading-none text-white shadow-[0_2px_8px_rgba(15,23,42,0.18)]"
        style={pillStyle}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * World-layer shimmer + status pills for image / video / lottie process jobs.
 * Same positioning contract as selection chrome — no unscaled overlay portal.
 */
function ImageProcessOverlay({
  document,
  hidden,
}: {
  document: SceneDocument;
  /** Hide while move / resize / rotate is in progress. */
  hidden?: boolean;
}): ReactNode {
  const ids = useMemo(() => {
    const children: string[] = document?.deltaSetLike?.ROOT?.children || [];
    return children.filter((id) => {
      const node = document?.deltaSetLike?.[id];
      if (node?.key !== 'image' && node?.key !== 'video' && node?.key !== 'lottie') {
        return false;
      }
      // Include generator plates while generating (same sweep as process jobs).
      return String(node.attrs?.processStatus || '') === 'running';
    });
  }, [document]);

  if (hidden || !ids.length) return null;

  return (
    <>
      {ids.map((id) => {
        const node = document.deltaSetLike[id];
        if (!node) return null;
        return <ProcessNodeChrome key={id} nodeId={id} node={node} document={document} />;
      })}
    </>
  );
}

export default memo(ImageProcessOverlay);
