/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/frames/HtmlArtboardFrame.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/** Artboard: SVG plate + world-layer title / process chrome. */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  memo,
} from 'react';
import { useRcbCamera, useRcbDevicePixelRatio } from '../camera/context';
import { rcbCameraCssZoom } from '../core/math';
import {
  createSvgBoard,
  seedInfiniteSvgViewport,
  snapInfiniteSvgViewportToCamera,
} from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import { append, setAttrs, setFill, setStroke, svgEl } from '@recombyn-native/components/rcb/scene/paint/svgDom';
import {
  getSceneShapesMount,
  getSceneWorldEpoch,
  getSceneWorldRoot,
  registerShapeHost,
  subscribeShapeHosts,
  syncSharedMountPaintOrder,
  unregisterShapeHost,
  updateShapeHostElement,
} from '@recombyn-native/components/rcb/shapes/shapeHostRegistry';
import NodeTitleLabel from '../selection/chrome/NodeTitleLabel';
import type { ArtboardFrame } from '@recombyn-native/components/rcb/frames/types';
import {
  FRAME_PLATE_STROKE,
  framePlateStrokeSceneWidth,
} from '@recombyn-native/components/rcb/frames/types';

type HtmlArtboardFrameProps = {
  frame: ArtboardFrame;
  selected?: boolean;
  onSelect?: () => void;
  onRename?: (name: string) => void;
  /** Drag the label to move the artboard. */
  onMove?: (x: number, y: number, opts?: { skipGrid?: boolean }) => void;
  onMoveStart?: () => void;
  /** Label drag ended (clear guides, etc.). */
  onMoveEnd?: () => void;
  /** Hide title while the frame is being moved. */
  hideTitle?: boolean;
  /** body under shapes; process above shapes (cover until run ends); label clickable */
  layer?: 'body' | 'process' | 'label';
  /** Unified stack z-index (interleaves with shapes). */
  zIndex?: number;
  /** PR9 ephemeral overlay — not read from SceneDocument. */
  aiGenerating?: boolean;
  aiProcessLabel?: string;
};

function paintFramePlate(
  layer: SVGGElement,
  frame: ArtboardFrame,
  selected: boolean,
  generating: boolean,
  zoom: number
): SVGGElement {
  while (layer.firstChild) layer.removeChild(layer.firstChild);

  const x = Number(frame.x) || 0;
  const y = Number(frame.y) || 0;
  const w = Math.max(1, Number(frame.width) || 1);
  const h = Math.max(1, Number(frame.height) || 1);
  const bg =
    generating
      ? '#e4ecf4'
      : frame.backgroundColor && frame.backgroundColor !== 'transparent'
        ? frame.backgroundColor
        : '#FFFFFF';

  const g = svgEl('g');
  append(layer, g);
  setAttrs(g, {
    transform: `translate(${x} ${y})`,
    'data-frame-id': frame.id,
    'data-scene-node-id': frame.id,
    'data-rcb-frame-plate': '1',
  });
  const anyG = g as unknown as {
    __sceneLeft?: number;
    __sceneTop?: number;
    sceneWidth?: number;
    sceneHeight?: number;
  };
  anyG.__sceneLeft = x;
  anyG.__sceneTop = y;
  anyG.sceneWidth = w;
  anyG.sceneHeight = h;

  const plate = svgEl('rect', {
    x: 0,
    y: 0,
    width: w,
    height: h,
    'data-baseline': '1',
    'data-radius-body': '1',
  });
  append(g, plate);
  setFill(plate, bg);
  // Idle: ~1 CSS px hairline after CSS camera scale (not non-scaling-stroke —
  // that still thickens under parent `scale(zoom)` and AA-fringes off-grid).
  // Selected: host chrome owns the blue box.
  plate.removeAttribute('vector-effect');
  if (selected) {
    setStroke(plate, 'none');
    plate.removeAttribute('shape-rendering');
  } else {
    setStroke(plate, {
      color: FRAME_PLATE_STROKE,
      width: framePlateStrokeSceneWidth(zoom),
    });
    // Prefer hard plate edges vs geometricPrecision soft fringe on deselected.
    setAttrs(plate, { 'shape-rendering': 'crispEdges' });
  }
  return g;
}

function HtmlArtboardFrame({
  frame,
  selected = false,
  onSelect,
  onRename,
  onMove,
  onMoveStart,
  onMoveEnd,
  hideTitle = false,
  layer = 'body',
  zIndex = 0,
  aiGenerating = false,
  aiProcessLabel,
}: HtmlArtboardFrameProps): ReactNode {
  const camera = useRcbCamera();
  const dpr = useRcbDevicePixelRatio();
  const z = rcbCameraCssZoom(camera);
  const inv = 1 / z;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<SVGGElement | null>(null);
  const generating =
    Boolean(aiGenerating) || String(frame.processStatus || '') === 'running';
  const processLabel = String(
    aiProcessLabel || frame.processLabel || 'Preparing…'
  );
  // Remount into shared world SVG when it appears (same as RcbShapeHost).
  // Private fallback SVGs stack via HTML z-index and cover shared shape paint.
  const [worldEpoch, setWorldEpoch] = useState(() => getSceneWorldEpoch());
  useEffect(
    () =>
      subscribeShapeHosts(() => {
        setWorldEpoch((prev) => {
          const next = getSceneWorldEpoch();
          return prev === next ? prev : next;
        });
      }),
    []
  );

  // World-layer process chrome (same lattice as the plate / control box).
  const processOverlayStyle = useMemo(
    (): CSSProperties => ({
      position: 'absolute',
      left: frame.x,
      top: frame.y,
      width: frame.width,
      height: frame.height,
    }),
    [frame.x, frame.y, frame.width, frame.height]
  );

  const processPillStyle = useMemo(
    (): CSSProperties => ({
      position: 'absolute',
      left: frame.x + frame.width / 2,
      top: frame.y + frame.height - 14 * inv,
      transform: `translate(-50%, -100%) scale(${inv})`,
      transformOrigin: 'center bottom',
    }),
    [frame.x, frame.y, frame.width, frame.height, inv]
  );

  // Remount only when plate geometry/fill changes. Do NOT remount on select /
  // zoom / zIndex — createSvgBoard appends at mount end, so a remount paints the
  // white plate over siblings (stuck when stackOrder is equal or sync races).
  const paintKey = [
    frame.id,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    frame.backgroundColor,
    generating ? 1 : 0,
  ].join('|');

  useLayoutEffect(() => {
    if (layer !== 'body') return undefined;
    const host = hostRef.current;
    if (!host) return undefined;

    const x = Number(frame.x) || 0;
    const y = Number(frame.y) || 0;
    const w = Math.max(1, Number(frame.width) || 1);
    const h = Math.max(1, Number(frame.height) || 1);
    const worldRoot = getSceneWorldRoot();
    const shapesMount = getSceneShapesMount();
    const { root, layer: sceneLayer, shared } = createSvgBoard(host, 1, 1, {
      infinite: true,
      sharedRoot: worldRoot,
      sharedMount: shapesMount,
    });
    layerRef.current = sceneLayer;
    // createSvgBoard tags shared layers as shape; frames must not share that attr
    // or shape-only reorder / hit paths treat the plate as a node layer.
    sceneLayer.removeAttribute('data-rcb-shape-layer');
    sceneLayer.setAttribute('data-rcb-frame-layer', frame.id);
    sceneLayer.setAttribute('data-z', String(zIndex));
    if (!shared) {
      seedInfiniteSvgViewport(root, { left: x, top: y, width: w, height: h });
      setAttrs(root, { 'data-frame-id': frame.id, 'data-rcb-frame-svg': '1' });
      snapInfiniteSvgViewportToCamera(root, camera, dpr);
    }
    const el = paintFramePlate(sceneLayer, frame, selected, generating, z);
    registerShapeHost({ nodeId: frame.id, root, layer: sceneLayer, el, kind: 'svg' });
    updateShapeHostElement(frame.id, el);

    if (shared && shapesMount && sceneLayer.parentNode === shapesMount) {
      syncSharedMountPaintOrder(shapesMount);
    }

    return () => {
      unregisterShapeHost(frame.id);
      try {
        if (shared) sceneLayer.remove();
        else root.remove();
      } catch {
        /* ignore */
      }
      if (!shared) host.innerHTML = '';
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, paintKey, worldEpoch]);

  // Selection / zoom hairline: repaint plate in place (do not remount the layer g).
  useLayoutEffect(() => {
    if (layer !== 'body') return;
    const sceneLayer = layerRef.current;
    if (!sceneLayer) return;
    const el = paintFramePlate(sceneLayer, frame, selected, generating, z);
    updateShapeHostElement(frame.id, el);
  }, [layer, selected, generating, z, paintKey, frame]);

  // Same as RcbShapeHost: update data-z + reorder without remounting the plate.
  useLayoutEffect(() => {
    if (layer !== 'body') return;
    const sceneLayer = layerRef.current;
    const shapesMount = getSceneShapesMount();
    if (!sceneLayer || !shapesMount || sceneLayer.parentNode !== shapesMount) return;
    sceneLayer.setAttribute('data-z', String(zIndex));
    syncSharedMountPaintOrder(shapesMount);
  }, [layer, zIndex]);
  if (layer === 'label') {
    return (
      <>
        <NodeTitleLabel
          box={{
            left: frame.x,
            top: frame.y,
            width: frame.width,
            height: frame.height,
          }}
          name={frame.name || 'Frame'}
          sizeWidth={frame.width}
          sizeHeight={frame.height}
          dataAttr="frame-label"
          icon="frame"
          dataProps={{ 'data-frame-id': frame.id }}
          hidden={hideTitle}
          onSelect={onSelect}
          onRename={onRename}
          onMove={onMove}
          onMoveStart={onMoveStart}
          onMoveEnd={onMoveEnd}
          originX={frame.x}
          originY={frame.y}
          renameAriaLabel="Frame name"
        />
      </>
    );
  }

  // Above SvgCanvas so paint/review/retry stays covered until the AI overlay clears.
  if (layer === 'process') {
    if (!generating) return null;
    return (
      <>
        <div
          data-artboard-process-shimmer
          data-frame-id={frame.id}
          className="rcb-artboard-process-shimmer pointer-events-none absolute z-[40] overflow-hidden"
          style={processOverlayStyle}
          aria-hidden
        />
        <div
          data-artboard-process-label
          data-frame-id={frame.id}
          className="pointer-events-none absolute z-[41] whitespace-nowrap rounded-full bg-[rgba(55,55,55,0.72)] px-2.5 py-1 text-[11px] font-medium leading-none text-white shadow-[0_2px_8px_rgba(15,23,42,0.18)]"
          style={processPillStyle}
        >
          {processLabel}
        </div>
      </>
    );
  }

  return (
    <>
      <div
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        // Plate paints in the shared world SVG via data-z. Do not mirror stack z on
        // this HTML anchor — a private-SVG fallback with high CSS z covers shapes
        // while still letting clicks through (world SVG is pointer-events: none).
        style={{ zIndex: 0 }}
        data-rcb-frame={frame.id}
        data-frame-id={frame.id}
      >
        <div
          ref={hostRef}
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          data-rcb-shape-host={frame.id}
          style={{ width: 0, height: 0, overflow: 'visible' }}
        />
      </div>
    </>
  );
}

export default memo(HtmlArtboardFrame);
