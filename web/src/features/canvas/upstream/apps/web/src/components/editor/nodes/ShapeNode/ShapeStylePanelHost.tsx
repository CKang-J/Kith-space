/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/nodes/ShapeNode/ShapeStylePanelHost.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  closeShapeStylePanel,
  patchDocumentNode,
} from '@recombyn-native/store/modules/editor';
import { nodeLeftTop } from '@recombyn-native/components/rcb/scene/paint/sceneToSvg';
import {
  RcbOverlayPortal,
  useRcbCamera,
  rcbSceneToScreen,
} from '@recombyn-native/components/rcb';
import { FillPanel, type FillPanelValue } from '@recombyn-native/components/editor/panels/FillPanel';
import {
  StrokePanel,
  type StrokePanelValue,
  type StrokeSides,
} from '@recombyn-native/components/editor/nodes/ShapeNode/StrokePanel';
import {
  CornerRadiusPanel,
  type CornerRadiiValue,
} from '@recombyn-native/components/editor/nodes/ShapeNode/CornerRadiusPanel';
import GradientHandlesOverlay from '@recombyn-native/components/editor/nodes/ShapeNode/GradientHandlesOverlay';
import MeshHandlesOverlay from '@recombyn-native/components/editor/nodes/ShapeNode/MeshHandlesOverlay';
import { parseStrokeStyle } from '@recombyn-native/components/rcb/scene/document/sceneStrokeStyle';
import {
  supportsSideStroke
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import {
  DEFAULT_FILL_IMAGE_ADJUST,
  fillImageFieldsFromAttrs,
  parseFillGradient,
  parseFillType,
  serializeFillGradient,
  serializeFillImageAdjust,
  type FillGradient,
} from '@recombyn-native/components/rcb/scene/document/sceneFill';
import {
  resolveStrokeAlign,
  resolveStrokeLinecap,
  resolveStrokeLinejoin,
  boolEffectAttr,
  inflateBoxByVisualOutset,
  inflateBoxByTextSelectionPad,
  geometryPatchForStrokeVisibilityToggle,
} from '@recombyn-native/components/rcb/scene/document/sceneEffects';
import {
  supportsFill,
  supportsCornerRadius
} from '@recombyn-native/components/rcb/scene/document/nodeCapabilities';
import {
  cornerVertexCount,
  isRadiusLinked,
  parseClosedPathRings,
  radiiFromAttrs,
  serializeRadiusVertices,
  vertexRadiiFromAttrs,
} from '@recombyn-native/components/rcb/scene/document/sceneRadii';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@recombyn-native/components/rcb/sceneNode';

type SceneBox = { left: number; top: number; width: number; height: number };

function resolvePanelGradient(
  fillGradient: unknown,
  fillType: 'linear' | 'radial' | 'angular' | 'diffuse',
  fillColor: unknown
): FillGradient {
  const g = parseFillGradient(fillGradient, fillType, String(fillColor ?? ''));
  g.type = fillType;
  return g;
}

/** Panel docked to the top-right of the selection (same pattern as eraser). */
function panelStyleTopRight(
  camera: { x: number; y: number; zoom: number },
  box: SceneBox
): CSSProperties {
  const gap = 16 / Math.max(0.05, camera.zoom);
  const { x, y } = rcbSceneToScreen(camera, box.left + box.width + gap, box.top);
  return {
    position: 'absolute',
    left: x,
    top: y,
    zIndex: 40,
  };
}

function unionBoxes(boxes: SceneBox[]): SceneBox | null {
  if (!boxes.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const b of boxes) {
    left = Math.min(left, b.left);
    top = Math.min(top, b.top);
    right = Math.max(right, b.left + b.width);
    bottom = Math.max(bottom, b.top + b.height);
  }
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/** Geometry AABB (fill / path) — gradient & mesh handles stay on this. */
function nodeGeomBox(document: SceneDocument, node: SceneNodeInput): SceneBox | null {
  if (!node) return null;
  const { left, top } = nodeLeftTop(document, node);
  return {
    left,
    top,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
}

/** Painted footprint including stroke outset — dock panels outside this. */
function nodeVisualBox(document: SceneDocument, node: SceneNodeInput): SceneBox | null {
  const geom = nodeGeomBox(document, node);
  if (!geom) return null;
  return inflateBoxByVisualOutset(inflateBoxByTextSelectionPad(geom, node), node);
}

function fillAttrsFromValue(
  next: FillPanelValue,
  shapeType?: unknown,
  opts?: { visible?: boolean }
) {
  const visible = opts?.visible !== false;
  return {
    ...(shapeType != null ? { shapeType } : {}),
    'fill-color': next.fillColor,
    'fill-type': next.fillType,
    'fill-opacity': next.fillOpacity ?? 100,
    'fill-enabled': visible ? 'true' : 'false',
    'fill-visible': visible ? 'true' : 'false',
    ...(next.fillType !== 'solid' && next.fillType !== 'image' && next.fillGradient
      ? { 'fill-gradient': next.fillGradient }
      : {}),
    ...(next.fillType === 'image'
      ? {
          'fill-image-src': next.fillImageSrc || '',
          'fill-image-fit': next.fillImageFit ?? 'fill',
          'fill-image-rotate': next.fillImageRotate ?? 0,
          'fill-image-adjust': serializeFillImageAdjust(
            next.fillImageAdjust ?? DEFAULT_FILL_IMAGE_ADJUST
          ),
        }
      : {}),
  };
}

function strokeAttrsFromValue(
  next: StrokePanelValue,
  opts?: { writeSides?: boolean; visible?: boolean }
) {
  const linecap = next.linecap ?? 'butt';
  const linejoin = next.linejoin ?? 'miter';
  const visible = opts?.visible !== false;
  const attrs: Record<string, unknown> = {
    'border-color': next.color,
    stroke: next.color,
    'stroke-opacity': Math.max(0, Math.min(100, Math.round(next.opacity))),
    'border-width': Math.max(0, Math.round(next.width) || 0),
    strokeStyle: next.style,
    strokeAlign: next.align ?? 'center',
    'stroke-align': next.align ?? 'center',
    strokeLinecap: linecap,
    'stroke-linecap': linecap,
    strokeLinejoin: linejoin,
    'stroke-linejoin': linejoin,
    'stroke-enabled': visible ? 'true' : 'false',
    'stroke-visible': visible ? 'true' : 'false',
  };
  if (opts?.writeSides && next.sides) {
    attrs.T = next.sides.T ? 'true' : 'false';
    attrs.R = next.sides.R ? 'true' : 'false';
    attrs.B = next.sides.B ? 'true' : 'false';
    attrs.L = next.sides.L ? 'true' : 'false';
  }
  return attrs;
}

function readFillValue(attrs: Record<string, unknown> | undefined): FillPanelValue {
  const a = attrs || {};
  return {
    fillType: parseFillType(a['fill-type']),
    fillColor: String(a['fill-color'] || '#FFFFFF'),
    fillOpacity: Number(a['fill-opacity'] ?? 100),
    fillGradient: a['fill-gradient'] != null ? String(a['fill-gradient']) : undefined,
    ...fillImageFieldsFromAttrs(a),
  };
}

function readStrokeSides(attrs: Record<string, unknown> | undefined): StrokeSides {
  const a = attrs || {};
  return {
    T: boolEffectAttr(a.T, true),
    R: boolEffectAttr(a.R, true),
    B: boolEffectAttr(a.B, true),
    L: boolEffectAttr(a.L, true),
  };
}

function readStrokeCorners(
  attrs: Record<string, unknown> | undefined,
  vertexCount = 4
): CornerRadiiValue {
  const r = radiiFromAttrs(attrs);
  const n = Math.max(3, Math.round(vertexCount) || 4);
  const vertices = vertexRadiiFromAttrs(attrs, n);
  // Rect: default linked. Multi-corner path/polygon: default unlocked so each
  // vertex is editable (explicit radiusLinked=true still locks them together).
  const linked =
    n === 4
      ? isRadiusLinked(attrs)
      : attrs?.radiusLinked === true || attrs?.radiusLinked === 'true';
  return {
    tl: r.tl,
    tr: r.tr,
    br: r.br,
    bl: r.bl,
    linked: Boolean(linked),
    vertices,
  };
}

function readStrokeValue(attrs: Record<string, unknown> | undefined): StrokePanelValue {
  const a = attrs || {};
  const style = parseStrokeStyle(a.strokeStyle);
  const widthNum = Number(a['border-width'] ?? a.strokeWidth ?? 1);
  const shapeType = String(a.shapeType || '');
  // Pencil default round; pen + line + arrow default butt (stroke panel).
  const roundCaps = shapeType === 'pencil';
  const hasCapAttr = a.strokeLinecap != null || a['stroke-linecap'] != null;
  const hasJoinAttr = a.strokeLinejoin != null || a['stroke-linejoin'] != null;
  return {
    color: String(a['border-color'] || a.stroke || '#333333'),
    opacity: Math.max(0, Math.min(100, Number(a['stroke-opacity'] ?? 100))),
    width: Number.isFinite(widthNum) ? widthNum : 1,
    style,
    align: resolveStrokeAlign(a),
    linecap: hasCapAttr
      ? resolveStrokeLinecap(a)
      : roundCaps
        ? 'round'
        : 'butt',
    linejoin: hasJoinAttr
      ? resolveStrokeLinejoin(a)
      : roundCaps
        ? 'round'
        : 'miter',
    sides: readStrokeSides(a),
  };
}

/**
 * Fill / stroke editor docked to the right of the selection.
 * Top selection toolbar is suppressed while this is open (see SvgCanvas suppressChrome).
 */
function ShapeStylePanelHost({ document }: { document: SceneDocument }): ReactNode {
  const dispatch = useDispatch();
  const camera = useRcbCamera();
  const panel = useSelector(
    (s: any) =>
      s.editor.shapeStylePanel as null | {
        kind: 'fill' | 'stroke' | 'radius';
        nodeIds: string[];
      }
  );
  const selectedNodeIds = useSelector((s: any) => s.editor.selectedNodeIds as string[]);
  const [meshSelectedIndex, setMeshSelectedIndex] = useState(0);
  const [meshShowGuides, setMeshShowGuides] = useState(true);
  const [gradientStopIndex, setGradientStopIndex] = useState(0);

  const panelFillType = useMemo(() => {
    if (!panel || panel.kind !== 'fill') return null;
    const attrs = document?.deltaSetLike?.[panel.nodeIds[0]]?.attrs as
      | Record<string, unknown>
      | undefined;
    return parseFillType(String(attrs?.['fill-type'] || 'solid'));
  }, [panel, document]);

  useEffect(() => {
    setMeshSelectedIndex(0);
    setGradientStopIndex(0);
  }, [panel?.nodeIds?.join(','), panel?.kind, panelFillType]);

  useEffect(() => {
    if (!panel) return;
    const same =
      panel.nodeIds.length === selectedNodeIds.length &&
      panel.nodeIds.every((id) => selectedNodeIds.includes(id));
    if (!same) dispatch(closeShapeStylePanel());
  }, [panel, selectedNodeIds, dispatch]);

  useEffect(() => {
    if (!panel || panel.kind !== 'fill') return;
    const anyFill = panel.nodeIds.some((id) => supportsFill(document?.deltaSetLike?.[id]));
    if (!anyFill) dispatch(closeShapeStylePanel());
  }, [panel, document, dispatch]);

  useEffect(() => {
    if (!panel || panel.kind !== 'radius') return;
    const anyRadius = panel.nodeIds.some((id) =>
      supportsCornerRadius(document?.deltaSetLike?.[id])
    );
    if (!anyRadius) dispatch(closeShapeStylePanel());
  }, [panel, document, dispatch]);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dispatch(closeShapeStylePanel());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, dispatch]);

  const box = useMemo(() => {
    if (!panel) return null;
    const boxes = panel.nodeIds
      .map((id) => nodeVisualBox(document, document?.deltaSetLike?.[id]))
      .filter(Boolean) as SceneBox[];
    return unionBoxes(boxes);
  }, [document, panel]);

  if (!panel || !box) return null;

  const firstId = panel.nodeIds[0];
  const firstNode = document?.deltaSetLike?.[firstId];
  const firstAttrs = firstNode?.attrs as Record<string, unknown> | undefined;
  const close = () => dispatch(closeShapeStylePanel());
  const fillValue = readFillValue(firstAttrs);
  const fillType = parseFillType(fillValue.fillType);
  const showGradientHandles =
    panel.kind === 'fill' &&
    (fillType === 'linear' || fillType === 'radial' || fillType === 'angular');
  const showMeshHandles = panel.kind === 'fill' && fillType === 'diffuse';
  const handleBox = nodeGeomBox(document, firstNode) || box;
  const nodeAngle = Number(firstAttrs?.angle);
  const gradient: FillGradient | null = showGradientHandles
    ? resolvePanelGradient(
        fillValue.fillGradient,
        fillType as 'linear' | 'radial' | 'angular',
        fillValue.fillColor
      )
    : null;
  const meshGradient: FillGradient | null = showMeshHandles
    ? resolvePanelGradient(fillValue.fillGradient, 'diffuse', fillValue.fillColor)
    : null;

  const fillLayerVisible =
    boolEffectAttr(firstAttrs?.['fill-enabled'], true) &&
    boolEffectAttr(firstAttrs?.['fill-visible'], true);
  const strokeLayerVisible =
    boolEffectAttr(firstAttrs?.['stroke-enabled'], true) &&
    boolEffectAttr(firstAttrs?.['stroke-visible'], true);

  const applyFill = (next: FillPanelValue) => {
    for (const id of panel.nodeIds) {
      const node = document?.deltaSetLike?.[id];
      if (!supportsFill(node)) continue;
      const shapeType = node?.attrs?.shapeType;
      const a = node?.attrs || {};
      const visible =
        boolEffectAttr(a['fill-enabled'], true) && boolEffectAttr(a['fill-visible'], true);
      dispatch(
        patchDocumentNode({
          nodeId: id,
          patch: { attrs: fillAttrsFromValue(next, shapeType, { visible }) },
        })
      );
    }
  };

  const applyGradient = (next: FillGradient) => {
    applyFill({
      ...fillValue,
      fillType: next.type,
      fillGradient: serializeFillGradient(next),
    });
  };

  const applyStroke = (next: StrokePanelValue) => {
    for (const id of panel.nodeIds) {
      const node = document?.deltaSetLike?.[id];
      if (!node) continue;
      const a = node?.attrs || {};
      const visible =
        boolEffectAttr(a['stroke-enabled'], true) && boolEffectAttr(a['stroke-visible'], true);
      const t = String(a.shapeType || node.key || '');
      const closedAttr = a.closed;
      const closedExplicit =
        closedAttr === true || closedAttr === 'true'
          ? true
          : closedAttr === false || closedAttr === 'false'
            ? false
            : null;
      const closed =
        closedExplicit ??
        (typeof a.path === 'string' && /z\s*$/i.test(String(a.path).trim()));
      const openStroke =
        t === 'line' ||
        t === 'arrow' ||
        t === 'pencil' ||
        ((t === 'pen' || t === 'path' || node.key === 'path') && !closed);
      dispatch(
        patchDocumentNode({
          nodeId: id,
          patch: {
            attrs: strokeAttrsFromValue(next, {
              writeSides: !openStroke,
              visible,
            }),
          },
        })
      );
    }
  };

  const setFillLayerVisible = (visible: boolean) => {
    for (const id of panel.nodeIds) {
      const node = document?.deltaSetLike?.[id];
      if (!supportsFill(node)) continue;
      const shapeType = node?.attrs?.shapeType;
      dispatch(
        patchDocumentNode({
          nodeId: id,
          patch: {
            attrs: {
              ...(shapeType != null ? { shapeType } : {}),
              'fill-enabled': visible ? 'true' : 'false',
              'fill-visible': visible ? 'true' : 'false',
            },
          },
        })
      );
    }
  };

  const setStrokeLayerVisible = (visible: boolean) => {
    for (const id of panel.nodeIds) {
      const node = document?.deltaSetLike?.[id];
      if (!node) continue;
      const shapeType = node?.attrs?.shapeType;
      const geom = geometryPatchForStrokeVisibilityToggle(node, visible);
      dispatch(
        patchDocumentNode({
          nodeId: id,
          patch: {
            ...(geom || {}),
            attrs: {
              ...(shapeType != null ? { shapeType } : {}),
              'stroke-enabled': visible ? 'true' : 'false',
              'stroke-visible': visible ? 'true' : 'false',
            },
          },
        })
      );
    }
  };

  const applyRadius = (next: CornerRadiiValue) => {
    for (const id of panel.nodeIds) {
      const node = document?.deltaSetLike?.[id];
      if (!node || !supportsCornerRadius(node)) continue;
      const count = cornerVertexCount(node);
      const vertices =
        next.vertices && next.vertices.length
          ? Array.from({ length: count }, (_, i) =>
              Math.max(
                0,
                Math.round(
                  next.vertices![i] ??
                    next.vertices![next.vertices!.length - 1] ??
                    next.tl ??
                    0
                )
              )
            )
          : vertexRadiiFromAttrs(
              {
                radiusTL: next.tl,
                radiusTR: next.tr,
                radiusBR: next.br,
                radiusBL: next.bl,
                radiusLinked: next.linked ? 'true' : 'false',
              },
              count
            );
      // Honor explicit link toggle — do not re-link just because corners match.
      dispatch(
        patchDocumentNode({
          nodeId: id,
          patch: {
            attrs: {
              radiusTL: Math.max(0, Math.round(next.tl) || 0),
              radiusTR: Math.max(0, Math.round(next.tr) || 0),
              radiusBR: Math.max(0, Math.round(next.br) || 0),
              radiusBL: Math.max(0, Math.round(next.bl) || 0),
              radiusLinked: next.linked ? 'true' : 'false',
              radiusVertices: serializeRadiusVertices(vertices),
              // Keep legacy aliases in sync for inventory / import paths.
              radius: Math.max(
                0,
                Math.round(Math.max(next.tl, next.tr, next.br, next.bl) || 0)
              ),
              cornerRadius: Math.max(
                0,
                Math.round(Math.max(next.tl, next.tr, next.br, next.bl) || 0)
              ),
            },
          },
        })
      );
    }
  };

  const shapeType = String(firstAttrs?.shapeType || firstNode?.key || 'rect');
  const closedAttr = firstAttrs?.closed;
  const pathClosedExplicit =
    closedAttr === true || closedAttr === 'true'
      ? true
      : closedAttr === false || closedAttr === 'false'
        ? false
        : null;
  const pathClosed =
    pathClosedExplicit ??
    (typeof firstAttrs?.path === 'string' && /z\s*$/i.test(String(firstAttrs.path).trim()));
  /**
   * Open strokes (line / arrow / open pen / pencil): show linecap (端点).
   * Side toggles (All / T / L / B / R) only for rect-like nodes — never for pen/path.
   */
  const isOpenStroke =
    shapeType === 'line' ||
    shapeType === 'arrow' ||
    shapeType === 'pencil' ||
    ((shapeType === 'pen' || shapeType === 'path' || firstNode?.key === 'path') && !pathClosed);
  const showLinecap = isOpenStroke;
  const showAlign = !isOpenStroke;
  const showSides = supportsSideStroke(firstNode);
  const cornerMax = Math.max(
    8,
    ...panel.nodeIds.map((id) => {
      const n = document?.deltaSetLike?.[id];
      if (!n) return 0;
      const boxCap = Math.floor(Math.min(Number(n.width) || 0, Number(n.height) || 0) / 2);
      const d = String(n.attrs?.path || '');
      const shapeType = String(n.attrs?.shapeType || n.key || '');
      if (d && (shapeType === 'pen' || shapeType === 'path' || n.key === 'path')) {
        const rings = parseClosedPathRings(d);
        let shortest = Infinity;
        for (const ring of rings) {
          for (let i = 0; i < ring.length; i += 1) {
            const a = ring[i];
            const b = ring[(i + 1) % ring.length];
            shortest = Math.min(shortest, Math.hypot(b[0] - a[0], b[1] - a[1]));
          }
        }
        if (Number.isFinite(shortest) && shortest < Infinity) {
          return Math.min(boxCap || shortest / 2, Math.max(8, Math.floor(shortest / 2)));
        }
      }
      return boxCap;
    })
  );

  return (
    <>
      {showGradientHandles && gradient ? (
        <GradientHandlesOverlay
          box={handleBox}
          angle={Number.isFinite(nodeAngle) ? nodeAngle : 0}
          gradient={gradient}
          onChange={applyGradient}
          onActiveStopChange={setGradientStopIndex}
        />
      ) : null}
      {showMeshHandles && meshGradient ? (
        <MeshHandlesOverlay
          box={handleBox}
          angle={Number.isFinite(nodeAngle) ? nodeAngle : 0}
          gradient={meshGradient}
          selectedIndex={meshSelectedIndex}
          showGuides={meshShowGuides}
          onChange={applyGradient}
          onActivePointChange={setMeshSelectedIndex}
        />
      ) : null}
      <RcbOverlayPortal>
        <div
          className="pointer-events-auto"
          style={panelStyleTopRight(camera, box)}
          data-shape-style-panel
          onPointerDown={(e) => e.stopPropagation()}
        >
          {panel.kind === 'fill' ? (
            <FillPanel
              value={fillValue}
              onChange={applyFill}
              title={'颜色'}
              onClose={close}
              meshSelectedIndex={meshSelectedIndex}
              onMeshSelectedIndexChange={setMeshSelectedIndex}
              meshShowGuides={meshShowGuides}
              onMeshShowGuidesChange={setMeshShowGuides}
              activeStopIndex={gradientStopIndex}
              onActiveStopIndexChange={setGradientStopIndex}
              layerVisible={fillLayerVisible}
              onLayerVisibleChange={setFillLayerVisible}
            />
          ) : panel.kind === 'radius' ? (
            <CornerRadiusPanel
              value={readStrokeCorners(
                firstAttrs,
                firstNode ? cornerVertexCount(firstNode) : 4
              )}
              onChange={applyRadius}
              title={'圆角'}
              onClose={close}
              max={cornerMax}
              vertexCount={firstNode ? cornerVertexCount(firstNode) : 4}
            />
          ) : (
            <StrokePanel
              value={readStrokeValue(firstAttrs)}
              onChange={applyStroke}
              title={'描边'}
              onClose={close}
              showLinecap={showLinecap}
              showAlign={showAlign}
              showSides={showSides}
              layerVisible={strokeLayerVisible}
              onLayerVisibleChange={setStrokeLayerVisible}
            />
          )}
        </div>
      </RcbOverlayPortal>
    </>
  );
}

export default memo(ShapeStylePanelHost);
