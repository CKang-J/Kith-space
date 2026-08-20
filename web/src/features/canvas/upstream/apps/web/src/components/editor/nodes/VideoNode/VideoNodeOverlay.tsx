/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/VideoNode/VideoNodeOverlay.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
  memo,
} from 'react';
import { useSelector } from 'react-redux';
import { useRcbCamera } from '@recombyn-native/components/rcb';
import {
  isNodeHidden,
  isVideoNode
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import { radiiFromAttrs } from '@recombyn-native/components/rcb/scene/document/sceneRadii';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import { useHtmlMediaMount } from '@recombyn-native/components/editor/nodes/useHtmlMediaMount';
import VideoHoverPlayback from './VideoHoverPlayback';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

export type VideoGeomOverride = {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Live rotate preview — omit to use document attrs.angle. */
  angle?: number;
};

function readOptionalNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function readNodeAngle(node: SceneNodeInput) {
  const n = Number(node?.attrs?.angle);
  return Number.isFinite(n) ? n : 0;
}

function plateTransform(angle: number) {
  if (Math.abs(angle) > 0.001) return `rotate(${angle}deg)`;
  return undefined;
}

/** Pan must not re-render every video plate — only push zoom when it changes. */
function VideoZoomSync({ onZoom }: { onZoom: (zoom: number) => void }) {
  const zoom = useRcbCamera().zoom;
  useEffect(() => {
    onZoom(Math.max(0.05, zoom || 1));
  }, [zoom, onZoom]);
  return null;
}

/**
 * Idle = freeze-frame / HTML <video> portaled into the SVG foreignObject mount.
 * Stays mounted during move/resize — FO is inside the SVG group that
 * `previewSvgNodeGeometry` transforms (same as audio). `geometryOverrides`
 * keeps plate width/height/angle chrome in sync while Redux is still pre-gesture.
 */
function VideoNodeOverlay({
  document,
  hidden,
  geometryOverrides = null,
}: {
  document: SceneDocument;
  hidden?: boolean;
  /** Live drag/resize/rotate boxes — same scene space as selection chrome. */
  geometryOverrides?: Record<string, VideoGeomOverride> | null;
}): ReactNode {
  const [zoom, setZoom] = useState(1);
  const onZoom = useCallback((z: number) => {
    setZoom((prev) => (Math.abs(prev - z) < 1e-6 ? prev : z));
  }, []);
  const videoToolPanel = useSelector(
    (state: any) => state.editor.videoToolPanel as null | { nodeId: string; kind: string }
  );
  const imageToolPanel = useSelector(
    (state: any) => state.editor.imageToolPanel as null | { nodeId: string; kind: string }
  );
  const ids = useMemo(() => {
    const children: string[] = document?.deltaSetLike?.ROOT?.children || [];
    return children.filter((id) => {
      const node = document?.deltaSetLike?.[id];
      if (!isVideoNode(node)) return false;
      return Boolean(String(node?.attrs?.src || '').trim());
    });
  }, [document]);

  if (!ids.length) return null;

  return (
    <>
      <VideoZoomSync onZoom={onZoom} />
      {ids.map((nodeId) => (
        <VideoPlateHost
          key={nodeId}
          nodeId={nodeId}
          document={document}
          zoom={zoom}
          hidden={hidden}
          geometryOverrides={geometryOverrides}
          videoToolPanel={videoToolPanel}
          imageToolPanel={imageToolPanel}
        />
      ))}
    </>
  );
}

function VideoPlateHost({
  nodeId,
  document,
  zoom,
  hidden,
  geometryOverrides,
  videoToolPanel,
  imageToolPanel,
}: {
  nodeId: string;
  document: SceneDocument;
  zoom: number;
  hidden?: boolean;
  geometryOverrides?: Record<string, VideoGeomOverride> | null;
  videoToolPanel: null | { nodeId: string; kind: string };
  imageToolPanel: null | { nodeId: string; kind: string };
}) {
  const mount = useHtmlMediaMount(nodeId);
  const node = document?.deltaSetLike?.[nodeId];
  if (!node) return null;
  const src = String(node.attrs?.src || '').trim();
  if (!src) return null;
  const trimOpen = videoToolPanel?.nodeId === nodeId;
  const cropSession = imageToolPanel?.nodeId === nodeId && imageToolPanel.kind === 'crop';
  const layerHidden = isNodeHidden(node);
  const { left, top } = nodeLeftTop(document, node);
  const ov = geometryOverrides?.[nodeId];
  const width = Math.max(1, ov ? ov.width : Number(node.width) || 1);
  const height = Math.max(1, ov ? ov.height : Number(node.height) || 1);
  const angle = ov && Number.isFinite(ov.angle) ? Number(ov.angle) : readNodeAngle(node);
  const radii = radiiFromAttrs(node.attrs || {});
  const scenePlate: CSSProperties & {
    left: number;
    top: number;
    width: number;
    height: number;
  } = {
    left: ov ? ov.left : left,
    top: ov ? ov.top : top,
    width,
    height,
    borderRadius: `${radii.tl}px ${radii.tr}px ${radii.br}px ${radii.bl}px`,
    transform: plateTransform(angle),
    transformOrigin: 'center center',
  };
  return (
    <VideoHoverPlayback
      nodeId={nodeId}
      scenePlate={scenePlate}
      zoom={zoom}
      svgMount={mount}
      src={src}
      poster={String(node.attrs?.poster || '').trim() || undefined}
      uploadKey={String(node.attrs?.uploadKey || node.attrs?.key || '').trim() || null}
      hidden={Boolean(hidden) || trimOpen || layerHidden || cropSession}
      trimStart={readOptionalNumber(node.attrs?.trimStart)}
      trimEnd={readOptionalNumber(node.attrs?.trimEnd)}
      knownDuration={readOptionalNumber(node.attrs?.duration)}
      flipX={node.attrs?.flipX === true || node.attrs?.flipX === 'true'}
      flipY={node.attrs?.flipY === true || node.attrs?.flipY === 'true'}
      cropX={readOptionalNumber(node.attrs?.cropX)}
      cropY={readOptionalNumber(node.attrs?.cropY)}
      cropW={readOptionalNumber(node.attrs?.cropW)}
      cropH={readOptionalNumber(node.attrs?.cropH)}
    />
  );
}

export default memo(VideoNodeOverlay);
