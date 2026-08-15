/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/chrome/EditorMinimap.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useCallback, useMemo, useRef, type PointerEvent as ReactPointerEvent, type ReactNode, memo } from 'react';
import type { ArtboardFrame } from '@recombyn-native/components/rcb/frames/types';
import { rcbViewportSceneBounds, type RcbCamera } from '@recombyn-native/components/rcb';
import {
  listSceneNodes
} from '@recombyn-native/components/rcb/scene/document/sceneDocument';
import { resolveFillColor, resolveStroke } from '@recombyn-native/components/rcb/scene/document/sceneEffects';
import { parseNodeTextStyle } from '@recombyn-native/components/rcb/scene/document/sceneText';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

type Box = { x: number; y: number; width: number; height: number };

const MAP_W = 200;
const MAP_H = 128;
const PAD = 10;

function unionBox(a: Box | null, b: Box): Box {
  if (!a) return { ...b };
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function nodeSceneBox(doc: SceneDocument, node: SceneNodeInput): Box | null {
  if (!node) return null;
  const { left, top } = nodeLeftTop(doc, node);
  const w = Math.max(1, Number(node.width) || 0);
  const h = Math.max(1, Number(node.height) || 0);
  if (w < 1 && h < 1) return null;
  return { x: left, y: top, width: w, height: h };
}

function sceneContentBounds(doc: SceneDocument, frames: ArtboardFrame[]): Box {
  let box: Box | null = null;
  for (const f of frames) {
    box = unionBox(box, {
      x: f.x,
      y: f.y,
      width: Math.max(1, f.width),
      height: Math.max(1, f.height),
    });
  }
  for (const { node } of listSceneNodes(doc)) {
    const nb = nodeSceneBox(doc, node);
    if (!nb) continue;
    if (nb.width < 2 && nb.height < 2) continue;
    box = unionBox(box, nb);
  }
  if (!box) return { x: 0, y: 0, width: 1200, height: 800 };
  const pad = 80;
  return {
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };
}

function minimapNodeColor(node: SceneNodeInput): string {
  const key = String(node?.key || '');
  if (key === 'image' || key === 'svg') return 'rgba(100,116,139,0.55)';
  if (key === 'text') {
    const style = parseNodeTextStyle(node?.attrs || {});
    return style.fill || '#64748b';
  }
  const fill = resolveFillColor(node, '#94a3b8');
  if (fill === 'rgba(0,0,0,0)' || fill === 'transparent') {
    const { stroke } = resolveStroke(node, '#64748b');
    if (stroke && stroke !== 'transparent') return stroke;
    return '#94a3b8';
  }
  return fill;
}

type Props = {
  document: SceneDocument;
  frames: ArtboardFrame[];
  camera: RcbCamera;
  stageEl: HTMLElement | null;
  activeFrameId?: string | null;
  selectedFrameIds?: string[];
  selectedNodeIds?: string[];
  onCameraChange: (next: RcbCamera | ((c: RcbCamera) => RcbCamera)) => void;
  canvasBg?: string;
};

/**
 * Bottom-left minimap: artboards + scene nodes + viewport outline; click/drag to pan.
 */
function EditorMinimap({
  document,
  frames,
  camera,
  stageEl,
  activeFrameId,
  selectedFrameIds = [],
  selectedNodeIds = [],
  onCameraChange,
  canvasBg,
}: Props): ReactNode {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number } | null>(null);

  const stageSize = useMemo(() => {
    if (!stageEl) return { width: 1, height: 1 };
    const r = stageEl.getBoundingClientRect();
    return { width: Math.max(1, r.width), height: Math.max(1, r.height) };
  }, [stageEl, camera.x, camera.y, camera.zoom]);

  const viewport = useMemo(
    () => rcbViewportSceneBounds(camera, stageSize),
    [camera, stageSize]
  );

  const world = useMemo(() => {
    const content = sceneContentBounds(document, frames);
    return unionBox(content, viewport);
  }, [document, frames, viewport]);

  const scale = useMemo(() => {
    const innerW = MAP_W - PAD * 2;
    const innerH = MAP_H - PAD * 2;
    return Math.min(innerW / world.width, innerH / world.height);
  }, [world]);

  const origin = useMemo(() => {
    const drawnW = world.width * scale;
    const drawnH = world.height * scale;
    return {
      x: PAD + (MAP_W - PAD * 2 - drawnW) / 2,
      y: PAD + (MAP_H - PAD * 2 - drawnH) / 2,
    };
  }, [world, scale]);

  const toMap = useCallback(
    (sx: number, sy: number) => ({
      x: origin.x + (sx - world.x) * scale,
      y: origin.y + (sy - world.y) * scale,
    }),
    [origin, world, scale]
  );

  const panToScene = useCallback(
    (sceneX: number, sceneY: number) => {
      const z = Math.max(0.05, camera.zoom || 1);
      onCameraChange({
        zoom: camera.zoom,
        x: stageSize.width / 2 - sceneX * z,
        y: stageSize.height / 2 - sceneY * z,
      });
    },
    [camera.zoom, onCameraChange, stageSize.height, stageSize.width]
  );

  const sceneFromLocal = useCallback(
    (localX: number, localY: number) => ({
      x: world.x + (localX - origin.x) / scale,
      y: world.y + (localY - origin.y) / scale,
    }),
    [world, origin, scale]
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = rootRef.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId };
    const r = el.getBoundingClientRect();
    const localX = e.clientX - r.left;
    const localY = e.clientY - r.top;
    const scene = sceneFromLocal(localX, localY);
    panToScene(scene.x, scene.y);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const scene = sceneFromLocal(e.clientX - r.left, e.clientY - r.top);
    panToScene(scene.x, scene.y);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try {
      rootRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const vp = toMap(viewport.x, viewport.y);
  const vpW = Math.max(2, viewport.width * scale);
  const vpH = Math.max(2, viewport.height * scale);
  const selectedFrames = new Set(selectedFrameIds);
  const selectedNodes = new Set(selectedNodeIds);
  const nodes = listSceneNodes(document);

  return (
    <div className="pointer-events-auto mb-2 w-[200px] rounded-xl bg-[var(--surface)] p-2 shadow-[0_8px_24px_rgba(0,0,0,0.18)] ring-1 ring-[var(--line)]">
      <div
        ref={rootRef}
        className="relative h-[128px] cursor-crosshair overflow-hidden rounded-lg bg-[var(--canvas)]"
        style={canvasBg ? { background: canvasBg } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {frames.map((f) => {
          const p = toMap(f.x, f.y);
          const w = Math.max(2, f.width * scale);
          const h = Math.max(2, f.height * scale);
          const isActive = f.id === activeFrameId || selectedFrames.has(f.id);
          return (
            <div
              key={f.id}
              className="absolute box-border"
              style={{
                left: p.x,
                top: p.y,
                width: w,
                height: h,
                background: f.backgroundColor || '#ffffff',
                outline: isActive ? '1.5px solid #3b82f6' : '1px solid rgba(0,0,0,0.18)',
                boxShadow: '0 0 0 0.5px rgba(255,255,255,0.4)',
              }}
              title={f.name || f.id}
            />
          );
        })}
        {nodes.map(({ id, node }) => {
          const nb = nodeSceneBox(document, node);
          if (!nb) return null;
          const p = toMap(nb.x, nb.y);
          const w = Math.max(2, nb.width * scale);
          const h = Math.max(2, nb.height * scale);
          const selected = selectedNodes.has(id);
          return (
            <div
              key={id}
              className="pointer-events-none absolute box-border"
              style={{
                left: p.x,
                top: p.y,
                width: w,
                height: h,
                background: minimapNodeColor(node),
                outline: selected ? '1.5px solid #3b82f6' : '1px solid rgba(0,0,0,0.2)',
                borderRadius: 1,
              }}
            />
          );
        })}
        <div
          className="pointer-events-none absolute box-border border border-[#3b82f6] bg-[#3b82f6]/15"
          style={{ left: vp.x, top: vp.y, width: vpW, height: vpH }}
        />
      </div>
    </div>
  );
}

export default memo(EditorMinimap);
